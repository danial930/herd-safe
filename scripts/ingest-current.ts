/**
 * Standalone CLI for current + 12h-forecast ingestion (STORAGE checkpoints).
 * Core logic lives in lib/ingestion/currentIngest.ts, shared with the
 * farm-creation pipeline (scripts/run-farm-pipeline.ts).
 *
 *   npx tsx scripts/ingest-current.ts <checkpointId>
 *   npx tsx scripts/ingest-current.ts --farm <farmId>
 */
import "./_env";
import { prisma } from "@/lib/db";
import { getFortyGuardClient } from "@/lib/fortyguard/client";
import { ingestCurrentCheckpoint } from "@/lib/ingestion/currentIngest";

async function main() {
  const args = process.argv.slice(2);
  const client = getFortyGuardClient();
  let checkpointIds: string[];

  if (args[0] === "--farm") {
    const farmId = args[1];
    if (!farmId) throw new Error("Usage: ingest-current.ts --farm <farmId>");
    const checkpoints = await prisma.checkpoint.findMany({ where: { farmId, type: "STORAGE" } });
    checkpointIds = checkpoints.map((c) => c.id);
  } else if (args[0]) {
    checkpointIds = [args[0]];
  } else {
    throw new Error("Usage: ingest-current.ts <checkpointId> | --farm <farmId>");
  }

  for (const id of checkpointIds) {
    await ingestCurrentCheckpoint(client, id, console.log);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
