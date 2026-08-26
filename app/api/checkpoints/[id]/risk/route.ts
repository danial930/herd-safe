import { NextResponse } from "next/server";
import { AMBIENT_HEAT_STRAIN_THRESHOLD_C } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { historicalAnalogProfile } from "@/lib/exposure/backtest";
import { getCompleteHistoricalYears, getHourlyThiPointsForYears } from "@/lib/ingestion/completeHistoricalYears";
import { calculateSpoilageRisk } from "@/lib/risk/spoilage";

/**
 * GET /api/checkpoints/:id/risk — Checkpoint Detail screen (PROJECT_GUIDE.md
 * Section 4, screen 5). FARM/TRANSPORT_ROUTE get the THI-over-time series
 * plus the historical-analog profile (labeled explicitly as an analog, not a
 * forecast — Section 8.4); STORAGE gets the current+forecast series and a
 * spoilage summary, with no historical chart by design. Read-only against
 * Postgres.
 *
 * `yearsBacktested` reports the checkpoint's ACTUAL complete-year scope (see
 * lib/ingestion/completeHistoricalYears.ts) rather than assuming a fixed
 * 3-year window — a checkpoint can have fewer complete years (an
 * interrupted pull that was deliberately not resumed) or none at all (the
 * reactive-only default for new farms), and the response must say so
 * accurately rather than implying a scope that isn't backed by real data.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const checkpoint = await prisma.checkpoint.findUnique({ where: { id } });
  if (!checkpoint) {
    return NextResponse.json({ error: "Checkpoint not found" }, { status: 404 });
  }

  const rows = await prisma.computedRisk.findMany({
    where: { checkpointId: id },
    orderBy: [{ date: "asc" }, { hour: "asc" }],
  });

  const series = rows.map((r) => ({
    date: r.date.toISOString().slice(0, 10),
    hour: r.hour,
    temperatureC: r.temperatureC,
    humidityPct: r.humidityPct,
    thiValue: r.thiValue,
    thiCategory: r.thiCategory,
    aqi: r.aqi,
    workerComfort: r.workerComfort,
    spoilageRisk: r.spoilageRisk,
  }));

  if (checkpoint.type === "STORAGE") {
    const spoilageSummary = calculateSpoilageRisk(rows.map((r) => r.temperatureC), AMBIENT_HEAT_STRAIN_THRESHOLD_C);
    return NextResponse.json({
      checkpoint,
      series,
      historicalAnalog: null,
      spoilageSummary,
      yearsBacktested: [],
      ambientHeatFrequency: null,
    });
  }

  const completeYears = await getCompleteHistoricalYears(id);
  const perYearSeries = await getHourlyThiPointsForYears(id, completeYears);
  const historicalAnalog = completeYears.length > 0 ? historicalAnalogProfile(perYearSeries, completeYears) : [];

  return NextResponse.json({
    checkpoint,
    series,
    historicalAnalog,
    spoilageSummary: null,
    yearsBacktested: completeYears,
    // FARM/TRANSPORT_ROUTE only — see lib/ingestion/ambientHeatFrequency.ts.
    // Separate real signal, not the THI backtest above.
    ambientHeatFrequency: checkpoint.ambientHeatFrequency,
  });
}
