/**
 * Computes and persists a farm's ChainSummary — the dollar-impact rollup and
 * chain-conflict check (PROJECT_GUIDE.md Section 8's final two items). Reads
 * only cached Postgres data (ComputedRisk, ScheduleRecommendation), never
 * FortyGuard directly — this can run at the end of the ingestion pipeline or
 * be recomputed any time without spending API credits.
 *
 * Scope, since the transport checkpoint carries milk/product (not live
 * cattle — PROJECT_GUIDE.md Section 1): the milk-yield-loss half of the
 * dollar impact is driven by the FARM checkpoint's severe-THI cow-hours
 * only; the spoilage half is driven by the STORAGE checkpoint only. The
 * TRANSPORT checkpoint's own recommendation feeds the chain-conflict check
 * (does its recommended arrival window land during a storage spoilage-risk
 * window?), not the dollar formula directly.
 */
import { DEFAULT_HERD_SIZE, SPOILAGE_ESTIMATE_MIN_OBSERVED_HOURS, THI_BANDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { detectChainConflict, type StorageHourRisk } from "@/lib/exposure/chainConflict";
import { computeExposure } from "@/lib/exposure/optimizer";
import { scheduleWindowForCheckpoint, shiftWindow } from "@/lib/exposure/scheduleWindow";
import { getCompleteHistoricalYears, getHourlyThiPointsForYears } from "@/lib/ingestion/completeHistoricalYears";
import { estimateDollarImpact } from "@/lib/impact/dollarEstimate";
import { Prisma } from "@/lib/generated/prisma";
import type { HourlyThiPoint } from "@/lib/exposure/optimizer";

/**
 * The checkpoint's own most recent COMPLETE historical year — not a
 * hardcoded assumption about which years exist globally. A checkpoint whose
 * historical pull was reduced in scope (e.g. only 1 of 3 years fully
 * cached — see scripts/recompute-recommendation.ts) correctly falls back to
 * whatever it actually has; a checkpoint with none (reactive-only, the
 * default for new farms) correctly contributes 0 severe-hours here.
 */
async function checkpointSeriesForMostRecentCompleteYear(checkpointId: string): Promise<HourlyThiPoint[]> {
  const completeYears = await getCompleteHistoricalYears(checkpointId);
  if (completeYears.length === 0) return [];
  const mostRecentYear = completeYears[completeYears.length - 1];
  const perYearSeries = await getHourlyThiPointsForYears(checkpointId, [mostRecentYear]);
  return perYearSeries[String(mostRecentYear)] ?? [];
}

export async function computeAndStoreChainSummary(farmId: string): Promise<void> {
  const checkpoints = await prisma.checkpoint.findMany({ where: { farmId } });
  const farmCheckpoint = checkpoints.find((c) => c.type === "FARM");
  const transportCheckpoint = checkpoints.find((c) => c.type === "TRANSPORT_ROUTE");
  const storageCheckpoint = checkpoints.find((c) => c.type === "STORAGE");

  // Distinct from "we computed a real $0" — a reactive-only FARM checkpoint
  // (the default for new farms; see historicalIngest.ts's gating) never gets
  // a ScheduleRecommendation, so there's nothing to diff exposure against.
  // milkYieldEstimateAvailable=false tells the UI to say so honestly instead
  // of showing "$0" (which would misread as "verified no impact").
  let milkYieldInputs = { severeThiCowHoursAvoided: 0 };
  let milkYieldEstimateAvailable = false;
  if (farmCheckpoint) {
    const recommendation = await prisma.scheduleRecommendation.findFirst({
      where: { checkpointId: farmCheckpoint.id },
      orderBy: { createdAt: "desc" },
    });
    if (recommendation) {
      milkYieldEstimateAvailable = true;
      const series = await checkpointSeriesForMostRecentCompleteYear(farmCheckpoint.id);
      const window = scheduleWindowForCheckpoint(farmCheckpoint.type, farmCheckpoint.schedule);
      const shifted = shiftWindow(window, recommendation.recommendedOffsetMinutes);
      const severeBefore = computeExposure(series, window, THI_BANDS.MODERATE_MAX);
      const severeAfter = computeExposure(series, shifted, THI_BANDS.MODERATE_MAX);
      milkYieldInputs = { severeThiCowHoursAvoided: Math.max(0, severeBefore - severeAfter) };
    }
  }

  // "Events avoided" for a reactive-only checkpoint: treat the current
  // forecast window as at most one flagged event — HerdSafe surfacing it
  // early is what "avoids" its cost, not a per-hour multiplier.
  //
  // spoilageEstimateAvailable guards against a single isolated hour earning
  // the full flat SPOILAGE_EVENT_COST_USD credit (see
  // SPOILAGE_ESTIMATE_MIN_OBSERVED_HOURS's doc comment) — the risk flag
  // itself (storageHourlyRisk, used below for the chain-conflict check and
  // by the checkpoint's own badge) is NOT gated by this; only the dollar
  // figure is, same as milkYieldEstimateAvailable above.
  let spoilageEventsAvoided = 0;
  let storageHourlyRisk: StorageHourRisk[] = [];
  let spoilageEstimateAvailable = false;
  if (storageCheckpoint) {
    const rows = await prisma.computedRisk.findMany({
      where: { checkpointId: storageCheckpoint.id },
      orderBy: { date: "desc" },
      take: 24,
    });
    spoilageEstimateAvailable = rows.length >= SPOILAGE_ESTIMATE_MIN_OBSERVED_HOURS;
    if (spoilageEstimateAvailable) {
      spoilageEventsAvoided = rows.some((r) => r.spoilageRisk) ? 1 : 0;
    }
    storageHourlyRisk = rows.map((r) => ({ hour: r.hour, atRisk: Boolean(r.spoilageRisk) }));
  }

  const dollarImpact = estimateDollarImpact({
    severeThiCowHoursAvoided: milkYieldInputs.severeThiCowHoursAvoided,
    herdSize: DEFAULT_HERD_SIZE,
    spoilageEventsAvoided,
  });

  let conflictDetected = false;
  let conflictDetails: unknown = null;
  if (transportCheckpoint && storageCheckpoint) {
    const recommendation = await prisma.scheduleRecommendation.findFirst({
      where: { checkpointId: transportCheckpoint.id },
      orderBy: { createdAt: "desc" },
    });
    if (recommendation) {
      const departureWindow = scheduleWindowForCheckpoint(transportCheckpoint.type, transportCheckpoint.schedule);
      const arrivalWindow = shiftWindow(departureWindow, recommendation.recommendedOffsetMinutes);
      const conflict = detectChainConflict(arrivalWindow, storageHourlyRisk);
      conflictDetected = conflict.conflictDetected;
      conflictDetails = conflict.conflictingHours.length > 0 ? { conflictingHours: conflict.conflictingHours } : null;
    }
  }

  await prisma.chainSummary.upsert({
    where: { farmId },
    create: {
      farmId,
      totalDollarImpact: dollarImpact.totalDollarImpact,
      milkYieldLossEstimate: dollarImpact.milkYieldLossEstimate,
      milkYieldEstimateAvailable,
      spoilageRiskEstimate: dollarImpact.spoilageRiskEstimate,
      spoilageEstimateAvailable,
      conflictDetected,
      conflictDetails: (conflictDetails as object | null) ?? Prisma.JsonNull,
    },
    update: {
      computedAt: new Date(),
      totalDollarImpact: dollarImpact.totalDollarImpact,
      milkYieldLossEstimate: dollarImpact.milkYieldLossEstimate,
      milkYieldEstimateAvailable,
      spoilageRiskEstimate: dollarImpact.spoilageRiskEstimate,
      spoilageEstimateAvailable,
      conflictDetected,
      conflictDetails: (conflictDetails as object | null) ?? Prisma.JsonNull,
    },
  });
}
