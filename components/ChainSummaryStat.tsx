import { DollarSign, TriangleAlert } from "lucide-react";

export interface ChainSummaryData {
  totalDollarImpact: number;
  milkYieldLossEstimate: number;
  /** false when the FARM checkpoint has no ScheduleRecommendation (reactive-
   * only — the default for new farms) — there's nothing to diff exposure
   * against, so milkYieldLossEstimate is a placeholder 0, not a real
   * computed answer. The UI must say so, not render it as a verified $0. */
  milkYieldEstimateAvailable: boolean;
  spoilageRiskEstimate: number;
  /** false when the STORAGE checkpoint has fewer than
   * SPOILAGE_ESTIMATE_MIN_OBSERVED_HOURS cached hours — a single reactive
   * reading isn't enough basis for a flat per-event dollar claim, even if
   * it happened to be flagged. Same honesty rule as
   * milkYieldEstimateAvailable; the underlying risk flag/badge elsewhere is
   * unaffected, only this dollar figure. */
  spoilageEstimateAvailable: boolean;
  conflictDetected: boolean;
  conflictDetails: unknown;
}

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** Header stat card — the combined dollar-impact estimate, first thing seen
 * (PROJECT_GUIDE.md Section 4, screen 4 & Section 10). */
export function ChainSummaryStat({ summary }: { summary: ChainSummaryData | null }) {
  if (!summary) {
    return (
      <div className="rounded-2xl border border-border-subtle bg-surface-raised p-6">
        <p className="text-sm text-text-muted">Impact estimate not available yet.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border-subtle bg-surface-raised p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-text-muted">
            <DollarSign className="h-3.5 w-3.5" aria-hidden />
            Estimated impact avoided
          </p>
          <p className="font-display mt-1 text-4xl font-semibold text-brand-ink">
            {currency.format(summary.totalDollarImpact)}
          </p>
          <p className="mt-1 text-xs text-text-muted">
            {summary.milkYieldEstimateAvailable
              ? `${currency.format(summary.milkYieldLossEstimate)} milk yield`
              : "Milk yield impact: not available (no historical backtest run for this farm)"}
            {" · "}
            {summary.spoilageEstimateAvailable
              ? `${currency.format(summary.spoilageRiskEstimate)} spoilage risk`
              : "Spoilage risk: not available (limited storage data so far)"}
          </p>
        </div>

        {summary.conflictDetected && (
          <div
            className="flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-medium"
            style={{ background: "var(--status-severe-tint)", color: "var(--status-severe)" }}
          >
            <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
            <span>Transport&apos;s recommended arrival overlaps a storage refrigeration-strain window</span>
          </div>
        )}
      </div>
    </div>
  );
}
