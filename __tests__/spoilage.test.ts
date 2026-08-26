import { describe, expect, it } from "vitest";
import { calculateSpoilageRisk } from "@/lib/risk/spoilage";

describe("calculateSpoilageRisk", () => {
  it("is not at risk when every hour is strictly below the ceiling", () => {
    const result = calculateSpoilageRisk([1, 2, 3.9], 4);
    expect(result.atRisk).toBe(false);
    expect(result.hoursAtOrAboveCeiling).toBe(0);
  });

  it("is at risk exactly at the ceiling (boundary is inclusive)", () => {
    const result = calculateSpoilageRisk([2, 4, 3], 4);
    expect(result.atRisk).toBe(true);
    expect(result.hoursAtOrAboveCeiling).toBe(1);
  });

  it("counts every hour at or above the ceiling and reports the max", () => {
    const result = calculateSpoilageRisk([5, 6, 2, 4.5], 4);
    expect(result.atRisk).toBe(true);
    expect(result.hoursAtOrAboveCeiling).toBe(3);
    expect(result.maxTemperatureC).toBe(6);
  });

  it("uses the default ceiling constant when none is passed", () => {
    const result = calculateSpoilageRisk([10]);
    expect(result.atRisk).toBe(true);
  });
});
