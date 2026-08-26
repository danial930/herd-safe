/**
 * DIAGNOSTIC, NOT FEATURE WORK. Manual-run cost-measurement harness — not
 * part of the app pipeline, not called by anything else. Runs exactly the
 * 10 calls requested to isolate which parameters (filter_type, date range,
 * analytic_type, granularity, AOI size) actually affect FortyGuard credit
 * cost, and to distinguish a real cost/coverage problem from a possible
 * upstream service issue (there were Slack reports of FortyGuard service
 * trouble, and our earlier "fetch failed" error was never root-caused since
 * the pipeline was discarding its own output at the time).
 *
 * Every call: check usage before AND after (not aggregated), log the full
 * response/error body (truncated in the console table, saved in full to
 * scratch JSON), and evaluate for anomalies (errors, degraded/empty
 * responses, wildly-off cost). On the first anomaly, STOP — don't run the
 * remaining calls — and report what happened.
 *
 * Goes through lib/fortyguard/client.ts like everything else (Section 7,
 * rule 2) — this bypasses the Postgres cache layer entirely (calls the
 * client directly, not through lib/ingestion/climatePull.ts), which is
 * deliberate: we want every call in this harness to actually hit the live
 * API, not resolve from cache.
 *
 *   npx tsx scripts/measure-api-costs.ts
 */
import "./_env";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { getFortyGuardClient } from "@/lib/fortyguard/client";
import { buildPointBufferPolygon } from "@/lib/fortyguard/geo";
import type { HeatmapResult, EnvParamsResult } from "@/lib/fortyguard/types";

// A location with a long track record of reliably returning real tile data
// in this build (Central Valley's own pasture point — 288 successful live
// heatmap calls against it already this session), so a bad result here is
// much more likely to mean something changed upstream than "wrong buffer
// for this particular point" (which we've hit before at other coordinates).
const LAT = 37.43;
const LON = -120.78;
const BASE_HALF_SIZE_M = 500;
const FIVE_X_AREA_HALF_SIZE_M = Math.round(BASE_HALF_SIZE_M * Math.sqrt(5)); // area scales with side^2

// A date/hour not used by any prior real ingestion in this project, so
// there's no ambiguity about whether a result reflects a fresh call.
const DATE = "2022-06-15";
const HOUR = "15:00";

const DIAGNOSTIC_TIMEOUT_MS = 3 * 60 * 1000; // fail fast rather than wait the full 30min default

interface UsageSnapshot {
  creditsUsed: number;
  remaining: number;
}

interface StepResult {
  step: number;
  description: string;
  params: Record<string, unknown>;
  creditsBefore: number;
  creditsAfter: number;
  delta: number;
  status: "ok" | "error" | "anomaly";
  note: string;
  responseSummary: string;
}

const client = getFortyGuardClient();

async function getUsage(): Promise<UsageSnapshot> {
  const usage = await client.fetchApiKeyUsage();
  const summary = (usage as { credit_summary?: { cycle_credits_used?: number; total_remaining_credits?: number } })
    .credit_summary;
  if (!summary || typeof summary.cycle_credits_used !== "number") {
    throw new Error(`Unexpected usage response shape: ${JSON.stringify(usage)}`);
  }
  return { creditsUsed: summary.cycle_credits_used, remaining: summary.total_remaining_credits ?? NaN };
}

function summarizeHeatmap(result: HeatmapResult): { note: string; anomaly: boolean; summary: string } {
  const mapData = (result as unknown as { map_data?: { features?: Array<{ properties: Record<string, unknown> }> } }).map_data;
  const features = mapData?.features ?? [];
  const statsData = (result as { stats_data?: unknown }).stats_data;
  const summary = `features=${features.length}, stats_data=${JSON.stringify(statsData).slice(0, 300)}`;
  if (features.length === 0) {
    return { note: "ZERO TILES returned — possible coverage/service issue", anomaly: true, summary };
  }
  return { note: "ok", anomaly: false, summary };
}

function summarizeEnvParams(result: EnvParamsResult): { note: string; anomaly: boolean; summary: string } {
  const location = result.locations?.[0];
  const paramKeys = location ? Object.keys(location.parameters ?? {}) : [];
  const summary = `locations=${result.locations?.length ?? 0}, paramKeys=${paramKeys.join(",")}`;
  if (!location || paramKeys.length === 0) {
    return { note: "Missing locations/parameters — possible service issue", anomaly: true, summary };
  }
  return { note: "ok", anomaly: false, summary };
}

const results: StepResult[] = [];
const rawResponses: Record<string, unknown> = {};

