import { NextResponse } from "next/server";
import { MAP_SEARCH_RESULT_LIMIT, NOMINATIM_SEARCH_URL, NOMINATIM_USER_AGENT } from "@/lib/constants";

export interface GeocodeResult {
  displayName: string;
  latitude: number;
  longitude: number;
}

/**
 * GET /api/geocode?q=<query> — server-side proxy to Nominatim, for the Add
 * Farm form's location-search convenience (map-picker/LocationPicker.tsx).
 *
 * This exists only because Nominatim's usage policy requires a real
 * identifying User-Agent, which browsers refuse to let client-side `fetch`
 * set at all (it's a forbidden header) — so the call has to happen
 * server-side regardless. Search only re-centers the map; it never sets the
 * farm's actual coordinates by itself (the user still clicks/drags a pin).
 *
 * Not a FortyGuard call, so Section 7 rule 1 ("API routes never call
 * [FortyGuard] live") doesn't apply here — Nominatim is a fast, synchronous,
 * unrelated free service.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json({ results: [] });
  }

  const url = new URL(NOMINATIM_SEARCH_URL);
  url.searchParams.set("q", q);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", String(MAP_SEARCH_RESULT_LIMIT));
  url.searchParams.set("countrycodes", "us"); // FortyGuard coverage is US-only

  const res = await fetch(url, {
    headers: { "User-Agent": NOMINATIM_USER_AGENT },
  });

  if (!res.ok) {
    return NextResponse.json({ results: [], error: "Search unavailable" }, { status: 502 });
  }

  const body = (await res.json()) as Array<{ display_name: string; lat: string; lon: string }>;
  const results: GeocodeResult[] = body.map((r) => ({
    displayName: r.display_name,
    latitude: Number(r.lat),
    longitude: Number(r.lon),
  }));

  return NextResponse.json({ results });
}
