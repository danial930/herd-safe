import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";
import { prisma } from "@/lib/db";
import { getCheckpointSummaries, sortForChain } from "@/lib/farms/getCheckpointSummaries";
import { ChainSummaryStat } from "@/components/ChainSummaryStat";
import { DashboardClient } from "@/components/DashboardClient";

/** Dashboard — PROJECT_GUIDE.md Section 4, screen 4. Server Component
 * reading Postgres directly (Section 7, rule 1). */
export default async function DashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const farm = await prisma.farm.findUnique({ where: { id }, include: { chainSummary: true } });
  if (!farm) notFound();

  const checkpoints = sortForChain(await getCheckpointSummaries(id));

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-brand">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          All Farms
        </Link>
        {!farm.isDemoSeed && (
          <Link href={`/farms/${id}/edit`} className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-brand">
            <Pencil className="h-3.5 w-3.5" aria-hidden />
            Edit
          </Link>
        )}
      </div>

      <h1 className="font-display mb-6 text-2xl font-semibold text-text-primary">{farm.name}</h1>

      <div className="mb-8">
        <ChainSummaryStat summary={farm.chainSummary} />
      </div>

      <DashboardClient checkpoints={checkpoints} />
    </div>
  );
}
