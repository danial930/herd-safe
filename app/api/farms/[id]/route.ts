import { after, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildCheckpointsData, validateFarmFormInput } from "@/lib/farms/createFarm";
import { runFarmPipeline } from "@/lib/ingestion/runFarmPipeline";

// See app/api/farms/route.ts for why this is set and why the pipeline runs
// via after() rather than a spawned background process.
export const maxDuration = 300;

/** GET /api/farms/:id — Dashboard header + Edit Farm prefill. Read-only
 * against Postgres. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const farm = await prisma.farm.findUnique({ where: { id }, include: { checkpoints: true } });
  if (!farm) {
    return NextResponse.json({ error: "Farm not found" }, { status: 404 });
  }
  return NextResponse.json({ farm });
}

/**
 * PUT /api/farms/:id — Edit Farm submit (PROJECT_GUIDE.md Section 4, screen
 * 6). Replaces the 3 checkpoints' parameters and re-triggers the same
 * ingestion pipeline; the cache-first design (Section 7, rule 4) means
 * checkpoints whose lat/lon/schedule didn't change resolve from cache
 * instantly, while changed ones pull fresh data — no separate "diff what
 * changed" logic needed here.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const existing = await prisma.farm.findUnique({ where: { id }, include: { checkpoints: true } });
  if (!existing) {
    return NextResponse.json({ error: "Farm not found" }, { status: 404 });
  }
  if (existing.isDemoSeed) {
    return NextResponse.json({ error: "The permanent demo farm can't be edited" }, { status: 403 });
  }

  let input;
  try {
    input = validateFarmFormInput(await request.json());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid request body" }, { status: 400 });
  }

  const newCheckpoints = buildCheckpointsData(input);
  const byType = new Map(newCheckpoints.map((c) => [c.type, c]));

  await prisma.$transaction([
    prisma.farm.update({
      where: { id },
      data: {
        name: input.name,
        status: "processing",
        statusError: null,
        statusErrorCategory: null,
        herdSize: input.herdSize ?? null,
      },
    }),
    ...existing.checkpoints.map((checkpoint) => {
      const data = byType.get(checkpoint.type);
      if (!data) return prisma.checkpoint.update({ where: { id: checkpoint.id }, data: {} });
      return prisma.checkpoint.update({ where: { id: checkpoint.id }, data });
    }),
  ]);

  after(() => runFarmPipeline(id));

  const farm = await prisma.farm.findUnique({ where: { id }, include: { checkpoints: true } });
  return NextResponse.json({ farm });
}

/**
 * DELETE /api/farms/:id — "Delete" from the user's point of view, but it's a
 * soft-delete: sets `hidden`, which excludes the farm from the Farm List
 * and its own GET, but never touches the underlying Farm/Checkpoint/
 * ComputedRisk/cache rows. The permanent demo farm can never be hidden —
 * same reasoning as it never being editable (PROJECT_GUIDE.md Section 4:
 * it must always be instantly visible as the live-demo fallback).
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const existing = await prisma.farm.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Farm not found" }, { status: 404 });
  }
  if (existing.isDemoSeed) {
    return NextResponse.json({ error: "The permanent demo farm can't be removed" }, { status: 403 });
  }

  await prisma.farm.update({ where: { id }, data: { hidden: true } });
  return NextResponse.json({ ok: true });
}
