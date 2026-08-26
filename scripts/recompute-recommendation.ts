/**
 * Recomputes a FARM/TRANSPORT_ROUTE checkpoint's schedule recommendation
 * from whatever historical years are already fully cached — WITHOUT calling
 * FortyGuard at all. For a checkpoint whose historical pull was interrupted
 * (crash, transient network failure) and deliberately not resumed (e.g. to
 * control credit spend), this treats the largest complete, coherent set of
 * already-cached years as the checkpoint's official backtest scope, rather
 * than leaving a stale/incomplete recommendation in place.
 *
 * A year only counts if every day in HISTORICAL_SAMPLE_WEEK has all 24
 * hours present in ComputedRisk — see lib/ingestion/completeHistoricalYears.ts.
 *
 *   npx tsx scripts/recompute-recommendation.ts <checkpointId>
 */
import "./_env";
import { prisma } from "@/lib/db";
import { getCompleteHistoricalYears, getHourlyThiPointsForYears } from "@/lib/ingestion/completeHistoricalYears";
import { computeAndStoreScheduleRecommendation } from "@/lib/ingestion/computeAndStoreRecommendation";

async function main() {
  const checkpointId = process.argv[2];
  if (!checkpointId) throw new Error("Usage: recompute-recommendation.ts <checkpointId>");

  const checkpoint = await prisma.checkpoint.findUniqueOrThrow({ where: { id: checkpointId } });
  if (checkpoint.type === "STORAGE") {
    throw new Error("recompute-recommendation.ts is for FARM/TRANSPORT_ROUTE checkpoints — STORAGE has no recommendation");
  }

  const completeYears = await getCompleteHistoricalYears(checkpointId);
  console.log(`[${checkpoint.name}] complete cached years: ${completeYears.length > 0 ? completeYears.join(", ") : "none"}`);

  if (completeYears.length === 0) {
    throw new Error(
      `[${checkpoint.name}] no fully-complete historical year cached yet — nothing to compute a recommendation from.`,
    );
  }

  const perYearSeries = await getHourlyThiPointsForYears(checkpointId, completeYears);
  await computeAndStoreScheduleRecommendation(checkpoint, perYearSeries, (msg) => console.log(`[${checkpoint.name}] ${msg}`));

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
