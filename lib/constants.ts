/**
 * Every constant referenced anywhere in HerdSafe lives here — thresholds,
 * endpoint URLs, sweep ranges, dollar-impact source numbers. Nothing in this
 * codebase should hardcode a magic number or URL outside this file
 * (PROJECT_GUIDE.md Section 7, rule 3).
 */

// ---------------------------------------------------------------------------
// FortyGuard API
// ---------------------------------------------------------------------------
//
// FORTYGUARD_API_KEY/FORTYGUARD_BASE_URL deliberately do NOT live here, even
// though every other constant in the app does (see the file-level rule
// above) — this file is imported by client components too (e.g.
// RiskGauge.tsx via THI_BANDS below), and a production build confirmed that
// pulls the WHOLE module into the browser bundle, including
// `process.env.FORTYGUARD_API_KEY`/`FORTYGUARD_BASE_URL` references (the
// literal secret VALUE is never inlined — Next.js only does that for
// NEXT_PUBLIC_-prefixed vars — but the reference itself has no business
// shipping to the browser at all). Both now live directly in
// lib/fortyguard/client.ts, the only file that ever reads them, which is
// itself never imported by any "use client" component (verified directly
// against a real build's client chunks, not assumed).

/** date_time.filter_type values shared by /v1/heatmap and /v1/env_params. */
export const FILTER_TYPE = {
  SINGLE_HOUR: 1,
  RANGE_OF_HOURS: 2,
  SINGLE_DAY: 3,
  RANGE_OF_DAYS: 4,
} as const;

/** analytic_type values for /v1/heatmap. */
export const ANALYTIC_TYPE = {
  TCM: "tcm",
  TIME_OF_MEASURE: "time_of_measure",
  EXCEEDANCE: "exceedance",
  PERSISTENCE: "persistence",
} as const;

/** Spatial resolution options (meters) for /v1/heatmap, per the quickstart docs. */
export const GRANULARITY_METERS = {
  COARSE: 100,
  BALANCED: 80,
  FINE: 60,
} as const;

/** Default granularity used for farm/transport AOI heatmap pulls. */
export const DEFAULT_GRANULARITY_METERS = GRANULARITY_METERS.COARSE;

/**
 * °C threshold used for the *exploratory* exceedance/persistence heatmaps
 * (hot-zone visualization only — never used for the THI exposure math, which
 * we compute ourselves from real per-hour temperature+humidity pairs; see
 * PROJECT_GUIDE.md Section 3's exceedance/persistence gotcha).
 */
export const EXPLORATORY_HEATMAP_THRESHOLD_C = 30;

/** Bounded polling: Heat Intelligence in particular can take several minutes. */
export const FORTYGUARD_POLL = {
  INTERVAL_MS: 3_000,
  TIMEOUT_MS: 30 * 60 * 1000, // 30 minutes
  HEAT_INTELLIGENCE_TIMEOUT_MS: 30 * 60 * 1000,
} as const;

/** Per-HTTP-request timeout (distinct from the overall poll timeout above). */
export const FORTYGUARD_REQUEST_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Historical ingestion window
// ---------------------------------------------------------------------------

/** Years backtested for the farm/transport schedule optimizer. */
export const HISTORICAL_YEARS = [2023, 2024, 2025] as const;

/** Earliest date FortyGuard has historical coverage for. */
export const FORTYGUARD_HISTORY_START_DATE = "2021-01-01";

/**
 * A real per-hour temperature series requires one filter_type=1 heatmap call
 * PER HOUR (see PROJECT_GUIDE.md Section 3, step 1 — neither filter_type=2
 * "range of hours" nor filter_type=3 "single day" return a genuine hourly
 * array from the tcm heatmap; they return a single aggregate/min/max/average
 * instead). Pulling a full year hour-by-hour is prohibitively expensive, so
 * the historical ingestion samples one representative peak-heat week per
 * year instead — this is what the optimizer/backtest/historical-analog
 * functions need (Section 8.4 explicitly describes averaging "the hourly THI
 * curve for the target week"), not a full 3-year hourly grid.
 */
