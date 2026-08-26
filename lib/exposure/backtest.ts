import { HISTORICAL_YEARS } from "@/lib/constants";
import { computeExposure, type HourlyThiPoint } from "./optimizer";
import { shiftWindow, type ScheduleWindow } from "./scheduleWindow";

export interface YearlyBacktestEntry {
  exposureBefore: number;
  exposureAfter: number;
}

export interface BacktestResult {
  perYear: Record<string, YearlyBacktestEntry>;
  /** true only if every year in perYear improved (after < before). A single
   * year that doesn't improve means the recommendation doesn't robustly hold. */
  holdsAcrossAllYears: boolean;
}

/**
 * Re-runs the exposure calculation for the optimizer's winning offset against
 * each cached historical year independently (PROJECT_GUIDE.md Section 8.3).
 * `perYearSeries` keys are typically HISTORICAL_YEARS entries as strings.
 */
export function backtestAcrossYears(
  perYearSeries: Record<string, HourlyThiPoint[]>,
  currentWindow: ScheduleWindow,
  offsetMinutes: number,
): BacktestResult {
  const perYear: Record<string, YearlyBacktestEntry> = {};
  let holdsAcrossAllYears = true;

  for (const [year, series] of Object.entries(perYearSeries)) {
    const exposureBefore = computeExposure(series, currentWindow);
    const exposureAfter = computeExposure(series, shiftWindow(currentWindow, offsetMinutes));
    perYear[year] = { exposureBefore, exposureAfter };
    if (!(exposureAfter < exposureBefore)) holdsAcrossAllYears = false;
  }

  return { perYear, holdsAcrossAllYears };
}

export interface HistoricalAnalogHour {
  hour: number;
  avgThi: number;
  minThi: number;
  maxThi: number;
  sampleCount: number;
}

/**
 * Historical-analog prediction (PROJECT_GUIDE.md Section 8.4, item 4): since
 * our live reactive pull only reaches REACTIVE_FORECAST_HOURS out (1 hour —
 * see lib/constants.ts), average the hourly THI curve across the historical
 * years (with min/max spread) to produce an "expected heat profile" for the
 * upcoming week. This is NOT a forecast — surface it in the UI labeled
 * explicitly as a historical-analog estimate.
 */
export function historicalAnalogProfile(
  perYearSeries: Record<string, HourlyThiPoint[]>,
  years: readonly number[] = HISTORICAL_YEARS,
): HistoricalAnalogHour[] {
  const byHour = new Map<number, number[]>();

  for (const year of years) {
    const series = perYearSeries[String(year)];
    if (!series) continue;
    for (const point of series) {
      const bucket = byHour.get(point.hour) ?? [];
      bucket.push(point.thi);
      byHour.set(point.hour, bucket);
    }
  }

  const profile: HistoricalAnalogHour[] = [];
  for (let hour = 0; hour < 24; hour++) {
    const values = byHour.get(hour) ?? [];
    if (values.length === 0) continue;
    const avgThi = values.reduce((sum, v) => sum + v, 0) / values.length;
    profile.push({
      hour,
      avgThi,
      minThi: Math.min(...values),
      maxThi: Math.max(...values),
      sampleCount: values.length,
    });
  }
  return profile.sort((a, b) => a.hour - b.hour);
}
