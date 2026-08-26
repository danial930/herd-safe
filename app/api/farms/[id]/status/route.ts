import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/** GET /api/farms/:id/status — polled by the Processing screen (PROJECT_GUIDE.md
 * Section 4, screen 3). Read-only against Postgres. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const farm = await prisma.farm.findUnique({
    where: { id },
    select: { id: true, status: true, statusStage: true, statusError: true, statusErrorCategory: true },
  });
  if (!farm) {
    return NextResponse.json({ error: "Farm not found" }, { status: 404 });
  }
  return NextResponse.json({ farm });
}
