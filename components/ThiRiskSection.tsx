"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { RiskGauge } from "./RiskGauge";
import type { ThiCategory } from "@/lib/constants";

const YEAR_COLORS: Record<string, string> = {
  "2023": "var(--series-2023)",
  "2024": "var(--series-2024)",
  "2025": "var(--series-2025)",
};

export interface ThiRiskSectionProps {
  hasHistorical: boolean;
  hasForecastOnly: boolean;
  latestRisk: { thiValue: number | null; thiCategory: string | null } | undefined;
  chartData: { years: string[]; rows: Array<Record<string, number | string>> };
  forecastThiData: Array<{ label: string; thi: number | null }>;
  recommendation: {
    currentScheduleStart: string;
    recommendedOffsetMinutes: number;
    exposureBefore: number;
    exposureAfter: number;
    yearlyBacktest: Record<string, { exposureBefore: number; exposureAfter: number }>;
  } | null;
  yearsBacktested: number[];
  ambientHeatFrequency: { thresholdC: number; windowDays: number; longestStreakHours: number } | null;
  reactiveForecastHours: number;
}

/**
 * The THI/risk chart area for FARM/TRANSPORT_ROUTE checkpoints — ONE
 * component that renders differently based on what data actually exists for
 * a checkpoint, replacing what used to be two separate hardcoded flows
 * spread directly across CheckpointDetailModal.tsx:
 *
 * - hasHistorical (currently only the demo farm, via its synthetic seed —
 *   real farms would need the gated historicalIngest.ts path run manually):
 *   the existing 3-year comparison chart + backtest table, unchanged.
 * - hasForecastOnly (every new real farm, by default): a clear current-THI
 *   stat/badge (RiskGauge) as the PRIMARY element — not a chart, since with
 *   REACTIVE_FORECAST_HOURS=1 there's exactly one data point and a "trend
 *   line" through a single point is degenerate/misleading. The forecast
 *   trend chart still exists and renders itself if there's ever more than
 *   one point (e.g. if the reactive window is widened later) — it just
 *   isn't the primary element, and doesn't render whens there's nothing to
 *   trend. The 30-day ambient-heat-persistence stat (already built,
 *   already wired into ingestion — see currentIngest.ts) is shown here too,
 *   as real forward-looking context alongside the current reading.
 * - neither: the existing "no data yet" fallback, unchanged.
 */
export function ThiRiskSection({
  hasHistorical,
  hasForecastOnly,
  latestRisk,
  chartData,
  forecastThiData,
  recommendation,
  yearsBacktested,
  ambientHeatFrequency,
  reactiveForecastHours,
}: ThiRiskSectionProps) {
  return (
    <>
      {hasForecastOnly ? (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-text-primary">Current conditions</h3>
          <RiskGauge
            thiValue={latestRisk?.thiValue ?? null}
            category={(latestRisk?.thiCategory as ThiCategory) ?? null}
          />
          {forecastThiData.length > 1 && (
            <div className="mt-4 h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={forecastThiData} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} width={32} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid var(--border-subtle)" }} />
                  <ReferenceLine y={72} stroke="var(--status-mild)" strokeDasharray="4 4" label={{ value: "mild threshold", fontSize: 10, fill: "var(--status-mild)", position: "insideTopRight" }} />
                  <Line type="monotone" dataKey="thi" stroke="var(--brand)" strokeWidth={2} dot={{ r: 3 }} name="THI" connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
          <p className="mt-3 text-xs text-text-muted">
            Current reading{reactiveForecastHours > 1 ? ` + ${reactiveForecastHours - 1}h forecast` : ""}, not a
            historical backtest — a multi-year pull hasn&apos;t been run for this checkpoint yet.
          </p>
        </div>
      ) : hasHistorical ? (
        <>
          <div>
            <h3 className="mb-2 text-sm font-semibold text-text-primary">
              THI over the day — {chartData.years.length}-year comparison
            </h3>
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData.rows} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                  <XAxis dataKey="hour" tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} unit="h" />
                  <YAxis tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} width={32} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid var(--border-subtle)" }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <ReferenceLine y={72} stroke="var(--status-mild)" strokeDasharray="4 4" label={{ value: "mild threshold", fontSize: 10, fill: "var(--status-mild)", position: "insideTopRight" }} />
                  {chartData.years.map((year) => (
                    <Line key={year} type="monotone" dataKey={year} stroke={YEAR_COLORS[year] ?? "var(--brand)"} strokeWidth={2} dot={false} connectNulls />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {recommendation && (
            <div className="rounded-xl border border-border-subtle p-4">
              <h3 className="mb-2 text-sm font-semibold text-text-primary">Recommended schedule shift</h3>
              <p className="text-sm text-text-secondary">
                Shift from <span className="font-mono text-text-primary">{recommendation.currentScheduleStart}</span> by{" "}
                <span className="font-medium text-text-primary">{recommendation.recommendedOffsetMinutes} min</span> — exposure drops from{" "}
                <span className="font-medium text-text-primary">{recommendation.exposureBefore}h</span> to{" "}
                <span className="font-medium text-text-primary">{recommendation.exposureAfter}h</span> per week.
              </p>
              <table className="mt-3 w-full text-xs">
                <thead>
                  <tr className="text-left text-text-muted">
                    <th className="pb-1 font-medium">Year</th>
                    <th className="pb-1 font-medium">Before</th>
                    <th className="pb-1 font-medium">After</th>
                    <th className="pb-1 font-medium">Holds?</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(recommendation.yearlyBacktest).map(([year, entry]) => (
                    <tr key={year} className="border-t border-border-subtle">
                      <td className="py-1 font-mono">{year}</td>
                      <td className="py-1 font-mono">{entry.exposureBefore}h</td>
                      <td className="py-1 font-mono">{entry.exposureAfter}h</td>
                      <td className="py-1">{entry.exposureAfter < entry.exposureBefore ? "✓" : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-xs text-text-muted">
            The comparison above is a historical-analog estimate averaged from real cached data across{" "}
            {yearsBacktested.join(", ")} — not a live forecast, since our reactive pull only reaches{" "}
            {reactiveForecastHours} hour{reactiveForecastHours === 1 ? "" : "s"} out.
          </p>
        </>
      ) : (
        <div className="rounded-xl border border-dashed border-border-subtle p-4 text-sm text-text-secondary">
          No data yet for this checkpoint — its ingestion may have failed or hasn&apos;t run yet.
        </div>
      )}

      {ambientHeatFrequency && (
        <div className="rounded-xl border border-border-subtle p-4">
          <h3 className="mb-1 text-sm font-semibold text-text-primary">
            Ambient heat frequency — past {ambientHeatFrequency.windowDays} days
          </h3>
          <p className="text-sm text-text-secondary">
            Longest continuous stretch above{" "}
            <span className="font-medium text-text-primary">{ambientHeatFrequency.thresholdC}°C</span>:{" "}
            <span className="font-medium text-text-primary">{ambientHeatFrequency.longestStreakHours} hours</span>.
          </p>
          <p className="mt-1 text-xs text-text-muted">
            Raw ambient-temperature frequency from real historical data — not the THI-based stress metric above, and not
            included in the dollar-impact estimate.
          </p>
        </div>
      )}
    </>
  );
}
