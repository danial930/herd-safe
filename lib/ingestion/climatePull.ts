/**
 * Cache-first, idempotent real-hourly-climate pulling (PROJECT_GUIDE.md
 * Section 7, rule 4). Shared by ingest-historical.ts and ingest-current.ts.
 *
 * Ports the two-step workaround for the env_params anchor gotcha (Section 3):
 *   1. Real per-hour temperature comes from `tcm` heatmap filter_type=1 calls
 *      — one per hour, since neither filter_type=2 nor filter_type=3 return a
 *      genuine hourly array from the tcm endpoint (they return a single
 *      aggregate / min / max / average instead).
 *   2. Real per-hour humidity comes from a single env_params filter_type=3
 *      call per day — only `relative_humidity_percent` is trusted from it.
 * Each hour's real temperature is paired with that same hour's real humidity
 * to compute THI ourselves; FortyGuard's derived heat_index/wet_bulb fields
 * are never used as literal hourly truth.
 */
import {
  CLIMATE_POINT_BUFFER_ESCALATION_METERS,
  CLIMATE_POINT_BUFFER_METERS,
  DEFAULT_GRANULARITY_METERS,
  ENV_PARAMS_HUMIDITY_ANCHOR_C,
  INGESTION_CONCURRENCY,
  RECENCY_FALLBACK_MAX_HOURS_BACK,
} from "@/lib/constants";
import { prisma } from "@/lib/db";
import type { FortyGuardClient } from "@/lib/fortyguard/client";
import { buildPointBufferPolygon } from "@/lib/fortyguard/geo";
import type { EnvParamsResult, HeatmapResult } from "@/lib/fortyguard/types";
import { mapWithConcurrency } from "./concurrency";

