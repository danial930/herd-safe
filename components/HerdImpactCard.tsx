"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info, type LucideIcon } from "lucide-react";

const TOOLTIP_WIDTH_PX = 256;
const VIEWPORT_MARGIN_PX = 12;

/**
 * One stat card in the Checkpoint Detail modal's impact sections (Herd
 * Impact Today, Transit Impact, Storage Impact). Source citation lives
 * behind the small info icon, not on the card face, per the layout spec: a
 * prominent value, a short label, a one-line context sentence, and the
 * citation on tap/hover only.
 *
 * The citation renders via a PORTAL into document.body, position: fixed,
 * anchored to the info button's live getBoundingClientRect() — not
 * position: absolute relative to the card. The card-relative version had a
 * real bug: for a card near the bottom of the modal's scrollable content,
 * the tooltip would extend past the modal's own visual boundary and float
 * disconnected over the backdrop below it, while also inflating the
 * modal's scrollHeight (a scrollable ancestor's overflow calculation still
 * accounts for absolutely-positioned descendants) — which reads as "the
 * rest of the page got pushed down." Portaling to the document root and
 * computing a fixed on-screen position sidesteps both problems: it can
 * never be clipped/misplaced by an ancestor's overflow or stacking
 * context, and it never contributes to any ancestor's scroll size.
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
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number } | null>(null);

  function openTooltip() {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.min(
      Math.max(rect.right - TOOLTIP_WIDTH_PX, VIEWPORT_MARGIN_PX),
      window.innerWidth - TOOLTIP_WIDTH_PX - VIEWPORT_MARGIN_PX,
    );
    setTooltipPos({ top: rect.bottom + 6, left });
  }

  // A fixed-position tooltip anchored to a point-in-time rect would drift
  // away from its icon if the page/modal scrolls while it's open —
  // correct, simple behavior is to close it rather than chase a moving
  // target with a scroll listener.
  useEffect(() => {
    if (!tooltipPos) return;
    const close = () => setTooltipPos(null);
    window.addEventListener("scroll", close, true);
    return () => window.removeEventListener("scroll", close, true);
  }, [tooltipPos]);

  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border-subtle bg-white p-4">
      <div className="flex items-start justify-between">
        <Icon className="h-5 w-5 text-brand" aria-hidden />
        <button
          ref={buttonRef}
          type="button"
          onClick={() => (tooltipPos ? setTooltipPos(null) : openTooltip())}
          onBlur={() => setTooltipPos(null)}
          className="rounded-full p-0.5 text-text-muted hover:bg-background hover:text-brand"
          aria-label="Source for this figure"
          aria-expanded={tooltipPos !== null}
        >
          <Info className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      <p className="font-display text-2xl font-semibold text-text-primary">{value}</p>
      <p className="text-xs font-medium text-text-secondary">{label}</p>
      <p className="text-xs text-text-muted">{context}</p>
      {tooltipPos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            style={{ position: "fixed", top: tooltipPos.top, left: tooltipPos.left, width: TOOLTIP_WIDTH_PX }}
            className="z-[1000] rounded-lg border border-border-subtle bg-surface-raised p-2 text-xs leading-snug text-text-secondary shadow-md"
          >
            {source}
          </div>,
          document.body,
        )}
    </div>
  );
}
