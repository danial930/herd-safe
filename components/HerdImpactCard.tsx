"use client";

import { useState } from "react";
import { Info, type LucideIcon } from "lucide-react";

/**
 * One stat card in the Checkpoint Detail modal's "Herd Impact Today"
 * section (FARM checkpoint only — see CheckpointDetailModal.tsx). Source
 * citation lives behind the small info icon, not on the card face, per the
 * layout spec: a prominent value, a short label, a one-line context
 * sentence, and the citation on tap/hover only.
 */
export function HerdImpactCard({
  icon: Icon,
  value,
  label,
  context,
  source,
}: {
  icon: LucideIcon;
  value: string;
  label: string;
  context: string;
  source: string;
}) {
  const [showSource, setShowSource] = useState(false);

  return (
    <div className="relative flex flex-col gap-1 rounded-xl border border-border-subtle bg-white p-4">
      <div className="flex items-start justify-between">
        <Icon className="h-5 w-5 text-brand" aria-hidden />
        <button
          type="button"
          onClick={() => setShowSource((v) => !v)}
          onBlur={() => setShowSource(false)}
          className="rounded-full p-0.5 text-text-muted hover:bg-background hover:text-brand"
          aria-label="Source for this figure"
          aria-expanded={showSource}
        >
          <Info className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      <p className="font-display text-2xl font-semibold text-text-primary">{value}</p>
      <p className="text-xs font-medium text-text-secondary">{label}</p>
      <p className="text-xs text-text-muted">{context}</p>
      {showSource && (
        <div className="absolute inset-x-2 top-full z-10 mt-1 rounded-lg border border-border-subtle bg-surface-raised p-2 text-xs leading-snug text-text-secondary shadow-md">
          {source}
        </div>
      )}
    </div>
  );
}
