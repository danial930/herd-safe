/**
 * The single ingestion pipeline run for every Add/Edit Farm submission and
 * Retry (PROJECT_GUIDE.md Section 4, screen 2 & 3). Drives Farm.status/
 * statusStage through the staged messages the Processing screen polls, then
 * computes the ChainSummary.
 *
 * Runs IN-PROCESS, invoked via Next.js's `after()` (stable since 15.1.0)
 * from the API routes (app/api/farms/route.ts, app/api/farms/[id]/route.ts,
 * app/api/farms/[id]/retry/route.ts) — NOT spawned as a detached child
 * process. That's how this used to work
 * (lib/ingestion/spawnPipeline.ts, removed) — fine for local dev's
 * long-running `next dev`/`next start` server, but fundamentally
 * incompatible with Vercel's serverless runtime: no persistent process to
 * detach into, and a read-only filesystem outside /tmp. Confirmed live in
 * production: the old spawn's log-file write threw
 * `ENOENT: /var/task/logs/pipeline-<farmId>.log` on every farm creation.
 * `after()` keeps everything in the same function invocation instead (Next
 * wires it to Vercel's `waitUntil` automatically there) — console.log goes
 * straight to Vercel's function logs, no separate log file needed. Each
 * calling route's own `maxDuration` export governs how long this is allowed
 * to run; if it's exceeded, the farm is left in "processing" and the user
 * can hit Retry.
 *
 * Also callable directly from the CLI (scripts/run-farm-pipeline.ts) for
 * local manual runs/debugging.
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
 * REACTIVE_FORECAST_HOURS=1 — see lib/constants.ts). That capability isn't
 * gone, just not automatic: run
 * `ALLOW_HISTORICAL_INGESTION=true npx tsx scripts/ingest-historical.ts <checkpointId>`
 * manually against a specific checkpoint when you're ready to spend the
 * credits on it.
 */
import { prisma } from "@/lib/db";
import { getFortyGuardClient } from "@/lib/fortyguard/client";
import { categorizeError } from "@/lib/fortyguard/errors";
import { ingestCurrentCheckpoint } from "@/lib/ingestion/currentIngest";
import { computeAndStoreChainSummary } from "@/lib/impact/computeChainSummary";

async function setStage(farmId: string, statusStage: string) {
  console.log(`[farm ${farmId}] ${statusStage}`);
  await prisma.farm.update({ where: { id: farmId }, data: { statusStage } });
}

export async function runFarmPipeline(farmId: string): Promise<void> {
  try {
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

    await prisma.farm.update({
      where: { id: farmId },
      data: { status: "ready", statusStage: null, statusError: null, statusErrorCategory: null },
    });
    console.log(`[farm ${farmId}] ready`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const category = categorizeError(err);
    console.error(`[farm ${farmId}] FAILED (${category}):`, err);
    // Node's fetch (undici) attaches the real underlying cause (DNS
    // failure, connection reset, timeout, etc.) to generic errors like
    // "fetch failed" via `.cause` — log it explicitly rather than relying
    // on console.error's default formatting to surface it. The category is
    // the source of truth for what the user sees (ProcessingView.tsx); this
    // raw message+cause is for Vercel's function logs / the local terminal.
    if (err instanceof Error && err.cause) {
      console.error(`[farm ${farmId}] cause:`, err.cause);
    }
    await prisma.farm.update({
      where: { id: farmId },
      data: { status: "failed", statusError: message, statusErrorCategory: category },
    });
    // Deliberately not re-thrown: this runs inside after(), after the
    // response has already been sent — there's no request left to receive
    // a thrown error. The Farm.status update above IS the error surface
    // (ProcessingView.tsx polls it); this just avoids an unhandled
    // rejection showing up in the function logs on top of the console.error
    // already above.
  }
}
