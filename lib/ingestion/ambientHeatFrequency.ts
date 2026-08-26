/**
 * Ambient-heat-frequency signal for FARM/TRANSPORT_ROUTE checkpoints on
 * every new farm — one cheap, REAL historical heatmap call (`persistence`,
 * filter_type=4 date range) over the past AMBIENT_HEAT_FREQUENCY_WINDOW_DAYS
 * days, reusing AMBIENT_HEAT_STRAIN_THRESHOLD_C.
 *
 * Deliberately NOT the THI-based historical backtest (that stays fully
 * gated — see historicalIngest.ts) and NOT blended into the dollar-impact
 * estimate or the optimizer (see lib/impact/computeChainSummary.ts, which
 * never reads this). It's a separate, honest, lightweight indicator: the
 * longest unbroken stretch above the strain threshold, surfaced plainly.
 *
 * ORIGINALLY paired with an `exceedance` call too (total hours above
 * threshold), but that doubled the per-farm cost of this feature for a
 * second number that told a similar story to the first — dropped to cut the
 * cost roughly in half. `persistence` reports the longest unbroken streak,
 * confirmed at a flat ~4,220 credits/call regardless of parameters
 * (scripts/measure-api-costs.ts, and re-verified at this exact
 * filter_type=4 + 30-day-range combination before shipping). Reads
 * `stats_data.max` directly from the API's own per-tile aggregation rather
 * than re-averaging tiles ourselves (see HeatmapAnalyticStatsData in
 * lib/fortyguard/types.ts) — the longest streak observed anywhere in the
 * checkpoint's AOI, not an average across tiles.
 *
 * Cache-first via the existing generic HeatmapCache (Section 7, rule 4) —
 * keyed by the real calendar dates requested, so a same-day retry resolves
 * from cache but a later day naturally busts it (the window is a rolling
 * "past N days", not a fixed range).
 */
import {
  AMBIENT_HEAT_FREQUENCY_WINDOW_DAYS,
  AMBIENT_HEAT_STRAIN_THRESHOLD_C,
  CLIMATE_POINT_BUFFER_METERS,
  DEFAULT_GRANULARITY_METERS,
} from "@/lib/constants";
import { prisma } from "@/lib/db";
import type { FortyGuardClient } from "@/lib/fortyguard/client";
import { buildPointBufferPolygon } from "@/lib/fortyguard/geo";
import type { HeatmapAnalyticResult, HeatmapResult } from "@/lib/fortyguard/types";

export interface AmbientHeatFrequency {
  thresholdC: number;
  windowDays: number;
  longestStreakHours: number;
}

function toDateISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Reads the API's own aggregate stat rather than re-deriving it from
 * individual tiles — `n_cells: 0` is the zero-tile case (a real, billed
 * response with nothing usable), which must never be cached, matching the
 * rule already established for tcm pulls in climatePull.ts. */
function extractMaxStat(result: HeatmapResult): number | null {
  const statsData = (result as HeatmapAnalyticResult).stats_data;
  if (!statsData || typeof statsData.n_cells !== "number" || statsData.n_cells === 0) return null;
  return typeof statsData.max === "number" ? statsData.max : null;
}

async function fetchPersistenceMax(
  client: FortyGuardClient,
  checkpointId: string,
  latitude: number,
  longitude: number,
  startDateISO: string,
  endDateISO: string,
): Promise<number> {
  const startDate = new Date(`${startDateISO}T00:00:00.000Z`);
  const endDate = new Date(`${endDateISO}T00:00:00.000Z`);
  const granularity = DEFAULT_GRANULARITY_METERS;
  const threshold = AMBIENT_HEAT_STRAIN_THRESHOLD_C;
  const analyticType = "persistence" as const;
  const direction = "above" as const;

  const cached = await prisma.heatmapCache.findUnique({
    where: {
      checkpointId_analyticType_startDate_endDate_filterType_granularity_threshold_direction: {
        checkpointId,
        analyticType,
        startDate,
        endDate,
        filterType: 4,
        granularity,
        threshold,
        direction,
      },
    },
  });
  if (cached) {
    const value = extractMaxStat(cached.rawResponse as unknown as HeatmapResult);
    if (value !== null) return value;
    // The cache only ever stores usable (non-zero-tile) responses (see
    // below) — falling through here would mean a corrupt/legacy row, not a
    // real zero-tile case, so treat it as "re-fetch" rather than trusting it.
  }

  const { result } = await client.createHeatmap({
    polygonAoi: buildPointBufferPolygon(latitude, longitude, CLIMATE_POINT_BUFFER_METERS),
    startDate: startDateISO,
    endDate: endDateISO,
    filterType: 4,
    granularity,
    analyticType,
    threshold,
    direction,
  });

  const value = extractMaxStat(result);
  if (value === null) {
    throw new Error(
      `persistence heatmap returned zero tiles at (${latitude}, ${longitude}) for ${startDateISO}..${endDateISO}`,
    );
  }

  await prisma.heatmapCache.create({
    data: {
      checkpointId,
      analyticType,
      startDate,
      endDate,
      filterType: 4,
      granularity,
      threshold,
      direction,
      rawResponse: result as unknown as object,
    },
  });
  return value;
}

/** One persistence call — one real, billed heatmap call total, not
 * per-hour like the reactive pull. */
export async function pullAmbientHeatFrequency(
  client: FortyGuardClient,
  checkpointId: string,
  latitude: number,
  longitude: number,
): Promise<AmbientHeatFrequency> {
  const now = new Date();
  // End yesterday, not today — today's day is still in progress, so
  // "past 30 days" means 30 real, complete days, not 29 plus a partial one.
  const endDateISO = toDateISO(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  const startDateISO = toDateISO(
    new Date(now.getTime() - AMBIENT_HEAT_FREQUENCY_WINDOW_DAYS * 24 * 60 * 60 * 1000),
  );

  const longestStreakHours = await fetchPersistenceMax(client, checkpointId, latitude, longitude, startDateISO, endDateISO);

  return {
    thresholdC: AMBIENT_HEAT_STRAIN_THRESHOLD_C,
    windowDays: AMBIENT_HEAT_FREQUENCY_WINDOW_DAYS,
    longestStreakHours: Math.round(longestStreakHours),
  };
}
