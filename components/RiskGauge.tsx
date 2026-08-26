import { Thermometer } from "lucide-react";
import { THI_BANDS } from "@/lib/constants";
import type { ThiCategory } from "@/lib/constants";

const CATEGORY_LABEL: Record<ThiCategory, string> = {
  comfort: "Comfort",
  mild: "Mild stress",
  moderate: "Moderate stress",
  severe: "Severe stress",
};

/** The canonical THI risk-severity color scale — exported so any other
 * risk-colored element (e.g. RouteMap's polyline) stays visually consistent
 * with the gauge/badges instead of inventing its own scale. */
export const CATEGORY_COLOR: Record<ThiCategory, string> = {
  comfort: "var(--status-comfort)",
  mild: "var(--status-mild)",
  moderate: "var(--status-moderate)",
  severe: "var(--status-severe)",
};

// Practical display range for the gauge track — THI rarely strays outside
// this band in practice; values are clamped for marker positioning.
const GAUGE_MIN = 60;
const GAUGE_MAX = 96;

/**
 * HerdSafe's signature risk-reading element: a horizontal gauge across the
 * comfort -> severe THI bands with a marker at the current value. Used
 * everywhere a THI reading appears (checkpoint cards, detail charts) so risk
 * always reads the same way across the app. Icon + label always accompany
 * the color, per the accessibility rule that color never carries meaning
 * alone.
 */
export function RiskGauge({ thiValue, category, compact = false }: { thiValue: number | null; category: ThiCategory | null; compact?: boolean }) {
  if (thiValue === null || category === null) {
    return <span className="text-sm text-text-muted">No data yet</span>;
  }

  const clamped = Math.min(GAUGE_MAX, Math.max(GAUGE_MIN, thiValue));
  const markerPct = ((clamped - GAUGE_MIN) / (GAUGE_MAX - GAUGE_MIN)) * 100;
  const color = CATEGORY_COLOR[category];

  const bandStops = [
    { at: ((THI_BANDS.COMFORT_MAX - GAUGE_MIN) / (GAUGE_MAX - GAUGE_MIN)) * 100, color: "var(--status-comfort)" },
    { at: ((THI_BANDS.MILD_MAX - GAUGE_MIN) / (GAUGE_MAX - GAUGE_MIN)) * 100, color: "var(--status-mild)" },
    { at: ((THI_BANDS.MODERATE_MAX - GAUGE_MIN) / (GAUGE_MAX - GAUGE_MIN)) * 100, color: "var(--status-moderate)" },
    { at: 100, color: "var(--status-severe)" },
  ];
  const gradient = `linear-gradient(to right, ${bandStops
    .map((s, i) => `${s.color} ${i === 0 ? 0 : bandStops[i - 1].at}%, ${s.color} ${s.at}%`)
    .join(", ")})`;

  return (
    <div className="flex items-center gap-2.5">
      <Thermometer className="h-4 w-4 shrink-0" style={{ color }} aria-hidden />
      <div className="flex-1">
        {!compact && (
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-sm font-medium" style={{ color }}>
              {CATEGORY_LABEL[category]}
            </span>
            <span className="font-mono text-xs text-text-muted">THI {thiValue.toFixed(1)}</span>
          </div>
        )}
        <div className="relative h-1.5 w-full overflow-hidden rounded-full" style={{ background: gradient }}>
          <div
            className="absolute top-1/2 h-3 w-1 -translate-y-1/2 rounded-full border border-white shadow-sm"
            style={{ left: `calc(${markerPct}% - 2px)`, background: "var(--text-primary)" }}
            aria-hidden
          />
        </div>
      </div>
      {compact && (
        <span className="shrink-0 text-xs font-medium" style={{ color }}>
          {CATEGORY_LABEL[category]}
        </span>
      )}
    </div>
  );
}
