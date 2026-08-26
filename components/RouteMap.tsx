"use client";

import dynamic from "next/dynamic";
import type { RouteWaypoint } from "./RouteMapView";

const RouteMapView = dynamic(() => import("./RouteMapView"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[220px] w-full items-center justify-center rounded-xl border border-border-subtle bg-background text-sm text-text-muted">
      Loading map…
    </div>
  ),
});

/**
 * Route map for the TRANSPORT_ROUTE checkpoint's Checkpoint Detail modal —
 * the farm → route midpoint → storage journey, colored by the checkpoint's
 * current THI risk category (same scale as RiskGauge/badges elsewhere).
 * Reuses the same react-leaflet + CartoDB tile setup as the Add/Edit Farm
 * location picker (lib/constants.ts's MAP_TILE_URL) — no new map library or
 * tile source.
 */
export function RouteMap({ waypoints, color }: { waypoints: RouteWaypoint[]; color: string }) {
  return <RouteMapView waypoints={waypoints} color={color} />;
}
