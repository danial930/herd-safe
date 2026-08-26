/**
 * CLI wrapper for local manual runs/debugging — the actual pipeline logic
 * (and what the app calls in production, via Next.js's after()) lives in
 * lib/ingestion/runFarmPipeline.ts. See that file's header comment for why
 * this used to spawn a subprocess and no longer does.
 *
 *   npx tsx scripts/run-farm-pipeline.ts <farmId>
 */
import "./_env";
import { prisma } from "@/lib/db";
import { runFarmPipeline } from "@/lib/ingestion/runFarmPipeline";

async function main() {
  const farmId = process.argv[2];
  if (!farmId) throw new Error("Usage: run-farm-pipeline.ts <farmId>");

  await runFarmPipeline(farmId);

  const farm = await prisma.farm.findUniqueOrThrow({ where: { id: farmId } });
  if (farm.status === "failed") process.exitCode = 1;

  await prisma.$disconnect();
}

main();
