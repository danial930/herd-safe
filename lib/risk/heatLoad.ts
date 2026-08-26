import { calculateTHI } from "./thi";

/**
 * OPTIONAL UPGRADE (PROJECT_GUIDE.md Section 8) — approximates a black-globe-
 * temperature-adjusted heat load for open-pasture cattle, since published
 * livestock Heat Load Index models (e.g. Gaughan et al. 2008) use black globe
 * temperature, which solar radiation drives, rather than plain air
 * temperature.
 *
 * This is a simplified approximation, not the published HLI formula — HLI
 * also requires wind speed, which FortyGuard's env_params endpoint doesn't
 * expose. It estimates how far black-globe temperature runs above ambient
 * air temperature under solar load (attenuated by cloud cover), then reuses
 * the THI formula with that adjusted temperature. Treat as a stretch
 * feature: every call site falls back cleanly to plain calculateTHI() when
 * solar/cloud data isn't available.
 */
export function estimateBlackGlobeTemperatureC(
  airTemperatureC: number,
  solarIrradianceWm2: number,
  cloudCoverOctas: number,
): number {
  const cloudFactor = 1 - Math.min(Math.max(cloudCoverOctas, 0), 8) / 8; // 0 overcast .. 1 clear sky
  // Black globe temps commonly run up to ~10C above air temp in full clear-sky
  // midday sun (Gaughan et al. 2008 field observations); scaled linearly by
  // irradiance relative to a ~1000 W/m2 clear-sky reference.
  const solarOffsetC = (solarIrradianceWm2 / 1000) * 10 * cloudFactor;
  return airTemperatureC + solarOffsetC;
}

export function calculateSolarAdjustedTHI(
  airTemperatureC: number,
  humidityPct: number,
  solarIrradianceWm2: number,
  cloudCoverOctas: number,
): number {
  const blackGlobeC = estimateBlackGlobeTemperatureC(airTemperatureC, solarIrradianceWm2, cloudCoverOctas);
  return calculateTHI(blackGlobeC, humidityPct);
}
