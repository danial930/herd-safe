/**
 * Shared "run the optimizer + backtest against whatever years of data we
 * have, and persist the result" step — used by both live ingestion
 * (lib/ingestion/historicalIngest.ts) and a from-cache recompute with no new
 * API calls (scripts/recompute-recommendation.ts). Operates purely on
 * already-fetched `perYearSeries` data; never touches FortyGuard itself.
 *
 * The "most recent year" used to derive the recommended offset is whichever
 * key is numerically last in `perYearSeries` — NOT a hardcoded assumption
 * about which years exist. Backtest results only ever list the years
 * actually passed in, so a reduced-scope checkpoint (e.g. 1 complete year
 * instead of 3) correctly reports that reduced scope everywhere this gets
 * read back, rather than claiming a scope it doesn't have data for.
 */
import { OPTIMIZER } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { backtestAcrossYears } from "@/lib/exposure/backtest";
import { optimizeSchedule, type HourlyThiPoint } from "@/lib/exposure/optimizer";
import { scheduleWindowForCheckpoint } from "@/lib/exposure/scheduleWindow";
import type { Checkpoint } from "@/lib/generated/prisma";

export async function computeAndStoreScheduleRecommendation(
  checkpoint: Pick<Checkpoint, "id" | "type" | "schedule">,
  perYearSeries: Record<string, HourlyThiPoint[]>,
  onProgress?: (message: string) => void,
): Promise<void> {
  const years = Object.keys(perYearSeries)
    .map(Number)
    .sort((a, b) => a - b);
  if (years.length === 0) {
    throw new Error(`computeAndStoreScheduleRecommendation: no years of data provided for checkpoint ${checkpoint.id}`);
  }
  const mostRecentYear = String(years[years.length - 1]);

  const currentWindow = scheduleWindowForCheckpoint(checkpoint.type, checkpoint.schedule);
  const optimized = optimizeSchedule(
    perYearSeries[mostRecentYear],
    currentWindow,
    OPTIMIZER.SWEEP_RANGE_MINUTES,
    OPTIMIZER.STEP_MINUTES,
  );
  const backtest = backtestAcrossYears(perYearSeries, currentWindow, optimized.bestOffsetMinutes);

  const s = checkpoint.schedule as { start?: string; departureTime?: string };
  const currentScheduleStart = s.start ?? s.departureTime ?? "00:00";

  // Idempotent: always converge to exactly one current recommendation per
  // checkpoint, rather than accumulating duplicates on re-run.
  await prisma.scheduleRecommendation.deleteMany({ where: { checkpointId: checkpoint.id } });
  await prisma.scheduleRecommendation.create({
    data: {
      checkpointId: checkpoint.id,
      currentScheduleStart,
      recommendedOffsetMinutes: optimized.bestOffsetMinutes,
      exposureBefore: optimized.currentExposure,
      exposureAfter: optimized.bestExposure,
      yearlyBacktest: backtest.perYear as unknown as object,
    },
  });

  onProgress?.(
    `recommendation (${years.length} year${years.length === 1 ? "" : "s"}: ${years.join(", ")}): ` +
      `shift by ${optimized.bestOffsetMinutes}min (exposure ${optimized.currentExposure} -> ${optimized.bestExposure}h, ` +
      `holds across all years: ${backtest.holdsAcrossAllYears})`,
  );
}
