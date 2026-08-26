-- CreateEnum
CREATE TYPE "CheckpointType" AS ENUM ('FARM', 'TRANSPORT_ROUTE', 'STORAGE');

-- CreateTable
CREATE TABLE "farms" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "statusStage" TEXT,
    "statusError" TEXT,
    "isDemoSeed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "farms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkpoints" (
    "id" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "type" "CheckpointType" NOT NULL,
    "name" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "polygonGeoJson" JSONB,
    "routeWaypoints" JSONB,
    "schedule" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "heatmap_cache" (
    "id" TEXT NOT NULL,
    "checkpointId" TEXT NOT NULL,
    "analyticType" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "filterType" INTEGER NOT NULL,
    "granularity" INTEGER NOT NULL,
    "threshold" DOUBLE PRECISION,
    "direction" TEXT,
    "rawResponse" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "heatmap_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "env_params_cache" (
    "id" TEXT NOT NULL,
    "checkpointId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "temperatureAnchor" DOUBLE PRECISION NOT NULL,
    "rawResponse" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "env_params_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "computed_risk" (
    "id" TEXT NOT NULL,
    "checkpointId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "hour" INTEGER NOT NULL,
    "temperatureC" DOUBLE PRECISION NOT NULL,
    "humidityPct" DOUBLE PRECISION NOT NULL,
    "thiValue" DOUBLE PRECISION,
    "thiCategory" TEXT,
    "spoilageRisk" BOOLEAN,
    "aqi" DOUBLE PRECISION,
    "workerComfort" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "computed_risk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_recommendations" (
    "id" TEXT NOT NULL,
    "checkpointId" TEXT NOT NULL,
    "currentScheduleStart" TEXT NOT NULL,
    "recommendedOffsetMinutes" INTEGER NOT NULL,
    "exposureBefore" DOUBLE PRECISION NOT NULL,
    "exposureAfter" DOUBLE PRECISION NOT NULL,
    "yearlyBacktest" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schedule_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chain_summary" (
    "id" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalDollarImpact" DOUBLE PRECISION NOT NULL,
    "milkYieldLossEstimate" DOUBLE PRECISION NOT NULL,
    "spoilageRiskEstimate" DOUBLE PRECISION NOT NULL,
    "conflictDetected" BOOLEAN NOT NULL,
    "conflictDetails" JSONB,

    CONSTRAINT "chain_summary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "heatmap_cache_checkpointId_analyticType_startDate_endDate_f_key" ON "heatmap_cache"("checkpointId", "analyticType", "startDate", "endDate", "filterType", "granularity", "threshold", "direction");

-- CreateIndex
CREATE UNIQUE INDEX "env_params_cache_checkpointId_date_temperatureAnchor_key" ON "env_params_cache"("checkpointId", "date", "temperatureAnchor");

-- CreateIndex
CREATE UNIQUE INDEX "computed_risk_checkpointId_date_hour_key" ON "computed_risk"("checkpointId", "date", "hour");

-- CreateIndex
CREATE UNIQUE INDEX "chain_summary_farmId_key" ON "chain_summary"("farmId");

-- AddForeignKey
ALTER TABLE "checkpoints" ADD CONSTRAINT "checkpoints_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "farms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "heatmap_cache" ADD CONSTRAINT "heatmap_cache_checkpointId_fkey" FOREIGN KEY ("checkpointId") REFERENCES "checkpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "env_params_cache" ADD CONSTRAINT "env_params_cache_checkpointId_fkey" FOREIGN KEY ("checkpointId") REFERENCES "checkpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "computed_risk" ADD CONSTRAINT "computed_risk_checkpointId_fkey" FOREIGN KEY ("checkpointId") REFERENCES "checkpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_recommendations" ADD CONSTRAINT "schedule_recommendations_checkpointId_fkey" FOREIGN KEY ("checkpointId") REFERENCES "checkpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chain_summary" ADD CONSTRAINT "chain_summary_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "farms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