export const HISTORICAL_SAMPLE_WEEK = {
  /** Month is 1-indexed (8 = August, peak Northern-hemisphere summer heat). */
  month: 8,
  startDay: 1,
  endDay: 7,
} as const;

/**
 * Half-width (meters, approximated in degrees) of the small buffer square
 * built around a representative point for tcm heatmap pulls — we want the
 * checkpoint's representative temperature, not a full tile grid.
 *
 * DISCOVERED RELIABILITY ISSUE, confirmed at a real coordinate with
 * DEFAULT_GRANULARITY_METERS (100m tiles), via a live billed call against a
 * PAST (non-forecast) date so recency couldn't be the cause: 75m and 150m
 * returned zero tiles (n_cells: 0, empty map_data.features); 250m reliably
 * returned one at the same point/date. 300m is used here for a small margin
 * above that empirically-confirmed threshold.
 *
 * IMPORTANT — a *separate*, later zero-tile failure at a different real
 * coordinate (a farm's transport-route point) was initially mis-diagnosed as
 * the same buffer issue and "fixed" by escalating the buffer up to 2000m —
 * which didn't help, and cost real credits finding that out. A follow-up
 * test (same coordinate, same 500m buffer, but a date from over a year in
 * the past) returned 90 tiles immediately. That proved the second failure
 * was FORECAST-DATA RECENCY/PROCESSING LAG, not a buffer/coverage problem at
 * all — see fetchHourlyTemperatureWithRecencyFallback() in climatePull.ts,
 * which is the actual fix for that failure mode. Before touching this
 * constant again for a new failure, confirm with a past-date test first
 * (same coordinate, same buffer) — don't assume buffer size is the cause.
 *
 * BUMPED from 300 to 1500 after the credit-cost measurement harness directly
 * confirmed AOI size has NO effect on heatmap cost — a ~5x-larger area
 * (1142 tiles vs. 224) billed the identical 4,220 credits. So a generous
 * buffer is a free safety margin against the grid-alignment zero-tile issue
 * above, not a cost/reliability tradeoff — there's no longer a reason to
 * keep it tight.
 */
export const CLIMATE_POINT_BUFFER_METERS = 1500;

/**
 * A zero-tile response at CLIMATE_POINT_BUFFER_METERS triggers one retry at
 * this larger half-width before giving up — genuine defense against the
 * grid-alignment issue this was originally sized for (see the doc comment
 * above). This is NOT the right tool for a recency-driven failure — see
 * fetchHourlyTemperatureWithRecencyFallback() for that case instead. Kept
 * generous like the base buffer above, since AOI size is confirmed free.
 */
export const CLIMATE_POINT_BUFFER_ESCALATION_METERS = [3000];

/**
 * For the current/forecast pull (STORAGE and, going forward, any reactive-
 * only checkpoint), a zero-tile response on a near-term forecast hour is
 * more likely to be processing lag than a coverage gap (confirmed — see
 * CLIMATE_POINT_BUFFER_METERS's doc comment). Rather than escalate the
 * buffer (pulling a bigger, less representative area for no real fix, and
 * costing more credits), retry the same point/buffer at earlier hours —
 * "current conditions" tolerates being a little stale, just not silently
 * very stale. Capped at 3 hours back.
 */
export const RECENCY_FALLBACK_MAX_HOURS_BACK = 3;

/**
 * The Add Farm form (PROJECT_GUIDE.md Section 4, screen 2) collects a single
 * farm coordinate, not a hand-drawn pasture boundary — so the FARM
 * checkpoint's AOI polygon is auto-generated as a buffer square around that
 * point. This is a placeholder pasture size; a future version would let
 * users draw or upload a real boundary.
 */
export const FARM_AOI_BUFFER_METERS = 300;

/** Max concurrent in-flight FortyGuard requests during a bulk ingestion pull. */
export const INGESTION_CONCURRENCY = 5;

