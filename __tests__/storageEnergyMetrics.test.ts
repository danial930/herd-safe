import { describe, expect, it } from "vitest";
import { estimateAdditionalCoolingCostUsd } from "@/lib/impact/storageEnergyMetrics";

describe("estimateAdditionalCoolingCostUsd", () => {
  it("is zero at or below the refrigeration-strain threshold (35°C)", () => {
    expect(estimateAdditionalCoolingCostUsd(35)).toBe(0);
    expect(estimateAdditionalCoolingCostUsd(20)).toBe(0);
  });

  it("scales linearly with degrees above the threshold", () => {
    const cost1 = estimateAdditionalCoolingCostUsd(40); // 5°C above
    const cost2 = estimateAdditionalCoolingCostUsd(45); // 10°C above
    expect(cost2).toBeCloseTo(cost1 * 2);
    expect(cost1).toBeGreaterThan(0);
  });
});
