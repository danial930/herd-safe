import { describe, expect, it } from "vitest";
import { backtestAcrossYears, historicalAnalogProfile } from "@/lib/exposure/backtest";
import type { HourlyThiPoint } from "@/lib/exposure/optimizer";
import { windowFromStartEnd } from "@/lib/exposure/scheduleWindow";

function dayWithHotHour(date: string, hotHour: number): HourlyThiPoint[] {
  return Array.from({ length: 24 }, (_, hour) => ({
    date,
    hour,
    thi: hour === hotHour ? 95 : 60,
  }));
}

describe("backtestAcrossYears", () => {
  it("aggregates per-year before/after exposure and flags years that don't improve", () => {
    const currentWindow = windowFromStartEnd("06:00", "10:00");
    // -60 offset avoids hour 9 (2023, 2024) but not hour 7 (2025, still inside
    // the shifted 05:00-09:00 window).
    const perYearSeries: Record<string, HourlyThiPoint[]> = {
      "2023": dayWithHotHour("2023-06-01", 9),
      "2024": dayWithHotHour("2024-06-01", 9),
      "2025": dayWithHotHour("2025-06-01", 7),
    };

    const result = backtestAcrossYears(perYearSeries, currentWindow, -60);

    expect(result.perYear["2023"]).toEqual({ exposureBefore: 1, exposureAfter: 0 });
    expect(result.perYear["2024"]).toEqual({ exposureBefore: 1, exposureAfter: 0 });
    expect(result.perYear["2025"]).toEqual({ exposureBefore: 1, exposureAfter: 1 });
    expect(result.holdsAcrossAllYears).toBe(false);
  });

  it("reports holdsAcrossAllYears true when every year improves", () => {
    const currentWindow = windowFromStartEnd("06:00", "10:00");
    const perYearSeries: Record<string, HourlyThiPoint[]> = {
      "2023": dayWithHotHour("2023-06-01", 9),
      "2024": dayWithHotHour("2024-06-01", 9),
    };

    const result = backtestAcrossYears(perYearSeries, currentWindow, -60);

    expect(result.holdsAcrossAllYears).toBe(true);
  });
});

describe("historicalAnalogProfile", () => {
  it("averages THI per hour-of-day across years, with min/max spread", () => {
    const perYearSeries: Record<string, HourlyThiPoint[]> = {
      "2023": [{ date: "2023-06-01", hour: 14, thi: 80 }],
      "2024": [{ date: "2024-06-01", hour: 14, thi: 90 }],
      "2025": [{ date: "2025-06-01", hour: 14, thi: 70 }],
    };

    const profile = historicalAnalogProfile(perYearSeries, [2023, 2024, 2025]);

    expect(profile).toHaveLength(1);
    expect(profile[0]).toMatchObject({ hour: 14, avgThi: 80, minThi: 70, maxThi: 90, sampleCount: 3 });
  });
});
