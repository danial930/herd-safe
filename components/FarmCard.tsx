import Link from "next/link";
import { ArrowRight, Sparkles, TriangleAlert } from "lucide-react";
import { DeleteFarmButton } from "./DeleteFarmButton";

export interface FarmCardData {
  id: string;
  name: string;
  status: string;
  isDemoSeed: boolean;
  checkpointCount: number;
  totalDollarImpact: number | null;
  conflictDetected: boolean;
}

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function FarmCard({ farm }: { farm: FarmCardData }) {
  const href = farm.status === "ready" ? `/farms/${farm.id}` : `/farms/${farm.id}/processing`;

  return (
    <Link
      href={href}
      className="group flex flex-col gap-3 rounded-2xl border border-border-subtle bg-surface-raised p-5 transition hover:border-brand hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-semibold text-text-primary">{farm.name}</h3>
          {farm.isDemoSeed && (
            <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand-ink">
              <Sparkles className="h-3 w-3" aria-hidden />
              Permanent demo farm
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!farm.isDemoSeed && <DeleteFarmButton farmId={farm.id} farmName={farm.name} />}
          <ArrowRight className="h-5 w-5 text-text-muted transition group-hover:translate-x-0.5 group-hover:text-brand" aria-hidden />
        </div>
      </div>

      {farm.status === "processing" && (
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-brand-tint px-2.5 py-1 text-xs font-medium text-brand-ink">
          Processing…
        </span>
      )}
      {farm.status === "failed" && (
        <span
          className="inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
          style={{ background: "var(--status-severe-tint)", color: "var(--status-severe)" }}
        >
          <TriangleAlert className="h-3.5 w-3.5" aria-hidden />
          Processing failed
        </span>
      )}
      {farm.status === "ready" && (
        <div className="flex items-center gap-3">
          {farm.totalDollarImpact !== null && (
            <span className="font-mono text-sm text-text-secondary">
              {currency.format(farm.totalDollarImpact)} impact
            </span>
          )}
          {farm.conflictDetected && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
              style={{ background: "var(--status-severe-tint)", color: "var(--status-severe)" }}
            >
              <TriangleAlert className="h-3 w-3" aria-hidden />
              Conflict
            </span>
          )}
        </div>
      )}

      <span className="text-xs text-text-muted">{farm.checkpointCount} checkpoints</span>
    </Link>
  );
}