async function runStep(
  step: number,
  description: string,
  params: Record<string, unknown>,
  fn: () => Promise<{ note: string; anomaly: boolean; summary: string; raw: unknown }>,
): Promise<boolean> {
  console.log(`\n=== Step ${step}: ${description} ===`);
  console.log("Params:", JSON.stringify(params));

  const before = await getUsage();
  console.log(`Credits before: used=${before.creditsUsed}, remaining=${before.remaining}`);

  let status: StepResult["status"] = "ok";
  let note: string;
  let summary: string;
  let raw: unknown;

  try {
    const outcome = await fn();
    note = outcome.note;
    summary = outcome.summary;
    raw = outcome.raw;
    if (outcome.anomaly) status = "anomaly";
  } catch (err) {
    status = "error";
    note = err instanceof Error ? `${err.name}: ${err.message}${err.cause ? ` (cause: ${JSON.stringify(err.cause)})` : ""}` : String(err);
    summary = "(threw before returning a response)";
    raw = { error: note, stack: err instanceof Error ? err.stack : undefined };
    console.log("ERROR:", note);
  }

  const after = await getUsage();
  console.log(`Credits after:  used=${after.creditsUsed}, remaining=${after.remaining}`);
  const delta = after.creditsUsed - before.creditsUsed;
  console.log(`Delta: ${delta} credits`);
  console.log(`Result: ${status} — ${note}`);
  console.log(`Summary: ${summary}`);

  results.push({ step, description, params, creditsBefore: before.creditsUsed, creditsAfter: after.creditsUsed, delta, status, note, responseSummary: summary });
  rawResponses[`step${step}`] = raw;

  if (status !== "ok") {
    console.log(`\n!!! STOPPING — step ${step} was not a clean success. Not running remaining steps. !!!`);
    return false;
  }
  return true;
}

