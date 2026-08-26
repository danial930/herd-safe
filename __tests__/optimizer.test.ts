import { describe, expect, it } from "vitest";
import { computeExposure, optimizeSchedule, type HourlyThiPoint } from "@/lib/exposure/optimizer";
import { windowFromStartEnd } from "@/lib/exposure/scheduleWindow";

// Synthetic day: every hour is comfortable (THI 60) except hour 9, which is
// severe (THI 95). A 06:00-10:00 window (hours 6-9) currently catches that
// one hot hour. Shifting the window earlier should be able to avoid it
// entirely within the +/-90 minute sweep.
function buildSyntheticDay(): HourlyThiPoint[] {
  return Array.from({ length: 24 }, (_, hour) => ({
    date: "2025-06-01",
    hour,
    thi: hour === 9 ? 95 : 60,
  }));
}

describe("computeExposure", () => {
  it("counts only the hours within the window that meet the threshold", () => {
    const series = buildSyntheticDay();
    const window = windowFromStartEnd("06:00", "10:00");
    expect(computeExposure(series, window)).toBe(1);
  });

  it("returns 0 when the window doesn't overlap any exposed hour", () => {
    const series = buildSyntheticDay();
    const window = windowFromStartEnd("00:00", "04:00");
    expect(computeExposure(series, window)).toBe(0);
  });
});

describe("optimizeSchedule", () => {
  it("identifies the known-best offset in a synthetic series", () => {
    const series = buildSyntheticDay();
    const currentWindow = windowFromStartEnd("06:00", "10:00");

    const result = optimizeSchedule(series, currentWindow, 90, 15);

    expect(result.currentExposure).toBe(1);
    expect(result.bestExposure).toBe(0);
    // -90, -75, and -60 all reach zero exposure; the optimizer must prefer
    // the smallest-magnitude shift among ties.
    expect(result.bestOffsetMinutes).toBe(-60);
  });

  it("returns offset 0 when the current window is already optimal", () => {
    const series = buildSyntheticDay();
    const currentWindow = windowFromStartEnd("00:00", "04:00"); // already avoids hour 9

    const result = optimizeSchedule(series, currentWindow, 90, 15);

    expect(result.bestOffsetMinutes).toBe(0);
    expect(result.bestExposure).toBe(result.currentExposure);
  });
});
