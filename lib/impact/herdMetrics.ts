/**
 * Herd Impact Today — four pure, per-head derived metrics for the FARM
 * checkpoint's Checkpoint Detail modal (PROJECT_GUIDE.md Section 4, screen
 * 5). Every input here is temperature/THI data the app already has cached
 * from the reactive pull (lib/ingestion/currentIngest.ts) — none of these
 * make a FortyGuard call, so they cost zero additional credits and run for
 * every farm, reactive-only or historical alike.
 *
 * Deliberately NOT fed into the dollar-impact estimate
 * (lib/impact/computeChainSummary.ts) or the schedule optimizer — these are
 * descriptive operational numbers for a farm manager, not inputs to either.
 *
 * Every constant is cited in full in lib/constants.ts — see there before
 * changing any threshold/rate below.
 */
import {
  DMI_REDUCTION_KG_PER_THI_UNIT_NORTH_AMERICA,
  RESPIRATION_BPM_INCREASE_PER_THI_UNIT,
  RESPIRATION_RESTING_BPM,
  RESPIRATION_THI_BREAKPOINT,
  SHADE_SQFT_PER_HEAD,
  THI_BANDS,
  WATER_DEMAND_BASELINE_TEMP_F,
  WATER_GALLONS_PER_10F_ABOVE_BASELINE,
} from "@/lib/constants";

export function celsiusToFahrenheit(temperatureC: number): number {
  return (temperatureC * 9) / 5 + 32;
}

/** Gallons of ADDITIONAL water needed per head today, above the source's own
 * cold-weather reference point (40°F) — see WATER_DEMAND_BASELINE_TEMP_F. */
export function estimateAdditionalWaterGallonsPerHead(temperatureF: number): number {
  return (Math.max(0, temperatureF - WATER_DEMAND_BASELINE_TEMP_F) / 10) * WATER_GALLONS_PER_10F_ABOVE_BASELINE;
}

/** Kg of dry-matter-intake reduction per head today, above the app's own
 * THI comfort threshold (THI_BANDS.COMFORT_MAX). */
export function estimateDmiReductionKgPerHead(thi: number): number {
  return Math.max(0, thi - THI_BANDS.COMFORT_MAX) * DMI_REDUCTION_KG_PER_THI_UNIT_NORTH_AMERICA;
}

/** Multiple of resting respiration rate (e.g. 1.4 = breathing 1.4x resting
 * rate) implied by today's THI. Always >= 1. */
export function estimateRespirationMultiplier(thi: number): number {
  const bpm =
    thi <= RESPIRATION_THI_BREAKPOINT
      ? RESPIRATION_RESTING_BPM
      : RESPIRATION_RESTING_BPM + RESPIRATION_BPM_INCREASE_PER_THI_UNIT * (thi - RESPIRATION_THI_BREAKPOINT);
  return bpm / RESPIRATION_RESTING_BPM;
}

/** Static per-head shade requirement — not temperature-dependent, a standing
 * infrastructure provision like the app's existing binary shelter model. */
export const shadeSqFtPerHead = SHADE_SQFT_PER_HEAD;
