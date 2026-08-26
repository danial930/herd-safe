/**
 * TypeScript port of the FortyGuard Python quickstart's fortyguard/client.py.
 *
 * This is the ONLY place in the codebase that may call api.fortyguard.com
 * (PROJECT_GUIDE.md Section 7, rule 2). Every analysis endpoint follows the
 * same submit -> poll pattern:
 *
 *   POST /v1/<endpoint>        -> { data: { activity_id } }
 *   GET  /v1/status/{activity_id} -> poll until status is terminal
 *
 * Ported behaviors (verified against the Python client and notebooks):
 * - Status strings matched case-insensitively; "succeeded"/"completed" both
 *   mean done, "failed"/"error" both mean failed.
 * - A 404 from the status endpoint right after submit is NOT a failure — it's
 *   eventual-consistency lag. We keep polling until the overall deadline
 *   instead of throwing (ActivityNotReadyError, caught internally).
 * - Failed tasks cost zero credits; only Completed tasks are billed.
 * - Bounded polling with a generous timeout (default 30 min) rather than a
 *   tight loop, since Heat Intelligence in particular can take several
 *   minutes.
 */

import {
  FORTYGUARD_API_KEY,
  FORTYGUARD_BASE_URL,
  FORTYGUARD_POLL,
  FORTYGUARD_REQUEST_TIMEOUT_MS,
} from "@/lib/constants";
import {
  ActivityNotReadyError,
  FortyGuardError,
  FortyGuardHttpError,
  FortyGuardUnavailableError,
  TaskFailedError,
  TaskTimeoutError,
} from "./errors";
import type {
  ApiKeyUsageResponse,
  DateTimeFilter,
  EnvParamsAnalysis,
  EnvParamsResult,
  GeoJsonPolygonAoi,
  HeatmapResult,
  StatusEnvelope,
  StatusResponseData,
  SubmitAndWaitResult,
  SubmitEnvelope,
} from "./types";
import { ENV_PARAMS_ANALYSES } from "./types";

const TERMINAL_SUCCESS = new Set(["succeeded", "completed"]);
const TERMINAL_FAILURE = new Set(["failed", "error"]);

const ANALYTIC_TYPES = ["tcm", "time_of_measure", "exceedance", "persistence"] as const;
type AnalyticType = (typeof ANALYTIC_TYPES)[number];