/**
 * env_params requires a `temperature` anchor input even though we only trust
 * `relative_humidity_percent` from its response (see the anchor gotcha in
 * PROJECT_GUIDE.md Section 3). The anchor's value doesn't affect humidity, so
 * this is an arbitrary-but-fixed placeholder purely to keep the request
 * payload consistent and the cache key stable.
 */
export const ENV_PARAMS_HUMIDITY_ANCHOR_C = 25;

// ---------------------------------------------------------------------------
// THI (Temperature-Humidity Index) — cattle heat stress
// Bands per Armstrong 1994, as specified in PROJECT_GUIDE.md Section 8.
// ---------------------------------------------------------------------------

export const THI_BANDS = {
  COMFORT_MAX: 72, // < 72 => comfort
  MILD_MAX: 80, // 72-79 => mild
  MODERATE_MAX: 90, // 80-89 => moderate; >= 90 => severe
} as const;

export type ThiCategory = "comfort" | "mild" | "moderate" | "severe";

/** THI exposure threshold used by the exposure/optimizer functions — hours at
 * or above this value count as "exposed" (PROJECT_GUIDE.md Section 8.1). */
export const THI_EXPOSURE_THRESHOLD = THI_BANDS.COMFORT_MAX;

// ---------------------------------------------------------------------------
// Spoilage risk (storage checkpoint)
// ---------------------------------------------------------------------------

/**
 * Safe upper bound for raw milk cold storage. Source: U.S. FDA Grade "A"
 * Pasteurized Milk Ordinance (PMO) — raw milk must be cooled to 4.4°C (40°F)
 * or below within 4 hours of the first milking and held at or below that
 * temperature until processing. We use 4°C as a slightly conservative round
 * threshold, matching PROJECT_GUIDE.md Section 8's "~4°C / 39°F" spec.
 */
export const SPOILAGE_TEMP_CEILING_C = 4;

/**
 * Reactive forecast window for all three checkpoint types on a new farm
 * (FARM/TRANSPORT_ROUTE/STORAGE) — current conditions + this many hours,
 * never historically backtested (that path is separately gated off live
 * farm creation entirely — see lib/ingestion/historicalIngest.ts).
 *
 * REDUCED from 12 to 1 after the credit-cost measurement harness confirmed
 * each hour is its own billed heatmap call (~4,220 credits, flat regardless
 * of parameters) — pullRealHourlyClimateForTimestamps fetches one tcm call
 * per requested hour, not one call covering a range. At 12h this was
 * ~50,640 credits/checkpoint (~151,920/farm across 3 checkpoints); at 1h
 * it's ~4,220/checkpoint (~12,660/farm), plus one ~2,900-credit env_params
 * call per checkpoint (~8,700/farm) = ~21,360 credits/farm total. The demo
 * seed farm's synthetic storage forecast (prisma/seed.ts) is unaffected —
 * it's fixture data, not a live pull, and intentionally still shows a
 * 12-hour window since it costs nothing.
 */
export const REACTIVE_FORECAST_HOURS = 1;

/**
 * calculateSpoilageRisk() is a generic "count hours at/above a ceiling"
 * utility — SPOILAGE_TEMP_CEILING_C is the actual food-safety standard, but
 * FortyGuard only exposes AMBIENT outdoor conditions, never a facility's
 * actual internal refrigeration reading (no IoT sensor integration exists
 * here). Comparing ambient air directly to that ceiling isn't physically
 * meaningful on its own — a Texas summer day would read "unsafe" by that
 * comparison on nearly every hour, regardless of how well the facility's
 * refrigeration is actually performing.
 *
 * So this threshold does NOT mean "the milk is at ambient temperature" —
 * it's a proxy for REFRIGERATION EQUIPMENT STRAIN AND OUTAGE RISK: extreme
 * ambient heat increases the load on cooling systems and raises the stakes
 * of any power outage or equipment failure during that window. Every place
 * this threshold is surfaced (badges, chart labels, log messages) must
 * communicate that framing explicitly — never imply the stored product
 * itself is confirmed to be at ambient temperature. This is an honest,
 * defensible proxy model, not a validated direct measurement. A future
 * version with real facility sensor data would compare that reading to
 * SPOILAGE_TEMP_CEILING_C directly instead of this proxy.
 */
