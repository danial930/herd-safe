/**
 * The single ingestion pipeline the "Add Farm" API route spawns as a
 * background process (PROJECT_GUIDE.md Section 4, screen 2 & screen 3).
 * Drives Farm.status/statusStage through the real staged messages the
 * Processing screen polls and displays, then computes the ChainSummary.
 *
 * DEFAULT CHANGED after a credit-budget review, then re-confirmed by a
 * direct measurement harness (scripts/measure-api-costs.ts): a live `tcm`
 * heatmap call costs a flat ~4,220 credits regardless of parameters, and
 * pullRealHourlyClimateForTimestamps/pullRealHourlyClimateForDay fetch ONE
 * such call per hour requested, not one call per range. A 3-year sample-week
 * historical pull is ~2.1M credits per checkpoint — more than the entire
 * hackathon key's budget on its own — so multi-year historical backtesting
 * is unsustainable as a live default and is now fully gated behind an
 * explicit env var, unreachable from this pipeline (see
 * lib/ingestion/historicalIngest.ts). Every checkpoint on a NEW farm instead
 * gets reactive current-conditions-only ingestion (`ingestCurrentCheckpoint`,
 * REACTIVE_FORECAST_HOURS=1 — see lib/constants.ts), at ~7,120 credits per
 * checkpoint (one ~4,220-credit heatmap call + one ~2,900-credit env_params
 * call) — about 21,360 credits per 3-checkpoint farm. No optimizer, no
 * backtest, no ScheduleRecommendation for FARM/TRANSPORT_ROUTE. That
 * capability isn't gone, just not automatic: run
 * `ALLOW_HISTORICAL_INGESTION=true npx tsx scripts/ingest-historical.ts <checkpointId>`
 * manually against a specific checkpoint when you're ready to spend the
 * credits on it, then `scripts/recompute-recommendation.ts <checkpointId>`
 * if a partial pull needs to be reconciled into a recommendation without
 * pulling more.
 *
 *   npx tsx scripts/run-farm-pipeline.ts <farmId>
 */
import "./_env";
import { prisma } from "@/lib/db";
import { getFortyGuardClient } from "@/lib/fortyguard/client";
import { categorizeError } from "@/lib/fortyguard/errors";
import { ingestCurrentCheckpoint } from "@/lib/ingestion/currentIngest";
import { computeAndStoreChainSummary } from "@/lib/impact/computeChainSummary";

async function setStage(farmId: string, statusStage: string) {
  console.log(`[farm ${farmId}] ${statusStage}`);
  await prisma.farm.update({ where: { id: farmId }, data: { statusStage } });
}

async function runPipeline(farmId: string) {
  const client = getFortyGuardClient();
  const checkpoints = await prisma.checkpoint.findMany({ where: { farmId } });
  const farmCheckpoint = checkpoints.find((c) => c.type === "FARM");
  const transportCheckpoint = checkpoints.find((c) => c.type === "TRANSPORT_ROUTE");
  const storageCheckpoint = checkpoints.find((c) => c.type === "STORAGE");

  if (farmCheckpoint) {
    await setStage(farmId, "Pulling current pasture conditions…");
    await ingestCurrentCheckpoint(client, farmCheckpoint.id, console.log);
  }

  if (transportCheckpoint) {
    await setStage(farmId, "Pulling current transport-route conditions…");
    await ingestCurrentCheckpoint(client, transportCheckpoint.id, console.log);
  }

  if (storageCheckpoint) {
    await setStage(farmId, "Pulling current storage conditions…");
    await ingestCurrentCheckpoint(client, storageCheckpoint.id, console.log);
  }

  await setStage(farmId, "Finalizing recommendations…");
  await computeAndStoreChainSummary(farmId);

  await prisma.farm.update({ where: { id: farmId }, data: { status: "ready", statusStage: null, statusError: null } });
  console.log(`[farm ${farmId}] ready`);
}

async function main() {
  const farmId = process.argv[2];
  if (!farmId) throw new Error("Usage: run-farm-pipeline.ts <farmId>");

  try {
    await runPipeline(farmId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const category = categorizeError(err);
    console.error(`[farm ${farmId}] FAILED (${category}):`, err);
    // Node's fetch (undici) attaches the real underlying cause (DNS
    // failure, connection reset, timeout, etc.) to generic errors like
    // "fetch failed" via `.cause` — log it explicitly rather than relying
    // on console.error's default formatting to surface it. The category is
    // the source of truth for what the user sees (ProcessingView.tsx); this
    // raw message+cause is for the pipeline log only (logs/pipeline-<farmId>.log).
    if (err instanceof Error && err.cause) {
      console.error(`[farm ${farmId}] cause:`, err.cause);
    }
    await prisma.farm.update({
      where: { id: farmId },
      data: { status: "failed", statusError: message, statusErrorCategory: category },
    });
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
