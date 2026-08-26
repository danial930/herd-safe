import { AlertTriangle, CircleCheck, HardHat, OctagonAlert } from "lucide-react";
import type { WorkerComfortLevel } from "@/lib/constants";

const CONFIG: Record<WorkerComfortLevel, { label: string; reason: string; color: string; tint: string; Icon: typeof CircleCheck }> = {
  good: {
    label: "Good",
    reason: "Comfortable heat and clean air",
    color: "var(--status-comfort)",
    tint: "var(--status-comfort-tint)",
    Icon: CircleCheck,
  },
  suitable: {
    label: "Suitable",
    reason: "Mild heat with moderate air quality",
    color: "var(--status-mild)",
    tint: "var(--status-mild-tint)",
    Icon: HardHat,
  },
  bad: {
    label: "Bad",
    reason: "Moderate heat or unhealthy air for sensitive groups",
    color: "var(--status-moderate)",
    tint: "var(--status-moderate-tint)",
    Icon: AlertTriangle,
  },
  intolerable: {
    label: "Intolerable",
    reason: "Severe heat or hazardous air quality",
    color: "var(--status-severe)",
    tint: "var(--status-severe-tint)",
    Icon: OctagonAlert,
  },
};

/** Worker-safety flag shown as a small badge — never a separate dashboard,
 * per PROJECT_GUIDE.md Section 8. Icon + label + one-line reason, never
 * color alone. */
export function WorkerComfortBadge({ level }: { level: WorkerComfortLevel | null }) {
  if (!level) return null;
  const { label, reason, color, tint, Icon } = CONFIG[level];
  return (
    <div
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
      style={{ background: tint, color }}
      title={reason}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      <span>Workers: {label}</span>
    </div>
  );
}