export const AMBIENT_HEAT_STRAIN_THRESHOLD_C = 35;

/**
 * Rolling lookback window for the ambient-heat-frequency signal (FARM/
 * TRANSPORT_ROUTE checkpoints on every new farm — see
 * lib/ingestion/ambientHeatFrequency.ts): one real exceedance call + one real
 * persistence call, both filter_type=4 (date range) against this many past
 * days, reusing AMBIENT_HEAT_STRAIN_THRESHOLD_C. Deliberately separate from
 * the THI-based historical backtest (HISTORICAL_YEARS) — this is a much
 * cheaper, coarser "how often has it been this hot lately" signal, not a
 * replacement for the gated multi-year pull.
 */
export const AMBIENT_HEAT_FREQUENCY_WINDOW_DAYS = 30;

// ---------------------------------------------------------------------------
// Worker comfort (all three checkpoints) — EPA AQI bands combined with THI.
// ---------------------------------------------------------------------------

/** EPA Air Quality Index breakpoints (https://www.airnow.gov/aqi/aqi-basics/). */
export const AQI_BANDS = {
  GOOD_MAX: 50,
  MODERATE_MAX: 100,
  UNHEALTHY_SENSITIVE_MAX: 150,
} as const;

export type WorkerComfortLevel = "good" | "suitable" | "bad" | "intolerable";

// ---------------------------------------------------------------------------
// Exposure & schedule optimizer (farm + transport checkpoints)
// ---------------------------------------------------------------------------

export const OPTIMIZER = {
  SWEEP_RANGE_MINUTES: 90,
  STEP_MINUTES: 15,
} as const;

/**
 * The transport checkpoint's schedule stores only a departure time (no route
 * duration field), so exposure calculations need an assumed transit length.
 * 2 hours is a realistic farm-to-storage-facility drive; placeholder until
 * real route data is collected, at which point this becomes a per-checkpoint
 * field rather than a global constant.
 */
export const TRANSPORT_DEFAULT_DURATION_MINUTES = 120;

// ---------------------------------------------------------------------------
// Dollar impact — published-rate derivation
//
// Sources:
// - West, D.M. (2003), "Effects of heat-stress on production in dairy
//   cattle," J. Dairy Sci. 86(6): documents milk yield decline accelerating
//   above THI ~72, with severe decline (up to ~19%) sustained at THI > 80.
// - Zimbelman et al. (2009) established the widely-cited THI heat-stress
//   thresholds for lactating dairy cattle (mirrored in Section 8's bands).
// - St-Pierre, N.R. et al. (2003), "Economic Losses from Heat Stress by US
//   Livestock Industries," J. Dairy Sci. 86(E. Suppl.): economy-wide baseline
//   for heat-stress cost estimation methodology.
//
// Derivation of YIELD_LOSS_LITERS_PER_SEVERE_THI_COW_HOUR:
//   A ~30 L/day US Holstein losing ~19% of daily yield (5.7 L) during a day
//   whose severe-THI (>=90) window runs roughly 8 hours (typical mid-summer
//   afternoon/evening duration) implies ~0.71 L lost per severe-THI cow-hour.
//   This lands inside the guide's cited 0.24-0.72 kg/day-per-THI-unit range,
//   so we treat it as the defensible per-hour rate for the optimizer's
//   dollar-impact rollup. Recalibrate once real herd-size/yield data exists.
// ---------------------------------------------------------------------------