async function main() {
  const basePolygon = buildPointBufferPolygon(LAT, LON, BASE_HALF_SIZE_M);
  const largePolygon = buildPointBufferPolygon(LAT, LON, FIVE_X_AREA_HALF_SIZE_M);

  const heatmapSteps: Array<{ description: string; params: Record<string, unknown>; call: () => Promise<HeatmapResult> }> = [
    {
      description: "tcm, filter_type=1 (single hour), granularity=60 — BASELINE",
      params: { analytic_type: "tcm", filter_type: 1, granularity: 60, start_date: DATE, start_time: HOUR },
      call: async () =>
        (await client.createHeatmap({ polygonAoi: basePolygon, startDate: DATE, startTime: HOUR, filterType: 1, granularity: 60, analyticType: "tcm", timeoutMs: DIAGNOSTIC_TIMEOUT_MS })).result,
    },
    {
      description: "tcm, filter_type=3 (single day), granularity=60 — isolates date RANGE",
      params: { analytic_type: "tcm", filter_type: 3, granularity: 60, start_date: DATE },
      call: async () =>
        (await client.createHeatmap({ polygonAoi: basePolygon, startDate: DATE, filterType: 3, granularity: 60, analyticType: "tcm", timeoutMs: DIAGNOSTIC_TIMEOUT_MS })).result,
    },
    {
      description: "tcm, filter_type=4 (3-day range), granularity=60 — isolates wider range",
      params: { analytic_type: "tcm", filter_type: 4, granularity: 60, start_date: DATE, end_date: "2022-06-17" },
      call: async () =>
        (await client.createHeatmap({ polygonAoi: basePolygon, startDate: DATE, endDate: "2022-06-17", filterType: 4, granularity: 60, analyticType: "tcm", timeoutMs: DIAGNOSTIC_TIMEOUT_MS })).result,
    },
    {
      description: "time_of_measure, filter_type=1, granularity=60 — isolates analytic_type",
      params: { analytic_type: "time_of_measure", filter_type: 1, granularity: 60, start_date: DATE, start_time: HOUR },
      call: async () =>
        (await client.createHeatmap({ polygonAoi: basePolygon, startDate: DATE, startTime: HOUR, filterType: 1, granularity: 60, analyticType: "time_of_measure", timeoutMs: DIAGNOSTIC_TIMEOUT_MS })).result,
    },
    {
      description: "exceedance, filter_type=1, granularity=60, threshold=30/above",
      params: { analytic_type: "exceedance", filter_type: 1, granularity: 60, start_date: DATE, start_time: HOUR, threshold: 30, direction: "above" },
      call: async () =>
        (await client.createHeatmap({ polygonAoi: basePolygon, startDate: DATE, startTime: HOUR, filterType: 1, granularity: 60, analyticType: "exceedance", threshold: 30, direction: "above", timeoutMs: DIAGNOSTIC_TIMEOUT_MS })).result,
    },
    {
      description: "persistence, filter_type=1, granularity=60, threshold=30/above",
      params: { analytic_type: "persistence", filter_type: 1, granularity: 60, start_date: DATE, start_time: HOUR, threshold: 30, direction: "above" },
      call: async () =>
        (await client.createHeatmap({ polygonAoi: basePolygon, startDate: DATE, startTime: HOUR, filterType: 1, granularity: 60, analyticType: "persistence", threshold: 30, direction: "above", timeoutMs: DIAGNOSTIC_TIMEOUT_MS })).result,
    },
    {
      description: "tcm, filter_type=1, granularity=100 — isolates granularity",
      params: { analytic_type: "tcm", filter_type: 1, granularity: 100, start_date: DATE, start_time: HOUR },
      call: async () =>
        (await client.createHeatmap({ polygonAoi: basePolygon, startDate: DATE, startTime: HOUR, filterType: 1, granularity: 100, analyticType: "tcm", timeoutMs: DIAGNOSTIC_TIMEOUT_MS })).result,
    },
    {
      description: `tcm, filter_type=1, granularity=60, ~5x AOI area (half-size ${FIVE_X_AREA_HALF_SIZE_M}m vs ${BASE_HALF_SIZE_M}m) — isolates AOI size`,
      params: { analytic_type: "tcm", filter_type: 1, granularity: 60, start_date: DATE, start_time: HOUR, aoi_half_size_m: FIVE_X_AREA_HALF_SIZE_M },
      call: async () =>
        (await client.createHeatmap({ polygonAoi: largePolygon, startDate: DATE, startTime: HOUR, filterType: 1, granularity: 60, analyticType: "tcm", timeoutMs: DIAGNOSTIC_TIMEOUT_MS })).result,
    },
  ];

  for (let i = 0; i < heatmapSteps.length; i++) {
    const s = heatmapSteps[i];
    const ok = await runStep(i + 1, s.description, s.params, async () => {
      const result = await s.call();
      const { note, anomaly, summary } = summarizeHeatmap(result);
      return { note, anomaly, summary, raw: result };
    });
    if (!ok) {
      writeReport();
      return;
    }
  }

  const envSteps: Array<{ description: string; params: Record<string, unknown>; call: () => Promise<EnvParamsResult> }> = [
    {
      description: "env_params, filter_type=1 (single hour) — BASELINE",
      params: { filter_type: 1, start_date: DATE, start_time: HOUR, latitude: LAT, longitude: LON },
      call: async () =>
        (await client.environmentalParameters({ latitude: LAT, longitude: LON, temperature: 25, startDate: DATE, startTime: HOUR, filterType: 1, timeoutMs: DIAGNOSTIC_TIMEOUT_MS })).result,
    },
    {
      description: "env_params, filter_type=3 (single day) — isolates date RANGE",
      params: { filter_type: 3, start_date: DATE, latitude: LAT, longitude: LON },
      call: async () =>
        (await client.environmentalParameters({ latitude: LAT, longitude: LON, temperature: 25, startDate: DATE, filterType: 3, timeoutMs: DIAGNOSTIC_TIMEOUT_MS })).result,
    },
  ];

  for (let i = 0; i < envSteps.length; i++) {
    const s = envSteps[i];
    const ok = await runStep(heatmapSteps.length + i + 1, s.description, s.params, async () => {
      const result = await s.call();
      const { note, anomaly, summary } = summarizeEnvParams(result);
      return { note, anomaly, summary, raw: result };
    });
    if (!ok) {
      writeReport();
      return;
    }
  }

  writeReport();
}

function writeReport() {
  console.log("\n\n=== SUMMARY TABLE ===");
  console.log(
    results
      .map(
        (r) =>
          `${r.step}. ${r.description}\n   credits: ${r.creditsBefore} -> ${r.creditsAfter} (delta ${r.delta}) | status: ${r.status} | ${r.note}`,
      )
      .join("\n"),
  );

  const outDir = "/tmp/claude-1000/-home-danny-Programming-HerdSafe/e0192abe-1512-45c9-964e-7b39514c4316/scratchpad";
  writeFileSync(path.join(outDir, "cost-measurement-results.json"), JSON.stringify(results, null, 2));
  writeFileSync(path.join(outDir, "cost-measurement-raw-responses.json"), JSON.stringify(rawResponses, null, 2));
  console.log(`\nFull results: ${outDir}/cost-measurement-results.json`);
  console.log(`Full raw responses: ${outDir}/cost-measurement-raw-responses.json`);
}

main().catch((err) => {
  console.error("Harness crashed:", err);
  writeReport();
  process.exit(1);
});
