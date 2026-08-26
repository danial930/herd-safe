import { FARM_AOI_BUFFER_METERS } from "@/lib/constants";
import { buildPointBufferPolygon } from "@/lib/fortyguard/geo";
import type { Prisma } from "@/lib/generated/prisma";

/**
 * Form input matching the Add/Edit Farm screen (PROJECT_GUIDE.md Section 4,
 * screen 2): farm name, farm coordinates, storage coordinates, grazing
 * schedule (start/end), transport departure time. No separate transport
 * route or farm-boundary field exists in the form, so both are derived here:
 * the transport route runs farm -> midpoint -> storage, and the farm's AOI
 * polygon is a buffer square around its single coordinate.
 */
export interface FarmFormInput {
  name: string;
  farmLatitude: number;
  farmLongitude: number;
  storageLatitude: number;
  storageLongitude: number;
  grazingStart: string; // HH:MM
  grazingEnd: string; // HH:MM
  transportDepartureTime: string; // HH:MM
  /** Optional — drives Herd Impact Today totals (lib/impact/herdMetrics.ts).
   * Never blocks farm creation; per-animal figures are shown when absent. */
  herdSize?: number | null;
}

function midpoint(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  return { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 };
}

/** Builds the 3 checkpoint `create` payloads for a farm (without `farmId` —
 * the caller supplies that via the nested `checkpoints.create` write). */
export function buildCheckpointsData(
  input: FarmFormInput,
): Prisma.CheckpointCreateWithoutFarmInput[] {
  const farmPoint = { lat: input.farmLatitude, lon: input.farmLongitude };
  const storagePoint = { lat: input.storageLatitude, lon: input.storageLongitude };
  const midPoint = midpoint(farmPoint, storagePoint);

  return [
    {
      type: "FARM",
      name: `${input.name} — Pasture`,
      latitude: input.farmLatitude,
      longitude: input.farmLongitude,
      polygonGeoJson: buildPointBufferPolygon(input.farmLatitude, input.farmLongitude, FARM_AOI_BUFFER_METERS) as unknown as object,
      schedule: { start: input.grazingStart, end: input.grazingEnd },
    },
    {
      type: "TRANSPORT_ROUTE",
      name: `${input.name} — Transport Route`,
      latitude: midPoint.lat,
      longitude: midPoint.lon,
      routeWaypoints: [
        { lat: farmPoint.lat, lon: farmPoint.lon },
        { lat: midPoint.lat, lon: midPoint.lon },
        { lat: storagePoint.lat, lon: storagePoint.lon },
      ] as unknown as object,
      schedule: { departureTime: input.transportDepartureTime },
    },
    {
      type: "STORAGE",
      name: `${input.name} — Storage Facility`,
      latitude: input.storageLatitude,
      longitude: input.storageLongitude,
      schedule: {},
    },
  ];
}

export function validateFarmFormInput(body: unknown): FarmFormInput {
  const b = body as Partial<FarmFormInput> | null;
  if (!b || typeof b !== "object") throw new Error("Request body must be a JSON object");

  const requiredStrings: Array<keyof FarmFormInput> = ["name", "grazingStart", "grazingEnd", "transportDepartureTime"];
  for (const key of requiredStrings) {
    if (typeof b[key] !== "string" || b[key] === "") {
      throw new Error(`Missing or invalid field: ${key}`);
    }
  }
  const requiredNumbers: Array<keyof FarmFormInput> = [
    "farmLatitude",
    "farmLongitude",
    "storageLatitude",
    "storageLongitude",
  ];
  for (const key of requiredNumbers) {
    if (typeof b[key] !== "number" || Number.isNaN(b[key])) {
      throw new Error(`Missing or invalid field: ${key}`);
    }
  }

  if (b.herdSize !== undefined && b.herdSize !== null) {
    if (typeof b.herdSize !== "number" || Number.isNaN(b.herdSize) || b.herdSize < 0) {
      throw new Error("Invalid field: herdSize must be a non-negative number");
    }
  }

  return b as FarmFormInput;
}
