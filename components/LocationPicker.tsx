"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap } from "leaflet";
import { Loader2, MapPin, Search, TriangleAlert } from "lucide-react";
import { CONTINENTAL_US_BOUNDS, MAP_SEARCH_DEBOUNCE_MS } from "@/lib/constants";

const LocationPickerMap = dynamic(() => import("./LocationPickerMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[280px] w-full items-center justify-center rounded-xl border border-border-subtle bg-background text-sm text-text-muted">
      Loading map…
    </div>
  ),
});

interface GeocodeResult {
  displayName: string;
  latitude: number;
  longitude: number;
}

function isOutsideContinentalUS(lat: number, lon: number): boolean {
  return (
    lat < CONTINENTAL_US_BOUNDS.minLat ||
    lat > CONTINENTAL_US_BOUNDS.maxLat ||
    lon < CONTINENTAL_US_BOUNDS.minLon ||
    lon > CONTINENTAL_US_BOUNDS.maxLon
  );
}

export interface LocationPickerProps {
  label: string;
  /** `null` means "not chosen yet" — the Add Farm form starts this way
   * deliberately (no default pin dropped somewhere the user never picked),
   * so the map renders with no marker until a real click/search/typed
   * coordinate sets one. */
  latitude: number | null;
  longitude: number | null;
  /** Called with real numbers from a map click/drag or a search selection
   * (always a complete pair). Can also be called with `null` for one side
   * while the user is mid-way through manually typing both lat/lon fields
   * — callers should treat the location as "not set" until both are
   * non-null, not coerce a lone typed value into a fake pin. */
  onChange: (lat: number | null, lon: number | null) => void;
}

/**
 * Map-based location picker for the Add/Edit Farm form. Click the map (or
 * drag the pin) to set coordinates; the search box is a secondary
 * convenience that only re-centers the map — it never sets coordinates by
 * itself. The lat/lon number inputs below stay visible and editable, synced
 * both ways with the pin.
 */
export function LocationPicker({ label, latitude, longitude, onChange }: LocationPickerProps) {
  const mapRef = useRef<LeafletMap | null>(null);
  const justSelectedRef = useRef(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [recenterTo, setRecenterTo] = useState<[number, number] | null>(null);

  // Debounced search — fires MAP_SEARCH_DEBOUNCE_MS after the user stops
  // typing, not on every keystroke, per Nominatim's usage policy. `searching`
  // flips true immediately from the input's own onChange (a plain event
  // handler, not this effect) so the spinner shows right away; this effect
  // only owns the debounced fetch and clearing it back to false.
  useEffect(() => {
    if (justSelectedRef.current) {
      // Selecting a result sets `query` to its display name, which would
      // otherwise immediately re-trigger a search on that same text and pop
      // the dropdown back open right after picking something from it.
      justSelectedRef.current = false;
      return;
    }
    if (!query.trim()) {
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
        const body = await res.json();
        setResults(body.results ?? []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, MAP_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  function handleQueryChange(value: string) {
    setQuery(value);
    setSearching(value.trim().length > 0);
  }

  // Typing directly into the lat/lon fields moves the pin's data
  // immediately (like a map click/drag), but — unlike a click/drag, where
  // the map view is already showing the right spot — the view itself won't
  // follow unless told to, leaving the pin invisibly off-screen. Recenter
  // the same way a search selection does, so what's typed is always
  // visually confirmable.
  function handleCoordinateInput(lat: number | null, lon: number | null) {
    onChange(lat, lon);
    if (lat !== null && lon !== null && Number.isFinite(lat) && Number.isFinite(lon)) {
      setRecenterTo([lat, lon]);
    }
  }

  function selectResult(result: GeocodeResult) {
    justSelectedRef.current = true;
    setRecenterTo([result.latitude, result.longitude]);
    setResults([]);
    setQuery(result.displayName);
  }

  const outsideUS = latitude !== null && longitude !== null && isOutsideContinentalUS(latitude, longitude);

  return (
    <div className="flex flex-col gap-2">
      <label className="block text-sm font-medium text-text-primary">{label}</label>

      <div className="relative">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden />
          <input
            type="text"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            onKeyDown={(e) => {
              // This box searches automatically (debounced, above) — Enter
              // has no defined action of its own here, so its only effect
              // would otherwise be the browser's default: submitting the
              // whole Add/Edit Farm form, potentially before a location has
              // even been picked. Block that; typing + the dropdown are the
              // only ways to select a result.
              if (e.key === "Enter") e.preventDefault();
            }}
            placeholder="Search for a place to re-center the map…"
            className="w-full rounded-lg border border-border-subtle bg-white py-2 pl-9 pr-9 text-sm text-text-primary outline-none transition focus:border-brand"
          />
          {searching && (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-text-muted" aria-hidden />
          )}
        </div>
        {query.trim() && results.length > 0 && (
          <ul className="absolute z-[1000] mt-1 w-full overflow-hidden rounded-lg border border-border-subtle bg-white shadow-md">
            {results.map((r) => (
              <li key={`${r.latitude},${r.longitude}`}>
                <button
                  type="button"
                  onClick={() => selectResult(r)}
                  className="flex w-full items-start gap-2 px-3 py-2 text-left text-xs text-text-secondary hover:bg-background"
                >
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" aria-hidden />
                  {r.displayName}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <LocationPickerMap latitude={latitude} longitude={longitude} onChange={onChange} recenterTo={recenterTo} mapRef={mapRef} />

      <p className="text-xs text-text-muted">Click the map to drop a pin, or drag it to fine-tune.</p>

      {outsideUS && (
        <p className="flex items-center gap-1.5 text-xs" style={{ color: "var(--status-moderate)" }}>
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
          This pin looks like it&apos;s outside the continental US — FortyGuard&apos;s coverage is US-only.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-text-secondary">Latitude</label>
          <input
            type="number"
            step="any"
            value={latitude ?? ""}
            placeholder="Not set"
            onChange={(e) => handleCoordinateInput(e.target.value === "" ? null : Number(e.target.value), longitude)}
            className="w-full rounded-lg border border-border-subtle bg-white px-3 py-1.5 font-mono text-sm text-text-primary outline-none transition focus:border-brand"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-text-secondary">Longitude</label>
          <input
            type="number"
            step="any"
            value={longitude ?? ""}
            placeholder="Not set"
            onChange={(e) => handleCoordinateInput(latitude, e.target.value === "" ? null : Number(e.target.value))}
            className="w-full rounded-lg border border-border-subtle bg-white px-3 py-1.5 font-mono text-sm text-text-primary outline-none transition focus:border-brand"
          />
        </div>
      </div>
    </div>
  );
}
