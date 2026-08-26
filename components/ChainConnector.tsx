import { ChevronRight } from "lucide-react";

/** A small connector between checkpoint cards — the chain reads as the real
 * physical route (pasture -> road -> warehouse), not a decorative divider. */
export function ChainConnector() {
  return (
    <div className="flex items-center justify-center py-1 lg:flex-col lg:py-0">
      <div className="h-px w-8 border-t-2 border-dashed border-border-subtle lg:h-8 lg:w-px lg:border-t-0 lg:border-l-2" />
      <ChevronRight className="h-4 w-4 shrink-0 text-text-muted lg:rotate-90" aria-hidden />
      <div className="h-px w-8 border-t-2 border-dashed border-border-subtle lg:h-8 lg:w-px lg:border-t-0 lg:border-l-2" />
    </div>
  );
}
