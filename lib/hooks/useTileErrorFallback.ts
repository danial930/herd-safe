"use client";

import { useState } from "react";
import { MAP_TILE_ERROR_THRESHOLD } from "@/lib/constants";

/**
 * Tracks consecutive tile-load failures so a map can show a plain "map
 * unavailable" message instead of a broken/blank tile grid if the tile
 * provider (lib/constants.ts's MAP_TILE_URL) is ever down. One successful
 * tile load resets the count, so a couple of transient failures don't
 * false-positive into the fallback. Shared by LocationPickerMap.tsx and
 * RouteMapView.tsx — identical logic, two call sites.
 */
export function useTileErrorFallback() {
  const [errorCount, setErrorCount] = useState(0);
  return {
    tilesUnavailable: errorCount >= MAP_TILE_ERROR_THRESHOLD,
    tileEventHandlers: {
      tileerror: () => setErrorCount((c) => c + 1),
      tileload: () => setErrorCount(0),
    },
  };
}
