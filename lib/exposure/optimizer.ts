import { OPTIMIZER, THI_EXPOSURE_THRESHOLD } from "@/lib/constants";
import { hourOverlapsWindow, shiftWindow, type ScheduleWindow } from "./scheduleWindow";

/** One real hourly THI reading. `date` groups points into days so a
 * multi-day series can be passed straight through (e.g. a week's historical
 * pull) and exposure sums across every matching hour in every day. */
export interface HourlyThiPoint {
  date: string; // YYYY-MM-DD
  hour: number; // 0-23, local hour
  thi: number;
}

/**
 * Sum of hours (cow-hours / transport-hours) within `window` where THI meets
 * or exceeds `thiThreshold` — default the "mild" threshold (72), per
 * PROJECT_GUIDE.md Section 8.1. Pass THI_BANDS.MODERATE_MAX (90) instead to
 * count severe-only hours for the dollar-impact rollup.
 */
export function computeExposure(
  hourlySeries: HourlyThiPoint[],
  window: ScheduleWindow,
  thiThreshold: number = THI_EXPOSURE_THRESHOLD,
): number {
  let exposedHours = 0;
  for (const point of hourlySeries) {
    if (point.thi >= thiThreshold && hourOverlapsWindow(point.hour, window)) {
      exposedHours += 1;
    }
  }
  return exposedHours;
}

export interface OptimizeScheduleResult {
  bestOffsetMinutes: number;
  bestExposure: number;
  currentExposure: number;
}

/**
 * Brute-force shift `currentWindow` by +/-sweepRangeMinutes in stepMinutes
 * increments, returning the offset that minimizes THI exposure. Ties prefer
 * the smallest schedule change (offset closest to 0); among equal-magnitude
 * ties, the earlier (more negative) offset wins, matching a stable left-to-
 * right scan.
 */
export function optimizeSchedule(
  hourlySeries: HourlyThiPoint[],
  currentWindow: ScheduleWindow,
  sweepRangeMinutes: number = OPTIMIZER.SWEEP_RANGE_MINUTES,
  stepMinutes: number = OPTIMIZER.STEP_MINUTES,
): OptimizeScheduleResult {
  const currentExposure = computeExposure(hourlySeries, currentWindow);

  let bestOffsetMinutes = 0;
  let bestExposure = currentExposure;

  for (let offset = -sweepRangeMinutes; offset <= sweepRangeMinutes; offset += stepMinutes) {
    if (offset === 0) continue;
    const exposure = computeExposure(hourlySeries, shiftWindow(currentWindow, offset));
    const isStrictlyBetter = exposure < bestExposure;
    const isTieButSmallerShift =
      exposure === bestExposure && Math.abs(offset) < Math.abs(bestOffsetMinutes);
    if (isStrictlyBetter || isTieButSmallerShift) {
      bestExposure = exposure;
      bestOffsetMinutes = offset;
    }
  }

  return { bestOffsetMinutes, bestExposure, currentExposure };
}
