/**
 * Standalone CLI for historical ingestion (FARM/TRANSPORT_ROUTE checkpoints).
 * Core logic lives in lib/ingestion/historicalIngest.ts, shared with the
 * farm-creation pipeline (scripts/run-farm-pipeline.ts).
 *
 *   npx tsx scripts/ingest-historical.ts <checkpointId>
 *   npx tsx scripts/ingest-historical.ts --farm <farmId>   # both farm+transport checkpoints
 */
import "./_env";
import { prisma } from "@/lib/db";
import { getFortyGuardClient } from "@/lib/fortyguard/client";
import { ingestHistoricalCheckpoint } from "@/lib/ingestion/historicalIngest";

async function main() {
  const args = process.argv.slice(2);
  const client = getFortyGuardClient();
  let checkpointIds: string[];

  if (args[0] === "--farm") {
    const farmId = args[1];
    if (!farmId) throw new Error("Usage: ingest-historical.ts --farm <farmId>");
    const checkpoints = await prisma.checkpoint.findMany({
      where: { farmId, type: { in: ["FARM", "TRANSPORT_ROUTE"] } },
    });
    checkpointIds = checkpoints.map((c) => c.id);
  } else if (args[0]) {
    checkpointIds = [args[0]];
  } else {
    throw new Error("Usage: ingest-historical.ts <checkpointId> | --farm <farmId>");
  }

  for (const id of checkpointIds) {
    await ingestHistoricalCheckpoint(client, id, console.log);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
