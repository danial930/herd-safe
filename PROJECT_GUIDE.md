# HerdSafe — Complete Implementation Guide

> **STATUS: This is a follow-up pass, not a from-scratch build.** The project has
> already been built end-to-end against an earlier version of this guide (all 6
> screens working, tests passing, real API calls verified). This updated version
> adds: (1) finalized real seed data in Section 0.5, (2) a corrected spoilage
> threshold and framing in Section 8, (3) a real anchor value for
> `SPOILAGE_EVENT_COST_USD`. See the prompt accompanying this file for exactly
> what to do with it — do not rebuild what's already working.

> **Instructions for Claude Code (original build — for reference):** This file is the complete specification for this project.
> 1. First, review `https://github.com/FortyGuard-Tech/temperature-api-quickstart` — it is FortyGuard's official starter kit (Python-based). Read its `fortyguard/client.py` and `notebooks/00_setup.ipynb`–`02_environmental_parameters.ipynb` to understand the exact submit-then-poll request/response shapes and known quirks. **Do not use the Python client directly** — this project is Next.js/TypeScript. Port the same patterns (submit → poll → retry/timeout handling → cache) into a TypeScript client.
> 2. Then, **initialize and build this entire project in the same folder this file is placed in.** Scaffold the full Next.js app, Prisma schema, scripts, computation logic, tests, and frontend — in one complete pass. We will fine-tune and debug in later phases; the goal now is a complete, working, well-structured first version.
> 3. Follow every standard and precaution in this document without exception — they exist because of real constraints discovered while researching this API, not stylistic preference.

---

## 0. Project Name & Logo