export const DOLLAR_IMPACT = {
  /** USD per liter, farm-gate. Source: USDA-ERS/AMS, 2026 all-milk farm
   * price ~$18.95/cwt (1 cwt = 100 lb = 45.36 kg; milk density ~1.03 kg/L)
   * -> ~$0.43/L. This moves with the market — it was ~$1.97/gallon
   * (~$0.52/L) in 2024; use the more current figure and keep the source
   * year current when it's next revisited. */
  MILK_PRICE_USD_PER_LITER: 0.43,
  /** See derivation note above. */
  YIELD_LOSS_LITERS_PER_SEVERE_THI_COW_HOUR: 0.71,
  /**
   * Estimated cost of one flagged spoilage-risk event at the storage
   * checkpoint: the value of one full spoiled tanker load. A standard
   * over-the-road raw-milk tanker holds ~5,500 gallons (~20,800 liters) —
   * documented in dairy-industry transport literature. At the
   * MILK_PRICE_USD_PER_LITER farm-gate price above, one full lost load is
   * ~$9,000 (20,800 L x $0.43/L, equivalently 5,500 gal x ~$1.63/gal).
   */
  SPOILAGE_EVENT_COST_USD: 9000,
} as const;

/**
 * Minimum number of cached ComputedRisk hours a STORAGE checkpoint needs
 * before its spoilage-risk dollar estimate is considered credible enough to
 * show as a number, rather than "not available" — same honesty standard as
 * milkYieldEstimateAvailable (lib/impact/computeChainSummary.ts).
 *
 * BUG this fixes: a reactive-only checkpoint (REACTIVE_FORECAST_HOURS=1) has
 * exactly ONE cached hour. If that single reading happened to land a
 * fraction of a degree above AMBIENT_HEAT_STRAIN_THRESHOLD_C,
 * spoilageEventsAvoided flipped to 1 and the UI showed a flat, full
 * SPOILAGE_EVENT_COST_USD ($9,000) — a hard dollar claim from one ambient
 * reading, no sustained pattern behind it at all. The underlying risk
 * FLAG/badge is unaffected by this threshold (one hour over threshold is
 * still a legitimate reason to warn a farm operator) — only the dollar
 * figure is gated, matching the same "don't let a thin-data case display as
 * a verified number" rule already applied to milk yield.
 */
export const SPOILAGE_ESTIMATE_MIN_OBSERVED_HOURS = 6;

// ---------------------------------------------------------------------------
// Herd size — used to scale per-cow exposure into a farm-level dollar impact.
// Placeholder until real farm data is collected; lives here so it's a single
// data change, not a code change, per PROJECT_GUIDE.md Section 13.
// ---------------------------------------------------------------------------

export const DEFAULT_HERD_SIZE = 150;

// ---------------------------------------------------------------------------
// Herd impact metrics (Checkpoint Detail modal, FARM checkpoint only) — pure
// derived computations on temperature/THI data already cached from the
// reactive pull. Zero additional FortyGuard calls. Deliberately separate
// from the dollar-impact estimate/optimizer — descriptive operational
// numbers, not fed back into either. Each constant below cites its source in
// full; verify against the primary source before changing any of them.
// ---------------------------------------------------------------------------

/**
 * Water: +1 gallon/head/day for every 10°F the ambient temperature sits
 * above 40°F. Source: Oklahoma State University Extension (Paul Beck, OSU
 * Extension beef nutrition specialist), "Watch for heat stress in livestock
 * as temps climb" (extension.okstate.edu/articles/2022/cattle-heat-stress) —
 * "When temperatures are above 40°F, water intake should increase by 1
 * gallon for every 10°F increase in temperature." 40°F is the source's own
 * stated applicability floor, used here as the reference point rather than
 * an invented "comfortable" baseline — so this is best read as "water needed
 * above cold-weather baseline," not "water needed above comfort," and will
 * report a nonzero figure on a merely mild day, not only a hot one.
 */
export const WATER_DEMAND_BASELINE_TEMP_F = 40;
export const WATER_GALLONS_PER_10F_ABOVE_BASELINE = 1;

