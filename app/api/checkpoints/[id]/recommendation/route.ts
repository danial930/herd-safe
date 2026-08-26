import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * GET /api/checkpoints/:id/recommendation — the recommended schedule shift +
 * multi-year backtest for the Checkpoint Detail screen (PROJECT_GUIDE.md
 * Section 4, screen 5). STORAGE checkpoints have none by design (spoilage
 * risk is reactive-only, no optimizer/backtest — Section 8) and return null.
 * Read-only against Postgres.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const checkpoint = await prisma.checkpoint.findUnique({ where: { id } });
  if (!checkpoint) {
    return NextResponse.json({ error: "Checkpoint not found" }, { status: 404 });
  }
  if (checkpoint.type === "STORAGE") {
    return NextResponse.json({ recommendation: null });
  }

  const recommendation = await prisma.scheduleRecommendation.findFirst({
    where: { checkpointId: id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ recommendation });
}
