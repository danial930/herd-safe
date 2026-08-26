import { hourOverlapsWindow, type ScheduleWindow } from "./scheduleWindow";

export interface StorageHourRisk {
  hour: number;
  atRisk: boolean;
}

export interface ChainConflictResult {
  conflictDetected: boolean;
  conflictingHours: number[];
}

/**
 * Chain-conflict check (PROJECT_GUIDE.md Section 8's final rule): flags a
 * conflict if the transport checkpoint's recommended arrival window overlaps
 * any hour the storage checkpoint has flagged as high spoilage-risk.
 */
export function detectChainConflict(
  transportArrivalWindow: ScheduleWindow,
  storageHourlyRisk: StorageHourRisk[],
): ChainConflictResult {
  const conflictingHours = storageHourlyRisk
    .filter((h) => h.atRisk && hourOverlapsWindow(h.hour, transportArrivalWindow))
    .map((h) => h.hour)
    .sort((a, b) => a - b);

  return { conflictDetected: conflictingHours.length > 0, conflictingHours };
}
