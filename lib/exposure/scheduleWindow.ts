import { TRANSPORT_DEFAULT_DURATION_MINUTES } from "@/lib/constants";
import type { CheckpointType } from "@/lib/generated/prisma";

/** A schedule window expressed in minutes-of-day; `durationMinutes` may push
 * `startMinutes + durationMinutes` past 1440 to represent an overnight span. */
export interface ScheduleWindow {
  startMinutes: number;
  durationMinutes: number;
}

export function parseHHMM(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function formatMinutesAsHHMM(minutes: number): string {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Farm/pasture schedule: explicit start+end (e.g. grazing window). Wraps
 * past midnight if end <= start. */
export function windowFromStartEnd(start: string, end: string): ScheduleWindow {
  const startMinutes = parseHHMM(start);
  let endMinutes = parseHHMM(end);
  if (endMinutes <= startMinutes) endMinutes += 1440;
  return { startMinutes, durationMinutes: endMinutes - startMinutes };
}

/** Transport schedule: a single departure time plus an assumed transit
 * duration (no route-duration field exists in the schema — see
 * TRANSPORT_DEFAULT_DURATION_MINUTES in lib/constants.ts). */
export function windowFromDeparture(departureTime: string, durationMinutes: number): ScheduleWindow {
  return { startMinutes: parseHHMM(departureTime), durationMinutes };
}

export function shiftWindow(window: ScheduleWindow, offsetMinutes: number): ScheduleWindow {
  return { startMinutes: window.startMinutes + offsetMinutes, durationMinutes: window.durationMinutes };
}

/**
 * Builds the right kind of window for a checkpoint's stored `schedule` JSON
 * — `{start,end}` for FARM, `{departureTime}` + the assumed transit duration
 * for TRANSPORT_ROUTE. Shared by every place that needs a checkpoint's
 * schedule window (ingestion, chain-summary, recommendation recompute) so
 * they can't drift out of sync with each other.
 */
export function scheduleWindowForCheckpoint(type: CheckpointType, schedule: unknown): ScheduleWindow {
  const s = schedule as { start?: string; end?: string; departureTime?: string };
  if (type === "TRANSPORT_ROUTE" && s.departureTime) {
    return windowFromDeparture(s.departureTime, TRANSPORT_DEFAULT_DURATION_MINUTES);
  }
  if (s.start && s.end) {
    return windowFromStartEnd(s.start, s.end);
  }
  throw new Error(`Checkpoint schedule missing start/end or departureTime: ${JSON.stringify(schedule)}`);
}

/** True if the given hour-of-day (0-23) overlaps the window at all. Checked
 * across a -1440/0/+1440 shift so windows that wrap past midnight (in either
 * direction, including from a negative optimizer offset) are handled. */
export function hourOverlapsWindow(hour: number, window: ScheduleWindow): boolean {
  const hourStart = hour * 60;
  const hourEnd = hourStart + 60;
  const winStart = window.startMinutes;
  const winEnd = window.startMinutes + window.durationMinutes;
  for (const shift of [-1440, 0, 1440]) {
    if (hourStart < winEnd + shift && hourEnd > winStart + shift) return true;
  }
  return false;
}
