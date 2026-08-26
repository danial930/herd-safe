"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Clock, Droplet, Loader2, Milk, Sun, Wheat, Wind, X, Zap } from "lucide-react";
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
import { WorkerComfortBadge } from "./WorkerComfortBadge";
import { SpoilageBadge } from "./SpoilageBadge";
import { HerdImpactCard } from "./HerdImpactCard";
import { CATEGORY_COLOR } from "./RiskGauge";
import { RouteMap } from "./RouteMap";
import type { RouteWaypoint } from "./RouteMapView";
import type { CheckpointSummary } from "@/lib/farms/getCheckpointSummaries";
import {
  PMO_TRANSPORT_RECEIVING_CEILING_C,
  REACTIVE_FORECAST_HOURS,
  SHADE_SQFT_PER_HEAD,
  SPOILAGE_TEMP_CEILING_C,
  TWENTY_EIGHT_HOUR_LAW_LIMIT_HOURS,
  TWENTY_EIGHT_HOUR_LAW_REST_HOURS,
  type ThiCategory,
  type WorkerComfortLevel,
} from "@/lib/constants";
import {
  celsiusToFahrenheit,
  estimateAdditionalWaterGallonsPerHead,
  estimateDmiReductionKgPerHead,
  estimateRespirationMultiplier,
} from "@/lib/impact/herdMetrics";
import { estimateAdditionalCoolingCostUsd } from "@/lib/impact/storageEnergyMetrics";
import { estimateMilkCoolingBufferHours, hoursSinceScheduledDeparture } from "@/lib/impact/transitMetrics";

interface RiskSeriesPoint {
  date: string;
  hour: number;
  temperatureC: number;
  humidityPct: number;
  thiValue: number | null;
  thiCategory: string | null;
  aqi: number | null;
  workerComfort: string | null;
  spoilageRisk: boolean | null;
}

interface RiskResponse {
  series: RiskSeriesPoint[];
  historicalAnalog: Array<{ hour: number; avgThi: number; minThi: number; maxThi: number }> | null;
  spoilageSummary: { atRisk: boolean; maxTemperatureC: number; hoursAtOrAboveCeiling: number } | null;
  /** The checkpoint's actual complete-year backtest scope — may be fewer
   * than 3 years, or empty for a reactive-only checkpoint. Never assume 3. */
  yearsBacktested: number[];
  /** FARM/TRANSPORT_ROUTE only — a separate, real, lightweight ambient-
   * temperature-frequency signal (not THI, not blended into the dollar
   * estimate or optimizer). Null for STORAGE and for any checkpoint whose
   * ingestion hasn't run this since the feature shipped. */
  ambientHeatFrequency: {
    thresholdC: number;
    windowDays: number;
    longestStreakHours: number;
  } | null;
  /** Full checkpoint row — only routeWaypoints is used here (RouteMap), but
   * the API already returns the whole thing. */
  checkpoint: { routeWaypoints: unknown };
}

interface RecommendationResponse {
  recommendation: {
    currentScheduleStart: string;
    recommendedOffsetMinutes: number;
    exposureBefore: number;
    exposureAfter: number;
    yearlyBacktest: Record<string, { exposureBefore: number; exposureAfter: number }>;
  } | null;
}

const YEAR_COLORS: Record<string, string> = {
  "2023": "var(--series-2023)",
  "2024": "var(--series-2024)",
  "2025": "var(--series-2025)",
};

function groupByYearAndHour(series: RiskSeriesPoint[]) {
  const byYearHour = new Map<string, { sum: number; count: number }>();
  for (const point of series) {
    if (point.thiValue === null) continue;
    const year = point.date.slice(0, 4);
    const key = `${year}-${point.hour}`;
    const entry = byYearHour.get(key) ?? { sum: 0, count: 0 };
    entry.sum += point.thiValue;
    entry.count += 1;
    byYearHour.set(key, entry);
  }

  const years = Array.from(new Set(series.map((p) => p.date.slice(0, 4)))).sort();
  const rows = Array.from({ length: 24 }, (_, hour) => {
    const row: Record<string, number | string> = { hour };
    for (const year of years) {
      const entry = byYearHour.get(`${year}-${hour}`);
      if (entry) row[year] = Number((entry.sum / entry.count).toFixed(1));
    }
    return row;
  });
  return { years, rows };
}

