/**
 * OSRM road-route fetch — draws a real road-following line on the
 * TRANSPORT_ROUTE checkpoint's map instead of straight segments between the
 * farm/route-midpoint/storage points. Display geometry only, fetched fresh
 * client-side, never persisted (see OSRM_ROUTE_BASE_URL's doc comment in
 * lib/constants.ts for why this differs from every FortyGuard call).
 */
import { OSRM_REQUEST_TIMEOUT_MS, OSRM_ROUTE_BASE_URL } from "@/lib/constants";

export interface RoutePoint {
  lat: number;
  lon: number;
}

/**
 * Fetches a road-following route through the given waypoints, in order.
 * Returns `[lat, lon]` pairs (Leaflet's order) for the full route geometry,
 * or `null` if the request fails, times out, or the response has no usable
 * geometry — callers must fall back to a straight-line rendering rather
 * than surface an error, since the public OSRM demo server isn't meant for
 * guaranteed uptime. Failures are logged (console.warn), not thrown.
 */
export async function fetchRoadRoute(waypoints: RoutePoint[]): Promise<[number, number][] | null> {
  if (waypoints.length < 2) return null;

  // OSRM takes coordinates as lon,lat (same as GeoJSON) — the opposite of
  // how this app otherwise always orders them (lat,lon everywhere else:
  // RouteWaypoint, every FortyGuard call, the DB). Double-checked against a
  // live request before shipping this — easy to get backwards silently.
  const coordinates = waypoints.map((w) => `${w.lon},${w.lat}`).join(";");
  const url = `${OSRM_ROUTE_BASE_URL}/${coordinates}?geometries=geojson&overview=full`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OSRM_REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      console.warn(`OSRM route request failed with status ${res.status} — falling back to straight-line route`);
      return null;
    }
    const body = (await res.json()) as {
      routes?: Array<{ geometry?: { coordinates?: [number, number][] } }>;
    };
    const geometryCoords = body.routes?.[0]?.geometry?.coordinates;
    if (!Array.isArray(geometryCoords) || geometryCoords.length === 0) {
      console.warn("OSRM response had no usable route geometry — falling back to straight-line route", body);
      return null;
    }
    // GeoJSON coordinates are [lon, lat] — flip to Leaflet's [lat, lon].
    return geometryCoords.map(([lon, lat]) => [lat, lon]);
  } catch (err) {
    console.warn("OSRM route request failed or timed out — falling back to straight-line route", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
