# HerdSafe

Heat is only dangerous when it overlaps with something that can't protect
itself and can't say so in time. HerdSafe applies that principle across three
linked checkpoints in a real dairy supply chain — a **farm/pasture**, a
**transport route**, and a **storage facility** — using real FortyGuard
temperature data to find safer schedules and flag spoilage risk before it
happens.

Built with Next.js (App Router) + TypeScript + PostgreSQL/Prisma, driven
entirely by the FortyGuard tOS Enterprise API.

## What's working

- **Full pipeline against the live FortyGuard API**, verified with real calls
  during this build: submit → poll → cache, real per-hour temperature (`tcm`
  heatmap) paired with real per-hour humidity (`env_params`), THI computed
  ourselves from that real pair (never from FortyGuard's anchor-artifact
  `heat_index_celsius`/`wet_bulb_temperature_celsius` fields — see
  [Known API quirks](#known-api-quirks-discovered-during-this-build)).
- **Multi-farm support** — Farm List, Add Farm, Processing (real staged
  progress polled from the DB, not a fake timer), Dashboard, Checkpoint
  Detail (modal), Edit Farm. All 6 screens from the spec are wired end to
  end.
- **Schedule optimizer + multi-year backtest** for the farm and transport
  checkpoints (available, not automatic on new farms — see
  [Credit budget & default ingestion scope](#credit-budget--default-ingestion-scope)),
  and a **historical-analog heat profile** (explicitly labeled as an analog,
  not a forecast). The backtest scope is whatever years are actually
  complete for that checkpoint, reported and labeled dynamically — never a
  hardcoded "3 years."
- **Spoilage risk + worker-comfort flag** for the storage checkpoint, reactive
  off current conditions (see [Credit budget & default ingestion scope](#credit-budget--default-ingestion-scope)
  for why the reactive window is 1 hour, not 12).
- **Combined dollar-impact estimate** (milk yield loss + spoilage risk) and a
  **chain-conflict check** (does transport's recommended arrival land during
  a storage risk window?).
- **Cache-first, idempotent ingestion** — re-running any script after a crash
  resumes instead of re-pulling; verified by killing an in-progress pull and
  confirming the cache stopped it from re-fetching completed hours.
- **24 passing unit tests** (Vitest) covering every function in `lib/risk/`
  and `lib/exposure/`.
- **The permanent demo farm** (`isDemoSeed: true`) — always populated, never
  deletable by any script, seeded from synthetic-but-realistic Texas-summer
  climate fixtures run through the exact same real computation pipeline (see
  [Demo farm data](#demo-farm-data--why-its-synthetic) below).

## What's stubbed / placeholder

- **Herd size** is a single global constant (`DEFAULT_HERD_SIZE` in
  `lib/constants.ts`), not a per-farm field — the Add Farm form (as specified)
  doesn't collect one.
- **Farm AOI polygon and transport route are auto-derived** for real,
  user-created farms (a buffer square around the single farm coordinate; a
  3-point farm→midpoint→storage line) — the Add Farm form collects points,
  not a drawn boundary. The permanent demo farm is the one exception: its
  transport waypoints use the real road-route midpoint from
  `PROJECT_GUIDE.md` Section 0.5 rather than the auto-derived straight-line
  average — an explicit override scoped to `prisma/seed.ts` only (see
  [Demo farm data](#demo-farm-data--why-its-synthetic)).
- **Background pipeline spawning** uses a detached Node child process, which
  only works on a long-running server (`next dev` / `next start`). It will
  **not** work on Vercel's serverless platform as-is — a real deployment
  needs a queue/worker (see [Deployment scope](#deployment-scope)).

## Resolved since the first pass

Two things flagged as unresolved in the first build pass now have real
answers, from `PROJECT_GUIDE.md` Section 0.5/8:

- **Demo farm coordinates and schedule are now real, finalized values** —
  "Heavenly Dairy" (`data/checkpoints.seed.json`), not placeholders. Grazing
  (10:00–16:00) and transport departure (13:00) were chosen deliberately
  inside peak heat so the optimizer has genuine signal to act on — see
  [Demo farm data](#demo-farm-data--why-its-synthetic) for how the synthetic
  fixture was retuned to actually produce that.
- **`SPOILAGE_EVENT_COST_USD` now has a real anchor: $9,000** — the value of
  one full spoiled tanker load. A standard raw-milk tanker holds ~5,500
  gallons (~20,800 L); at the milk-price constant below, that's ~$9,000
  (documented in `lib/constants.ts`).
- **`AMBIENT_HEAT_STRAIN_THRESHOLD_C`'s framing is now explicit everywhere
  it's surfaced.** My instinct that comparing ambient air directly to the
  literal food-safety ceiling wasn't physically meaningful was correct — the
  fix isn't a new data source (there isn't one), it's what the number
  communicates: every badge, chart label, and log line now says
  "refrigeration equipment strain and outage risk," never anything implying
  the stored product itself is confirmed at ambient temperature. See
  `components/SpoilageBadge.tsx`, `components/CheckpointDetailModal.tsx`, and
  the doc comments on `AMBIENT_HEAT_STRAIN_THRESHOLD_C` and
  `calculateSpoilageRisk`.
- **Milk price is now $0.43/liter** (USDA-ERS/AMS, 2026 all-milk farm price
  ~$18.95/cwt), replacing the earlier improvised $0.45/L estimate.

## What I'm unsure about

- **The tcm single-hour buffer-polygon size** (`CLIMATE_POINT_BUFFER_METERS`,
  300m) was tuned empirically against one location during this build (see
  below) — it might need retuning if a real farm's coordinates turn out to
  sit awkwardly on FortyGuard's tile grid the same way.
- **The demo farm's synthetic peak/trough temperatures were retuned to find
  genuine optimizer relief for both the farm and transport checkpoints under
  the new, narrower Section 0.5 schedule** (a 6h grazing window and a 2h
  transport window, both centered on peak heat, vs. the wider placeholder
  windows this was originally tuned against). At realistic dairy-heat-stress
  peaks, that narrow-window-centered-on-peak shape turns out to be uniformly
  hot for a long stretch around it — no combination I found gives genuine
  relief AND reaches severe (≥90) THI at the same time, so
  `milkYieldLossEstimate` lands at $0 for this specific schedule/curve
  combination. `spoilageRiskEstimate` ($9,000) still drives the headline
  number. See the comment above `YEAR_PEAK_TEMPERATURES_C` in
  `prisma/seed.ts` for the full reasoning — flagging this as worth a look if
  a nonzero milk-yield figure matters for the demo narrative.

## Setup from scratch

```bash
# 1. Install dependencies
npm install

# 2. Environment
cp .env.example .env.local
# then edit .env.local and paste in your real FORTYGUARD_API_KEY

# 3. Local Postgres (Docker wasn't available in the environment this was
#    built in — see docs/local-postgres.md for the native-cluster setup used
#    instead, or swap in your own Postgres and just point DATABASE_URL at it)
initdb -D pgdata -U herdsafe --auth=trust --no-locale --encoding=UTF8
pg_ctl -D pgdata -l pgdata/logfile -o "-p 5433 -k $(pwd)/pgdata" start
psql -h 127.0.0.1 -p 5433 -U herdsafe -d postgres -c "CREATE DATABASE herdsafe;"

# 4. Migrate
npx prisma migrate deploy   # (or `npx prisma migrate dev` in development)

# 5. Seed the permanent demo farm (synthetic fixtures — no API credits spent)
npm run seed

# 6. Optional: full multi-year historical pull for one checkpoint. Gated
#    behind ALLOW_HISTORICAL_INGESTION=true — the live "Add New Farm" flow
#    never sets this and never reaches this path; it always uses the cheap
#    reactive current-conditions pull (~29,800 credits/farm, including the
#    ambient-heat-frequency signal — see "Credit budget & default ingestion
#    scope" below). Only run this manually if you
#    deliberately want the full historical backtest for a specific
#    checkpoint (~2.2M credits — check your balance FIRST).
npm run check-usage
ALLOW_HISTORICAL_INGESTION=true npx tsx scripts/ingest-historical.ts <checkpointId>
npx tsx scripts/recompute-recommendation.ts <checkpointId>  # if a pull was interrupted, use whatever's fully cached without pulling more

# 7. Dev server
npm run dev
```

Then open `http://localhost:3000` — the demo farm is there immediately.
"Add New Farm" spawns the real ingestion pipeline against FortyGuard —
current conditions only, a few seconds per checkpoint (see
[Known API quirks](#known-api-quirks-discovered-during-this-build)).

Other useful commands:

```bash
npm run test        # Vitest — lib/risk and lib/exposure unit tests
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
```

## Architecture

- Next.js App Router, TypeScript strict mode throughout.
- **API routes are read-only against Postgres** — they never call
  FortyGuard live during a request (Vercel's execution limits are seconds;
  FortyGuard tasks can take minutes). All FortyGuard calls happen in
  `scripts/` or the pipeline they spawn.
- **`lib/fortyguard/client.ts` is the only place that calls FortyGuard.** It's
  a TypeScript port of the Python quickstart's `fortyguard/client.py` —
  same submit→poll pattern, same case-insensitive status matching, same
  "404 right after submit isn't a failure, keep polling" behavior.
- **`lib/constants.ts`** holds every threshold, endpoint, and tunable value —
  nothing hardcoded elsewhere.
- **Server Components query Postgres directly** via `lib/db.ts` for initial
  page loads (the idiomatic Next.js App Router pattern); **Client Components
  hit the API routes** for polling (Processing screen) and mutations
  (Add/Edit Farm forms, Checkpoint Detail's on-demand data fetch). Both paths
  are still strictly read-only-against-Postgres / no-live-FortyGuard-calls at
  request time — this is a request-shape decision, not a relaxation of that
  rule.
- Prisma 7 changed its connection model since this spec was written: the
  `datasource` block no longer accepts a `url` — the connection string lives
  in `prisma.config.ts`, and `PrismaClient` now requires an explicit driver
  adapter (`@prisma/adapter-pg`). See `lib/db.ts`.

## Known API quirks (discovered during this build)

Beyond what `PROJECT_GUIDE.md` already documented from the Python quickstart,
live testing against the real API during this build surfaced a few more:

1. **A live `filter_type=1` (single-hour) `tcm` heatmap call can return tiles
   carrying `average_temperature`/`min_temperature`/`max_temperature` instead
   of the plain `temperature` field** the quickstart notebooks document for
   that filter type. `lib/ingestion/climatePull.ts`'s extraction checks
   `temperature` first, falling back to `average_temperature`.
2. **A too-small buffer polygon around a point can return zero tiles**
   (`n_cells: 0`, empty `map_data.features`) depending on exactly where the
   point falls on FortyGuard's tile grid — and this is genuinely
   location-dependent, not a fixed safe buffer size. Confirmed at two
   different real coordinates: 75m/150m failed at one Texas point (250m
   fixed it there); separately, 300m *and* 500m *and* even 2000m all failed
   at a real California Central Valley transport-route point. `tryAverageTcmTemperature()`
   in `lib/ingestion/climatePull.ts` now auto-escalates the buffer
   (`CLIMATE_POINT_BUFFER_METERS`, then `CLIMATE_POINT_BUFFER_ESCALATION_METERS`)
   on a zero-tile response instead of requiring a manual fix each time — but
   that escalation isn't unbounded, since each attempt is a real billed call
   (see quirk #3), and it still isn't guaranteed to succeed at every point.
3. **A zero-tile response is a billed `Completed` task, not a free `Failed`
   one** (Section 3: "Failed tasks cost zero credits. Only Completed tasks
   are billed") — so a buffer that's too small at a given point costs real
   credits for a useless result, and a naive retry-on-crash doesn't help
   because the response was already `Completed`. A related bug this
   surfaced: the ingestion cache was writing a zero-tile response to
   `HeatmapCache` as if it were valid, which meant every subsequent retry —
   even after fixing the buffer size in code — just replayed the same
   useless cached response instead of ever calling the API again. Fixed:
   `fetchHourlyTemperatureC()` now only caches a response once it has
   confirmed usable tiles.
4. **The `env_params` `analysis` parameter-restriction list doesn't appear to
   be honored** — a live call requesting only 2 parameters returned the full
   default set regardless. `lib/ingestion/climatePull.ts` stopped requesting
   a restricted set and just extracts what it needs from the full response
   (which also means one `env_params` call now serves both the humidity and
   AQI extractors at no extra cost).
5. **`env_params` never returns a raw ambient-temperature series at all** —
   only the anchor `temperature` you passed in, echoed back as a scalar. The
   *only* way to get a real per-hour temperature series is
   `filter_type=1` (single-hour) `tcm` heatmap calls, one per hour — neither
   `filter_type=2` (range of hours) nor `filter_type=3` (single day) return a
   genuine hourly array from the heatmap endpoint either (both return a
   single aggregate). This is why a full year of hourly data is
   prohibitively expensive to pull exhaustively — see
   `HISTORICAL_SAMPLE_WEEK` below.

### One real request/response pair

Pulled live during this build (`POST /v1/heatmap`, single-hour `tcm`, against
a real Texas pasture coordinate used for testing during development — not
the current demo farm's coordinates, which were finalized in a later pass):

**Request:**

```json
{
  "polygon_aoi": {
    "type": "FeatureCollection",
    "features": [{
      "type": "Feature",
      "properties": {},
      "geometry": {
        "type": "Polygon",
        "coordinates": [[
          [-95.97751409040536, 30.074294933524975],
          [-95.97128590959464, 30.074294933524975],
          [-95.97128590959464, 30.068905066475025],
          [-95.97751409040536, 30.068905066475025],
          [-95.97751409040536, 30.074294933524975]
        ]]
      }
    }]
  },
  "date_time": { "start_date": "2025-08-01", "start_time": "15:00", "filter_type": 1 },
  "granularity": 100,
  "analytic_type": "tcm"
}
```

**Response** (`result` payload, after submit→poll completed):

```json
{
  "stats_data": {
    "temperature_stats": {
      "minimum": 35.691,
      "maximum": 35.7834,
      "mean": 35.73448333333333,
      "standard_deviation": 0.031463479963738376
    }
  },
  "map_data": {
    "type": "FeatureCollection",
    "features": [{
      "id": "0",
      "type": "Feature",
      "properties": {
        "tile_id": 0,
        "average_temperature": 35.7807,
        "min_temperature": 35.7807,
        "max_temperature": 35.7807
      },
      "geometry": { "type": "Polygon", "coordinates": [[ /* tile boundary */ ]] }
    }]
  }
}
```

Note the `average_temperature` field on a `filter_type=1` response — quirk
#1 above.

### Why only a sample week, not a full 3 years hourly

A real per-hour temperature series needs one `filter_type=1` call *per hour*
(quirk #5). Pulling three full years hour-by-hour would mean roughly
26,000 calls per checkpoint. Instead, historical ingestion samples one
representative peak-heat week per year (`HISTORICAL_SAMPLE_WEEK` in
`lib/constants.ts`, defaults to Aug 1–7) — which is also exactly what the
spec's own historical-analog description asks for ("average the hourly THI
curve for the target week across the three historical years"). That's still
~525 real API calls per checkpoint for a full production run — cache-first
and resumable, but budget real time for it.

That estimate turned out to understate the real constraint: a live `tcm`
heatmap call costs **~4,220 credits** on this key, confirmed against actual
usage. ~525 calls/checkpoint × ~4,220 credits ≈ **2.2M credits** — more than
the *entire* 2,000,000-credit hackathon budget, for **one** checkpoint's
full historical pull. See the next section for what that changed.

A follow-up diagnostic (`scripts/measure-api-costs.ts`, a deliberate 10-call
harness that checked the usage endpoint before/after every single call) then
confirmed pricing is **flat per call, independent of every parameter
tested** — `filter_type`, `analytic_type`, `granularity`, and AOI size (a
~5x-larger polygon billed the identical 4,220 credits) all made no
difference. So there's no cheaper request shape to switch to; the only real
lever is call count, and there's no reason to keep the sampled AOI tight
anymore either — see below.

## Credit budget & default ingestion scope

Multi-year historical backtesting is real and working, but it is **fully
gated off the live Add Farm/Edit Farm flow** — not just defaulted off. Current
scope:

- **The permanent demo farm** (`isDemoSeed: true`) demonstrates the full
  3-year backtest at full scope — synthetically, at zero API cost (see
  [Demo farm data](#demo-farm-data--why-its-synthetic) below).
- **New farms**, via the "Add New Farm" flow, get every checkpoint (farm,
  transport, *and* storage) ingested through reactive current-conditions
  ingestion ONLY — `lib/ingestion/currentIngest.ts`'s `ingestCurrentCheckpoint()`,
  which supports all three checkpoint types. No optimizer, no backtest, no
  `ScheduleRecommendation` for the farm/transport checkpoints.
  - The reactive window (`REACTIVE_FORECAST_HOURS` in `lib/constants.ts`) is
    **1 hour**, not 12 — each hour is its own billed heatmap call (confirmed
    by the harness above), so 12 hours meant 12 heatmap calls per checkpoint
    (~50,640 credits), not one call covering a 12-hour range. At 1 hour,
    each checkpoint costs one ~4,220-credit heatmap call + one
    ~2,900-credit env_params call ≈ **7,120 credits**, so a full 3-checkpoint
    farm costs **≈21,360 credits** to create — down from the ~160,600
    credits/farm the 12-hour default actually cost (an order-of-magnitude
    miscalculation caught before it became the shipped default — the initial
    "cheap, roughly a dozen calls" estimate confused call *count* with call
    *cost*).
  - The sampled AOI (`CLIMATE_POINT_BUFFER_METERS`) was bumped from 300m to
    1500m (escalation step 600m → 3000m) as a free reliability margin against
    the grid-alignment zero-tile issue described above — free because AOI
    size doesn't affect cost.
- **Ambient heat frequency** (`lib/ingestion/ambientHeatFrequency.ts`): every
  new farm's FARM/TRANSPORT_ROUTE checkpoints (not STORAGE) also get one real
  `persistence` heatmap call (`filter_type=4`, past 30 real days, reusing
  `AMBIENT_HEAT_STRAIN_THRESHOLD_C`) — a cheap, honest, ambient-temperature-
  frequency signal ("Longest continuous stretch above 35°C: 6 hours"),
  surfaced plainly in the Checkpoint Detail modal and explicitly labeled as
  separate from the THI-based backtest above it. **Deliberately not blended
  into the dollar-impact estimate or the optimizer** — it's descriptive, not
  prescriptive. Confirmed at the same flat ~4,220 credits/call as everything
  else, including at this exact parameter combination
  (`scripts/measure-api-costs.ts` only tested `filter_type=4` and
  `exceedance`/`persistence` separately, not together — re-verified together
  before wiring it into the live flow). ORIGINALLY paired with an
  `exceedance` call too, doubling the cost for a second number that told a
  similar story — dropped to cut this feature's cost roughly in half. Adds
  ~4,220 credits/checkpoint × 2 checkpoints = **~8,440 credits/farm**,
  bringing the real total to **≈29,800 credits/farm** (up from ≈21,360
  without it) — confirmed exactly by direct usage-endpoint deltas, not
  estimated.
- **Herd Impact Today** (`lib/impact/herdMetrics.ts`): four derived metrics
  in the Checkpoint Detail modal for the FARM checkpoint only — additional
  water needed, feed (DMI) intake reduction, minimum shade area, and an
  estimated respiration-rate multiple — computed purely from
  temperature/THI data already cached from the reactive pull. **Zero
  additional FortyGuard calls**, runs for every farm including reactive-only
  ones. Each figure cites a real agricultural-extension or peer-reviewed
  source (full citations in `lib/constants.ts` and behind each card's info
  icon) — water (OSU Extension), feed intake (a 2021 global meta-analysis,
  North America-specific coefficient), shade (Cornell Cooperative Extension,
  grazing dairy cattle), respiration (Mississippi State Extension baseline +
  a 2021 Frontiers in Animal Science breakpoint study). Farm.herdSize is an
  optional field (Add/Edit Farm form) — per-animal figures are shown with an
  "Add herd size" prompt when it's absent, never blocking farm creation.
  Deliberately separate from the dollar-impact estimate and optimizer.
- **Milk-yield-impact honesty fix**: the dollar-impact card used to show "$0
  milk yield" for every reactive-only farm — indistinguishable from "we
  checked and there's truly no risk," when the real reason is that no
  `ScheduleRecommendation` exists yet to diff exposure against (that half of
  the estimate is structurally unreachable for any new farm, permanently,
  since the optimizer/backtest is gated off — see above). `ChainSummary` now
  stores `milkYieldEstimateAvailable`, and the UI shows "Milk yield impact:
  not available (no historical backtest run for this farm)" instead of a
  number that could be misread as verified-safe — the same honesty standard
  already used for the Checkpoint Detail modal's missing-recommendation case.
- **`lib/ingestion/historicalIngest.ts`'s `ingestHistoricalCheckpoint()` is
  hard-gated behind `ALLOW_HISTORICAL_INGESTION=true`** in the environment —
  it throws immediately otherwise. The live pipeline
  (`scripts/run-farm-pipeline.ts`) never sets this and never calls the
  function at all, so this is defense-in-depth, not the only thing preventing
  it: `ALLOW_HISTORICAL_INGESTION=true npx tsx scripts/ingest-historical.ts <checkpointId>`
  is the only way to run a historical pull, deliberately, against one
  checkpoint, when you're ready to spend the credits on it. In a real product
  this is the natural shape of a paid-tier capability: reactive monitoring
  cheap by default, deep historical backtesting a deliberate, explicitly
  unlocked, priced action.
- **A real farm with a genuinely interrupted historical pull** (from before
  this gate existed — network failure, or a decision to stop before
  completing every year) doesn't lose what it already paid for:
  `scripts/recompute-recommendation.ts <checkpointId>` computes a
  recommendation from whatever years are fully cached — a year only counts
  if every sample day has all 24 hours present
  (`lib/ingestion/completeHistoricalYears.ts`) — without pulling anything
  new. This is exactly what happened to a real farm during this build: its
  historical pull failed partway through with only 1 of 3 years fully
  cached; rather than resume the pull or discard the real, already-paid-for
  data, its recommendation was recomputed from that 1 complete year. Every
  place a backtest scope is shown (Dashboard card, Checkpoint Detail chart
  and table) reports the checkpoint's *actual* complete-year count
  dynamically — never a hardcoded "3 years."
- **Service-unavailability handling**: FortyGuard calls that never get a
  response at all (DNS failure, connection reset, our own request timeout)
  now throw a distinct `FortyGuardUnavailableError` instead of surfacing as a
  generic, unhelpful "fetch failed" (`lib/fortyguard/client.ts`); a non-2xx
  HTTP response throws `FortyGuardHttpError` instead of a generic
  `FortyGuardError`. `categorizeError()`/`userFacingMessage()`
  (`lib/fortyguard/errors.ts`) classify any pipeline failure into
  network/api/application, storing the category on `Farm.statusErrorCategory`.
  The Processing screen shows a friendly message plus a **Retry** button for
  network/api failures (plausibly transient) and a plain "something went
  wrong, check the logs" message with no Retry for application-level bugs
  (retrying wouldn't help). Verified by pointing a `FortyGuardClient` at a
  deliberately-invalid host — confirmed it throws `FortyGuardUnavailableError`
  → categorizes as `"network"` → renders the friendly message and Retry
  button, at zero API cost.

## Demo farm data — why it's synthetic

The permanent demo farm — **Heavenly Dairy** (`data/checkpoints.seed.json`,
finalized real coordinates and schedule from `PROJECT_GUIDE.md` Section 0.5)
— gets its climate data from `lib/fixtures/syntheticClimateData.ts`: a
deterministic (seeded, not `Math.random()`), right-shaped Texas-summer
diurnal curve, run through the **exact same** THI/optimizer/backtest/dollar-
impact pipeline real ingestion uses (`prisma/seed.ts`). No FortyGuard
credits are spent seeding it. This was a deliberate choice made with the
project owner: a real historical pull is substituted later if time allows,
per Section 0.5.

Its coordinates and schedule are real and finalized, but the climate is
still synthetic, so the fixture's peak/trough temperatures were hand-tuned
to produce a genuine, demonstrable optimizer improvement for both the farm
and transport checkpoints against that real schedule — Section 0.5 chose
a grazing window (10:00–16:00) and transport departure (13:00) deliberately
inside peak heat specifically so the optimizer would have real signal to
act on; a schedule that already reads safe wouldn't produce a compelling
demo. See the comment above `YEAR_PEAK_TEMPERATURES_C` in `prisma/seed.ts`
for how that tuning was found and the trade-off it hit.

The one exception to "everything else auto-derives the same way a real
farm would": the demo farm's transport checkpoint uses the real road-route
waypoints from Section 0.5 (`checkpoints.seed.json`'s `transportWaypoints`)
instead of the straight-line midpoint `buildCheckpointsData()` normally
computes — a small override applied only inside `prisma/seed.ts`, so the
live Add-Farm flow (real users) is untouched and keeps auto-deriving, since
its form doesn't collect a route midpoint either.

The synthetic generator is isolated in its own file specifically so swapping
the demo farm to a real pull later is a contained change, not a codebase-
wide hunt.

## What's simplified / future scope

- **Barn/shelter is modeled as binary** — fully protected when sheltered,
  fully exposed on open pasture. An explicit simplification, not a hidden
  assumption (per the spec).
- **Spoilage risk is a proxy from ambient conditions**, not a real facility
  sensor reading — FortyGuard only exposes outdoor weather, not a
  refrigeration unit's actual internal temperature. See quirk discussion
  above and the doc comment on `AMBIENT_HEAT_STRAIN_THRESHOLD_C`.
- **Three checkpoint types, one livestock category.** Expanding to other
  livestock (poultry, swine) or other perishable food categories (produce,
  seafood) would mean new THI-equivalent stress models per species/product —
  the checkpoint/risk-computation architecture already generalizes to that,
  it just needs the domain-specific formulas.
- **Farm AOI and transport route are auto-derived**, not user-drawn. A real
  version would let users draw a pasture boundary and route on a map.
- **Multi-year historical backtesting is not reachable from the live Add
  Farm/Edit Farm flow at all** (hard-gated behind `ALLOW_HISTORICAL_INGESTION=true`
  — see [Credit budget & default ingestion scope](#credit-budget--default-ingestion-scope)).
  The demo farm demonstrates it at full (synthetic) scope; one real farm
  built during this project demonstrates it at a reduced-but-real scope from
  before the gate existed; every other farm gets reactive-only monitoring.
  Full historical analysis remains a real, working, manually-triggered
  capability behind that flag — the natural shape of a future paid tier, not
  a missing feature.

## Deployment scope

This was built and tested for **local development**. Everything is
env-var-driven so swapping to a hosted Postgres (Neon/Supabase/Railway) is a
one-line `.env` change. The one piece that genuinely needs rework for a
Vercel deployment: `lib/ingestion/spawnPipeline.ts`'s detached child process
only survives on a long-running server — Vercel's serverless functions exit
once the response is sent. A real deployment needs a queue (e.g. a Vercel
Cron-triggered worker, or a proper job queue) instead.

## Claude Code disclosure

This project was built end-to-end with Claude Code, from `PROJECT_GUIDE.md`
as the specification: scaffolding the Next.js/Prisma project, porting the
FortyGuard Python quickstart's client patterns to TypeScript, writing all
computation logic and its unit tests, building the ingestion pipeline and API
routes, and building the frontend. Claude Code also discovered and worked
around the API quirks and reliability issues documented above by making live
test calls against the real FortyGuard API during the build (not by
inference from the spec alone), and caught a live bug in Prisma 7's
`findUnique`-with-null behavior before it could affect the cache-first
ingestion design.

A follow-up pass then applied the finalized real seed data and the two
Section 8 resolutions above. That pass also caught that the new, narrower
demo schedule (a 6h grazing window and a 2h transport window, both centered
on peak heat) made the previous demo-seed climate tuning produce zero
optimizer improvement — the exact failure mode the spec's own Section 0.5
warns against — and retuned it to restore a genuine, backtest-holding
result for both checkpoints (see [Demo farm data](#demo-farm-data--why-its-synthetic)).
