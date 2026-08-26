import { describe, expect, it } from "vitest";
import { estimateMilkCoolingBufferHours, hoursSinceScheduledDeparture } from "@/lib/impact/transitMetrics";

describe("estimateMilkCoolingBufferHours", () => {
  it("is Infinity (no risk) when ambient is at or below the milk's starting temp", () => {
    expect(estimateMilkCoolingBufferHours(4)).toBe(Infinity); // ambient == storage ceiling
    expect(estimateMilkCoolingBufferHours(-5)).toBe(Infinity);
  });

  it("returns a finite, positive buffer when ambient exceeds the milk's starting temp", () => {
    const hours = estimateMilkCoolingBufferHours(30);
    expect(hours).toBeGreaterThan(0);
    expect(Number.isFinite(hours)).toBe(true);
  });

  it("shrinks as ambient temperature rises", () => {
    const cooler = estimateMilkCoolingBufferHours(20);
    const hotter = estimateMilkCoolingBufferHours(35);
    expect(hotter).toBeLessThan(cooler);
  });
});

describe("hoursSinceScheduledDeparture", () => {
  it("is 0 exactly at the scheduled time", () => {
    const now = new Date("2026-08-24T13:00:00Z");
    now.setHours(13, 0, 0, 0);
    const hhmm = `${String(now.getHours()).padStart(2, "0")}:00`;
    expect(hoursSinceScheduledDeparture(hhmm, now)).toBeCloseTo(0);
  });

  it("computes elapsed hours for a departure earlier today", () => {
    const now = new Date();
    now.setHours(15, 0, 0, 0);
    const departure = new Date(now);
    departure.setHours(9, 0, 0, 0);
    const hhmm = "09:00";
    expect(hoursSinceScheduledDeparture(hhmm, now)).toBeCloseTo(6);
  });

  it("rolls back to yesterday when the scheduled time hasn't happened yet today", () => {
    const now = new Date();
    now.setHours(3, 0, 0, 0);
    const hhmm = "20:00"; // 8pm hasn't happened yet at 3am
    // elapsed since yesterday 20:00 -> 7 hours
    expect(hoursSinceScheduledDeparture(hhmm, now)).toBeCloseTo(7);
  });
});
