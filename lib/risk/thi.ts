import { THI_BANDS, type ThiCategory } from "@/lib/constants";

/**
 * Temperature-Humidity Index for cattle heat stress.
 *
 *   THI = (1.8T + 32) - (0.55 - 0.0055*RH) * (1.8T - 26)
 *
 * @param temperatureC air temperature, °C
 * @param humidityPct relative humidity, 0-100
 *
 * IMPORTANT: pass real per-hour (temperature, humidity) pairs — never the
 * FortyGuard env_params anchor artifact. See PROJECT_GUIDE.md Section 3: the
 * env_params `temperature` input is a single fixed anchor applied across the
 * whole series, so its derived heat_index/wet_bulb fields are not physically
 * meaningful hour-by-hour. Real hourly temperature must come from a `tcm`
 * heatmap call; only `relative_humidity_percent` from env_params is trusted
 * as real per-hour truth.
 */
export function calculateTHI(temperatureC: number, humidityPct: number): number {
  const t = temperatureC;
  const rh = humidityPct;
  return 1.8 * t + 32 - (0.55 - 0.0055 * rh) * (1.8 * t - 26);
}

/** Bands per Armstrong 1994 (PROJECT_GUIDE.md Section 8). */
export function categorizeTHI(thi: number): ThiCategory {
  if (thi < THI_BANDS.COMFORT_MAX) return "comfort";
  if (thi < THI_BANDS.MILD_MAX) return "mild";
  if (thi < THI_BANDS.MODERATE_MAX) return "moderate";
  return "severe";
}
