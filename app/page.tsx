import Link from "next/link";
import { Plus, ShieldCheck } from "lucide-react";
import { prisma } from "@/lib/db";
import { FarmCard, type FarmCardData } from "@/components/FarmCard";

/**
 * Farm List (landing screen) — PROJECT_GUIDE.md Section 4, screen 1. Shows
 * the list even with only one farm, so multi-farm support reads as real, not
 * an unverified claim. Server Component reading Postgres directly (no live
 * FortyGuard call — Section 7, rule 1).
 *
 * `dynamic = "force-dynamic"` is required here, not optional: this route has
 * no dynamic segment, so Next.js's build otherwise statically prerenders it
 * once at BUILD TIME and serves that frozen snapshot to every visitor —
 * confirmed by a real `next build` (showed up as "○ Static" in the route
 * table), invisible in `next dev`, which doesn't apply the same
 * optimization. Without this, farms created after a deploy would never
 * appear on the homepage until the next redeploy.
 */
export const dynamic = "force-dynamic";

export default async function FarmListPage() {
  const farms = await prisma.farm.findMany({
    where: { hidden: false },
    orderBy: [{ isDemoSeed: "desc" }, { createdAt: "desc" }],
    include: { chainSummary: true, checkpoints: { select: { id: true } } },
  });

  const cards: FarmCardData[] = farms.map((farm) => ({
    id: farm.id,
    name: farm.name,
    status: farm.status,
    isDemoSeed: farm.isDemoSeed,
    checkpointCount: farm.checkpoints.length,
    totalDollarImpact: farm.chainSummary?.totalDollarImpact ?? null,
    conflictDetected: farm.chainSummary?.conflictDetected ?? false,
  }));

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-text-primary">Farms</h1>
          <p className="mt-1 text-sm text-text-secondary">Heat risk across every pasture, route, and storage checkpoint you track.</p>
        </div>
        <Link
          href="/farms/new"
          className="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2.5 text-sm font-medium text-white transition hover:bg-brand-ink"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Add New Farm
        </Link>
      </div>

      {cards.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border-subtle py-16 text-center">
          <ShieldCheck className="h-8 w-8 text-text-muted" aria-hidden />
          <p className="text-text-secondary">No farms yet — add your first one to see its heat risk.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((farm) => (
            <FarmCard key={farm.id} farm={farm} />
          ))}
        </div>
      )}
    </div>
  );
}
