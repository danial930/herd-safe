/**
 * Current + reactive-forecast ingestion — no historical backtest/optimizer.
 * Originally STORAGE-only (PROJECT_GUIDE.md Section 5 & 8: spoilage risk
 * needs a fresh daily answer, not multi-year validation).
 *
 * Following a credit-budget review (a multi-year historical pull costs far
 * more per checkpoint than originally assumed — see README), this is now
 * the ONLY ingestion path for FARM/TRANSPORT_ROUTE/STORAGE checkpoints on
 * any new farm (scripts/run-farm-pipeline.ts) — full historical backtesting
 * still exists as code but is gated behind an explicit env var and is not
 * reachable from the live Add-Farm/Edit-Farm flow at all (see
 * lib/ingestion/historicalIngest.ts). Spoilage risk is only computed for
 * STORAGE — it isn't a meaningful concept for a pasture or a truck.
 *
 * FARM/TRANSPORT_ROUTE checkpoints also get a cheap real ambient-heat-
 * frequency signal (2 more heatmap calls — exceedance + persistence over the
 * past 30 days) alongside the reactive pull — see
 * lib/ingestion/ambientHeatFrequency.ts. That signal is deliberately separate
 * from THI/the optimizer/the dollar-impact estimate, so it doesn't change
 * any of the "reactive-only, no backtest" reasoning above.
 *
 * Cache-first and idempotent (Section 7, rule 4).
 */
import { AMBIENT_HEAT_STRAIN_THRESHOLD_C, REACTIVE_FORECAST_HOURS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import type { FortyGuardClient } from "@/lib/fortyguard/client";
import { pullAmbientHeatFrequency } from "./ambientHeatFrequency";
import { pullRealHourlyClimateForTimestamps } from "./climatePull";
import { calculateSpoilageRisk } from "@/lib/risk/spoilage";
import { calculateTHI, categorizeTHI } from "@/lib/risk/thi";
import { calculateWorkerComfort } from "@/lib/risk/workerComfort";

function nextForecastHours(count: number): Date[] {
  const now = new Date();
  const flooredNow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours()));
  return Array.from({ length: count }, (_, i) => new Date(flooredNow.getTime() + i * 60 * 60 * 1000));
}

export async function ingestCurrentCheckpoint(
  client: FortyGuardClient,
  checkpointId: string,
  onProgress?: (message: string) => void,
): Promise<void> {
  const checkpoint = await prisma.checkpoint.findUniqueOrThrow({ where: { id: checkpointId } });

  onProgress?.(
    `[${checkpoint.name}] pulling current conditions${REACTIVE_FORECAST_HOURS > 1 ? ` + ${REACTIVE_FORECAST_HOURS - 1}h forecast` : ""}...`,
  );
  const timestamps = nextForecastHours(REACTIVE_FORECAST_HOURS);
  const samples = await pullRealHourlyClimateForTimestamps(
    client,
    checkpoint.id,
    checkpoint.latitude,
    checkpoint.longitude,
    timestamps,
  );

  const isStorage = checkpoint.type === "STORAGE";

  for (const sample of samples) {
    const thi = calculateTHI(sample.temperatureC, sample.humidityPct);
    const category = categorizeTHI(thi);
    const workerComfort = calculateWorkerComfort(category, sample.aqi);
    const spoilageRisk = isStorage
      ? calculateSpoilageRisk([sample.temperatureC], AMBIENT_HEAT_STRAIN_THRESHOLD_C).atRisk
      : null;
    const date00 = new Date(
      Date.UTC(sample.timestamp.getUTCFullYear(), sample.timestamp.getUTCMonth(), sample.timestamp.getUTCDate()),
    );

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
        spoilageRisk,
        workerComfort,
      },
      update: {
        temperatureC: sample.temperatureC,
        humidityPct: sample.humidityPct,
        thiValue: thi,
        thiCategory: category,
        aqi: sample.aqi,
        spoilageRisk,
        workerComfort,
      },
    });
  }

  if (isStorage) {
    const overallSpoilage = calculateSpoilageRisk(samples.map((s) => s.temperatureC), AMBIENT_HEAT_STRAIN_THRESHOLD_C);
    onProgress?.(
      `[${checkpoint.name}] refrigeration strain risk: ${overallSpoilage.atRisk ? "ELEVATED" : "normal"} ` +
        `(max ambient ${overallSpoilage.maxTemperatureC.toFixed(1)}C, ${overallSpoilage.hoursAtOrAboveCeiling}/${samples.length}h above the strain threshold)`,
    );
  } else {
    onProgress?.(`[${checkpoint.name}] pulled current conditions (${samples.length}h reactive window)`);

    // Cheap real historical signal (1 heatmap call) for FARM/TRANSPORT_ROUTE
    // only — see lib/ingestion/ambientHeatFrequency.ts. Deliberately not
    // computed for STORAGE and never blended into THI/dollar-impact/optimizer.
    onProgress?.(`[${checkpoint.name}] pulling ambient heat frequency (past 30 days)...`);
    const ambientHeatFrequency = await pullAmbientHeatFrequency(
      client,
      checkpoint.id,
      checkpoint.latitude,
      checkpoint.longitude,
    );
    await prisma.checkpoint.update({
      where: { id: checkpoint.id },
      data: { ambientHeatFrequency: ambientHeatFrequency as unknown as object },
    });
    onProgress?.(
      `[${checkpoint.name}] longest stretch above ${ambientHeatFrequency.thresholdC}C over the past ` +
        `${ambientHeatFrequency.windowDays} days: ${ambientHeatFrequency.longestStreakHours}h`,
    );
  }
}