/**
 * Feed intake: dry matter intake drops 0.29 kg/day per THI-unit above
 * THI_BANDS.COMFORT_MAX (the Armstrong 1994 comfort threshold already used
 * throughout this app for THI categorization/exposure — see THI_BANDS
 * above). Source: "Negative relationship between dry matter intake and the
 * temperature-humidity index with increasing heat stress in cattle: a
 * global meta-analysis," International Journal of Biometeorology (2021),
 * DOI 10.1007/s00484-021-02167-0 — North America-specific coefficient
 * (0.29 kg/day per THI unit), the lowest of all regions studied (Asia 0.57,
 * South America 0.51, Oceania 0.48, Europe 0.42 kg/day/THI-unit).
 */
export const DMI_REDUCTION_KG_PER_THI_UNIT_NORTH_AMERICA = 0.29;

/**
 * Shade: at least 40 sq ft of shade per cow for grazing dairy cattle.
 * Source: Cornell Cooperative Extension, Southwest New York Dairy, Livestock
 * & Field Crops Program, "Shielding grazing dairy cows from heat stress"
 * (swnydlfc.cce.cornell.edu) — "at least 40 square feet of shade per cow" to
 * avoid competition for shade. Corroborated by University of Minnesota
 * Extension (~40 sq ft/animal) and the California Dairy Quality Assurance
 * Program (40-50 sq ft/cow). This is a PASTURE/grazing-system figure — a
 * different housing system (feedlot confinement) uses a lower figure
 * (20-30 sq ft/head per Kansas State/Nebraska Extension) that doesn't apply
 * to HerdSafe's pasture checkpoint.
 */
export const SHADE_SQFT_PER_HEAD = 40;

/**
 * Respiration rate: a non-heat-stressed cow's resting rate is 26-50
 * breaths/min; the midpoint (38) is used as the resting reference. Source:
 * Mississippi State University Extension, "Recognizing Heat Stress in Dairy
 * Cattle: How to Visually Record Respiration Rate" (extension.msstate.edu) —
 * "A non-heat-stressed cow will have a respiration rate range of 26 to 50
 * breaths per minute." Above THI 77, respiration rate rises ~2.04
 * breaths/min per THI-unit. Source: "Critical Temperature-Humidity Index
 * Thresholds for Dry Cows in a Subtropical Climate," Frontiers in Animal
 * Science (2021) — heat-stressed treatment group: "RR began rising at a
 * rate of 2.04 breaths/min for every increase of THI" above a breakpoint of
 * THI 77. NOTE: that breakpoint/slope comes from one subtropical-climate
 * dry-cow study — used here as a general order-of-magnitude reference across
 * all climates and lactation states, an honest proxy rather than a validated
 * figure for every farm (same caveat pattern as AMBIENT_HEAT_STRAIN_THRESHOLD_C
 * below).
 */
export const RESPIRATION_RESTING_BPM = 38;
export const RESPIRATION_THI_BREAKPOINT = 77;
export const RESPIRATION_BPM_INCREASE_PER_THI_UNIT = 2.04;

// ---------------------------------------------------------------------------
// Transit impact metrics (Checkpoint Detail modal, TRANSPORT_ROUTE checkpoint
// only) — pure derived computations, zero additional FortyGuard calls.
// ---------------------------------------------------------------------------

/**
 * A SEPARATE, real PMO checkpoint from SPOILAGE_TEMP_CEILING_C above (4°C /
 * 39°F — the storage-hold ceiling milk must be cooled to and held at). This
 * one is the FDA Grade "A" Pasteurized Milk Ordinance's transport/receiving
 * standard: raw milk delivered to a processing plant or receiving station
 * must be received at 45°F (7.2°C) or below. Used here as the "still safe"
 * upper bound in transit — milk is assumed loaded at the storage ceiling
 * (SPOILAGE_TEMP_CEILING_C) and this is how far it can warm before crossing
 * into an unsafe-to-receive range.
 */
export const PMO_TRANSPORT_RECEIVING_CEILING_C = 7.2;