export interface HourlyClimateSample {
  hour: number; // 0-23, in whatever wall-clock convention was requested (see note below)
  temperatureC: number;
  humidityPct: number;
  aqi: number;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * DISCOVERED QUIRK (not documented in the quickstart notebooks): a live
 * filter_type=1 (single-hour) tcm call can return tiles carrying
 * `average_temperature`/`min_temperature`/`max_temperature` instead of the
 * plain `temperature` field the notebooks document for that filter type —
 * confirmed against a real request during this build. Extraction checks
 * `temperature` first, falling back to `average_temperature` so a single-
 * hour pull never silently comes back empty.
 */
/** Extracts usable tile temperatures, or `null` if the response has none
 * (empty map_data.features, or tiles with neither `temperature` nor
 * `average_temperature`) — a zero-tile response is a real, billed
 * "Completed" task (not a "Failed" one — see PROJECT_GUIDE.md Section 3),
 * so callers must distinguish "no usable data" from an actual error and
 * NEVER cache it as if it were a valid response (see fetchHourlyTemperatureC). */
function tryAverageTcmTemperature(result: HeatmapResult): number | null {
  const features = result.map_data.features as unknown as Array<{ properties: Record<string, unknown> }>;
  const temps = features
    .map((f) => (typeof f.properties.temperature === "number" ? f.properties.temperature : f.properties.average_temperature))
    .filter((t): t is number => typeof t === "number");
  if (temps.length === 0) return null;
  return temps.reduce((sum, t) => sum + t, 0) / temps.length;
}

function averageTcmTemperature(result: HeatmapResult): number {
  const avg = tryAverageTcmTemperature(result);
  if (avg === null) {
    throw new Error("tcm heatmap response had no tile temperatures");
  }
  return avg;
}

async function fetchHourlyTemperatureC(
  client: FortyGuardClient,
  checkpointId: string,
  latitude: number,
  longitude: number,
  dateISO: string,
  hour: number,
): Promise<number> {
  const startDate = new Date(`${dateISO}T${pad2(hour)}:00:00.000Z`);
  const granularity = DEFAULT_GRANULARITY_METERS;

  // NOTE: findFirst, not findUnique — Prisma 7 rejects `null` as an argument
  // inside a compound-unique `findUnique` lookup ("Argument endDate must not
  // be null"), and Postgres's unique index doesn't dedupe null-containing
  // rows either (NULL <> NULL in SQL), so the DB constraint alone can't do
  // this lookup. findFirst with plain equality filters handles null
  // correctly. Safe here because ingestion scripts run single-threaded/
  // sequential, not as concurrent writers racing each other.
  const cached = await prisma.heatmapCache.findFirst({
    where: {
      checkpointId,
      analyticType: "tcm",
      startDate,
      endDate: null,
      filterType: 1,
      granularity,
      threshold: null,
      direction: null,
    },
  });

  if (cached) {
    // The cache only ever stores responses that had usable tiles (see
    // below), so this is never the poisoned-zero-tile case.
    return averageTcmTemperature(cached.rawResponse as unknown as HeatmapResult);
  }

  // A zero-tile response is grid-alignment-dependent per location, not a
  // fixed-buffer-size problem (confirmed at two different real locations
  // during testing) — so on a miss, escalate the buffer rather than fail
  // immediately. Each attempt is still a real, billed "Completed" task
  // (PROJECT_GUIDE.md Section 3: only Failed tasks are free), so this is
  // deliberately short — 1 default try + up to 2 escalation steps.
  const bufferAttempts = [CLIMATE_POINT_BUFFER_METERS, ...CLIMATE_POINT_BUFFER_ESCALATION_METERS];

  for (let i = 0; i < bufferAttempts.length; i++) {
    const bufferMeters = bufferAttempts[i];
    const { result } = await client.createHeatmap({
      polygonAoi: buildPointBufferPolygon(latitude, longitude, bufferMeters),
      startDate: dateISO,
      startTime: `${pad2(hour)}:00`,
      filterType: 1,
      granularity,
      analyticType: "tcm",
    });

    const temperature = tryAverageTcmTemperature(result);
    if (temperature !== null) {
      // Only a response with usable tiles ever gets cached — a zero-tile
      // response is real and billed, but caching it would permanently lock
      // in the failure: every future call (even after a code fix) would
      // just replay it from cache instead of ever retrying the API.
      await prisma.heatmapCache.create({
        data: {
          checkpointId,
          analyticType: "tcm",
          startDate,
          endDate: null,
          filterType: 1,
          granularity,
          threshold: null,
          direction: null,
          rawResponse: result as unknown as object,
        },
      });
      return temperature;
    }
  }

  throw new Error(
    `tcm heatmap returned zero tiles at (${latitude}, ${longitude}) for ${dateISO} ${pad2(hour)}:00 even after escalating ` +
      `the buffer through ${bufferAttempts.join("m, ")}m — this location may need a larger CLIMATE_POINT_BUFFER_ESCALATION_METERS step.`,
  );
}

/**
 * Fetches (cache-first) the full env_params response for one day. We don't
 * restrict `analysis` — a live smoke test showed the API returns its full
 * default parameter set regardless of the requested subset, so a single call
 * serves both the humidity and AQI extractors below at no extra cost.
 */
async function fetchDailyEnvParams(
  client: FortyGuardClient,
  checkpointId: string,
  latitude: number,
  longitude: number,
  dateISO: string,
): Promise<EnvParamsResult> {
  const date = new Date(`${dateISO}T00:00:00.000Z`);
  const temperatureAnchor = ENV_PARAMS_HUMIDITY_ANCHOR_C;

  const cached = await prisma.envParamsCache.findUnique({
    where: { checkpointId_date_temperatureAnchor: { checkpointId, date, temperatureAnchor } },
  });
  if (cached) {
    return cached.rawResponse as unknown as EnvParamsResult;
  }

  const { result } = await client.environmentalParameters({
    latitude,
    longitude,
    temperature: temperatureAnchor,
    startDate: dateISO,
    filterType: 3,
  });
  await prisma.envParamsCache.create({
    data: { checkpointId, date, temperatureAnchor, rawResponse: result as unknown as object },
  });
  return result;
}

interface DailyHumidityAndAqi {
  humidityByHour: number[];
  aqiByHour: number[];
}

function extractHumidityAndAqi(result: EnvParamsResult, dateISO: string): DailyHumidityAndAqi {
  const humidity = result.locations[0]?.parameters.relative_humidity_percent;
  const aqi = result.locations[0]?.parameters["air_quality:idx"];
  if (!Array.isArray(humidity) || humidity.length === 0) {
    throw new Error(`env_params response for ${dateISO} had no relative_humidity_percent array`);
  }
  if (!Array.isArray(aqi) || aqi.length === 0) {
    throw new Error(`env_params response for ${dateISO} had no air_quality:idx array`);
  }
  return { humidityByHour: humidity as number[], aqiByHour: aqi as number[] };
}

function lookupHour<T>(arr: T[], hour: number): T {
  return arr[hour] ?? arr[arr.length - 1];
}

/**
 * Real hourly (temperature, humidity, AQI) samples for one checkpoint on one
 * day. Cache-first and safe to re-run — already-cached hours/days are
 * skipped.
 */
export async function pullRealHourlyClimateForDay(
  client: FortyGuardClient,
  checkpointId: string,
  latitude: number,
  longitude: number,
  dateISO: string,
): Promise<HourlyClimateSample[]> {
  const envParams = await fetchDailyEnvParams(client, checkpointId, latitude, longitude, dateISO);
  const { humidityByHour, aqiByHour } = extractHumidityAndAqi(envParams, dateISO);

  const hours = Array.from({ length: 24 }, (_, hour) => hour);
  const temperatures = await mapWithConcurrency(hours, INGESTION_CONCURRENCY, (hour) =>
    fetchHourlyTemperatureC(client, checkpointId, latitude, longitude, dateISO, hour),
  );

  return hours.map((hour) => ({
    hour,
    temperatureC: temperatures[hour],
    humidityPct: lookupHour(humidityByHour, hour),
    aqi: lookupHour(aqiByHour, hour),
  }));
}

export interface TimestampedClimateSample extends HourlyClimateSample {
  timestamp: Date;
}

function toDateISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Fetches (temperature, humidity, AQI) for `timestamp`, and — if that hour's
 * tcm call comes back with zero tiles even after fetchHourlyTemperatureC's
 * own buffer-escalation attempt — retries at (timestamp - 1h), (- 2h), ...
 * up to RECENCY_FALLBACK_MAX_HOURS_BACK. This is the fix for forecast-data
 * recency/processing-lag (confirmed as the real cause of a live failure —
 * see the doc comment on CLIMATE_POINT_BUFFER_METERS in lib/constants.ts),
 * not a buffer-size problem: "current conditions" tolerates being a little
 * stale, so falling back to the last hour that actually had data is more
 * honest and far cheaper than pulling a bigger area.
 *
 * Temperature and humidity/AQI are always fetched for the SAME resolved
 * hour, never mixed across hours — pairing one hour's real temperature with
 * a *different* hour's real humidity would reintroduce exactly the
 * synthetic-mismatch problem the env_params anchor workaround (Section 3)
 * exists to avoid.
 *
 * `envParamsPromises` de-duplicates concurrent env_params fetches for the
 * same calendar date (a fallback can cross midnight) — sharing the in-flight
 * promise, not just the resolved value, so two concurrent workers hitting a
 * new date at the same time can't both fire a live call or both try to
 * insert the same cache row.
 */
async function fetchHourlyTemperatureWithRecencyFallback(
  client: FortyGuardClient,
  checkpointId: string,
  latitude: number,
  longitude: number,
  timestamp: Date,
  envParamsPromises: Map<string, Promise<DailyHumidityAndAqi>>,
): Promise<{ temperatureC: number; humidityPct: number; aqi: number; hour: number }> {
  function getDailyHumidityAndAqi(dateISO: string): Promise<DailyHumidityAndAqi> {
    let pending = envParamsPromises.get(dateISO);
    if (!pending) {
      pending = fetchDailyEnvParams(client, checkpointId, latitude, longitude, dateISO).then((envParams) =>
        extractHumidityAndAqi(envParams, dateISO),
      );
      envParamsPromises.set(dateISO, pending);
    }
    return pending;
  }

  let lastError: unknown;
  for (let hoursBack = 0; hoursBack <= RECENCY_FALLBACK_MAX_HOURS_BACK; hoursBack++) {
    const attemptTimestamp = new Date(timestamp.getTime() - hoursBack * 60 * 60 * 1000);
    const dateISO = toDateISO(attemptTimestamp);
    const hour = attemptTimestamp.getUTCHours();
    try {
      const temperatureC = await fetchHourlyTemperatureC(client, checkpointId, latitude, longitude, dateISO, hour);
      const { humidityByHour, aqiByHour } = await getDailyHumidityAndAqi(dateISO);
      return { temperatureC, humidityPct: lookupHour(humidityByHour, hour), aqi: lookupHour(aqiByHour, hour), hour };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

/**
 * Real (temperature, humidity, AQI) samples for an arbitrary set of hourly
 * timestamps — used by ingest-current.ts's "now + 12-hour forecast" window.
 * Falls back to earlier hours on a recency-driven zero-tile response (see
 * fetchHourlyTemperatureWithRecencyFallback above) — cache-first throughout.
 */
export async function pullRealHourlyClimateForTimestamps(
  client: FortyGuardClient,
  checkpointId: string,
  latitude: number,
  longitude: number,
  timestamps: Date[],
): Promise<TimestampedClimateSample[]> {
  const envParamsPromises = new Map<string, Promise<DailyHumidityAndAqi>>();

  const results = await mapWithConcurrency(timestamps, INGESTION_CONCURRENCY, async (ts) => {
    const { temperatureC, humidityPct, aqi } = await fetchHourlyTemperatureWithRecencyFallback(
      client,
      checkpointId,
      latitude,
      longitude,
      ts,
      envParamsPromises,
    );
    // Stored under the ORIGINALLY requested slot's hour, even when the
    // underlying reading came from an earlier hour via the recency
    // fallback — the forecast display is slot-indexed ("+0h, +1h, ..."),
    // and a slightly-stale real reading is still the right value to show
    // for that slot (capped at RECENCY_FALLBACK_MAX_HOURS_BACK, so it's
    // never silently very stale).
    return { timestamp: ts, hour: ts.getUTCHours(), temperatureC, humidityPct, aqi };
  });

  return results.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}
