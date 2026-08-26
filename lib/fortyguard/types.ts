/**
 * Response-shape types for the FortyGuard tOS Enterprise API, ported from the
 * shapes documented in the Python quickstart's client.py docstrings and
 * notebooks 00-02 (see PROJECT_GUIDE.md Section 3 for the gotchas these
 * shapes are built around).
 */

export type GeoJsonPolygonAoi = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: Record<string, unknown>;
    geometry: {
      type: "Polygon";
      /** [lon, lat] order — the opposite of how people say "lat, long". */
      coordinates: number[][][];
    };
  }>;
};

/** date_time.filter_type: 1=single hour, 2=range of hours, 3=single day, 4=range of days. */
export interface DateTimeFilter {
  start_date: string; // YYYY-MM-DD
  filter_type: 1 | 2 | 3 | 4;
  start_time?: string; // HH:MM
  end_time?: string; // HH:MM
  end_date?: string; // YYYY-MM-DD, required for filter_type=4
}

// --- /v1/status/{activity_id} ----------------------------------------------

export interface StatusResponseData {
  status: string;
  message?: string;
  result?: unknown;
  [key: string]: unknown;
}

export interface StatusEnvelope {
  error?: boolean;
  message?: string;
  data: StatusResponseData;
}

export interface SubmitEnvelope {
  error?: boolean;
  message?: string;
  data: { activity_id: string };
}

// --- /v1/heatmap -------------------------------------------------------------

/** Present on `tcm` (default) tiles. */
export interface HeatmapTcmTileProperties {
  tile_id: string;
  /** filter_type 1/2 only */
  temperature?: number;
  /** filter_type 3/4 only — daily/multi-day aggregates, °C */
  average_temperature?: number;
  min_temperature?: number;
  max_temperature?: number;
}

/** Present on time_of_measure/exceedance/persistence tiles. */
export interface HeatmapAnalyticTileProperties {
  tile_id: string;
  value: number;
}

export interface HeatmapTile<P> {
  type: "Feature";
  geometry: { type: "Polygon"; coordinates: number[][][] };
  properties: P;
}

export interface HeatmapMapData<P> {
  type: "FeatureCollection";
  features: HeatmapTile<P>[];
}

export interface HeatmapTcmStatsData {
  Temperature_stats?: Record<string, number>;
  Overall_temperature_distribution?: number[];
  [key: string]: unknown;
}

export interface HeatmapAnalyticStatsData {
  activity_id: string;
  analytic_type: "time_of_measure" | "exceedance" | "persistence";
  units: string;
  n_cells: number;
  min: number;
  max: number;
  mean: number;
}

export interface HeatmapTcmResult {
  stats_data: HeatmapTcmStatsData;
  map_data: HeatmapMapData<HeatmapTcmTileProperties>;
}

export interface HeatmapAnalyticResult {
  stats_data: HeatmapAnalyticStatsData;
  map_data: HeatmapMapData<HeatmapAnalyticTileProperties>;
}

export type HeatmapResult = HeatmapTcmResult | HeatmapAnalyticResult;

// --- /v1/env_params ------------------------------------------------------

export const ENV_PARAMS_ANALYSES = [
  "heat_index_celsius",
  "apparent_temperature_celsius",
  "wet_bulb_temperature_celsius",
  "relative_humidity_percent",
  "precipitation_mm",
  "cloud_cover_octas",
  "air_quality:idx",
  "air_quality_no2:idx",
  "air_quality_o3:idx",
  "air_quality_pm2p5:idx",
  "air_quality_pm10:idx",
  "air_quality_so2:idx",
  "aqi_us_co",
  "methane_ppb",
  "co2_ppm",
  "elevation",
  "solar_irradiance",
] as const;

export type EnvParamsAnalysis = (typeof ENV_PARAMS_ANALYSES)[number];

/**
 * Each value is a scalar for filter_type=1, or an array aligned with
 * metadata.timestamps otherwise. We type as `number | number[]` and let
 * callers narrow based on the filter_type they requested.
 */
export type EnvParamsSeries = number | number[];

export interface EnvParamsLocation {
  lat: number;
  lon: number;
  elevation: number;
  /** the anchor temperature you passed in, echoed back */
  temperature: number;
  parameters: Partial<Record<EnvParamsAnalysis, EnvParamsSeries>>;
  solar_irradiance?: {
    clear_sky: { ghi: number; dni: number; dhi: number };
  };
}

export interface EnvParamsMetadata {
  time_range: { start: string; end: string; interval: string; count: number };
  timestamps: string[];
  timezone: string;
  timezone_offset_hours: number;
}

export interface EnvParamsResult {
  metadata: EnvParamsMetadata;
  locations: EnvParamsLocation[];
}

// --- usage endpoints -------------------------------------------------------

export interface ApiKeyUsageActivityRow {
  name: string;
  credits: number;
  count: number;
}

export interface ApiKeyUsageResponse {
  date_range?: { date_range_formatted?: string; [key: string]: unknown };
  total_credits_used?: number;
  activity_breakdown?: ApiKeyUsageActivityRow[];
  [key: string]: unknown;
}

// --- generic submit+wait envelope ------------------------------------------

export interface SubmitAndWaitResult<T> {
  activity_id: string;
  result: T;
}
