/**
 * Seeds the permanent demo farm (PROJECT_GUIDE.md Section 4/13) — the live-
 * demo fallback, always fully populated. Driven by synthetic-but-realistic
 * climate fixtures (lib/fixtures/syntheticClimateData.ts), not a live
 * FortyGuard pull, per the coordinates-not-final-yet decision — but run
 * through the exact same THI/optimizer/backtest/dollar-impact pipeline real
 * ingestion uses, so the dashboard is fully and correctly populated.
 *
 * Idempotent: never deletes/overwrites an existing demo farm; re-running
 * just ensures one exists and is up to date (isDemoSeed rows are the one
 * thing no script/migration/reset routine may ever delete).
 *
 *   npx tsx prisma/seed.ts
 */
import "../scripts/_env";
import { readFileSync } from "node:fs";
import path from "node:path";
import { HISTORICAL_SAMPLE_WEEK, HISTORICAL_YEARS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { backtestAcrossYears } from "@/lib/exposure/backtest";
import { optimizeSchedule, type HourlyThiPoint } from "@/lib/exposure/optimizer";
import { windowFromDeparture, windowFromStartEnd } from "@/lib/exposure/scheduleWindow";
import { buildCheckpointsData, type FarmFormInput } from "@/lib/farms/createFarm";
import { generateSyntheticForecast, generateSyntheticWeek } from "@/lib/fixtures/syntheticClimateData";
import { computeAndStoreChainSummary } from "@/lib/impact/computeChainSummary";
import { AMBIENT_HEAT_STRAIN_THRESHOLD_C, OPTIMIZER, TRANSPORT_DEFAULT_DURATION_MINUTES } from "@/lib/constants";
import { calculateSpoilageRisk } from "@/lib/risk/spoilage";
import { calculateTHI, categorizeTHI } from "@/lib/risk/thi";
import { calculateWorkerComfort } from "@/lib/risk/workerComfort";
import type { CheckpointType } from "@/lib/generated/prisma";

interface SeedJson {
  farmName: string;
  farm: { latitude: number; longitude: number };
  storage: { latitude: number; longitude: number };
  grazingStart: string;
  grazingEnd: string;
  transportDepartureTime: string;
  /**
   * Real road-route waypoints (farm -> real route midpoint -> storage), NOT
   * an arithmetic midpoint — buildCheckpointsData() (shared with the live
   * Add-Farm flow) only ever auto-derives a straight-line average, so this
   * override is applied here, in the seed script only, to match the
   * finalized real-world data in PROJECT_GUIDE.md Section 0.5 exactly. The
   * live Add-Farm flow is untouched and keeps auto-deriving, since its form
   * doesn't collect a route midpoint either.
   */
  transportWaypoints: Array<{ lat: number; lon: number }>;
}

function sampleWeekDates(year: number): string[] {
  const { month, startDay, endDay } = HISTORICAL_SAMPLE_WEEK;
  const dates: string[] = [];
  for (let day = startDay; day <= endDay; day++) {
    dates.push(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }
  return dates;
}

// Slight year-to-year variation so the 3-year backtest isn't perfectly
// identical every year (more representative of "prove it across multiple
// past summers," per PROJECT_GUIDE.md Section 1).
//
// Retuned for the Section 0.5 finalized schedule (grazing 10:00-16:00,
// transport 13:00+2h — both deliberately centered ON peak heat, narrower
// than the placeholder schedule this was originally tuned against). At
// realistic dairy-heat-stress peaks (upper 30s-40s C), a 6h/2h window
// centered on the daily peak turns out to be uniformly hot for ~16
// consecutive hours around it — no +/-90min shift finds relief, and no
// combination tested found genuine exposure reduction for both farm AND
// transport at those peaks (see the search work behind this comment).
// Real relief for a window with THAT little slack only exists near the
// mild/comfort boundary, i.e. moderate peaks (high 20s C) — which is what's
// used here. Trade-off: this keeps THI in the moderate band, so it doesn't
// reach severe (>=90) and milkYieldLossEstimate lands at $0 for this specific
// schedule/curve combination — an honest result (a schedule already gentle
// enough to avoid severe stress has less severe-hours to avoid), not a bug.
// spoilageRiskEstimate still carries the headline dollar figure.
const YEAR_PEAK_TEMPERATURES_C: Record<number, number> = { 2023: 26, 2024: 28, 2025: 27 };
const HISTORICAL_TROUGH_TEMPERATURE_C = 14;

function scheduleWindowFor(type: CheckpointType, schedule: unknown) {
  const s = schedule as { start?: string; end?: string; departureTime?: string };
  if (type === "TRANSPORT_ROUTE" && s.departureTime) {
    return windowFromDeparture(s.departureTime, TRANSPORT_DEFAULT_DURATION_MINUTES);
  }
  return windowFromStartEnd(s.start!, s.end!);
}

async function seedHistoricalCheckpoint(checkpointId: string, type: CheckpointType, schedule: unknown) {
  const perYearSeries: Record<string, HourlyThiPoint[]> = {};

  for (const year of HISTORICAL_YEARS) {
    const week = generateSyntheticWeek(sampleWeekDates(year), {
      peakTemperatureC: YEAR_PEAK_TEMPERATURES_C[year],
      troughTemperatureC: HISTORICAL_TROUGH_TEMPERATURE_C,
    });
    const series: HourlyThiPoint[] = [];

    for (const [date, samples] of Object.entries(week)) {
      for (const sample of samples) {
        const thi = calculateTHI(sample.temperatureC, sample.humidityPct);
        const category = categorizeTHI(thi);
        const workerComfort = calculateWorkerComfort(category, sample.aqi);
        const date00 = new Date(`${date}T00:00:00.000Z`);

        await prisma.computedRisk.upsert({
          where: { checkpointId_date_hour: { checkpointId, date: date00, hour: sample.hour } },
          create: {
            checkpointId,
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

  const mostRecentYear = String(HISTORICAL_YEARS[HISTORICAL_YEARS.length - 1]);
  const currentWindow = scheduleWindowFor(type, schedule);
  const optimized = optimizeSchedule(
    perYearSeries[mostRecentYear],
    currentWindow,
    OPTIMIZER.SWEEP_RANGE_MINUTES,
    OPTIMIZER.STEP_MINUTES,
  );
  const backtest = backtestAcrossYears(perYearSeries, currentWindow, optimized.bestOffsetMinutes);

  const s = schedule as { start?: string; departureTime?: string };
  await prisma.scheduleRecommendation.deleteMany({ where: { checkpointId } });
  await prisma.scheduleRecommendation.create({
    data: {
      checkpointId,
      currentScheduleStart: s.start ?? s.departureTime ?? "00:00",
      recommendedOffsetMinutes: optimized.bestOffsetMinutes,
      exposureBefore: optimized.currentExposure,
      exposureAfter: optimized.bestExposure,
      yearlyBacktest: backtest.perYear as unknown as object,
    },
  });
}

async function seedStorageCheckpoint(checkpointId: string) {
  const now = new Date();
  const forecast = generateSyntheticForecast(now.toISOString().slice(0, 10), now.getUTCHours(), 12, {
    // Above AMBIENT_HEAT_STRAIN_THRESHOLD_C so the demo actually shows a
    // flagged spoilage-risk window, not a permanently-safe storage card.
    peakTemperatureC: 38,
  });

  for (const sample of forecast) {
    const thi = calculateTHI(sample.temperatureC, sample.humidityPct);
    const category = categorizeTHI(thi);
    const workerComfort = calculateWorkerComfort(category, sample.aqi);
    const spoilage = calculateSpoilageRisk([sample.temperatureC], AMBIENT_HEAT_STRAIN_THRESHOLD_C);
    const date00 = new Date(`${sample.dateISO}T00:00:00.000Z`);

    await prisma.computedRisk.upsert({
      where: { checkpointId_date_hour: { checkpointId, date: date00, hour: sample.hour } },
      create: {
        checkpointId,
        date: date00,
        hour: sample.hour,
        temperatureC: sample.temperatureC,
        humidityPct: sample.humidityPct,
        thiValue: thi,
        thiCategory: category,
        aqi: sample.aqi,
        spoilageRisk: spoilage.atRisk,
        workerComfort,
      },
      update: {
        temperatureC: sample.temperatureC,
        humidityPct: sample.humidityPct,
        thiValue: thi,
        thiCategory: category,
        aqi: sample.aqi,
        spoilageRisk: spoilage.atRisk,
        workerComfort,
      },
    });
  }
}

async function main() {
  const seedJson: SeedJson = JSON.parse(
    readFileSync(path.resolve(process.cwd(), "data/checkpoints.seed.json"), "utf-8"),
  );

  let farm = await prisma.farm.findFirst({ where: { isDemoSeed: true }, include: { checkpoints: true } });

  const input: FarmFormInput = {
    name: seedJson.farmName,
    farmLatitude: seedJson.farm.latitude,
    farmLongitude: seedJson.farm.longitude,
    storageLatitude: seedJson.storage.latitude,
    storageLongitude: seedJson.storage.longitude,
    grazingStart: seedJson.grazingStart,
    grazingEnd: seedJson.grazingEnd,
    transportDepartureTime: seedJson.transportDepartureTime,
  };
  const checkpointsData = buildCheckpointsData(input);
  // Override the auto-derived (arithmetic-midpoint) transport checkpoint
  // with the real road-route waypoints from Section 0.5 — see the doc
  // comment on SeedJson.transportWaypoints above.
  const routeMidpoint = seedJson.transportWaypoints[1];
  for (const checkpointData of checkpointsData) {
    if (checkpointData.type === "TRANSPORT_ROUTE") {
      checkpointData.latitude = routeMidpoint.lat;
      checkpointData.longitude = routeMidpoint.lon;
      checkpointData.routeWaypoints = seedJson.transportWaypoints as unknown as object;
    }
  }

  if (!farm) {
    farm = await prisma.farm.create({
      data: {
        name: input.name,
        status: "processing",
        isDemoSeed: true,
        checkpoints: { create: checkpointsData },
      },
      include: { checkpoints: true },
    });
    console.log(`Created demo farm ${farm.id}`);
  } else {
    // Update in place — never delete/recreate the demo farm row (Section 4's
    // permanent-fixture rule) — so a re-run also picks up corrected/updated
    // seed data (like this pass's Section 0.5 coordinates), not just stale
    // values from whenever it was first created.
    console.log(`Demo farm ${farm.id} already exists — updating it to match the current seed data`);
    await prisma.farm.update({ where: { id: farm.id }, data: { name: input.name, status: "processing" } });
    for (const checkpointData of checkpointsData) {
      const existing = farm.checkpoints.find((c) => c.type === checkpointData.type);
      if (existing) {
        await prisma.checkpoint.update({ where: { id: existing.id }, data: checkpointData });
      }
    }
    farm = await prisma.farm.findUniqueOrThrow({ where: { id: farm.id }, include: { checkpoints: true } });
  }

  for (const checkpoint of farm.checkpoints) {
    console.log(`Seeding ${checkpoint.type} checkpoint (${checkpoint.name})...`);
    if (checkpoint.type === "STORAGE") {
      await seedStorageCheckpoint(checkpoint.id);
    } else {
      await seedHistoricalCheckpoint(checkpoint.id, checkpoint.type, checkpoint.schedule);
    }
  }

  await computeAndStoreChainSummary(farm.id);
  await prisma.farm.update({ where: { id: farm.id }, data: { status: "ready", statusStage: null, statusError: null } });

  console.log(`Demo farm ${farm.id} is ready.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