export interface CreateHeatmapArgs {
  polygonAoi: GeoJsonPolygonAoi;
  startDate: string;
  filterType: 1 | 2 | 3 | 4;
  granularity?: number;
  startTime?: string;
  endTime?: string;
  endDate?: string;
  analyticType?: AnalyticType;
  threshold?: number;
  direction?: "above" | "below";
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export interface EnvironmentalParametersArgs {
  latitude: number;
  longitude: number;
  temperature: number;
  startDate: string;
  filterType: 1 | 2 | 3 | 4;
  startTime?: string;
  endTime?: string;
  endDate?: string;
  analysis?: EnvParamsAnalysis[];
  pollIntervalMs?: number;
  timeoutMs?: number;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export class FortyGuardClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly requestTimeoutMs: number;

  constructor(options?: { apiKey?: string; baseUrl?: string; requestTimeoutMs?: number }) {
    const apiKey = options?.apiKey ?? FORTYGUARD_API_KEY;
    if (!apiKey) {
      throw new FortyGuardError(
        "No API key provided. Pass apiKey in the constructor or set FORTYGUARD_API_KEY in .env.local.",
      );
    }
    this.apiKey = apiKey;
    this.baseUrl = (options?.baseUrl ?? FORTYGUARD_BASE_URL).replace(/\/$/, "");
    this.requestTimeoutMs = options?.requestTimeoutMs ?? FORTYGUARD_REQUEST_TIMEOUT_MS;
  }

  private headers(): HeadersInit {
    return { "api-key": this.apiKey, "Content-Type": "application/json" };
  }

  private async request(method: string, path: string, body?: unknown): Promise<Response> {
    let resp: Response;
    try {
      resp = await fetchWithTimeout(
        `${this.baseUrl}${path}`,
        {
          method,
          headers: this.headers(),
          body: body !== undefined ? JSON.stringify(body) : undefined,
        },
        this.requestTimeoutMs,
      );
    } catch (err) {
      // fetch() throws (not a rejected-with-status response) for anything
      // that means the request never completed at all: DNS failure,
      // connection refused/reset, TLS error, or our own AbortController
      // firing on timeout. None of these are FortyGuard telling us
      // something — they're us failing to reach it.
      const message = err instanceof Error ? err.message : String(err);
      throw new FortyGuardUnavailableError(`${method} ${path} -> request failed: ${message}`, { cause: err });
    }
    if (!resp.ok && resp.status !== 404) {
      const text = await resp.text().catch(() => "");
      throw new FortyGuardHttpError(resp.status, `${method} ${path} -> ${resp.status}: ${text.slice(0, 500)}`);
    }
    return resp;
  }

  private async submit(path: string, payload: unknown): Promise<string> {
    const resp = await this.request("POST", path, payload);
    const body = (await resp.json()) as SubmitEnvelope;
    if (body.error) {
      throw new FortyGuardError(body.message ?? "Submission failed");
    }
    const activityId = body.data?.activity_id;
    if (!activityId) {
      throw new FortyGuardError(`Unexpected response shape: ${JSON.stringify(body)}`);
    }
    return activityId;
  }

  /**
   * Raw status-endpoint lookup. Right after submission the status endpoint
   * can briefly 404 while the activity propagates — surfaced as
   * ActivityNotReadyError so callers (waitFor) retry instead of failing.
   */
  async getStatus(activityId: string): Promise<StatusResponseData> {
    const resp = await this.request("GET", `/v1/status/${activityId}`);
    if (resp.status === 404) {
      throw new ActivityNotReadyError(activityId);
    }
    const body = (await resp.json()) as StatusEnvelope;
    if (body.error) {
      throw new FortyGuardError(body.message ?? "Status lookup failed");
    }
    return body.data;
  }

  /** Poll the status endpoint until the task terminates. Returns the
   * `result` payload on success. Throws on failure or timeout. */
  async waitFor<T>(
    activityId: string,
    options?: {
      pollIntervalMs?: number;
      timeoutMs?: number;
      onTick?: (status: string, data: Partial<StatusResponseData>) => void;
    },
  ): Promise<T> {
    const pollIntervalMs = options?.pollIntervalMs ?? FORTYGUARD_POLL.INTERVAL_MS;
    const timeoutMs = options?.timeoutMs ?? FORTYGUARD_POLL.TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      let data: StatusResponseData;
      try {
        data = await this.getStatus(activityId);
      } catch (err) {
        if (err instanceof ActivityNotReadyError) {
          options?.onTick?.("pending", {});
          if (Date.now() >= deadline) {
            throw new TaskTimeoutError(
              `Activity ${activityId} never became visible within ${Math.round(timeoutMs / 1000)}s`,
            );
          }
          await sleep(pollIntervalMs);
          continue;
        }
        throw err;
      }

      const status = String(data.status ?? "").toLowerCase();
      options?.onTick?.(status, data);

      if (TERMINAL_SUCCESS.has(status)) {
        return (data.result ?? data) as T;
      }
      if (TERMINAL_FAILURE.has(status)) {
        throw new TaskFailedError(`Activity ${activityId} failed: ${data.message ?? JSON.stringify(data)}`);
      }
      if (Date.now() >= deadline) {
        throw new TaskTimeoutError(
          `Activity ${activityId} still '${status}' after ${Math.round(timeoutMs / 1000)}s`,
        );
      }
      await sleep(pollIntervalMs);
    }
  }

  private async submitAndWait<T>(
    path: string,
    payload: unknown,
    options?: { pollIntervalMs?: number; timeoutMs?: number },
  ): Promise<SubmitAndWaitResult<T>> {
    const activityId = await this.submit(path, payload);
    const result = await this.waitFor<T>(activityId, options);
    return { activity_id: activityId, result };
  }

  private buildDateTime(args: {
    startDate: string;
    filterType: 1 | 2 | 3 | 4;
    startTime?: string;
    endTime?: string;
    endDate?: string;
  }): DateTimeFilter {
    const dateTime: DateTimeFilter = { start_date: args.startDate, filter_type: args.filterType };
    if (args.startTime !== undefined) dateTime.start_time = args.startTime;
    if (args.endTime !== undefined) dateTime.end_time = args.endTime;
    if (args.endDate !== undefined) dateTime.end_date = args.endDate;
    return dateTime;
  }

