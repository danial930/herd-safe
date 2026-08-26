import { AQI_BANDS, type ThiCategory, type WorkerComfortLevel } from "@/lib/constants";

/**
 * Combines a heat-comfort read (THI category) with EPA AQI bands into one of
 * four levels, per PROJECT_GUIDE.md Section 8's table:
 *
 *   AQI > 150 OR heat severe          -> intolerable
 *   AQI 101-150 OR heat moderate      -> bad
 *   AQI 51-100 AND heat mild          -> suitable
 *   otherwise                         -> good
 *
 * Rows are checked in this order (top row wins) — e.g. severe heat with good
 * air quality is still `intolerable`, and the `suitable` row's AND means
 * mild heat with good air quality (AQI <= 50) falls through to `good`.
 */
export function calculateWorkerComfort(thiCategory: ThiCategory, aqi: number): WorkerComfortLevel {
  if (aqi > AQI_BANDS.UNHEALTHY_SENSITIVE_MAX || thiCategory === "severe") {
    return "intolerable";
  }
  if ((aqi > AQI_BANDS.MODERATE_MAX && aqi <= AQI_BANDS.UNHEALTHY_SENSITIVE_MAX) || thiCategory === "moderate") {
    return "bad";
  }
  if (aqi > AQI_BANDS.GOOD_MAX && aqi <= AQI_BANDS.MODERATE_MAX && thiCategory === "mild") {
    return "suitable";
  }
  return "good";
}
