import { CLIMATE_POINT_BUFFER_METERS } from "@/lib/constants";
import type { GeoJsonPolygonAoi } from "./types";

const METERS_PER_DEGREE_LAT = 111_320;

/**
 * A small closed-ring square around a point, for heatmap tcm pulls where we
 * want the checkpoint's representative temperature rather than a full tile
 * grid over a large AOI. Remember: FortyGuard coordinates are [lon, lat].
 */
export function buildPointBufferPolygon(
  latitude: number,
  longitude: number,
  halfSizeMeters: number = CLIMATE_POINT_BUFFER_METERS,
): GeoJsonPolygonAoi {
  const dLat = halfSizeMeters / METERS_PER_DEGREE_LAT;
  const metersPerDegreeLon = METERS_PER_DEGREE_LAT * Math.cos((latitude * Math.PI) / 180);
  const dLon = halfSizeMeters / metersPerDegreeLon;

  const nw: [number, number] = [longitude - dLon, latitude + dLat];
  const ne: [number, number] = [longitude + dLon, latitude + dLat];
  const se: [number, number] = [longitude + dLon, latitude - dLat];
  const sw: [number, number] = [longitude - dLon, latitude - dLat];

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [[nw, ne, se, sw, nw]],
        },
      },
    ],
  };
}

/** Centroid of a polygon's first ring — used to reduce a farm's stored AOI
 * down to one representative point for climate pulls (see the ingestion
 * scripts' doc comments for why we don't do a full per-tile pull). */
export function polygonCentroid(polygon: GeoJsonPolygonAoi): { latitude: number; longitude: number } {
  const ring = polygon.features[0]?.geometry.coordinates[0] ?? [];
  const points = ring.slice(0, -1); // last point closes the ring, duplicate of first
  const sum = points.reduce(
    (acc, [lon, lat]) => ({ lon: acc.lon + lon, lat: acc.lat + lat }),
    { lon: 0, lat: 0 },
  );
  return { latitude: sum.lat / points.length, longitude: sum.lon / points.length };
}
