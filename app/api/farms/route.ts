import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildCheckpointsData, validateFarmFormInput } from "@/lib/farms/createFarm";
import { spawnFarmPipeline } from "@/lib/ingestion/spawnPipeline";

/** GET /api/farms — Farm List screen (PROJECT_GUIDE.md Section 4, screen 1).
 * Read-only against Postgres (Section 7, rule 1). */
export async function GET() {
  const farms = await prisma.farm.findMany({
    where: { hidden: false },
    orderBy: [{ isDemoSeed: "desc" }, { createdAt: "desc" }],
    include: { chainSummary: true, checkpoints: { select: { id: true, type: true } } },
  });
  return NextResponse.json({ farms });
}

/** POST /api/farms — Add Farm form submit. Creates the Farm + 3 Checkpoints,
 * spawns the ingestion pipeline as a background process, and returns
 * immediately with status "processing" (Section 4, screen 2). */
export async function POST(request: Request) {
  let input;
  try {
    input = validateFarmFormInput(await request.json());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid request body" }, { status: 400 });
  }

  const farm = await prisma.farm.create({
    data: {
      name: input.name,
      status: "processing",
      herdSize: input.herdSize ?? null,
      checkpoints: { create: buildCheckpointsData(input) },
    },
    include: { checkpoints: true },
  });

  spawnFarmPipeline(farm.id);

  return NextResponse.json({ farm }, { status: 201 });
}
