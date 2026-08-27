"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useState } from "react";
import L from "leaflet";
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import { MAP_TILE_ATTRIBUTION, MAP_TILE_URL } from "@/lib/constants";
import { useTileErrorFallback } from "@/lib/hooks/useTileErrorFallback";
import { fetchRoadRoute } from "@/lib/routing/osrm";

export interface RouteWaypoint {
  lat: number;
  lon: number;
  label: string;
}

/** Fits the map to whatever's actually being drawn — the road route once
 * it's loaded (which can bow out past the straight-line bounds), the raw
 * waypoints until then/if it never loads. Re-fits when either changes so
 * the swap from straight-line to road route doesn't leave part of the line
 * outside the visible area. */
function FitToRoute({ waypoints, linePositions }: { waypoints: RouteWaypoint[]; linePositions: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (linePositions.length === 0) return;
    const bounds = L.latLngBounds(linePositions);
    map.fitBounds(bounds, { padding: [32, 32] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, JSON.stringify(waypoints), linePositions]);
  return null;
}

/**
 * The actual Leaflet map — loaded client-only via next/dynamic (ssr:false)
 * from RouteMap.tsx, since Leaflet touches `window` at import time (same
 * pattern as LocationPickerMap.tsx). Read-only display: no click-to-move,
 * scroll-wheel zoom disabled so it doesn't hijack the modal's own scrolling.
 *
 * The connecting line starts as straight segments between the waypoints
 * (renders immediately, no blank/loading map) and upgrades in place to a
 * real road-following route once OSRM responds (lib/routing/osrm.ts) —
 * fetched once per mount (i.e. once per checkpoint view), not persisted.
 * If OSRM fails or times out, the straight line simply stays — that's the
 * fallback, not an error state, so nothing is surfaced to the user beyond a
 * console warning (see fetchRoadRoute).
 *
 * Markers are plain CircleMarkers (not the picker's custom divIcon pin) —
 * simpler, and sidesteps Leaflet's default-icon asset-path bundler issue
 * entirely since there's no image involved. Each carries a permanent
 * Tooltip label instead of relying on marker color/shape to distinguish
 * farm/midpoint/storage.
 */
export default function RouteMapView({ waypoints, color }: { waypoints: RouteWaypoint[]; color: string }) {
  const straightLinePositions: [number, number][] = waypoints.map((w) => [w.lat, w.lon]);
  const [roadRoute, setRoadRoute] = useState<[number, number][] | null>(null);
  const center = straightLinePositions[Math.floor(straightLinePositions.length / 2)] ?? [0, 0];

  useEffect(() => {
    let cancelled = false;
    fetchRoadRoute(waypoints.map((w) => ({ lat: w.lat, lon: w.lon }))).then((route) => {
      if (!cancelled && route) setRoadRoute(route);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(waypoints.map((w) => [w.lat, w.lon]))]);

  const linePositions = roadRoute ?? straightLinePositions;
  const { tilesUnavailable, tileEventHandlers } = useTileErrorFallback();

  return (
    <div className="relative">
      <MapContainer
        center={center}
        zoom={9}
        scrollWheelZoom={false}
        style={{ height: "220px", width: "100%", borderRadius: "0.75rem" }}
      >
        <TileLayer url={MAP_TILE_URL} attribution={MAP_TILE_ATTRIBUTION} eventHandlers={tileEventHandlers} />
        <Polyline positions={linePositions} pathOptions={{ color, weight: 3 }} />
        {waypoints.map((w) => (
          <CircleMarker
            key={`${w.label}-${w.lat}-${w.lon}`}
            center={[w.lat, w.lon]}
            radius={7}
            pathOptions={{ color: "#ffffff", weight: 2, fillColor: color, fillOpacity: 1 }}
          >
            <Tooltip permanent direction="top" offset={[0, -6]} className="!text-xs !font-medium">
              {w.label}
            </Tooltip>
          </CircleMarker>
        ))}
        <FitToRoute waypoints={waypoints} linePositions={linePositions} />
      </MapContainer>
      {tilesUnavailable && (
        <div className="absolute inset-0 z-[500] flex items-center justify-center rounded-xl bg-background/95 text-sm text-text-muted">
          Map unavailable — route markers and impact figures below are unaffected.
        </div>
      )}
    </div>
  );
}
