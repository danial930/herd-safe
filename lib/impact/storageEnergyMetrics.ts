/**
 * Storage Impact — one pure, derived metric for the STORAGE checkpoint's
 * Checkpoint Detail modal (PROJECT_GUIDE.md Section 4, screen 5). Reuses the
 * ambient temperature already cached from the reactive pull — no FortyGuard
 * call, zero additional credits.
 *
 * Deliberately NOT fed into the dollar-impact estimate — descriptive
 * operational context, not an input to it. See lib/constants.ts for full
 * source citations on both constants used here, including the honest
 * caveat that the kWh/°C coefficient (unlike the electricity rate) is an
 * illustrative approximation, not an independently sourced figure.
 */
import {
  AMBIENT_HEAT_STRAIN_THRESHOLD_C,
  REFRIGERATION_ELECTRICITY_RATE_USD_PER_KWH,
  REFRIGERATION_EXTRA_KWH_PER_DEGREE_C_ABOVE_STRAIN,
} from "@/lib/constants";

/** Estimated additional daily cooling cost (USD) from ambient temperature
 * sitting above the refrigeration-strain threshold. Zero when ambient is at
 * or below the threshold. */
export function estimateAdditionalCoolingCostUsd(ambientC: number): number {
  const degreesAboveStrain = Math.max(0, ambientC - AMBIENT_HEAT_STRAIN_THRESHOLD_C);
  const extraKwh = degreesAboveStrain * REFRIGERATION_EXTRA_KWH_PER_DEGREE_C_ABOVE_STRAIN;
  return extraKwh * REFRIGERATION_ELECTRICITY_RATE_USD_PER_KWH;
}
