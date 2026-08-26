import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCheckpointSummaries } from "@/lib/farms/getCheckpointSummaries";

/** GET /api/farms/:id/checkpoints — the Dashboard's three connected
 * checkpoint cards (PROJECT_GUIDE.md Section 4, screen 4). Each card needs
 * current status, risk value, worker-comfort badge, and (farm/transport
 * only) the recommended schedule shift — so this bundles a compact summary
 * per checkpoint rather than making the Dashboard fan out to N detail calls.
 * Read-only against Postgres. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const farm = await prisma.farm.findUnique({ where: { id }, select: { id: true } });
  if (!farm) {
    return NextResponse.json({ error: "Farm not found" }, { status: 404 });
  }

  const checkpoints = await getCheckpointSummaries(id);
  return NextResponse.json({ checkpoints });
}
