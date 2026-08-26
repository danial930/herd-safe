/**
 * Transit Impact — two pure, derived metrics for the TRANSPORT_ROUTE
 * checkpoint's Checkpoint Detail modal (PROJECT_GUIDE.md Section 4, screen
 * 5). Every input here is temperature data or the checkpoint's own schedule,
 * already cached/stored — no FortyGuard call, zero additional credits.
 *
 * Deliberately NOT fed into the dollar-impact estimate or the schedule
 * optimizer — descriptive operational context, not inputs to either. Every
 * constant is cited in full in lib/constants.ts — see there before changing
 * any threshold/rate below.
 */
import {
  PMO_TRANSPORT_RECEIVING_CEILING_C,
  SPOILAGE_TEMP_CEILING_C,
  TRANSIT_HEAT_GAIN_RATE_COEFFICIENT_PER_F,
} from "@/lib/constants";
import { celsiusToFahrenheit } from "./herdMetrics";

/**
 * Estimated hours remaining before in-transit milk, assumed loaded at the
 * storage ceiling (SPOILAGE_TEMP_CEILING_C), warms past the PMO transport-
 * receiving ceiling (PMO_TRANSPORT_RECEIVING_CEILING_C) — under the
 * ILLUSTRATIVE linear heat-gain assumption in
 * TRANSIT_HEAT_GAIN_RATE_COEFFICIENT_PER_F. Returns `Infinity` when today's
 * ambient temperature is at or below the milk's starting temperature (no
 * warming risk at all today, not just a large buffer).
 */
export function estimateMilkCoolingBufferHours(ambientC: number): number {
  const ambientF = celsiusToFahrenheit(ambientC);
  const milkStartF = celsiusToFahrenheit(SPOILAGE_TEMP_CEILING_C);
  const thresholdF = celsiusToFahrenheit(PMO_TRANSPORT_RECEIVING_CEILING_C);

  const differentialF = ambientF - milkStartF;
  if (differentialF <= 0) return Infinity;

  const rateFPerHour = TRANSIT_HEAT_GAIN_RATE_COEFFICIENT_PER_F * differentialF;
  const headroomF = thresholdF - milkStartF;
  return headroomF / rateFPerHour;
}

/**
 * Hours elapsed since the most recent occurrence of a daily HH:MM departure
 * time — the app's only real signal for "how long has this leg been in
 * transit" (no live GPS/logistics tracking exists). If the scheduled time
 * hasn't happened yet today, uses yesterday's occurrence.
 */
export function hoursSinceScheduledDeparture(departureTimeHHMM: string, now: Date = new Date()): number {
  const [hours, minutes] = departureTimeHHMM.split(":").map(Number);
  const todayOccurrence = new Date(now);
  todayOccurrence.setHours(hours, minutes, 0, 0);
  const occurrence =
    todayOccurrence.getTime() <= now.getTime() ? todayOccurrence : new Date(todayOccurrence.getTime() - 24 * 60 * 60 * 1000);
  return (now.getTime() - occurrence.getTime()) / (1000 * 60 * 60);
}
