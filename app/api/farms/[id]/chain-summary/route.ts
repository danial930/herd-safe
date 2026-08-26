import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/** GET /api/farms/:id/chain-summary — Dashboard header stat card
 * (PROJECT_GUIDE.md Section 4, screen 4). Read-only against Postgres — the
 * ChainSummary row is precomputed by the ingestion pipeline
 * (lib/impact/computeChainSummary.ts), never live here. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const farm = await prisma.farm.findUnique({ where: { id }, include: { chainSummary: true } });
  if (!farm) {
    return NextResponse.json({ error: "Farm not found" }, { status: 404 });
  }
  return NextResponse.json({ chainSummary: farm.chainSummary });
}
