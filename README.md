# HerdSafe

HerdSafe advocates for the parts of the food-supply chain that can't advocate for themselves: dairy cattle in a pasture, milk in a truck, and product in a storage facility — none of which can report their own heat distress. It watches three checkpoints along a farm's chain and turns real climate data into concrete, cited operational numbers: how much heat stress the herd is under right now, whether refrigeration is being strained, and what a schedule shift is worth in dollars.

This README is the technical submission document for this project. Every value, formula, and quirk described below is either quoted directly from the codebase or pulled from a real, cached database entry — nothing here is approximated.

## Table of contents

1. [Project overview](#1-project-overview)
2. [How to run it from scratch](#2-how-to-run-it-from-scratch)
3. [System architecture](#3-system-architecture)
4. [Data model](#4-data-model)
5. [FortyGuard API integration](#5-fortyguard-api-integration)
6. [Core algorithms and formulas](#6-core-algorithms-and-formulas)
7. [Testing and validation](#7-testing-and-validation)
8. [What doesn't work yet / known limitations](#8-what-doesnt-work-yet--known-limitations)
9. [Future scope](#9-future-scope)
10. [Security and credentials](#10-security-and-credentials)
11. [Deployment](#11-deployment)
12. [AI tools disclosure](#12-ai-tools-disclosure)

---

## 1. Project overview

Heat stress quietly costs the dairy supply chain money and animal welfare at three distinct points, and none of the things actually at risk — a cow, a tanker of milk, a walk-in cooler — can tell anyone when they're in trouble. HerdSafe exists to watch on their behalf, using real climate data instead of guesswork.

A farm in HerdSafe is modeled as exactly three checkpoints, created together when a farm is added:

- **Pasture (`FARM`)** — where the herd grazes, on a fixed daily schedule (grazing start/end). HerdSafe computes the Temperature-Humidity Index (THI) here and can recommend a schedule shift to reduce severe-heat exposure.
- **Transport route (`TRANSPORT_ROUTE`)** — the road route the milk truck takes from pasture to storage, with its own departure-time schedule. HerdSafe tracks heat exposure along this leg and estimates how much cooling buffer the milk has before it crosses the federal receiving-temperature ceiling.
- **Storage facility (`STORAGE`)** — the refrigerated facility receiving the product. HerdSafe flags when ambient heat is severe enough to plausibly strain refrigeration equipment.

Each checkpoint gets real hourly temperature and humidity from the FortyGuard climate API, run through THI and food-safety formulas (cited in [Section 6](#6-core-algorithms-and-formulas)), to produce a risk reading, a worker-safety flag, and — where the data supports it — a dollar-impact estimate for the whole chain.

## 2. How to run it from scratch

### Prerequisites

- Node.js ≥ 20.9.0 (required by Next.js 16.3.2 — see `node_modules/next/package.json`'s `engines` field)
- A PostgreSQL 15+ database (a native local instance, or a hosted one like Supabase — see below)
- A FortyGuard tOS Enterprise API key

### Clone and install

```bash
git clone <this-repo-url>
cd HerdSafe
npm install
```

`npm install` automatically runs `prisma generate` via the `postinstall` script, generating the Prisma client into `lib/generated/prisma` (gitignored).

### Environment variables

Copy `.env.example` to `.env.local` and fill in real values. Variable **names** only — see `.env.example` in the repo for the exact placeholder format:

- `DATABASE_URL` — the app's runtime database connection
- `DIRECT_URL` — a direct (non-pooled) database connection, used only by the Prisma CLI
- `FORTYGUARD_API_KEY` — your FortyGuard tOS Enterprise API key
- `FORTYGUARD_BASE_URL` — optional, defaults to `https://api.fortyguard.com`

#### Database setup: local vs. Supabase

For local development, `docs/local-postgres.md` documents a native (no Docker, no root) Postgres cluster running on port 5433, so `DATABASE_URL` and `DIRECT_URL` can point at the same local instance.

For production, HerdSafe is built against **Supabase Postgres**, which requires two distinct connection strings because of how Supabase's connection pooler works:

- `DATABASE_URL` — the **pooled** connection (Supavisor/PgBouncer, transaction mode, port `6543`, with `?pgbouncer=true`). Used by the app at runtime for all normal query traffic via `@prisma/adapter-pg`.
- `DIRECT_URL` — the **direct** connection (port `5432`, no pooler). Used only by the Prisma CLI (`migrate`, `generate`, `studio`) — PgBouncer's transaction-pooling mode doesn't support the prepared statements Prisma Migrate needs.

Prisma 7 removed the `datasource.url`/`directUrl` fields from `schema.prisma` entirely; the CLI now reads connection info from `prisma.config.ts`, whose `datasource.url` resolves to `DIRECT_URL` (falling back to `DATABASE_URL`) — see the header comment in `prisma/schema.prisma` for the full explanation.

### Run migrations

```bash
npx prisma migrate deploy
```

### Seed the permanent demo farm

```bash
npm run seed
```

This runs `prisma/seed.ts`, which creates (or idempotently updates) one permanent demo farm — driven by synthetic-but-realistic climate fixtures (`lib/fixtures/syntheticClimateData.ts`), not a live FortyGuard pull, but processed through the exact same THI/optimizer/backtest/dollar-impact pipeline real ingestion uses. The seed script never deletes an existing demo farm; re-running it just brings it up to date. This is the one farm in the system with a genuine, complete 3-year historical backtest (see [Section 5](#5-fortyguard-api-integration)).

### Run the dev server

```bash
npm run dev
```

### Run the test suite

```bash
npm test
```

Other useful scripts (`package.json`): `npm run typecheck`, `npm run lint`, `npm run check-usage` (queries FortyGuard's own billing-usage endpoints).

## 3. System architecture

**Stack:** Next.js 16 (App Router, Turbopack, React 19, TypeScript), Tailwind CSS v4, Prisma 7 with the `@prisma/adapter-pg` driver adapter, PostgreSQL via Supabase, hosted on Vercel.

**How the pieces relate:**

- **Frontend** (`app/`, `components/`) — React Server/Client Components rendering the farm list, farm detail, checkpoint detail modal, add/edit farm form, and the route map (`react-leaflet` + OpenStreetMap tiles).
- **API routes** (`app/api/`) — Next.js Route Handlers that read/write Postgres via Prisma and, for farm creation/retry, kick off ingestion.
- **Database** (Postgres/Supabase, via `lib/db.ts`) — the single source of truth for farms, checkpoints, cached FortyGuard responses, and computed risk/recommendation/summary data.
- **Ingestion** (`lib/ingestion/`) — the logic that actually calls FortyGuard, computes risk, and writes to Postgres. It runs two ways:
  - **In-process, on the request path**, via Next.js's `after()` (stable since Next 15.1) — called from the farm create/update/retry API routes so ingestion continues after the HTTP response is sent, without needing a detached subprocess (which doesn't survive Vercel's serverless runtime — see [Section 8](#8-what-doesnt-work-yet--known-limitations)).
  - **As standalone CLI scripts** (`scripts/ingest-historical.ts`, `scripts/ingest-current.ts`, `scripts/recompute-recommendation.ts`, `scripts/measure-api-costs.ts`, `scripts/check-usage.ts`), for manual/ops use outside the web request flow.

**Folder structure:**

| Path | Purpose |
|---|---|
| `app/` | Next.js App Router — pages under `app/farms/`, API route handlers under `app/api/` |
| `components/` | React components (farm list/cards, checkpoint detail modal, forms, maps, risk charts) |
| `lib/exposure/` | Schedule window math, exposure counting, the schedule optimizer, multi-year backtesting |
| `lib/farms/` | Farm-form validation and the 3-checkpoint construction logic |
| `lib/fixtures/` | Synthetic climate data generation for the demo farm seed |
| `lib/fortyguard/` | The FortyGuard API client, GeoJSON helpers, error types — the only code that calls FortyGuard |
| `lib/generated/` | Generated Prisma client (gitignored, rebuilt by `postinstall`) |
| `lib/hooks/` | Shared React hooks (e.g. map-tile error fallback) |
| `lib/impact/` | Herd/transit/storage impact metrics and the combined dollar-impact estimate |
| `lib/ingestion/` | Climate-pulling, caching, and per-checkpoint ingestion orchestration |
| `lib/risk/` | THI, spoilage risk, and worker-comfort calculations |
| `lib/routing/` | OSRM road-route fetching for the transport map |
| `data/` | Static seed data (`checkpoints.seed.json`) for the demo farm |
| `docs/` | Setup documentation (e.g. local Postgres) |
| `prisma/` | `schema.prisma`, migrations, and the demo-farm seed script |
| `public/` | Static assets |
| `scripts/` | Standalone CLI entry points for ingestion, cost measurement, and usage checks |
| `__tests__/` | Vitest unit tests |

## 4. Data model

The schema (`prisma/schema.prisma`) has 7 models:

| Model | Purpose |
|---|---|
| `Farm` | Top-level entity: name, ingestion lifecycle (`status`/`statusStage`/`statusError`/`statusErrorCategory`), `isDemoSeed` (protects the permanent demo farm from deletion), `hidden`, optional `herdSize`, and its 3 checkpoints |
| `Checkpoint` | One of the three physical points in the chain — `type` (`FARM`/`TRANSPORT_ROUTE`/`STORAGE`), coordinates, optional AOI polygon (`polygonGeoJson`), optional route waypoints, its own `schedule` (JSON), and a 30-day `ambientHeatFrequency` signal (JSON) |
| `HeatmapCache` | Raw cached response from a FortyGuard `/v1/heatmap` call, keyed by checkpoint + analytic type + date range + filter type + granularity + threshold + direction — cache-first, so the same request is never re-billed |
| `EnvParamsCache` | Raw cached response from a FortyGuard `/v1/env_params` call, keyed by checkpoint + date + temperature anchor |
| `ComputedRisk` | One hour's derived risk numbers for a checkpoint — temperature, humidity, THI value/category, spoilage risk, AQI, worker comfort — unique per (checkpoint, date, hour) |
| `ScheduleRecommendation` | The optimizer's output for a checkpoint — recommended offset in minutes, exposure before/after, and a per-year backtest (JSON) |
| `ChainSummary` | One farm-level rollup — total dollar impact, milk-yield and spoilage sub-estimates (each with an "available" flag distinguishing "not computed" from a genuine $0), and chain-conflict detection |

**Farm → Checkpoint relationship:** every `Farm` has exactly 3 `Checkpoint` rows, created together by `buildCheckpointsData()` (`lib/farms/createFarm.ts`) when a farm is added:

- `FARM` — the pasture's own coordinate, with a 300m-buffer AOI polygon for climate pulls, schedule = `{ start, end }` (grazing hours).
- `TRANSPORT_ROUTE` — coordinate defaults to the arithmetic midpoint between pasture and storage (the demo farm overrides this with a real road-route midpoint), `routeWaypoints` = `[pasture, midpoint, storage]`, schedule = `{ departureTime }`.
- `STORAGE` — the storage facility's own coordinate, no AOI polygon, empty schedule (spoilage risk is reactive-only, not schedule-driven).

## 5. FortyGuard API integration

### Endpoints used

All calls go through `lib/fortyguard/client.ts` — the only file in the codebase permitted to call `api.fortyguard.com`. Every analysis endpoint follows the same **submit-then-poll** pattern:

```
POST /v1/<endpoint>            -> { data: { activity_id } }
GET  /v1/status/{activity_id}  -> poll until status is terminal
```

- **`POST /v1/heatmap`** (`createHeatmap()`) — a thermal map over a polygon AOI. `analyticType` defaults to `tcm` (raw per-tile snapshot temperature); `time_of_measure`, `exceedance`, and `persistence` are also used. HerdSafe uses this for:
  - Real hourly per-tile temperature (`tcm`, `filterType: 1`, one call per hour) — the real per-hour temperature input to THI.
  - The 30-day ambient-heat-frequency signal (`persistence`, `filterType: 4`, date range) — longest unbroken streak above the strain threshold.
  - (Gated) multi-year historical pulls for the schedule optimizer/backtest.
- **`POST /v1/env_params`** (`environmentalParameters()`) — thermal-comfort, air-quality, and solar metrics for a point. HerdSafe uses this once per day per checkpoint for real hourly `relative_humidity_percent` and `air_quality:idx` (AQI).
- **`POST /v1/system/fetch-api-key-usage`** / **`POST /v1/system/fetch-api-key-custom-usage`** (`fetchApiKeyUsage()` / `fetchApiKeyCustomUsage()`) — billing-usage summaries, used by `scripts/check-usage.ts`.

### The client's submit→poll implementation

`FortyGuardClient.submitAndWait()` calls `submit()` to get an `activity_id`, then `waitFor()` polls `getStatus()` on an interval until the status is terminal:

- Status strings are matched case-insensitively; `"succeeded"`/`"completed"` both mean done, `"failed"`/`"error"` both mean failed.
- A 404 from the status endpoint right after submit is treated as eventual-consistency lag (`ActivityNotReadyError`), not a failure — polling continues up to the overall deadline instead of throwing immediately.
- Bounded polling with a generous default timeout (30 minutes), since heat-intelligence jobs can take several minutes.
- Network-level failures (DNS, connection refused/reset, our own abort-on-timeout) are wrapped as `FortyGuardUnavailableError`; non-2xx HTTP responses are wrapped as `FortyGuardHttpError` — kept distinct so the ingestion pipeline can classify a failure as retryable ("network"/"api") vs. not ("application").

### One real request and response pair

Pulled directly from the live database (`HeatmapCache`/`EnvParamsCache`), for the demo farm's storage checkpoint (44.402°N, −72.311°W):

**Heatmap request** (`tcm`, single hour): a square AOI around the point, `filter_type: 1`, `granularity: 100`.

**Response** (`HeatmapCache`, `startDate: 2026-08-28T15:00:00.000Z`):

```json
{
  "stats_data": {
    "temperature_stats": {
      "mean": 20.995544395116536,
      "maximum": 21.8912,
      "minimum": 19.9269,
      "standard_deviation": 0.5911946855912424
    }
  },
  "map_data": {
    "features": [
      {
        "id": "0",
        "type": "Feature",
        "geometry": {
          "type": "Polygon",
          "coordinates": [[
            [-72.32929872764309, 44.38887305585823],
            [-72.32803765410009, 44.38884354203895],
            [-72.3279969667352, 44.38973722378254],
            [-72.32925805942556, 44.38976673851654],
            [-72.32929872764309, 44.38887305585823]
          ]]
        },
        "properties": {
          "tile_id": 0,
          "max_temperature": 21.6894,
          "min_temperature": 21.6894,
          "average_temperature": 21.6894
        }
      }
      /* … 900 more features */
    ]
  }
}
```

Note the tile's `properties` carry `average_temperature`, not a plain `temperature` field — one of the quirks below.

**env_params response** for the same checkpoint/day (`EnvParamsCache`, `date: 2026-08-28`, `temperatureAnchor: 25`):

```json
{
  "metadata": {
    "timezone": "GMT-5",
    "time_range": { "start": "2026-08-28T00:00:00-05:00", "end": "2026-08-28T23:00:00-05:00", "count": 24, "interval": "1h" }
  },
  "locations": [{
    "parameters": {
      "relative_humidity_percent": [98.4, 99, 99.3, 99.6, 99, /* …19 more */],
      "heat_index_celsius": [ /* derived from the fixed anchor, not trusted */ ],
      "apparent_temperature_celsius": [ /* derived, not trusted */ ],
      "wet_bulb_temperature_celsius": [ /* derived, not trusted */ ],
      "air_quality:idx": [ /* … */ ]
      /* co2_ppm, methane_ppb, precipitation_mm, cloud_cover_octas, several air_quality_*:idx fields */
    }
  }]
}
```

Notably, this response has **no plain hourly temperature field at all** — only derived fields computed from the single `temperature: 25` anchor passed in the request, plus real per-hour `relative_humidity_percent` and `air_quality:idx`.

### Real quirks and gotchas discovered, and how they're handled

- **GeoJSON coordinate order is `[lon, lat]`** — the opposite of the lat/lon convention used everywhere else in this codebase. `buildPointBufferPolygon()` (`lib/fortyguard/geo.ts`) builds every AOI polygon with an explicit comment flagging this, and `polygonCentroid()` destructures rings as `[lon, lat]` to match.
- **env_params `temperature` is a fixed anchor, not real hourly data.** The request requires a single `temperature` value; the response's `heat_index_celsius`/`apparent_temperature_celsius`/`wet_bulb_temperature_celsius` are derived from that one fixed anchor applied across the whole series, so they are not physically meaningful hour-by-hour. Only `relative_humidity_percent` (and `air_quality:idx`) genuinely vary per hour. **This is why THI is computed from a real `tcm` heatmap temperature paired with real env_params humidity — never from FortyGuard's own derived heat-index/wet-bulb fields.** (`calculateTHI`'s doc comment in `lib/risk/thi.ts` states this explicitly; `climatePull.ts`'s header comment documents the two-step workaround.)
- **`average_temperature` vs. `temperature` field inconsistency.** A live `filter_type=1` (single-hour) `tcm` call can return tiles with `average_temperature`/`min_temperature`/`max_temperature` instead of the plain `temperature` field some FortyGuard documentation describes for that filter type — confirmed against a real request during this build (see the response above). `tryAverageTcmTemperature()` (`lib/ingestion/climatePull.ts`) checks `temperature` first and falls back to `average_temperature`, so a single-hour pull never silently comes back empty.
- **Zero-tile responses are real and billed, not failures.** A `tcm` or `persistence` call can return `Completed` with zero usable tiles — this still costs credits, and is grid-alignment-dependent per location (confirmed at two different real locations), not a fixed buffer-size problem. `fetchHourlyTemperatureC()` escalates the AOI buffer through `CLIMATE_POINT_BUFFER_METERS` (1500m) then `CLIMATE_POINT_BUFFER_ESCALATION_METERS` (3000m) before giving up — deliberately short (1 default try + 1 escalation) since each attempt is separately billed. A zero-tile response is never cached, so a future retry (even after a code fix) isn't permanently locked into replaying the failure.
- **Recency vs. buffer-size are two distinct failure modes.** For "current conditions" (reactive) pulls, a zero-tile response can also mean the requested hour is too recent for FortyGuard's data to have processed yet — a buffer-size fix doesn't help here. `fetchHourlyTemperatureWithRecencyFallback()` retries at progressively earlier hours (up to `RECENCY_FALLBACK_MAX_HOURS_BACK`, 3 hours back) instead, since a slightly-stale real reading is more honest and far cheaper than pulling a larger area.
- **Flat per-call credit pricing, confirmed empirically.** `scripts/measure-api-costs.ts` made real calls varying `filter_type`, `analytic_type`, `granularity`, and AOI size, and found the credit cost is flat regardless of any of those parameters: **~4,220 credits per heatmap call** and **~2,900 credits per env_params call**, every time. This finding directly drove the credit-safety strategy below.

### Current credit-usage strategy

Given flat per-call pricing, a naive design (pull 12+ hours of forecast, plus multi-year historical, for every new farm) would burn credits far faster than useful. The current strategy:

- **New farms get a reactive-only 1-hour default window** (`REACTIVE_FORECAST_HOURS = 1` in `lib/constants.ts`, reduced from an original 12-hour design after measuring the cost: ~21,360 credits/farm at 1 hour vs. ~151,920 credits/farm at 12 hours). `ingestCurrentCheckpoint()` (`lib/ingestion/currentIngest.ts`) is the *only* ingestion path reachable from the live Add-Farm/Edit-Farm flow — it computes THI/spoilage/worker-comfort for the current hour and, for `FARM`/`TRANSPORT_ROUTE` checkpoints, one additional cheap `persistence` call (a single flat-rate heatmap call) for a real 30-day ambient-heat-frequency signal.
- **Full multi-year historical backtesting is fully gated behind an explicit environment flag.** `ingestHistoricalCheckpoint()` (`lib/ingestion/historicalIngest.ts`) refuses to run unless `ALLOW_HISTORICAL_INGESTION=true` is set — a full pull for one checkpoint (one `tcm` heatmap call per hour, for a full sample week, across `HISTORICAL_YEARS`) costs roughly 2.1M credits, more than the hackathon key's entire budget. It's still real, working code — reachable only via the standalone `scripts/ingest-historical.ts` CLI, never from the web app — for anyone deliberately choosing to spend the credits on one checkpoint.
- **The one exception:** during earlier development (before this project's database was migrated to Supabase), one real farm was given a partial, honestly-scoped historical backtest, built by running the gated historical path manually and letting `scripts/recompute-recommendation.ts` compute a schedule recommendation from whatever complete year(s) were actually cached — before the `ALLOW_HISTORICAL_INGESTION` gate existed. That farm's data lived in a local Postgres database used during development and is not present in the current production Supabase database — every real (non-demo) farm currently live has reactive-only data. The mechanism behind it is real, current, and verifiable: `computeAndStoreChainSummary()` (`lib/impact/computeChainSummary.ts`) calls `getCompleteHistoricalYears()` per checkpoint and only ever reports the years a checkpoint actually has complete cached data for — a checkpoint with a partial or absent historical pull correctly reports 0 or a reduced year-count, not a fabricated full backtest.

The permanent demo farm ("Heavenly Dairy") is the one place with a genuine, complete 3-year backtest today — but that comes entirely from `prisma/seed.ts`'s synthetic fixture generator, run through the real pipeline, not a live FortyGuard pull (see [Section 2](#2-how-to-run-it-from-scratch)).

## 6. Core algorithms and formulas

### Temperature-Humidity Index (THI) and category thresholds

`lib/risk/thi.ts`:

```
THI = (1.8·T + 32) − (0.55 − 0.0055·RH) · (1.8·T − 26)
```

where `T` is air temperature in °C and `RH` is relative humidity (0–100). Categorized per **Armstrong 1994** (`categorizeTHI()`, thresholds in `THI_BANDS`, `lib/constants.ts`):

| Category | Range |
|---|---|
| Comfort | THI < 72 |
| Mild | 72 ≤ THI < 80 |
| Moderate | 80 ≤ THI < 90 |
| Severe | THI ≥ 90 |

### Spoilage risk / refrigeration-strain proxy

`lib/risk/spoilage.ts` — `calculateSpoilageRisk()` counts hours at or above a ceiling temperature (boundary inclusive: exactly at the ceiling counts as at-risk). Two distinct ceilings exist in `lib/constants.ts`:

- `SPOILAGE_TEMP_CEILING_C = 4` — the FDA Grade "A" Pasteurized Milk Ordinance (PMO) standard: raw milk must cool to 45°F/7°C within 2 hours and be maintained at ≤ 45°F (used here as 4°C/40°F, the stricter storage target).
- `AMBIENT_HEAT_STRAIN_THRESHOLD_C = 35` — what ingestion actually uses for the live storage-checkpoint flag, since FortyGuard only exposes outdoor **ambient** conditions, never a facility's actual internal refrigeration reading. The result is honestly reframed: `atRisk` means "ambient heat elevated enough to plausibly strain refrigeration equipment and raise outage risk," not "the product is confirmed to be at this temperature" — see the doc comment on both the function and the constant.

### Worker comfort flag

`lib/risk/workerComfort.ts` — combines THI category with EPA AQI bands (`AQI_BANDS`, `lib/constants.ts`), rows checked top-down (top row wins):

```
AQI > 150         OR heat severe    -> intolerable
AQI 101–150       OR heat moderate  -> bad
AQI 51–100        AND heat mild     -> suitable
otherwise                           -> good
```

### Schedule optimizer

`lib/exposure/optimizer.ts` — `optimizeSchedule()` brute-force sweeps the current schedule window by ±`OPTIMIZER.SWEEP_RANGE_MINUTES` (90 minutes) in `OPTIMIZER.STEP_MINUTES` (15-minute) increments, computing `computeExposure()` (hours where THI ≥ threshold, default the mild threshold of 72, that overlap the window) at each offset. Ties prefer the smallest shift; among equal-magnitude ties, the earlier (more negative) offset wins.

### Multi-year historical backtest logic

`lib/exposure/backtest.ts` — `backtestAcrossYears()` re-runs `computeExposure()` for the optimizer's winning offset against each cached historical year independently, reporting `exposureBefore`/`exposureAfter` per year and `holdsAcrossAllYears` (true only if every single year improved).

### Ambient heat frequency / historical-analog signal

Two related but distinct things:

- **Ambient heat frequency** (`lib/ingestion/ambientHeatFrequency.ts`) — one real `persistence` heatmap call (`filterType: 4`, 30-day date range, `AMBIENT_HEAT_FREQUENCY_WINDOW_DAYS`) reporting the longest unbroken streak of hours above the strain threshold, read directly from the API's own `stats_data.max` aggregate. Deliberately persistence-only (a companion `exceedance` call was originally paired with it but dropped to halve the feature's cost) and never blended into THI, the optimizer, or the dollar-impact estimate.
- **Historical-analog profile** (`historicalAnalogProfile()`, `lib/exposure/backtest.ts`) — averages hourly THI across the cached historical years (with min/max spread), explicitly *not* a forecast, surfaced only where historical data actually exists.

### Herd impact metrics

`lib/impact/herdMetrics.ts` — none of these call FortyGuard; all reuse temperature/THI already cached from the reactive pull:

- **Water demand:** `max(0, T_F − 40) / 10 × 1` additional gallons/head (OSU Extension, Paul Beck: +1 gallon per 10°F above a 40°F baseline).
- **Feed intake reduction:** `max(0, THI − 72) × 0.29` kg/day/head (North America meta-analysis, *International Journal of Biometeorology* 2021, DOI 10.1007/s00484-021-02167-0).
- **Shade requirement:** flat 40 sq ft/head (Cornell Cooperative Extension, SWNY Dairy).
- **Respiration rate:** resting 38 bpm below a THI breakpoint of 77; above it, `38 + 2.04 × (THI − 77)` bpm (Mississippi State Extension + *Frontiers in Animal Science* 2021).

### Transit impact metrics

`lib/impact/transitMetrics.ts`:

- **Milk cooling buffer:** estimates hours remaining before in-transit milk (assumed loaded at the 4°C storage ceiling) warms past the PMO **transport-receiving** ceiling of 45°F/7.2°C (`PMO_TRANSPORT_RECEIVING_CEILING_C`), under an explicitly-labeled illustrative linear heat-gain assumption (`TRANSIT_HEAT_GAIN_RATE_COEFFICIENT_PER_F = 0.05`°F gained per °F of ambient-to-milk differential, per hour). Returns `Infinity` when ambient is at or below the milk's starting temperature.
- **Federal Twenty-Eight Hour Law context:** `TWENTY_EIGHT_HOUR_LAW_LIMIT_HOURS = 28`, `TWENTY_EIGHT_HOUR_LAW_REST_HOURS = 5` (49 U.S.C. § 80502; cited alongside GAO-26-108123's finding on enforcement gaps in the underlying research this app's constants file documents).

### Refrigeration energy cost estimate

`lib/impact/storageEnergyMetrics.ts` — `estimateAdditionalCoolingCostUsd()`:

```
extra_kWh = max(0, T_ambient − 35) × REFRIGERATION_EXTRA_KWH_PER_DEGREE_C_ABOVE_STRAIN (3, illustrative)
cost      = extra_kWh × REFRIGERATION_ELECTRICITY_RATE_USD_PER_KWH (0.1351, EIA commercial rate, April 2026)
```

The electricity rate is a real, sourced figure (EIA); the per-degree kWh coefficient is explicitly labeled in `lib/constants.ts` as an illustrative approximation, not an independently sourced figure — see [Section 8](#8-what-doesnt-work-yet--known-limitations).

### Combined dollar-impact estimate

`lib/impact/dollarEstimate.ts`:

```
milkYieldLossEstimate = severeThiCowHoursAvoided × herdSize × 0.71 L/severe-THI-cow-hour × $0.43/L
spoilageRiskEstimate  = spoilageEventsAvoided × $9,000/event
totalDollarImpact     = milkYieldLossEstimate + spoilageRiskEstimate
```

(`DOLLAR_IMPACT` in `lib/constants.ts`: USDA-ERS/AMS 2026 milk price; yield-loss rate derived from West 2003 / Zimbelman 2009 / St-Pierre 2003; spoilage event cost derived from a 5,500-gallon tanker load basis.)

`computeAndStoreChainSummary()` (`lib/impact/computeChainSummary.ts`) makes the honesty distinction explicit: `milkYieldEstimateAvailable` is only `true` if the pasture checkpoint has a real `ScheduleRecommendation` (i.e. historical data was actually pulled); `spoilageEstimateAvailable` requires at least `SPOILAGE_ESTIMATE_MIN_OBSERVED_HOURS` (6) hours of observed storage data. A reactive-only new farm correctly shows **"not available," not "$0"** — the UI is told to distinguish "we haven't computed this" from "we computed a genuine zero."

## 7. Testing and validation

**Unit tests:** 8 test files, 40 tests, all passing (`npm test`, Vitest):

- `thi.test.ts`, `spoilage.test.ts`, `workerComfort.test.ts` — the core risk formulas
- `optimizer.test.ts`, `backtest.test.ts` — the schedule optimizer and multi-year backtest
- `herdMetrics.test.ts`, `transitMetrics.test.ts`, `storageEnergyMetrics.test.ts` — the impact metrics

**Real API validation beyond unit tests:**

- `scripts/measure-api-costs.ts` made real, billed calls against FortyGuard varying `filter_type`, `analytic_type`, `granularity`, and AOI size, confirming the flat per-call pricing described in [Section 5](#5-fortyguard-api-integration).
- The `average_temperature`/`temperature` field inconsistency, the env_params anchor artifact, and the zero-tile/grid-alignment behavior were all discovered against real live FortyGuard responses during development, not from documentation.
- End-to-end farm creation was verified against production Supabase via a real `next start` production server, confirming correct staged progression (pasture → transport → storage) and correct error classification (a genuine FortyGuard 402 "Insufficient credits" response was caught and categorized as `"api"`, surfacing a retryable error to the user rather than a generic failure).
- A real production build (`npm run build`) caught a static-prerendering bug (farm list baked in at build time) and a client-bundle secret-leak (verified by grepping the actual built `.next/static` chunks for FortyGuard credential references before and after the fix).

## 8. What doesn't work yet / known limitations

- **Binary barn/shelter model.** HerdSafe has no concept of partial shade coverage, ventilation quality, or misting systems — a farm either has the described pasture/storage setup or it doesn't. Real herd heat mitigation infrastructure varies continuously; this app doesn't model that variation.
- **Multi-year historical backtesting is unavailable by default.** As detailed in [Section 5](#5-fortyguard-api-integration), it's gated behind `ALLOW_HISTORICAL_INGESTION=true` because a full pull costs ~2.1M credits per checkpoint — empirically measured, not estimated (`scripts/measure-api-costs.ts`). Every real farm in the current production database has reactive-only (1-hour) data as a direct consequence; only the synthetic demo farm has a full 3-year backtest.
- **Ambient vs. actual refrigeration temperature.** The storage-checkpoint "spoilage risk" flag is driven entirely by outdoor ambient temperature (FortyGuard has no visibility into a facility's internal refrigeration reading) — it is a refrigeration-strain/outage-risk proxy, not a measurement of the product's actual temperature. This reframing is deliberate and documented in the code (`lib/risk/spoilage.ts`), but it means the flag can be wrong in either direction relative to what's actually happening inside a well- or poorly-maintained unit.
- **The refrigeration energy coefficient is illustrative, not independently sourced.** `REFRIGERATION_EXTRA_KWH_PER_DEGREE_C_ABOVE_STRAIN` (3 kWh/°C) is explicitly labeled in `lib/constants.ts` as an approximation for the purpose of producing a directionally-useful dollar figure — unlike the EIA electricity rate it's multiplied by, it isn't backed by a published source.
- **The schedule optimizer can genuinely find nothing to improve.** For a schedule already centered on peak heat with little slack (e.g. the demo farm's tuned schedule), a ±90-minute sweep can find no offset that reduces exposure — this shows up as `milkYieldLossEstimate = $0` for that specific schedule/curve combination, which is a correct result (a schedule already avoiding severe stress has nothing severe left to avoid), not a bug, but it can look surprising in the UI without this context.
- **Historical-analog and ambient-heat-frequency signals are not forecasts.** Both are explicitly persistence/average-based estimates from past data, and both are kept structurally separate from the live THI reading and the dollar-impact estimate specifically so they can never be mistaken for a live prediction.
- **No live GPS/logistics tracking.** "Time since departure" for the transport checkpoint is inferred purely from the scheduled departure time, not any real telemetry — a truck running early or late isn't reflected.

## 9. Future scope

- **Ward/hospital-level or other human-facing extensions.** The same reactive-heat-monitoring + honest-availability-flagging pattern built here for livestock and product was considered for extension to settings where heat-vulnerable people or equipment also can't self-report (e.g. eldercare facilities, hospital cold-chain storage) — not built in this submission, but the checkpoint/risk/dollar-impact architecture doesn't assume "cattle" anywhere structural.
- **Expansion beyond dairy** to other livestock (poultry, swine) and other perishable food categories, each with their own THI-equivalent thresholds and food-safety ceilings in place of the current Armstrong/PMO constants.
- **Full historical backtesting as a paid/opt-in tier.** Given the real, measured ~2.1M-credit cost per checkpoint, the most viable path to making multi-year backtesting available to real farms (not just the synthetic demo) is an explicit, priced opt-in — the `ALLOW_HISTORICAL_INGESTION` gate and `scripts/ingest-historical.ts` are already the mechanical foundation for that; what's missing is billing/authorization around it.

## 10. Security and credentials

- All secrets (`DATABASE_URL`, `DIRECT_URL`, `FORTYGUARD_API_KEY`, `FORTYGUARD_BASE_URL`) are read exclusively from environment variables (`process.env`) — none are hardcoded anywhere in the codebase.
- `.env.local` is gitignored; only `.env.example` (placeholder values, no real credentials) is committed.
- `FORTYGUARD_API_KEY`/`FORTYGUARD_BASE_URL` are deliberately **not** defined in `lib/constants.ts` (which is imported by client components) — they live only in `lib/fortyguard/client.ts`, the sole server-only file that ever calls FortyGuard. This was verified directly: a real production build's `.next/static` client chunks were grepped for both the literal API key value and the variable names, confirming neither ships to the browser bundle.
- Prisma's generated client (`lib/generated/prisma`) is gitignored and regenerated on every install via the `postinstall` script, so no database schema/credential artifacts are committed either.

## 11. Deployment

- **Hosting:** Vercel (linked directly to this GitHub repository) for the Next.js app; Supabase for PostgreSQL.
- **Database:** the pooled Supabase connection (`DATABASE_URL`, port 6543) is used by the deployed app for all runtime queries via `@prisma/adapter-pg`; the direct connection (`DIRECT_URL`, port 5432) is used only when running `prisma migrate deploy` from a CLI environment (developer machine or CI), never at runtime.
- **Environment configuration:** all four environment variables (`DATABASE_URL`, `DIRECT_URL`, `FORTYGUARD_API_KEY`, `FORTYGUARD_BASE_URL`) are configured directly in the Vercel project's environment settings — never committed to the repo.
- **Ingestion on serverless:** farm creation/edit/retry trigger ingestion via Next.js's `after()` API so the work runs in-process after the HTTP response is sent, compatible with Vercel's ephemeral, read-only serverless filesystem (an earlier detached-subprocess design was replaced after failing in production with `ENOENT` — see the `runFarmPipeline.ts` history). Routes that trigger ingestion set `export const maxDuration = 300` to allow enough execution time.
- **Dynamic rendering:** the farm list route is explicitly marked `export const dynamic = "force-dynamic"` so newly created farms appear without requiring a redeploy (a real production build caught this defaulting to static prerendering otherwise).

## 12. AI tools disclosure

- **Claude** — used for ideation, research and verification of the scientific and regulatory sources cited throughout this app (Armstrong 1994 THI bands, FDA PMO standards, OSU Extension water-demand figures, the North America DMI-reduction meta-analysis, Cornell Cooperative Extension shade guidance, Mississippi State/​*Frontiers in Animal Science* respiration data, 49 U.S.C. § 80502 and the related GAO finding, EIA electricity rates), and for writing technical specifications.
- **Claude Code** — used for the full application build: implementation, debugging, and diagnosing real production issues (including the serverless ingestion failure, the stale-deployment/tile-rendering issue, and the client-bundle credential-leak check described above).
- **Google Gemini** — used for one exploratory UI/UX design pass, and for generating the thumbnail image used in the demo video.