/**
 * Milk cooling buffer: an ILLUSTRATIVE, NOT independently sourced, insulated-
 * tanker heat-gain rate — a simple linear ("Newton's law of cooling"-style)
 * approximation: the tanker's contents warm toward ambient at this fraction
 * of the current ambient-to-milk temperature differential, per hour. E.g. at
 * a 30°F differential, milk warms ~1.5°F/hr under this assumption. This is
 * an honest proxy for the first few hours of an otherwise-exponential
 * warming curve, not a validated figure for any specific tanker's actual
 * insulation — the tooltip states this explicitly. Refine with a real
 * tanker-spec heat-transfer coefficient if one becomes available.
 */
export const TRANSIT_HEAT_GAIN_RATE_COEFFICIENT_PER_F = 0.05;

/**
 * The Twenty-Eight Hour Law (49 U.S.C. § 80502, originally 1873, reenacted
 * 1994): interstate carriers may not confine animals in a vehicle for more
 * than 28 consecutive hours without humanely unloading them for at least 5
 * consecutive hours of food, water, and rest. Shown as informational transit
 * context, not an alarm — most legs here are well under the limit.
 *
 * GAO-26-108123, "Animal Transport: Congress Should Consider Modernizing the
 * Law to Better Protect Livestock" (June 4, 2026): identifies six factors
 * that could help prevent cruelty to livestock during transport, of which
 * the current law "partly addresses" only one (duration of confinement) and
 * "does not address" the other five — including "Environmental conditions:
 * Exposure to extreme temperatures and inadequate ventilation" (Figure 2).
 * That's precisely the gap HerdSafe's heat tracking addresses; the 28-hour
 * figure below is legal/duration context only, not a temperature measure.
 */
export const TWENTY_EIGHT_HOUR_LAW_LIMIT_HOURS = 28;
export const TWENTY_EIGHT_HOUR_LAW_REST_HOURS = 5;

// ---------------------------------------------------------------------------
// Storage impact metrics (Checkpoint Detail modal, STORAGE checkpoint only)
// — pure derived computations, zero additional FortyGuard calls.
// ---------------------------------------------------------------------------

/** U.S. average commercial electricity price. Source: EIA Electric Power
 * Monthly, April 2026 data — 13.51 cents/kWh (down from March 2026's 13.92
 * cents/kWh; up 4.8% year over year from April 2025). The one genuinely
 * solid, precisely-sourced number in this section — see
 * REFRIGERATION_EXTRA_KWH_PER_DEGREE_C_ABOVE_STRAIN below for the much
 * softer assumption it's multiplied against. */
export const REFRIGERATION_ELECTRICITY_RATE_USD_PER_KWH = 0.1351;

/**
 * Additional refrigeration energy draw per °C the ambient temperature sits
 * above AMBIENT_HEAT_STRAIN_THRESHOLD_C (35°C/95°F, the app's existing
 * refrigeration-strain proxy threshold — see that constant's doc comment).
 *
 * NOT a solid, independently-sourced coefficient — searched for one before
 * hardcoding this, per the same standard applied to the herd-impact metrics
 * above. The closest real figures found were general HVAC building-cooling-
 * load studies (~2.7% additional cooling load per °F of outdoor temperature
 * rise, from energy-efficiency industry analysis, not a formal ASHRAE
 * refrigeration standard) — but turning a percentage into an absolute kWh
 * figure needs an assumed baseline system size, which would just be another
 * invented number stacked on top of an already-soft one. Rather than
 * present that as more rigorous than it is, this is a flat, clearly-labeled,
 * conservative ILLUSTRATIVE estimate for a farm-scale bulk-tank/walk-in
 * refrigeration system (~3 kWh/°C/day) — the tooltip states plainly that
 * this coefficient is an approximation pending a better source, unlike the
 * electricity rate above it.
 */
export const REFRIGERATION_EXTRA_KWH_PER_DEGREE_C_ABOVE_STRAIN = 3;

// ---------------------------------------------------------------------------
// Location picker (Add/Edit Farm form) — map, tiles, geocoding search.
// ---------------------------------------------------------------------------

