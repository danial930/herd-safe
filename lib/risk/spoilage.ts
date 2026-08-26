import { SPOILAGE_TEMP_CEILING_C } from "@/lib/constants";

export interface SpoilageRiskResult {
  /** true once any hour reaches or exceeds the ceiling — "must stay under". */
  atRisk: boolean;
  maxTemperatureC: number;
  hoursAtOrAboveCeiling: number;
}

/**
 * Reactive spoilage-risk flag for the storage checkpoint: current conditions
 * + REACTIVE_FORECAST_HOURS more (lib/constants.ts), no historical backtest
 * (a fresh answer is needed daily, not multi-year validation —
 * PROJECT_GUIDE.md Section 8).
 *
 * Boundary: a temperature exactly at the ceiling counts as at-risk ("must
 * stay under a spoilage threshold" — Section 1 — reads as strictly below is
 * safe).
 *
 * This is a generic "count hours at/above `ceilingC`" utility — callers
 * decide what ceiling is meaningful for their input. Ingestion code passes
 * AMBIENT_HEAT_STRAIN_THRESHOLD_C (not the raw SPOILAGE_TEMP_CEILING_C food-
 * safety standard) since FortyGuard only exposes outdoor ambient conditions,
 * not a facility's actual internal refrigeration reading. `atRisk` here
 * means "ambient heat elevated enough to strain refrigeration equipment and
 * raise outage risk" — NOT "the product is confirmed to be at this
 * temperature." Callers surfacing this to a user must carry that framing
 * through into their copy — see the doc comment on
 * AMBIENT_HEAT_STRAIN_THRESHOLD_C in lib/constants.ts.
 */
export function calculateSpoilageRisk(
  hourlyTemperaturesC: number[],
  ceilingC: number = SPOILAGE_TEMP_CEILING_C,
): SpoilageRiskResult {
  const hoursAtOrAboveCeiling = hourlyTemperaturesC.filter((t) => t >= ceilingC).length;
  const maxTemperatureC = hourlyTemperaturesC.length > 0 ? Math.max(...hourlyTemperaturesC) : -Infinity;
  return {
    atRisk: hoursAtOrAboveCeiling > 0,
    maxTemperatureC,
    hoursAtOrAboveCeiling,
  };
}
