import { Snowflake, TriangleAlert } from "lucide-react";

/**
 * Storage checkpoint's refrigeration-strain flag (PROJECT_GUIDE.md Section 8)
 * — icon + label, never color alone.
 *
 * FRAMING: `atRisk` is computed from ambient outdoor heat crossing
 * AMBIENT_HEAT_STRAIN_THRESHOLD_C, a proxy for refrigeration equipment
 * strain and outage risk — NOT a confirmed reading of the stored product's
 * actual temperature (FortyGuard never exposes that). The copy below must
 * say so explicitly rather than implying the milk itself is unsafe.
 */
export function SpoilageBadge({ atRisk }: { atRisk: boolean | null }) {
  if (atRisk === null) return null;
  return atRisk ? (
    <div
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
      style={{ background: "var(--status-severe-tint)", color: "var(--status-severe)" }}
      title="Extreme ambient heat raises the risk of refrigeration equipment strain or an outage during this window — not a confirmed reading of the stored product's temperature."
    >
      <TriangleAlert className="h-3.5 w-3.5" aria-hidden />
      <span>Refrigeration strain risk</span>
    </div>
  ) : (
    <div
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
      style={{ background: "var(--status-comfort-tint)", color: "var(--status-comfort)" }}
      title="Ambient heat isn't elevated enough right now to meaningfully strain refrigeration equipment."
    >
      <Snowflake className="h-3.5 w-3.5" aria-hidden />
      <span>Cooling load normal</span>
    </div>
  );
}
