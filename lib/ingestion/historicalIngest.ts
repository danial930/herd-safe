/**
 * Historical ingestion for FARM and TRANSPORT_ROUTE checkpoints
 * (PROJECT_GUIDE.md Section 5 & 13) — the reusable core, called by the
 * standalone `scripts/ingest-historical.ts` CLI. As of the credit-budget
 * review, the automatic Add-Farm pipeline (`scripts/run-farm-pipeline.ts`)
 * no longer calls this by default for new farms — see that file's header
 * comment — but it's still available to run manually against a specific
 * checkpoint when you want to spend the credits on a real multi-year pull.
 *
 * Pulls real per-hour temperature+humidity for one representative peak-heat
 * week (HISTORICAL_SAMPLE_WEEK) in each of HISTORICAL_YEARS, computes
 * THI/category/AQI/worker-comfort per hour, writes ComputedRisk rows, then
 * runs the schedule optimizer + multi-year backtest and writes a
 * ScheduleRecommendation.
 *
 * Cache-first and idempotent (Section 7, rule 4): every FortyGuard call
 * checks HeatmapCache/EnvParamsCache first — re-running after a crash
 * resumes rather than re-pulling. If you deliberately stop short of a full
 * pull (e.g. to control credit spend), use
 * scripts/recompute-recommendation.ts to compute a recommendation from
 * whatever complete years are cached, without pulling anything more.
 *
 * GATED: a full multi-year pull for one checkpoint costs ~2.1M credits
 * (HISTORICAL_YEARS.length * sampleWeekDates.length heatmap calls at
 * ~4,220 credits each) — more than the entire hackathon key's budget. This
 * is not reachable from the live Add-Farm/Edit-Farm flow at all (that
 * pipeline only calls ingestCurrentCheckpoint — see
 * scripts/run-farm-pipeline.ts), and as a second line of defense this
 * function itself refuses to run unless ALLOW_HISTORICAL_INGESTION=true is
 * set in the environment, so it can't be triggered by accident even via the
 * standalone CLI. Set it deliberately, for one checkpoint, when you actually
 * want to spend the credits.
 */
import { HISTORICAL_SAMPLE_WEEK, HISTORICAL_YEARS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import type { HourlyThiPoint } from "@/lib/exposure/optimizer";
import type { FortyGuardClient } from "@/lib/fortyguard/client";
import { polygonCentroid } from "@/lib/fortyguard/geo";
import type { Checkpoint } from "@/lib/generated/prisma";
import { pullRealHourlyClimateForDay } from "./climatePull";
import { computeAndStoreScheduleRecommendation } from "./computeAndStoreRecommendation";
import { calculateTHI, categorizeTHI } from "@/lib/risk/thi";
import { calculateWorkerComfort } from "@/lib/risk/workerComfort";

function sampleWeekDates(year: number): string[] {
  const { month, startDay, endDay } = HISTORICAL_SAMPLE_WEEK;
  const dates: string[] = [];
  for (let day = startDay; day <= endDay; day++) {
    dates.push(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }
  return dates;
}

function checkpointLatLon(checkpoint: Pick<Checkpoint, "latitude" | "longitude" | "polygonGeoJson">): {
  latitude: number;
  longitude: number;
} {
  if (checkpoint.polygonGeoJson) {
    return polygonCentroid(checkpoint.polygonGeoJson as never);
  }
  return { latitude: checkpoint.latitude, longitude: checkpoint.longitude };
}

export async function ingestHistoricalCheckpoint(
  client: FortyGuardClient,
  checkpointId: string,
  onProgress?: (message: string) => void,
): Promise<void> {
  if (process.env.ALLOW_HISTORICAL_INGESTION !== "true") {
    throw new Error(
      "Historical ingestion is gated behind ALLOW_HISTORICAL_INGESTION=true (unset in the live Add-Farm flow by " +
        "design — a full multi-year pull costs ~2.1M credits per checkpoint). Set it explicitly in your shell " +
        "before running scripts/ingest-historical.ts if you really want to spend the credits.",
    );
  }

  const checkpoint = await prisma.checkpoint.findUniqueOrThrow({ where: { id: checkpointId } });
  if (checkpoint.type === "STORAGE") {
    throw new Error(
      "ingestHistoricalCheckpoint is for FARM/TRANSPORT_ROUTE checkpoints — use ingestCurrentCheckpoint for STORAGE",
    );
  }

  const { latitude, longitude } = checkpointLatLon(checkpoint);
  const perYearSeries: Record<string, HourlyThiPoint[]> = {};

  for (const year of HISTORICAL_YEARS) {
    const series: HourlyThiPoint[] = [];
    for (const date of sampleWeekDates(year)) {
      onProgress?.(`[${checkpoint.name}] pulling ${date}...`);
      const hourlySamples = await pullRealHourlyClimateForDay(client, checkpoint.id, latitude, longitude, date);

      for (const sample of hourlySamples) {
        const thi = calculateTHI(sample.temperatureC, sample.humidityPct);
        const category = categorizeTHI(thi);
        const workerComfort = calculateWorkerComfort(category, sample.aqi);
        const date00 = new Date(`${date}T00:00:00.000Z`);

        await prisma.computedRisk.upsert({
          where: { checkpointId_date_hour: { checkpointId: checkpoint.id, date: date00, hour: sample.hour } },
          create: {
            checkpointId: checkpoint.id,
            date: date00,
            hour: sample.hour,
            temperatureC: sample.temperatureC,
            humidityPct: sample.humidityPct,
            thiValue: thi,
            thiCategory: category,
            aqi: sample.aqi,
            workerComfort,
          },
          update: {
            temperatureC: sample.temperatureC,
            humidityPct: sample.humidityPct,
            thiValue: thi,
            thiCategory: category,
            aqi: sample.aqi,
            workerComfort,
          },
        });

        series.push({ date, hour: sample.hour, thi });
      }
    }
    perYearSeries[String(year)] = series;
  }

  await computeAndStoreScheduleRecommendation(checkpoint, perYearSeries, (msg) =>
    onProgress?.(`[${checkpoint.name}] ${msg}`),
  );
}