/**
 * SWITCHED from CartoDB's "Positron" light basemap (2026-08-26): CartoDB's
 * free `basemaps.cartocdn.com` endpoint started returning a watermarked
 * "API KEY REQUIRED" tile on every request — confirmed live, repeatably,
 * not a transient blip. Replaced with the Wikimedia Foundation's public OSM
 * tile service (maps.wikimedia.org) — free, no API key, CORS-enabled
 * (confirmed: `access-control-allow-origin: *`), backed by WMF's own
 * infrastructure (the same tiles power Wikipedia's map features), and
 * explicitly intended for external reuse — unlike OpenStreetMap's own raw
 * tile server (osm.org), whose usage policy discourages direct third-party
 * use (the original reason CartoDB was chosen over it).
 *
 * TRADEOFF: this is OSM's standard bright/colorful cartography, not a light-
 * gray minimal style like Positron — no equivalent free, no-key, reliably-
 * CORS-enabled light basemap was found. `{r}` requests retina tiles
 * (Leaflet substitutes "@2x") on high-DPI screens, matching Wikimedia's own
 * naming convention.
 *
 * One real constraint: Wikimedia's server 403s requests with no Referer
 * header at all (confirmed via curl) — fine for normal browser tile loads
 * (Leaflet loads tiles as plain <img> tags, and browsers send an Origin-only
 * Referer by default under strict-origin-when-cross-origin, which this
 * server accepts), but would fail from a script/curl call with no Referer,
 * or a browser configured to strip it entirely (strict privacy modes).
 */
export const MAP_TILE_URL = "https://maps.wikimedia.org/osm-intl/{z}/{x}/{y}{r}.png";
export const MAP_TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export const MAP_DEFAULT_ZOOM = 12;

/**
 * Nominatim (nominatim.openstreetmap.org) — free geocoding, no API key, but
 * its usage policy requires a real identifying User-Agent (the browser's
 * default UA isn't enough, and browsers won't let client-side `fetch` set a
 * custom User-Agent at all) and asks for max ~1 request/second. So this is
 * only ever called from `app/api/geocode/route.ts` — a small server-side
 * proxy — never directly from the browser. `SEARCH_DEBOUNCE_MS` keeps the
 * client from firing a request per keystroke.
 */
export const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";
export const NOMINATIM_USER_AGENT = "HerdSafe/1.0 (hackathon project - heat-risk dairy supply chain demo)";
export const MAP_SEARCH_DEBOUNCE_MS = 600;
export const MAP_SEARCH_RESULT_LIMIT = 5;

/**
 * OSRM (router.project-osrm.org) — free, public, no-API-key driving-route
 * geometry, used only to draw a road-following line on the TRANSPORT_ROUTE
 * checkpoint's map (lib/routing/osrm.ts, components/RouteMapView.tsx).
 * Confirmed CORS-enabled (`access-control-allow-origin: *` on a live
 * response), unlike Nominatim above — no server-side proxy needed here.
 *
 * This is display geometry only, never persisted to Postgres (unlike every
 * FortyGuard call, which is cache-first there) — fetched fresh client-side
 * each time the map mounts. The public demo server explicitly isn't meant
 * for heavy/guaranteed-uptime use, so callers must fall back to a straight
 * line between waypoints on any failure/timeout rather than show a broken
 * map — see fetchRoadRoute()'s doc comment.
 */
export const OSRM_ROUTE_BASE_URL = "https://router.project-osrm.org/route/v1/driving";
export const OSRM_REQUEST_TIMEOUT_MS = 6000;

/**
 * Rough continental-US bounding box — used only for a cheap, non-blocking
 * "this pin may be outside FortyGuard's coverage" warning on the picker, not
 * for validation or to block submission. Deliberately approximate (a
 * bounding box, not the real border) since precision here isn't worth the
 * cost — FortyGuard's actual coverage note (PROJECT_GUIDE.md Section 3) is
 * just "US-only," and this excludes AK/HI, which is an accepted
 * simplification for a cheap warning.
 */
export const CONTINENTAL_US_BOUNDS = {
  minLat: 24.5,
  maxLat: 49.5,
  minLon: -125,
  maxLon: -66.5,
} as const;
