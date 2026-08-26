import { Shield } from "lucide-react";

/** Header lockup: icon + wordmark, per PROJECT_GUIDE.md Section 0.
 * Shield alone (no combined thermometer icon) — the guide's explicit
 * fallback: "simpler is fine given the timeline." */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-white">
        <Shield className="h-[19px] w-[19px]" strokeWidth={2} />
      </span>
      <span className="font-display text-[1.35rem] font-semibold tracking-tight text-text-primary">
        HerdSafe
      </span>
    </span>
  );
}
