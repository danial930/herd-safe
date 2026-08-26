import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { spawnFarmPipeline } from "@/lib/ingestion/spawnPipeline";

/**
 * POST /api/farms/:id/retry — the Processing screen's "Retry" action
 * (ProcessingView.tsx), offered only for failures categorized "network" or
 * "api" (see lib/fortyguard/errors.ts categorizeError) since those are the
 * ones plausibly transient. Re-runs the exact same pipeline the Add-Farm
 * flow already runs — checkpoints/params are untouched, so this simply
 * re-attempts the same reactive pull (cache-first, so any hour that
 * actually succeeded last time resolves instantly, not re-billed).
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const existing = await prisma.farm.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Farm not found" }, { status: 404 });
  }
  if (existing.isDemoSeed) {
    return NextResponse.json({ error: "The permanent demo farm can't be retried" }, { status: 403 });
  }

  await prisma.farm.update({
    where: { id },
    data: { status: "processing", statusStage: null, statusError: null, statusErrorCategory: null },
  });
  spawnFarmPipeline(id);

  return NextResponse.json({ ok: true });
}