  /**
   * POST /v1/heatmap — thermal map over a polygon AOI. `analyticType`
   * defaults to `tcm` (snapshot °C). `exceedance`/`persistence` require
   * `threshold` (°C) and `direction`; both are ignored for `tcm`/
   * `time_of_measure`. See PROJECT_GUIDE.md Section 3 for the response-shape
   * split between tcm and the three analysis types.
   */
  async createHeatmap(args: CreateHeatmapArgs): Promise<SubmitAndWaitResult<HeatmapResult>> {
    const analyticType = args.analyticType ?? "tcm";
    if (!ANALYTIC_TYPES.includes(analyticType)) {
      throw new FortyGuardError(
        `Unknown analyticType ${analyticType}. Valid options: ${ANALYTIC_TYPES.join(", ")}`,
      );
    }
    if (analyticType === "exceedance" || analyticType === "persistence") {
      if (args.threshold === undefined) {
        throw new FortyGuardError(`analyticType=${analyticType} requires a threshold (°C).`);
      }
      if (args.direction !== "above" && args.direction !== "below") {
        throw new FortyGuardError(`analyticType=${analyticType} requires direction 'above' or 'below'.`);
      }
    }

    const payload: Record<string, unknown> = {
      polygon_aoi: args.polygonAoi,
      date_time: this.buildDateTime(args),
      granularity: args.granularity ?? 100,
      analytic_type: analyticType,
    };
    if (args.threshold !== undefined) payload.threshold = args.threshold;
    if (args.direction !== undefined) payload.direction = args.direction;

    return this.submitAndWait<HeatmapResult>("/v1/heatmap", payload, {
      pollIntervalMs: args.pollIntervalMs,
      timeoutMs: args.timeoutMs,
    });
  }

  /**
   * POST /v1/env_params — thermal-comfort, air-quality, and solar-irradiance
   * metrics for a point. `temperature` is a required anchor value — see the
   * env_params gotcha in PROJECT_GUIDE.md Section 3: only
   * relative_humidity_percent genuinely varies hour-to-hour in the response;
   * heat_index/apparent/wet-bulb are derived from the fixed anchor and are
   * NOT physically meaningful hour-by-hour.
   */
  async environmentalParameters(
    args: EnvironmentalParametersArgs,
  ): Promise<SubmitAndWaitResult<EnvParamsResult>> {
    if (args.analysis) {
      const unknown = args.analysis.filter((a) => !ENV_PARAMS_ANALYSES.includes(a));
      if (unknown.length > 0) {
        throw new FortyGuardError(`Unknown env-params analysis: ${unknown.join(", ")}`);
      }
    }
    const payload: Record<string, unknown> = {
      latitude: args.latitude,
      longitude: args.longitude,
      temperature: args.temperature,
      date_time: this.buildDateTime(args),
    };
    if (args.analysis) payload.analysis = args.analysis;

    return this.submitAndWait<EnvParamsResult>("/v1/env_params", payload, {
      pollIntervalMs: args.pollIntervalMs,
      timeoutMs: args.timeoutMs,
    });
  }

  /** POST /v1/system/fetch-api-key-usage — current billing cycle summary. */
  async fetchApiKeyUsage(): Promise<ApiKeyUsageResponse> {
    const resp = await this.request("POST", "/v1/system/fetch-api-key-usage", { api_key: this.apiKey });
    return (await resp.json()) as ApiKeyUsageResponse;
  }

  /** POST /v1/system/fetch-api-key-custom-usage — usage over a custom range. */
  async fetchApiKeyCustomUsage(startDate: string, endDate: string): Promise<ApiKeyUsageResponse> {
    const toIso = (value: string, endOfDay: boolean) =>
      value.includes("T") ? value : `${value}T${endOfDay ? "23:59:59" : "00:00:00"}Z`;
    const resp = await this.request("POST", "/v1/system/fetch-api-key-custom-usage", {
      api_key: this.apiKey,
      start_date: toIso(startDate, false),
      end_date: toIso(endDate, true),
    });
    return (await resp.json()) as ApiKeyUsageResponse;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let sharedClient: FortyGuardClient | undefined;

/** Shared singleton — the usual way to get a client throughout the codebase. */
export function getFortyGuardClient(): FortyGuardClient {
  if (!sharedClient) {
    sharedClient = new FortyGuardClient();
  }
  return sharedClient;
}
