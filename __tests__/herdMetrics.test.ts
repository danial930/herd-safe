import { describe, expect, it } from "vitest";
import {
  celsiusToFahrenheit,
  estimateAdditionalWaterGallonsPerHead,
  estimateDmiReductionKgPerHead,
  estimateRespirationMultiplier,
} from "@/lib/impact/herdMetrics";

describe("celsiusToFahrenheit", () => {
  it("converts known reference points", () => {
    expect(celsiusToFahrenheit(0)).toBe(32);
    expect(celsiusToFahrenheit(100)).toBe(212);
  });
});

describe("estimateAdditionalWaterGallonsPerHead", () => {
  it("is zero at or below the 40°F baseline", () => {
    expect(estimateAdditionalWaterGallonsPerHead(40)).toBe(0);
    expect(estimateAdditionalWaterGallonsPerHead(20)).toBe(0);
  });

  it("adds 1 gallon per 10°F above baseline", () => {
    expect(estimateAdditionalWaterGallonsPerHead(50)).toBe(1);
    expect(estimateAdditionalWaterGallonsPerHead(90)).toBe(5);
  });

  it("scales fractionally for a partial 10°F step", () => {
    expect(estimateAdditionalWaterGallonsPerHead(45)).toBeCloseTo(0.5);
  });
});

describe("estimateDmiReductionKgPerHead", () => {
  it("is zero at or below the comfort threshold (THI 72)", () => {
    expect(estimateDmiReductionKgPerHead(72)).toBe(0);
    expect(estimateDmiReductionKgPerHead(60)).toBe(0);
  });

  it("reduces 0.29 kg per THI-unit above the comfort threshold", () => {
    expect(estimateDmiReductionKgPerHead(82)).toBeCloseTo(2.9);
  });
});

describe("estimateRespirationMultiplier", () => {
  it("is 1x (resting) at or below the breakpoint (THI 77)", () => {
    expect(estimateRespirationMultiplier(77)).toBe(1);
    expect(estimateRespirationMultiplier(60)).toBe(1);
  });

  it("rises above 1x past the breakpoint", () => {
    const multiplier = estimateRespirationMultiplier(87);
    // baseline 38 bpm + 2.04 * 10 = 58.4 bpm -> 58.4 / 38
    expect(multiplier).toBeCloseTo(58.4 / 38);
    expect(multiplier).toBeGreaterThan(1);
  });
});
