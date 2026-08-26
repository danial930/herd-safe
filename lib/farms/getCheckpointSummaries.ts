import { prisma } from "@/lib/db";
import type { CheckpointType } from "@/lib/generated/prisma";

export interface CheckpointSummary {
  id: string;
  farmId: string;
  type: CheckpointType;
  name: string;
  latitude: number;
  longitude: number;
  schedule: unknown;
  /** The farm's optional herd size — used by the FARM checkpoint's Herd
   * Impact Today section (lib/impact/herdMetrics.ts) to scale per-animal
   * figures into totals. Same value on every checkpoint of a given farm. */
  farmHerdSize: number | null;
  latestRisk: {
    thiValue: number | null;
    thiCategory: string | null;
    spoilageRisk: boolean | null;
    workerComfort: string | null;
    date: Date;
    hour: number;
  } | null;
  recommendation: {
    recommendedOffsetMinutes: number;
    exposureBefore: number;
    exposureAfter: number;
    holdsAcrossAllYears: boolean;
    /** How many years the backtest actually covers — not assumed to be 3;
     * see lib/ingestion/completeHistoricalYears.ts. */
    yearsCount: number;
  } | null;
}

/** Shared by the Dashboard's Server Component render and
 * GET /api/farms/:id/checkpoints so both stay in sync. */
export async function getCheckpointSummaries(farmId: string): Promise<CheckpointSummary[]> {
  const [checkpoints, farm] = await Promise.all([
    prisma.checkpoint.findMany({ where: { farmId } }),
    prisma.farm.findUnique({ where: { id: farmId }, select: { herdSize: true } }),
  ]);
  const farmHerdSize = farm?.herdSize ?? null;

  return Promise.all(
    checkpoints.map(async (checkpoint) => {
      const latestRisk = await prisma.computedRisk.findFirst({
        where: { checkpointId: checkpoint.id },
        orderBy: [{ date: "desc" }, { hour: "desc" }],
      });
      const recommendation =
        checkpoint.type === "STORAGE"
          ? null
          : await prisma.scheduleRecommendation.findFirst({
              where: { checkpointId: checkpoint.id },
              orderBy: { createdAt: "desc" },
            });

      return {
        id: checkpoint.id,
        farmId: checkpoint.farmId,
        type: checkpoint.type,
        name: checkpoint.name,
        latitude: checkpoint.latitude,
        longitude: checkpoint.longitude,
        schedule: checkpoint.schedule,
        farmHerdSize,
        latestRisk: latestRisk && {
          thiValue: latestRisk.thiValue,
          thiCategory: latestRisk.thiCategory,
          spoilageRisk: latestRisk.spoilageRisk,
          workerComfort: latestRisk.workerComfort,
          date: latestRisk.date,
          hour: latestRisk.hour,
        },
        recommendation: recommendation && {
          recommendedOffsetMinutes: recommendation.recommendedOffsetMinutes,
          exposureBefore: recommendation.exposureBefore,
          exposureAfter: recommendation.exposureAfter,
          holdsAcrossAllYears: Object.values(
            recommendation.yearlyBacktest as Record<string, { exposureBefore: number; exposureAfter: number }>,
          ).every((y) => y.exposureAfter < y.exposureBefore),
          yearsCount: Object.keys(recommendation.yearlyBacktest as Record<string, unknown>).length,
        },
      };
    }),
  );
}

export const CHECKPOINT_CHAIN_ORDER: CheckpointType[] = ["FARM", "TRANSPORT_ROUTE", "STORAGE"];

export function sortForChain(checkpoints: CheckpointSummary[]): CheckpointSummary[] {
  return [...checkpoints].sort(
    (a, b) => CHECKPOINT_CHAIN_ORDER.indexOf(a.type) - CHECKPOINT_CHAIN_ORDER.indexOf(b.type),
  );
}
