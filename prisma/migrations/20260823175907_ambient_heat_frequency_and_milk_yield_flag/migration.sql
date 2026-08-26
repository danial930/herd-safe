-- AlterTable
ALTER TABLE "chain_summary" ADD COLUMN     "milkYieldEstimateAvailable" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "checkpoints" ADD COLUMN     "ambientHeatFrequency" JSONB;
