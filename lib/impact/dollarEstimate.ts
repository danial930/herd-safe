import { DOLLAR_IMPACT } from "@/lib/constants";

export interface DollarImpactInputs {
  /** Severe-THI (>=90) cow-hours avoided by the recommended schedule shift —
   * NOT the general "mild" exposure count used by the optimizer itself. See
   * the derivation note on DOLLAR_IMPACT in lib/constants.ts. */
  severeThiCowHoursAvoided: number;
  herdSize: number;
  spoilageEventsAvoided: number;
}

export interface DollarImpactResult {
  milkYieldLossEstimate: number;
  spoilageRiskEstimate: number;
  totalDollarImpact: number;
}

/**
 * Combined dollar-impact rollup (PROJECT_GUIDE.md Section 8.4):
 *
 *   milkYieldLossEstimate = severeThiCowHoursAvoided * herdSize
 *                            * yieldLossRatePerSevereThiCowHour * milkPricePerLiter
 *   spoilageRiskEstimate  = spoilageEventsAvoided * costPerSpoilageEvent
 *   totalDollarImpact     = milkYieldLossEstimate + spoilageRiskEstimate
 */
export function estimateDollarImpact(inputs: DollarImpactInputs): DollarImpactResult {
  const milkYieldLossEstimate =
    inputs.severeThiCowHoursAvoided *
    inputs.herdSize *
    DOLLAR_IMPACT.YIELD_LOSS_LITERS_PER_SEVERE_THI_COW_HOUR *
    DOLLAR_IMPACT.MILK_PRICE_USD_PER_LITER;

  const spoilageRiskEstimate = inputs.spoilageEventsAvoided * DOLLAR_IMPACT.SPOILAGE_EVENT_COST_USD;

  return {
    milkYieldLossEstimate,
    spoilageRiskEstimate,
    totalDollarImpact: milkYieldLossEstimate + spoilageRiskEstimate,
  };
}
