/**
 * Synthetic-but-realistic hourly climate curves for the permanent demo-seed
 * farm (PROJECT_GUIDE.md Section 4/13) — a right-shaped Texas summer diurnal
 * pattern, no FortyGuard API call. Run through the same real THI/optimizer/
 * backtest/dollar-impact pipeline as live-ingested data, so the demo
 * dashboard is fully and correctly populated without spending API credits on
 * placeholder coordinates that get replaced once real ones are chosen.
 *
 * Kept isolated in this one file so swapping the demo-seed farm to a real
 * FortyGuard pull later is a clean, contained change — see scripts/seed.ts.
 *
 * Deterministic (seeded by date string), not `Math.random()` — so re-running
 * the seed script reproduces the exact same dataset every time.
 */

export interface SyntheticHourlySample {
  hour: number;
  temperatureC: number;
  humidityPct: number;
  aqi: number;
}

/** mulberry32 — tiny deterministic PRNG so the fixture is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0;
  }
  return hash;
}

/**
 * One day's 24-hour curve: sinusoidal temperature peaking mid-afternoon,
 * humidity anti-correlated with temperature, AQI wandering in a
 * good-to-moderate band. `peakTemperatureC` lets callers vary intensity
 * (e.g. slightly hotter/cooler across the 3 synthetic years).
 */
export function generateSyntheticDay(
  dateISO: string,
  options?: { peakTemperatureC?: number; troughTemperatureC?: number },
): SyntheticHourlySample[] {
  const peakTemperatureC = options?.peakTemperatureC ?? 37;
  const troughTemperatureC = options?.troughTemperatureC ?? 25;
  const rand = mulberry32(hashSeed(dateISO));

  const amplitude = (peakTemperatureC - troughTemperatureC) / 2;
  const mean = (peakTemperatureC + troughTemperatureC) / 2;
  // Peak at 15:00 local, trough at 03:00 — a 24h sinusoid phase-shifted so
  // hour 15 is the max.
  const phaseShiftHours = 15;

  return Array.from({ length: 24 }, (_, hour) => {
    const angle = ((hour - phaseShiftHours) / 24) * 2 * Math.PI;
    const noise = (rand() - 0.5) * 1.2;
    const temperatureC = mean + amplitude * Math.cos(angle) + noise;

    // Humidity: highest overnight/early morning, lowest mid-afternoon —
    // roughly inverse of the temperature curve, clamped to a realistic band.
    const humidityBase = 78 - ((temperatureC - troughTemperatureC) / (peakTemperatureC - troughTemperatureC)) * 38;
    const humidityPct = Math.min(95, Math.max(30, humidityBase + (rand() - 0.5) * 6));

    const aqi = Math.min(140, Math.max(15, 55 + (rand() - 0.5) * 60));

    return { hour, temperatureC, humidityPct, aqi };
  });
}

/** A full week of synthetic days, per PROJECT_GUIDE.md Section 8.4's
 * "average the hourly THI curve for the target week" framing. */
export function generateSyntheticWeek(
  datesISO: string[],
  options?: { peakTemperatureC?: number; troughTemperatureC?: number },
): Record<string, SyntheticHourlySample[]> {
  const week: Record<string, SyntheticHourlySample[]> = {};
  for (const date of datesISO) {
    week[date] = generateSyntheticDay(date, options);
  }
  return week;
}

/** A rolling N-hour forecast window starting at the given hour, for the
 * storage checkpoint's current+12h-forecast use case. */
export function generateSyntheticForecast(
  startDateISO: string,
  startHour: number,
  hours: number,
  options?: { peakTemperatureC?: number; troughTemperatureC?: number },
): Array<{ dateISO: string; hour: number } & Omit<SyntheticHourlySample, "hour">> {
  const day = generateSyntheticDay(startDateISO, options);
  const nextDay = generateSyntheticDay(
    new Date(new Date(`${startDateISO}T00:00:00.000Z`).getTime() + 86_400_000).toISOString().slice(0, 10),
    options,
  );

  return Array.from({ length: hours }, (_, i) => {
    const hour = (startHour + i) % 24;
    const crossesIntoNextDay = startHour + i >= 24;
    const sample = crossesIntoNextDay ? nextDay[hour] : day[hour];
    return {
      dateISO: crossesIntoNextDay
        ? new Date(new Date(`${startDateISO}T00:00:00.000Z`).getTime() + 86_400_000).toISOString().slice(0, 10)
        : startDateISO,
      hour,
      temperatureC: sample.temperatureC,
      humidityPct: sample.humidityPct,
      aqi: sample.aqi,
    };
  });
}
