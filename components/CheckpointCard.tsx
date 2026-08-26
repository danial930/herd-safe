"use client";

import { Milk, Truck, Warehouse } from "lucide-react";
import { RiskGauge } from "./RiskGauge";
import { WorkerComfortBadge } from "./WorkerComfortBadge";
import { SpoilageBadge } from "./SpoilageBadge";
import type { CheckpointSummary } from "@/lib/farms/getCheckpointSummaries";
import type { ThiCategory, WorkerComfortLevel } from "@/lib/constants";

const ICON = { FARM: Milk, TRANSPORT_ROUTE: Truck, STORAGE: Warehouse } as const;
const LABEL = { FARM: "Pasture", TRANSPORT_ROUTE: "Transport", STORAGE: "Storage" } as const;

function formatOffset(minutes: number): string {
  if (minutes === 0) return "already optimal";
  const abs = Math.abs(minutes);
  const direction = minutes < 0 ? "earlier" : "later";
  return `${abs} min ${direction}`;
}

export function CheckpointCard({ checkpoint, onClick }: { checkpoint: CheckpointSummary; onClick: () => void }) {
  const Icon = ICON[checkpoint.type];
  const risk = checkpoint.latestRisk;

  return (
    <button
      onClick={onClick}
      className="flex w-full flex-col gap-4 rounded-2xl border border-border-subtle bg-surface-raised p-5 text-left transition hover:border-brand hover:shadow-md"
    >
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-tint text-brand-ink">
          <Icon className="h-[18px] w-[18px]" aria-hidden />
        </span>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-text-muted">{LABEL[checkpoint.type]}</p>
          <h3 className="font-display text-base font-semibold text-text-primary">{checkpoint.name}</h3>
        </div>
      </div>

      {checkpoint.type === "STORAGE" ? (
        <SpoilageBadge atRisk={risk?.spoilageRisk ?? null} />
      ) : (
        <RiskGauge thiValue={risk?.thiValue ?? null} category={(risk?.thiCategory as ThiCategory) ?? null} compact />
      )}

      <WorkerComfortBadge level={(risk?.workerComfort as WorkerComfortLevel) ?? null} />

      {checkpoint.recommendation && (
        <div className="border-t border-border-subtle pt-3 text-xs text-text-secondary">
          <p>
            Recommended shift: <span className="font-medium text-text-primary">{formatOffset(checkpoint.recommendation.recommendedOffsetMinutes)}</span>
          </p>
          <p className="mt-0.5 text-text-muted">
            {checkpoint.recommendation.exposureBefore} → {checkpoint.recommendation.exposureAfter}h exposure ·{" "}
            {checkpoint.recommendation.holdsAcrossAllYears
              ? `holds across all ${checkpoint.recommendation.yearsCount} year${checkpoint.recommendation.yearsCount === 1 ? "" : "s"}`
              : "doesn't hold every year"}
          </p>
        </div>
      )}
    </button>
  );
}