export function CheckpointDetailModal({ checkpoint, onClose }: { checkpoint: CheckpointSummary; onClose: () => void }) {
  const [risk, setRisk] = useState<RiskResponse | null>(null);
  const [recommendation, setRecommendation] = useState<RecommendationResponse["recommendation"]>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [riskRes, recRes] = await Promise.all([
        fetch(`/api/checkpoints/${checkpoint.id}/risk`),
        fetch(`/api/checkpoints/${checkpoint.id}/recommendation`),
      ]);
      const riskJson = await riskRes.json();
      const recJson = await recRes.json();
      if (cancelled) return;
      setRisk(riskJson);
      setRecommendation(recJson.recommendation);
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [checkpoint.id]);

  const chartData = useMemo(() => (risk ? groupByYearAndHour(risk.series) : { years: [], rows: [] }), [risk]);
  const forecastData = useMemo(
    () =>
      risk?.series.map((p, i) => ({
        label: i === 0 ? "now" : `+${i}h`,
        temperatureC: Number(p.temperatureC.toFixed(1)),
      })) ?? [],
    [risk],
  );
  const forecastThiData = useMemo(
    () =>
      risk?.series.map((p, i) => ({
        label: i === 0 ? "now" : `+${i}h`,
        thi: p.thiValue === null ? null : Number(p.thiValue.toFixed(1)),
      })) ?? [],
    [risk],
  );

  const latestRisk = risk?.series[risk.series.length - 1];

  // Herd Impact Today (FARM checkpoint only) — pure computation on the same
  // latestRisk reading everything else on this modal already uses, zero
  // additional FortyGuard calls. See lib/impact/herdMetrics.ts for the
  // formulas and lib/constants.ts for full source citations. Gated on
  // latestRisk existing at all — "today" figures need a real current
  // reading, not just herdSize being set.
  const herdImpact = useMemo(() => {
    if (checkpoint.type !== "FARM" || !latestRisk || latestRisk.thiValue === null) return null;
    const temperatureF = celsiusToFahrenheit(latestRisk.temperatureC);
    return {
      temperatureF,
      waterGallonsPerHead: estimateAdditionalWaterGallonsPerHead(temperatureF),
      dmiReductionKgPerHead: estimateDmiReductionKgPerHead(latestRisk.thiValue),
      respirationMultiplier: estimateRespirationMultiplier(latestRisk.thiValue),
    };
  }, [checkpoint.type, latestRisk]);

  // Transit Impact (TRANSPORT_ROUTE checkpoint only) — same pattern as
  // herdImpact above: pure computation on latestRisk + the checkpoint's own
  // schedule, zero additional FortyGuard calls. See
  // lib/impact/transitMetrics.ts and lib/constants.ts for formulas/sources.
  const transitImpact = useMemo(() => {
    if (checkpoint.type !== "TRANSPORT_ROUTE" || !latestRisk) return null;
    const schedule = checkpoint.schedule as { departureTime?: string };
    if (!schedule.departureTime) return null;
    return {
      coolingBufferHours: estimateMilkCoolingBufferHours(latestRisk.temperatureC),
      transitHours: hoursSinceScheduledDeparture(schedule.departureTime),
    };
  }, [checkpoint.type, checkpoint.schedule, latestRisk]);

  // Route map waypoints (TRANSPORT_ROUTE only) — farm -> midpoint(s) ->
  // storage, from the checkpoint's own stored routeWaypoints (set at
  // creation time, lib/farms/createFarm.ts). Labels are position-based
  // (first = Farm, last = Storage, everything between = Route midpoint)
  // rather than hardcoding exactly 3 entries, since the demo farm's real
  // road-route override (prisma/seed.ts) is also 3 today but nothing
  // guarantees that stays true.
  const routeWaypoints = useMemo((): RouteWaypoint[] => {
    if (checkpoint.type !== "TRANSPORT_ROUTE" || !risk) return [];
    const raw = risk.checkpoint.routeWaypoints as Array<{ lat: number; lon: number }> | null;
    if (!raw || raw.length === 0) return [];
    return raw.map((point, i) => ({
      lat: point.lat,
      lon: point.lon,
      label: i === 0 ? "Farm" : i === raw.length - 1 ? "Storage" : "Route midpoint",
    }));
  }, [checkpoint.type, risk]);

  // Single color for the whole route line, reusing the exact THI category
  // scale RiskGauge/badges already use elsewhere — never a bespoke scale.
  // Neutral gray when there's no current reading to color it by.
  const routeColor = latestRisk?.thiCategory ? CATEGORY_COLOR[latestRisk.thiCategory as ThiCategory] : "var(--text-muted)";

  // Storage Impact (STORAGE checkpoint only) — same pattern again. See
  // lib/impact/storageEnergyMetrics.ts and lib/constants.ts.
  const storageImpact = useMemo(() => {
    if (checkpoint.type !== "STORAGE" || !latestRisk) return null;
    return { additionalCoolingCostUsd: estimateAdditionalCoolingCostUsd(latestRisk.temperatureC) };
  }, [checkpoint.type, latestRisk]);

  // Non-STORAGE checkpoints have 3 distinct data states, not 2: a full
  // historical backtest (unchanged below), reactive-only current+12h data
  // with no historical pull yet (new farms default to this — render a
  // forecast trend instead of an empty state, since the data genuinely
  // exists, just isn't historical), or truly nothing cached at all (a
  // failed/never-run pull — the only case that still shows "no data").
  const hasHistorical = risk !== null && checkpoint.type !== "STORAGE" && risk.yearsBacktested.length > 0;
  const hasForecastOnly =
    risk !== null && checkpoint.type !== "STORAGE" && risk.yearsBacktested.length === 0 && risk.series.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-8" onClick={onClose}>
      <div
        className="w-full max-w-2xl rounded-2xl bg-surface-raised p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="mb-5 flex items-start justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-text-muted">{checkpoint.type.replace("_", " ")}</p>
            <h2 className="font-display text-xl font-semibold text-text-primary">{checkpoint.name}</h2>
          </div>
          <button onClick={onClose} className="rounded-full p-1.5 text-text-muted hover:bg-background hover:text-text-primary" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        {loading || !risk ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-brand" aria-hidden />
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center gap-2">
              <WorkerComfortBadge level={(latestRisk?.workerComfort as WorkerComfortLevel) ?? null} />
              {checkpoint.type === "STORAGE" && <SpoilageBadge atRisk={risk.spoilageSummary?.atRisk ?? null} />}
            </div>

            {checkpoint.type === "STORAGE" ? (
              <>
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-text-primary">
                    {forecastData.length === 1 ? "Current conditions" : `${forecastData.length}-hour forecast`} — ambient temperature
                  </h3>
                  <div className="h-56 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={forecastData} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                        <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} />
                        <YAxis tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} unit="°C" width={44} />
                        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid var(--border-subtle)" }} />
                        <ReferenceLine y={35} stroke="var(--status-moderate)" strokeDasharray="4 4" label={{ value: "refrigeration strain threshold", fontSize: 10, fill: "var(--status-moderate)", position: "insideTopRight" }} />
                        <Line type="monotone" dataKey="temperatureC" stroke="var(--brand)" strokeWidth={2} dot={{ r: 3 }} name="Ambient temperature (°C)" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                {risk.spoilageSummary && (
                  <p className="text-sm text-text-secondary">
                    Max ambient forecast temperature <span className="font-medium text-text-primary">{risk.spoilageSummary.maxTemperatureC.toFixed(1)}°C</span> ·{" "}
                    {risk.spoilageSummary.hoursAtOrAboveCeiling} of {risk.series.length} hours cross the refrigeration-strain threshold — elevated risk of
                    equipment strain or an outage during those hours, not a confirmed reading of the stored product&apos;s temperature.
                  </p>
                )}
              </>
            ) : hasForecastOnly ? (
              <div>
                <h3 className="mb-2 text-sm font-semibold text-text-primary">
                  {forecastThiData.length === 1 ? "Current conditions" : `Next ${forecastThiData.length} hours`}
                </h3>
                <div className="h-56 w-full">
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
                <p className="mt-2 text-xs text-text-muted">
                  Forecast, not a historical backtest — a multi-year pull hasn&apos;t been run for this checkpoint yet.
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
                  {risk.yearsBacktested.join(", ")} — not a live forecast, since our reactive pull only reaches{" "}
                  {REACTIVE_FORECAST_HOURS} hour{REACTIVE_FORECAST_HOURS === 1 ? "" : "s"} out.
                </p>
              </>
            ) : (
              <div className="rounded-xl border border-dashed border-border-subtle p-4 text-sm text-text-secondary">
                No data yet for this checkpoint — its ingestion may have failed or hasn&apos;t run yet.
              </div>
            )}

            {checkpoint.type !== "STORAGE" && risk.ambientHeatFrequency && (
              <div className="rounded-xl border border-border-subtle p-4">
                <h3 className="mb-1 text-sm font-semibold text-text-primary">
                  Ambient heat frequency — past {risk.ambientHeatFrequency.windowDays} days
                </h3>
                <p className="text-sm text-text-secondary">
                  Longest continuous stretch above{" "}
                  <span className="font-medium text-text-primary">{risk.ambientHeatFrequency.thresholdC}°C</span>:{" "}
                  <span className="font-medium text-text-primary">{risk.ambientHeatFrequency.longestStreakHours} hours</span>.
                </p>
                <p className="mt-1 text-xs text-text-muted">
                  Raw ambient-temperature frequency from real historical data — not the THI-based stress metric above, and not
                  included in the dollar-impact estimate.
                </p>
              </div>
            )}

            {herdImpact && (
              <>
                <hr className="border-border-subtle" />
                <div className="rounded-2xl bg-background p-4">
                  <h3 className="mb-1 text-sm font-semibold text-text-primary">Herd Impact Today</h3>
                  {checkpoint.farmHerdSize === null && (
                    <p className="mb-3 text-xs text-text-muted">
                      Per-animal figures shown below.{" "}
                      <Link href={`/farms/${checkpoint.farmId}/edit`} className="font-medium text-brand hover:underline">
                        Add herd size
                      </Link>{" "}
                      for a total estimate.
                    </p>
                  )}
                  <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <HerdImpactCard
                      icon={Droplet}
                      value={
                        checkpoint.farmHerdSize
                          ? `${Math.round(herdImpact.waterGallonsPerHead * checkpoint.farmHerdSize)} gal`
                          : `${herdImpact.waterGallonsPerHead.toFixed(1)} gal/head`
                      }
                      label="Additional water needed today"
                      context={`Based on today's peak temperature (${herdImpact.temperatureF.toFixed(0)}°F). Deliver within a 4-6 hour window during heat stress, not spread across 24h.`}
                      source="Oklahoma State University Extension (Paul Beck, beef nutrition specialist): water intake increases ~1 gallon/head/day for every 10°F above 40°F ambient temperature."
                    />
                    <HerdImpactCard
                      icon={Wheat}
                      value={
                        checkpoint.farmHerdSize
                          ? `${(herdImpact.dmiReductionKgPerHead * checkpoint.farmHerdSize).toFixed(0)} kg`
                          : `${herdImpact.dmiReductionKgPerHead.toFixed(1)} kg/head`
                      }
                      label="Est. feed intake reduction today"
                      context="Dry matter intake drops as THI rises above the comfort threshold — a separate economic-impact line from the milk-yield estimate above."
                      source="Global meta-analysis, International Journal of Biometeorology (2021), DOI 10.1007/s00484-021-02167-0: North America dry matter intake drops ~0.29 kg/day per THI-unit above the comfort threshold (THI 72)."
                    />
                    <HerdImpactCard
                      icon={Sun}
                      value={
                        checkpoint.farmHerdSize
                          ? `${(SHADE_SQFT_PER_HEAD * checkpoint.farmHerdSize).toLocaleString()} sq ft`
                          : `${SHADE_SQFT_PER_HEAD} sq ft/head`
                      }
                      label="Shade available for herd"
                      context="Recommended minimum to avoid crowding/competition for shade on pasture."
                      source="Cornell Cooperative Extension (Southwest NY Dairy, Livestock & Field Crops Program), 'Shielding grazing dairy cows from heat stress': at least 40 sq ft of shade per cow for grazing dairy cattle. Corroborated by UMN Extension (~40 sq ft) and CDQAP (40-50 sq ft)."
                    />
                    <HerdImpactCard
                      icon={Wind}
                      value={`${herdImpact.respirationMultiplier.toFixed(1)}x`}
                      label="Est. respiration rate"
                      context={`Cattle are likely breathing at approximately ${herdImpact.respirationMultiplier.toFixed(1)}x their resting rate based on today's THI.`}
                      source="Resting rate: Mississippi State University Extension (26-50 breaths/min, non-heat-stressed). Rate of increase: Frontiers in Animal Science (2021), 'Critical Temperature-Humidity Index Thresholds for Dry Cows in a Subtropical Climate' — ~2.04 breaths/min per THI-unit above THI 77. An order-of-magnitude approximation, not farm-specific validated data."
                    />
                  </div>
                </div>
              </>
            )}

            {transitImpact && (
              <>
                <hr className="border-border-subtle" />
                <div className="rounded-2xl bg-background p-4">
                  <h3 className="mb-3 text-sm font-semibold text-text-primary">Transit Impact</h3>
                  {routeWaypoints.length > 0 && (
                    <div className="mb-3">
                      <RouteMap waypoints={routeWaypoints} color={routeColor} />
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <HerdImpactCard
                      icon={Milk}
                      value={
                        Number.isFinite(transitImpact.coolingBufferHours)
                          ? `${transitImpact.coolingBufferHours.toFixed(1)} hrs`
                          : "No risk today"
                      }
                      label="Est. cooling buffer remaining"
                      context="Based on today's ambient temperature along the route and an assumed insulated-tanker heat-gain rate."
                      source={`Milk is assumed loaded at the storage ceiling (${SPOILAGE_TEMP_CEILING_C}°C / ${celsiusToFahrenheit(SPOILAGE_TEMP_CEILING_C).toFixed(0)}°F) and warms toward ambient at an ILLUSTRATIVE rate — 5% of the ambient-to-milk temperature differential per hour — until it reaches the FDA Grade "A" PMO's transport-receiving ceiling (${PMO_TRANSPORT_RECEIVING_CEILING_C}°C / ${celsiusToFahrenheit(PMO_TRANSPORT_RECEIVING_CEILING_C).toFixed(0)}°F). This is an estimate under stated assumptions, not a validated measurement of this specific tanker's actual insulation.`}
                    />
                    <HerdImpactCard
                      icon={Clock}
                      value={`${transitImpact.transitHours.toFixed(1)} hrs`}
                      label={`of ${TWENTY_EIGHT_HOUR_LAW_LIMIT_HOURS}-hr legal limit used`}
                      context={`${Math.min(100, (transitImpact.transitHours / TWENTY_EIGHT_HOUR_LAW_LIMIT_HOURS) * 100).toFixed(0)}% of the federal confinement limit — informational context, not an alarm.`}
                      source={`49 U.S.C. § 80502, the Twenty-Eight Hour Law (1873, reenacted 1994): interstate carriers may not confine animals for more than ${TWENTY_EIGHT_HOUR_LAW_LIMIT_HOURS} consecutive hours without unloading for at least ${TWENTY_EIGHT_HOUR_LAW_REST_HOURS} consecutive hours of food, water, and rest. GAO-26-108123 (June 2026), "Animal Transport: Congress Should Consider Modernizing the Law to Better Protect Livestock," found the law addresses only duration of confinement — not environmental conditions (temperature/ventilation), among four other factors — which is the gap HerdSafe's heat tracking addresses.`}
                    />
                  </div>
                </div>
              </>
            )}

            {storageImpact && (
              <>
                <hr className="border-border-subtle" />
                <div className="rounded-2xl bg-background p-4">
                  <h3 className="mb-3 text-sm font-semibold text-text-primary">Storage Impact</h3>
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <HerdImpactCard
                      icon={Zap}
                      value={`$${storageImpact.additionalCoolingCostUsd.toFixed(2)}`}
                      label="Est. additional cooling cost today"
                      context="Based on today's ambient temperature above the refrigeration-strain threshold and U.S. average commercial electricity rates."
                      source="Electricity rate: EIA Electric Power Monthly, April 2026 — 13.51 cents/kWh (U.S. average commercial). The energy-draw coefficient (extra kWh per °C above the strain threshold) is an ILLUSTRATIVE, conservative approximation, not an independently sourced engineering figure — refine when a facility-specific or engineering-validated coefficient becomes available."
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
