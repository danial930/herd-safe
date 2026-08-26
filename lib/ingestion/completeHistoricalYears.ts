/**
 * Determines which years of a checkpoint's historical sample-week data are
 * actually COMPLETE (every day in HISTORICAL_SAMPLE_WEEK has all 24 hours
 * computed) versus partially pulled. An interrupted ingestion run (crash,
 * transient network failure, deliberately not resumed to avoid further
 * credit spend) can leave a year with some — but not all — of its sample
 * days present; that year is not a valid backtest year, since "backtest
 * across multiple summers" only means something if each summer is a full,
 * even comparison.
 *
 * This never calls FortyGuard — it only reads what's already cached in
 * Postgres, so it's free to call any time.
 */
import { HISTORICAL_SAMPLE_WEEK } from "@/lib/constants";
import { prisma } from "@/lib/db";
import type { HourlyThiPoint } from "@/lib/exposure/optimizer";

const EXPECTED_ROWS_PER_YEAR = (HISTORICAL_SAMPLE_WEEK.endDay - HISTORICAL_SAMPLE_WEEK.startDay + 1) * 24;

/** Complete years, ascending, for one checkpoint — based on ComputedRisk row
 * counts (the same rows the optimizer/backtest/chart actually read). */
export async function getCompleteHistoricalYears(checkpointId: string): Promise<number[]> {
  const rows = await prisma.computedRisk.findMany({
    where: { checkpointId },
    select: { date: true },
  });

  const countByYear = new Map<number, number>();
  for (const row of rows) {
    const year = row.date.getUTCFullYear();
    countByYear.set(year, (countByYear.get(year) ?? 0) + 1);
  }

  return Array.from(countByYear.entries())
    .filter(([, count]) => count >= EXPECTED_ROWS_PER_YEAR)
    .map(([year]) => year)
    .sort((a, b) => a - b);
}

/** ComputedRisk rows for one checkpoint, restricted to the given years and
 * shaped as the HourlyThiPoint[] the optimizer/backtest functions expect. */
export async function getHourlyThiPointsForYears(
  checkpointId: string,
  years: number[],
): Promise<Record<string, HourlyThiPoint[]>> {
  const perYearSeries: Record<string, HourlyThiPoint[]> = {};
  if (years.length === 0) return perYearSeries;

  const rows = await prisma.computedRisk.findMany({
    where: { checkpointId },
    orderBy: [{ date: "asc" }, { hour: "asc" }],
  });

  for (const year of years) {
    perYearSeries[String(year)] = rows
      .filter((r) => r.date.getUTCFullYear() === year && r.thiValue !== null)
      .map((r) => ({ date: r.date.toISOString().slice(0, 10), hour: r.hour, thi: r.thiValue as number }));
  }
  return perYearSeries;
}