**Name: HerdSafe** — chosen to reinforce the pitch thesis (advocating for those who can't advocate for themselves), not just describe the product mechanically.

**Logo spec (build with `lucide-react`, no custom illustration — keep this to ~15-20 minutes):**
- **Icon:** a `Shield` icon (from `lucide-react`) with a small `Thermometer` or animal-silhouette accent inside/beside it — reads as "protection from heat" at a glance. If a combined icon is fiddly, `Shield` alone is a perfectly good fallback — simpler is fine given the timeline.
- **Lockup:** icon + wordmark "HerdSafe" in a bold sans-serif (Tailwind's default `font-sans`), icon sized ~1.2× the text height, positioned left of the text.
- **Color:** pull from the app's existing THI risk-severity palette — use the "comfort" green or a trustworthy blue as the primary logo color, so the brand mark itself visually reinforces "safety."
- **Sizes needed:** 32×32 favicon (`app/icon.png` in Next.js App Router — auto-generates the right meta tags), and the header lockup at ~32–40px tall in the top nav bar (per Section 4's navigation spec).
- **Format:** SVG for the header logo, PNG export for the favicon.

Use "HerdSafe" consistently as the app name in the nav bar, page titles, README, and submission form.

---

## 0.5 Real-World Seed Data (Finalized)

**Farm — "Heavenly Dairy Farm"**
- Coordinates: `30.01050403375586, -95.91469892692805`
- Grazing schedule: `10:00–16:00` (deliberately spans peak heat hours so the optimizer has a genuine, demonstrable exposure reduction to recommend — a schedule that's already safe wouldn't produce a compelling demo)

**Storage — "Heavenly Dairy Storage"**
- Coordinates: `29.739566881150356, -95.34750925813294`
- No schedule needed — monitored continuously (current + 12hr forecast only, no optimizer, per Section 8)

**Transport route waypoints (farm → midpoint → storage):**
```json
[
  { "lat": 30.01050403375586, "lon": -95.91469892692805 },
  { "lat": 29.895795605850818, "lon": -95.59280234688606 },
  { "lat": 29.739566881150356, "lon": -95.34750925813294 }
]
```
- Transport departure: `13:00` (same reasoning as the grazing window — placed inside peak heat so the shift optimizer has real signal to act on)

**Milk price constant:** ~$0.43/liter (USDA-ERS/AMS, 2026 all-milk farm price ~$18.95/cwt — cite source and year in code comment).

**Spoilage threshold:** federal Grade "A" PMO standard — 45°F (7°C) or below within 2 hours of milking; applies at farm, transport, and processing receiving dock. See Section 8.

**THI thresholds:** Armstrong 1994 — comfort <72, mild 72–79, moderate 80–89, severe >90. See Section 8.

This is the data for the **permanent demo-seed Farm** (`isDemoSeed: true`, Section 4) — run through the synthetic-fixture pipeline (`lib/fixtures/syntheticClimateData.ts`) first per the earlier decision, with a real historical pull substituted later if time allows.

---

## 1. The Idea, in One Paragraph

Heat is only dangerous when it overlaps with something that can't protect itself and can't say so in time. We apply that principle across three linked checkpoints in a real dairy supply chain: **(1) a farm/pasture**, where cattle are scheduled between open grazing and barn shelter; **(2) a transport route**, where a truck moves milk/product from farm to storage; and **(3) a storage facility**, where temperature must stay under a spoilage threshold. One shared risk-scoring engine powers all three. For the farm and transport checkpoints — both driven by a *schedule* someone sets and rarely revisits — we use FortyGuard's historical data (2021–present) to find a better schedule and prove it would have worked across multiple past summers, not just today. For the storage checkpoint — which needs a fresh answer every day — we use only current conditions and FortyGuard's 12-hour forecast. Every checkpoint also carries a simple worker-safety flag (heat + air quality combined), and everything rolls up into one dollar-denominated impact estimate.

---

## 2. Tech Stack (Locked Decisions)

- **Framework:** Next.js (App Router), full-stack — no separate backend service.
- **Language:** TypeScript throughout, strict mode on.
- **Database:** PostgreSQL, accessed via **Prisma** (not TypeORM — pick Prisma for this project since it's a single Next.js codebase).
- **Local DB now:** Claude Code should provision and run a local Postgres instance (e.g. via Docker Compose, or a local `postgres` install — pick whichever is more reliable in this environment) for development. All connection info must come from environment variables so switching to a hosted free Postgres (Neon, Supabase, Railway) later is a one-line `.env` change, never a code change.
- **Styling:** Tailwind CSS.
- **Icons:** `lucide-react`.
- **Data ingestion:** standalone Node/TypeScript scripts run via `tsx` (e.g. `npx tsx scripts/ingest-historical.ts`) — **not** Next.js API routes, and **not** n8n. See Section 6 for why this matters.
- **Testing:** Vitest (or Jest) for all pure computation functions.
- **Deployment target (later phase, not now):** Vercel for the app, a free hosted Postgres for the DB. Don't build anything that assumes local-only — see Section 6.

---

## 3. FortyGuard API — What You Need to Know Before Writing Code

**Base URL:** `https://api.fortyguard.com` (dev override available at `https://tos-enterprise-api.dev.app.fortyguard.com` — support both via an env var, default to production).

**Auth:** header `api-key: YOUR_API_KEY` on every request. No OAuth.

**Tier:** Premium is confirmed active for this hackathon key — all endpoints unlocked, 2,000,000 credits, valid 5 weeks, coverage is US-only.

**The async pattern (applies to every analysis endpoint):**
```
POST /v1/<endpoint>  →  { data: { activity_id } }
GET  /v1/status/{activity_id}  →  poll until status is "Completed" or "Failed"
```
- Failed tasks cost **zero credits**. Only `Completed` tasks are billed.
- Status strings should be matched case-insensitively (`Completed`/`completed`/`succeeded` all mean done).
- Some tasks (especially Heat Intelligence) can take several minutes. Build bounded polling with a generous timeout (30+ minutes) and exponential-ish backoff, not a tight loop.

**⚠️ GeoJSON coordinate order:** all polygon/route coordinates are `[longitude, latitude]` — the *opposite* of how people naturally say "lat, long" out loud. Get this backwards and every query silently points at the wrong place (or errors, if it lands outside the US). Double-check every payload.

**⚠️ Critical gotcha — `env_params` does NOT give you real hourly temperature.** The endpoint requires a single `temperature` value as an input anchor, and applies that *same fixed value* across the entire returned time series — only `relative_humidity_percent` genuinely varies hour-to-hour. This means fields like `heat_index_celsius` and `wet_bulb_temperature_celsius` in a multi-hour response are **not physically meaningful across most of the day** — they reflect the anchor temperature combined with a humidity that doesn't match the real temperature at that hour (e.g. a heat-index artifact can peak at 2am instead of mid-afternoon). Since our THI calculation needs **real paired (temperature, humidity) values per hour**, do this instead:
1. Pull real per-hour temperature from a `tcm` heatmap call (or a single-hour `filter_type=1` call per hour) for the checkpoint's location.
2. Pull real per-hour humidity from one `env_params` call (`filter_type=3`, single day) — trust `relative_humidity_percent` from this response, but ignore `heat_index_celsius`/`wet_bulb_temperature_celsius` as literal hourly truth.
3. Compute THI ourselves (formula in Section 7) by pairing each hour's *real* temperature with that same hour's *real* humidity. Do not rely on the API's derived heat/wet-bulb fields for anything hour-by-hour.
`solar_irradiance` and `cloud_cover_octas` are not subject to this anchor artifact (they're not derived from the anchor) and can be used directly if the solar heat-load upgrade (Section 7) is attempted.

**⚠️ `exceedance`/`persistence` thresholds are in °C, not THI.** These heatmap analytic types threshold on raw temperature only — they cannot directly express a humidity-dependent THI threshold. Use them only for **exploratory spatial/temporal mapping** (e.g. "which tiles/hours exceed 30°C") to visualize hot zones on the map. The actual THI-based exposure calculation that drives the optimizer and recommendations must be computed by our own function (Section 7), using real per-hour temperature + humidity pairs, not FortyGuard's built-in exceedance/persistence values.

**Heatmap (`POST /v1/heatmap`) parameters:**
| Field | Notes |
|---|---|
| `polygon_aoi` | GeoJSON FeatureCollection, Polygon geometry, `[lon, lat]` order, closed ring |
| `date_time.start_date` / `end_date` | `YYYY-MM-DD`. Valid range: `2021-01-01` to today (historical), or up to 12 hours ahead (forecast) |
| `date_time.filter_type` | `1`=single hour, `2`=range of hours (same day, max 23h), `3`=single day, `4`=range of days (**confirmed working** for multi-day/week pulls, capped at ~31 days) |
| `granularity` | `60`, `80`, or `100` (meters) |
| `analytic_type` | `tcm` (default, °C snapshot), `time_of_measure` (peak hour), `exceedance` (hours above/below threshold), `persistence` (longest continuous run) |
| `threshold` | °C, required for `exceedance`/`persistence`, default 30°C |
| `direction` | `above` (default) or `below` |

Response shape differs by `analytic_type`: `tcm` returns `properties.average_temperature`/`min_temperature`/`max_temperature`; the other three return `properties.value` with units in `stats_data.units`.

**Environmental Parameters (`POST /v1/env_params`):** required `latitude`, `longitude`, `temperature` (°C anchor — see gotcha above), `date_time`. Premium gives full access to all parameters (no 3-field cap): `heat_index_celsius`, `apparent_temperature_celsius`, `wet_bulb_temperature_celsius`, `relative_humidity_percent`, `precipitation_mm`, `cloud_cover_octas`, `elevation`, full air-quality/gas set, `solar_irradiance` (GHI/DNI/DHI).

**Satellite Segmentation (`POST /v1/satellite`)**, **Street View Segmentation (`POST /v1/streetview`)**, **Heat Intelligence (`POST /v1/heat_intelligence`)** — Premium-only, all available. Heat Intelligence returns a **PDF via a temporary `download_link`**, not JSON — download it immediately when `Completed`, don't log/share the signed URL.

**Credit/usage check:** there's a usage-check endpoint (`fetch_api_key_usage` / custom-usage variant in the quickstart client) — build a small script to check remaining credits before and after the big historical pull, just as a sanity check (2,000,000 credits is a large budget for this project's scope, but confirm actual usage once).

---

## 4. Frontend Flow & Multi-Farm Support (Important — Read Before Building the UI)

This is **not** a single fixed-farm demo. Users can create multiple farm profiles (no login required — the live demo must work in an incognito window per the hackathon rules, so there is no auth system; profiles are simply a shared list). This is a real product decision, not a stretch feature — it's what makes the "path to deployment" claim credible.

### The `Farm` grouping concept
Add a `Farm` model that groups exactly three `Checkpoint` rows (FARM, TRANSPORT_ROUTE, STORAGE) under one user-facing profile:
```prisma
model Farm {
  id          String       @id @default(cuid())
  name        String
  status      String       @default("processing") // processing | ready | failed
  isDemoSeed  Boolean      @default(false)         // true ONLY for the permanent pre-loaded demo farm — see note below
  createdAt   DateTime     @default(now())
  checkpoints Checkpoint[]
}
```
Add `farmId String` + a relation field to `Checkpoint`.

**⚠️ The seeded demo farm is a permanent fixture, not placeholder dev data.** It exists specifically as a fallback for the live demo video: if a live "Add New Farm" run is slow, fails, or hits a rate limit on camera, the presenter falls back to this fully pre-computed, always-available farm. Mark it `isDemoSeed: true` and make sure no seed/reset script, migration, or cleanup routine ever deletes or overwrites it. It must always be fully populated and instantly loadable.

### Screens (6 total)

1. **Farm List (landing page)** — cards for each saved farm profile with a small risk-summary badge, plus a prominent "+ Add New Farm" button. Shows the list even with only one farm — this is what makes multi-farm support visibly real to a viewer, not just an unverified claim.
2. **Add/Edit Farm Profile** — one-page form: farm name, farm coordinates, storage coordinates, grazing schedule (start/end), transport departure time. Single submit button: "Analyze Heat Risk." On submit: create the `Farm` + 3 `Checkpoint` rows, set `status: "processing"`, kick off the ingestion script as a background process, and navigate to the Processing screen.
3. **Processing screen** — polls the farm's status. Shows real staged messages tied to actual pipeline steps (e.g. "Pulling 3 years of temperature history…", "Computing THI risk…", "Running schedule optimizer…", "Finalizing recommendations…"), driven by real backend progress markers, not a fake timer. This is also the screen the presenter narrates over in the demo video — explain what data is being fetched and why while it runs. Auto-navigates to the Dashboard when `status: "ready"`; shows a clear failure state (with a link back to the demo seed farm) if `status: "failed"`.
4. **Dashboard** — three connected checkpoint cards (Farm → Transport → Storage) in a visual chain, header stat card with the combined dollar-impact estimate, chain-conflict banner if applicable. Each card is clickable through to its Detail screen.
5. **Checkpoint Detail** (modal or sub-page) — Farm/Transport: THI-over-time chart, before/after historical-backtest comparison across 2023/2024/2025, the recommended schedule shift stated plainly, worker-comfort badge with a one-line reason. Storage: current + 12hr forecast, spoilage flag, worker-comfort badge — no historical chart (this checkpoint has none by design).
6. **Edit Farm** — reuses screen 2's form, pre-filled; re-triggers ingestion only for checkpoints whose parameters actually changed (the cache-first design already makes this cheap).

### Navigation
Flat and minimal: a top bar with the app name/logo, and a "← All Farms" link from the Dashboard back to the Farm List. No sidebar, no settings page, no dropdown menus — with only two real destinations, anything more is over-engineering for this timeline.

### Data flow
```
Farm List           GET /api/farms
Add Farm form       (client-side only until submit)
Submit              POST /api/farms  → creates Farm + Checkpoints, spawns ingestion script, status=processing
Processing screen   GET /api/farms/:id/status  (polled)
Dashboard           GET /api/farms/:id/chain-summary, GET /api/farms/:id/checkpoints
Checkpoint Detail   GET /api/checkpoints/:id/risk, GET /api/checkpoints/:id/recommendation
```
Every screen except the Processing screen's poll and the Add-Farm submission reads only from Postgres — never a live FortyGuard call mid-request, consistent with Section 6's architecture rule.

---

## 5. Project Folder Structure

```
/ (this file's folder — initialize the Next.js project here)
├── PROJECT_GUIDE.md              # this file
├── .env.example
├── .env.local                    # gitignored — real secrets
├── .gitignore                    # must include .env*, node_modules, /prisma/dev.db if sqlite fallback used
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── app/
│   ├── api/
│   │   ├── farms/route.ts                        # GET list, POST create (spawns ingestion)
│   │   ├── farms/[id]/status/route.ts             # GET — polled by Processing screen
│   │   ├── farms/[id]/chain-summary/route.ts
│   │   ├── farms/[id]/checkpoints/route.ts
│   │   ├── checkpoints/[id]/risk/route.ts
│   │   └── checkpoints/[id]/recommendation/route.ts
│   ├── page.tsx                    # Farm List (landing screen)
│   ├── farms/new/page.tsx          # Add Farm form
│   ├── farms/[id]/processing/page.tsx
│   ├── farms/[id]/page.tsx         # Dashboard
│   ├── farms/[id]/edit/page.tsx
│   └── layout.tsx
├── lib/
│   ├── constants.ts               # ALL endpoint URLs, thresholds, sweep ranges — nothing hardcoded elsewhere
│   ├── db.ts                      # Prisma client singleton
│   ├── fortyguard/
│   │   ├── client.ts              # the ONLY place that calls FortyGuard — submit+poll wrapper
│   │   └── types.ts               # response type definitions
│   ├── risk/
│   │   ├── thi.ts                 # calculateTHI()
│   │   ├── heatLoad.ts            # optional solar/cloud-adjusted upgrade
│   │   ├── spoilage.ts            # calculateSpoilageRisk()
│   │   └── workerComfort.ts       # calculateWorkerComfort()
│   ├── exposure/
│   │   ├── optimizer.ts           # computeExposure(), optimizeSchedule()
│   │   └── backtest.ts            # backtestAcrossYears()
│   └── impact/
│       └── dollarEstimate.ts      # estimateDollarImpact()
├── scripts/
│   ├── ingest-historical.ts       # standalone — farm & transport, 2023-2025
│   ├── ingest-current.ts          # standalone — storage, current + 12hr forecast
│   └── check-usage.ts             # standalone — credit usage sanity check
├── __tests__/
│   ├── thi.test.ts
│   ├── spoilage.test.ts
│   ├── workerComfort.test.ts
│   └── optimizer.test.ts
└── data/
    └── checkpoints.seed.json      # real coordinates/schedules, filled in separately
```

---

## 6. Prisma Schema (Extendable Base — Implement As-Is, Extend Later As Needed)

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum CheckpointType {
  FARM
  TRANSPORT_ROUTE
  STORAGE
}

model Farm {
  id          String       @id @default(cuid())
  name        String
  status      String       @default("processing") // processing | ready | failed
  isDemoSeed  Boolean      @default(false)         // true ONLY for the permanent pre-loaded demo farm — never delete/overwrite
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt
  checkpoints Checkpoint[]

  @@map("farms")
}

model Checkpoint {
  id              String   @id @default(cuid())
  farmId          String
  farm            Farm     @relation(fields: [farmId], references: [id])
  type            CheckpointType
  name            String
  latitude        Float
  longitude       Float
  polygonGeoJson  Json?    // farm: AOI polygon for heatmap calls
  routeWaypoints  Json?    // transport: ordered [{lat, lon}] waypoints
  schedule        Json     // { start: "HH:MM", end: "HH:MM" } or { departureTime: "HH:MM" }
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  heatmapCache    HeatmapCache[]
  envParamsCache  EnvParamsCache[]
  computedRisk    ComputedRisk[]
  recommendations ScheduleRecommendation[]

  @@map("checkpoints")
}

model HeatmapCache {
  id            String     @id @default(cuid())
  checkpointId  String
  checkpoint    Checkpoint @relation(fields: [checkpointId], references: [id])
  analyticType  String     // tcm | time_of_measure | exceedance | persistence
  startDate     DateTime
  endDate       DateTime?
  filterType    Int
  granularity   Int
  threshold     Float?
  direction     String?
  rawResponse   Json       // full API response, kept for traceability/README example
  createdAt     DateTime   @default(now())

  @@unique([checkpointId, analyticType, startDate, endDate, filterType, granularity, threshold, direction])
  @@map("heatmap_cache")
}

model EnvParamsCache {
  id                String     @id @default(cuid())
  checkpointId      String
  checkpoint        Checkpoint @relation(fields: [checkpointId], references: [id])
  date              DateTime
  temperatureAnchor Float
  rawResponse       Json       // full response; extract relative_humidity_percent hourly array from here
  createdAt         DateTime   @default(now())

  @@unique([checkpointId, date, temperatureAnchor])
  @@map("env_params_cache")
}

model ComputedRisk {
  id             String     @id @default(cuid())
  checkpointId   String
  checkpoint     Checkpoint @relation(fields: [checkpointId], references: [id])
  date           DateTime
  hour           Int
  temperatureC   Float
  humidityPct    Float
  thiValue       Float?
  thiCategory    String?    // comfort | mild | moderate | severe
  spoilageRisk   Boolean?
  aqi            Float?
  workerComfort  String?    // good | suitable | bad | intolerable
  createdAt      DateTime   @default(now())

  @@unique([checkpointId, date, hour])
  @@map("computed_risk")
}

model ScheduleRecommendation {
  id                       String     @id @default(cuid())
  checkpointId             String
  checkpoint               Checkpoint @relation(fields: [checkpointId], references: [id])
  currentScheduleStart     String
  recommendedOffsetMinutes Int
  exposureBefore           Float
  exposureAfter            Float
  yearlyBacktest           Json       // { "2023": {...}, "2024": {...}, "2025": {...} }
  createdAt                DateTime   @default(now())

  @@map("schedule_recommendations")
}

model ChainSummary {
  id                    String   @id @default(cuid())
  computedAt            DateTime @default(now())
  totalDollarImpact     Float
  milkYieldLossEstimate Float
  spoilageRiskEstimate  Float
  conflictDetected      Boolean
  conflictDetails       Json?

  @@map("chain_summary")
}
```

---

## 7. Non-Negotiable Architecture Rules (each one avoids a real failure mode)

1. **Next.js API routes are read-only against Postgres. They never call FortyGuard live during a request.** Vercel's serverless functions have short execution limits (10–60s); FortyGuard tasks can take minutes. All data must be pre-fetched by the standalone scripts and cached in Postgres before the app serves it. This applies to local dev too, not just deployment — build the habit now.
2. **Every FortyGuard call goes through `lib/fortyguard/client.ts`.** No endpoint URL, no fetch call to `api.fortyguard.com`, anywhere else in the codebase.
3. **Every constant lives in `lib/constants.ts`.** THI bands, spoilage threshold °C, AQI bands, sweep range/step (±90 min, 5–15 min steps), granularity, historical years array (`[2023, 2024, 2025]`), base URL — nothing hardcoded inline anywhere else.
4. **Ingestion scripts are cache-first and idempotent.** Before calling the API, check whether the exact (checkpoint, date range, filter_type, analytic_type, granularity, threshold, direction) combination already exists in `HeatmapCache`/`EnvParamsCache`. If the script crashes and is re-run, it should skip everything already cached and resume — never blindly re-pull.
5. **Prisma migrations from the first schema change onward.** Use `npx prisma migrate dev` to generate real migration files — never rely on `db push`/sync-only. This is what makes "local now, cloud Postgres later" a one-line env change instead of a schema reconciliation headache.
6. **Secrets never touch the repo.** `FORTYGUARD_API_KEY` and `DATABASE_URL` live only in `.env.local` / `.env`, loaded via `process.env`, and `.env*` is in `.gitignore` from the very first commit. A key visible anywhere in committed code or client-side bundle is a disqualifying error for this hackathon — treat it as a hard constraint, not a style preference.
7. **Barn/shelter is modeled as binary** (fully protected when sheltered, fully exposed on open pasture) — an explicit, stated simplification, not a hidden assumption. Note it in the README as a called-out limitation.

---

## 8. Computation Logic (Implement as Pure, Unit-Tested Functions)

### THI (Temperature-Humidity Index) — cattle heat stress
```
THI = (1.8 × T + 32) − (0.55 − 0.0055 × RH) × (1.8 × T − 26)
```
Where `T` = air temperature in °C, `RH` = relative humidity in %. **Use real per-hour T and RH pairs** — see the `env_params` anchor gotcha in Section 3; do not use the API's `heat_index_celsius` field directly for this.

**Thresholds (Armstrong 1994, corroborated by multiple published sources):**
| THI range | Category |
|---|---|
| < 72 | Comfort |
| 72–79 | Mild stress |
| 80–89 | Moderate stress |
| > 90 | Severe stress (risk of heat-related mortality; documented ~19% milk yield drop above THI 80) |

### Optional upgrade: solar-adjusted heat load
If time allows, incorporate `solar_irradiance` and `cloud_cover_octas` to approximate a black-globe-temperature-adjusted heat load (published livestock Heat Load Index models use black globe temperature, which solar radiation drives) — this is a genuine scientific upgrade over plain THI for open-pasture cattle. Treat as a stretch feature; fall back cleanly to THI alone if not implemented.

### Spoilage risk (storage checkpoint)
Binary/severity flag against the **federal Grade "A" Pasteurized Milk Ordinance (PMO) standard**: raw milk must be cooled to **45°F (7°C) or below within two hours of milking**, and this requirement holds at the farm, during transport, and at the processing facility's receiving dock. This is a real, citable federal regulation — cite it directly rather than an invented threshold. Note it has a genuine time component (2-hour cooling window), not just a flat temperature ceiling — if time allows, model "minutes above 7°C since last cooling" rather than a simple instantaneous flag, since that's more physically accurate to the actual regulation. Reactive only: current conditions + FortyGuard's 12-hour forecast. **No historical backtest for this checkpoint** — spoilage risk needs a fresh daily answer, not multi-year validation.

**⚠️ Important framing clarification:** FortyGuard only exposes ambient (outdoor) weather — never a facility's actual internal refrigeration reading. Comparing ambient air directly to the 45°F/7°C food-safety ceiling is not physically meaningful on its own (a Texas summer day will read "unsafe" by that comparison on nearly every hour, regardless of how well the facility's refrigeration is actually performing). Model ambient heat as a proxy for **refrigeration system strain and outage risk**, not as a literal stand-in for the milk's internal temperature: the risk output should communicate something like *"extreme ambient heat increases refrigeration equipment strain and the consequences of any power outage or equipment failure during this window"* — never imply the stored product itself is confirmed to be at ambient temperature. This is an honest, defensible proxy model, not a validated direct measurement, and the UI/copy should reflect that distinction.

### Worker comfort flag (all three checkpoints)
Combine a heat-comfort read with EPA AQI bands into one of four levels — shown as a small badge, not a separate dashboard:
| Condition | Flag |
|---|---|
| AQI > 150 OR heat severe | `intolerable` |
| AQI 101–150 OR heat moderate | `bad` |
| AQI 51–100 AND heat mild | `suitable` |
| Otherwise | `good` |

### Exposure & optimizer (farm + transport checkpoints only)
1. `computeExposure(hourlySeries, scheduleWindow)` — sum hours (cow-hours / transport-hours) where THI exceeds the "mild" threshold (72) within the schedule window.
2. `optimizeSchedule(hourlySeries, currentWindow, sweepRangeMinutes=90, stepMinutes=15)` — brute-force shift the window by ±90 minutes in 15-minute steps (tune step size for compute budget), return the offset minimizing exposure.
3. `backtestAcrossYears(checkpointId, offset)` — re-run the exposure calculation for the winning offset against each cached historical year (2023, 2024, 2025) independently; report per-year results and whether the recommendation holds across all three.
4. **Historical-analog prediction:** average the hourly THI curve for the target week across the three historical years (with min/max spread) to produce an estimated "expected heat profile" for the upcoming week — this is the forward-looking layer, since live forecasting only reaches 12 hours out. Surface this explicitly in the UI, labeled as a historical-analog estimate, not a forecast.

### Combined dollar impact (headline number)
```
milkYieldLossEstimate = (THI-severe cow-hours avoided) × (published yield-loss rate per THI-hour) × (milk price per liter)
spoilageRiskEstimate  = (spoilage risk events avoided) × (estimated cost per spoilage event)
totalDollarImpact     = milkYieldLossEstimate + spoilageRiskEstimate
```
Use the published relationship (milk yield can drop 0.24–0.72 kg/day per unit THI increase above certain thresholds, and up to 19% at THI > 80) to derive a defensible per-hour loss rate. **Milk price constant:** use ~$0.43/liter (derived from USDA's 2026 all-milk farm price of $18.95/cwt — cite USDA-ERS/AMS; note this moves with the market and was ~$1.97/gallon, ~$0.52/liter, in 2024 — use the more current figure and note the source year in a code comment).

**`SPOILAGE_EVENT_COST_USD` anchor:** use the value of one full spoiled tanker load. A standard over-the-road raw milk tanker holds ~5,500 gallons (~20,800 liters) — a figure documented in dairy-industry transport literature. At the ~$0.43/liter farm-gate price above, one full lost load is worth approximately **$9,000** (5,500 gal × ~$1.63/gal, or equivalently 20,800 L × $0.43/L). Use this as the constant, with a code comment citing both the tanker-volume source and the milk-price source — this replaces any placeholder/unanchored value.

Document the exact source numbers used as code comments so the README's "measurable outcome" claim is traceable.

### Chain-conflict check
Compare the transport checkpoint's recommended departure/arrival window against the storage checkpoint's safe-arrival margin; flag a conflict if the transport optimizer's recommended timing would cause arrival during a period flagged high-spoilage-risk at storage.

---

## 9. Sample Request Payloads (Real Structure — Adjust Coordinates to Final Chosen Locations)

**Farm/pasture polygon (Houston-area rural example — replace with final chosen coordinates):**
```json
POST /v1/heatmap
{
  "polygon_aoi": {
    "type": "FeatureCollection",
    "features": [{
      "type": "Feature",
      "properties": {},
      "geometry": {
        "type": "Polygon",
        "coordinates": [[
          [-95.9800, 30.0650],
          [-95.9650, 30.0650],
          [-95.9650, 30.0800],
          [-95.9800, 30.0800],
          [-95.9800, 30.0650]
        ]]
      }
    }]
  },
  "date_time": {
    "start_date": "2025-08-18",
    "end_date": "2025-08-24",
    "filter_type": 4
  },
  "granularity": 60,
  "analytic_type": "exceedance",
  "threshold": 30.0,
  "direction": "above"
}
```
*(Remember: coordinates are `[longitude, latitude]`.)*

**Environmental Parameters — real per-hour humidity for the farm point, single day:**
```json
POST /v1/env_params
{
  "latitude": 30.0716,
  "longitude": -95.9744,
  "temperature": 34.0,
  "date_time": {
    "start_date": "2025-08-20",
    "filter_type": 3
  }
}
```

**Storage facility — current conditions, single point:**
```json
POST /v1/env_params
{
  "latitude": 29.7604,
  "longitude": -95.3698,
  "temperature": 33.0,
  "date_time": {
    "start_date": "2026-08-22",
    "start_time": "14:00",
    "filter_type": 1
  }
}
```

**Transport route — treat as a thin polygon buffer along the route, or sample 2–3 points along it and run the same heatmap/env_params calls as the farm.**

---

## 10. Frontend Requirements

- **One dashboard page**, three connected checkpoint cards in a visual chain (Farm → Transport → Storage), each showing: current status, risk value (THI category / spoilage flag), the worker-comfort badge, and — for farm/transport — the recommended schedule shift with the historical-backtest result.
- **Header stat card:** the combined dollar-impact estimate, prominent, first thing seen.
- **Chain-conflict indicator:** a visible warning state if transport/storage timings conflict.
- **Use `lucide-react` icons** throughout — thermometer/heat icons for temperature, a truck icon for transport, a warehouse/snowflake icon for storage, a cow/barn icon for the farm.
- **Loading states matter — this app pre-computes everything, but the UI should still feel responsive and polished:**
  - Skeleton screens (not spinners) for the checkpoint cards while initial data loads.
  - Loading buttons (spinner + disabled state) for any interactive recompute/refresh action.
  - A progress bar or staged-loading indicator for the initial dashboard load if multiple API routes are fetched in sequence.
- Clean, modern, uncluttered layout — this is being judged partly on Communication (10% of the score), so visual polish genuinely matters. Use Tailwind's spacing/typography scale consistently; don't default to unstyled browser elements anywhere.

---

## 11. Testing Requirements

Write unit tests (Vitest) for every function in `lib/risk/` and `lib/exposure/` before wiring them into API routes:
- `calculateTHI`: verify against a known published input/output pair.
- `calculateSpoilageRisk`: verify boundary behavior at the threshold.
- `calculateWorkerComfort`: verify all four flag outcomes are reachable with correct inputs.
- `optimizeSchedule`: verify it correctly identifies a known-best offset in a synthetic test series.
- `backtestAcrossYears`: verify it correctly aggregates multi-year synthetic data.

---

## 12. README Requirements (for the final submission)

Must include: setup-from-scratch steps (clone → env setup → local Postgres → migrate → seed → ingest scripts → dev server), one real FortyGuard request **and** response pair (pull this from an actual cached entry once the ingestion script has run), a clearly stated "what's simplified / future scope" section (binary barn/shelter model; expansion to other livestock and food categories; expansion beyond three checkpoints), and disclosure that Claude Code was used, with what for.

---

## 13. Build Order (for this session)

1. Scaffold Next.js project + Tailwind + folder structure (Section 4).
2. `lib/constants.ts` first — every threshold and endpoint constant, before any logic references them.
3. Prisma schema + first migration + local Postgres running.
4. `lib/fortyguard/client.ts` — submit+poll wrapper, referencing the quickstart repo's tested behavior. Test it against one real call before building anything on top.
5. Pure computation functions (`lib/risk/`, `lib/exposure/`, `lib/impact/`) + their unit tests — these have zero dependency on the API or DB and can be fully built and tested first.
6. Ingestion scripts (`scripts/`), cache-first and idempotent.
7. API routes (read-only against Postgres).
8. Frontend dashboard.
9. Farm List, Add Farm form, Processing screen (with real staged progress), Dashboard, Checkpoint Detail, Edit Farm — in that order.
10. Seed **one permanent demo Farm** (`isDemoSeed: true`) with placeholder-but-realistic, fully pre-computed data — this is the live-demo fallback described in Section 4, not just dev scaffolding. Never let any script, migration, or reset routine delete or overwrite it.

Build the complete thing end-to-end with placeholder checkpoint data first — real coordinates and schedules for the demo-seed farm will be swapped in once collected, and the architecture should make that a data change, not a code change. The "Add New Farm" flow should work for genuinely new, user-entered farms from the start, not just the seeded one.
