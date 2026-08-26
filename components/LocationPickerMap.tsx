"use client";

import "leaflet/dist/leaflet.css";
import { useEffect } from "react";
import L, { type LeafletMouseEvent, type Map as LeafletMap, type Marker as LeafletMarker } from "leaflet";
import { MapContainer, Marker, TileLayer, useMapEvents } from "react-leaflet";
import { CONTINENTAL_US_BOUNDS, MAP_DEFAULT_ZOOM, MAP_TILE_ATTRIBUTION, MAP_TILE_URL } from "@/lib/constants";

/** Wide continental-US view shown until a location is actually chosen — no
 * marker is rendered in this state (see below), so this is just an
 * orientation view, not an implied default pin. */
const EMPTY_STATE_CENTER: [number, number] = [
  (CONTINENTAL_US_BOUNDS.minLat + CONTINENTAL_US_BOUNDS.maxLat) / 2,
  (CONTINENTAL_US_BOUNDS.minLon + CONTINENTAL_US_BOUNDS.maxLon) / 2,
];
const EMPTY_STATE_ZOOM = 4;

// Leaflet's default marker icon references image paths that don't resolve
// correctly through Next.js's bundler — a small inline-SVG pin sidesteps
// that entirely instead of patching L.Icon.Default's asset URLs.
const pinIcon = L.divIcon({
  className: "",
  html: `<svg width="28" height="38" viewBox="0 0 28 38" xmlns="http://www.w3.org/2000/svg">
    <path d="M14 0C6.3 0 0 6.3 0 14c0 10.5 14 24 14 24s14-13.5 14-24c0-7.7-6.3-14-14-14z" fill="#1f6f8b" stroke="#ffffff" stroke-width="1.5"/>
    <circle cx="14" cy="14" r="5" fill="#ffffff"/>
  </svg>`,
  iconSize: [28, 38],
  iconAnchor: [14, 38],
});

function ClickHandler({ onPick }: { onPick: (lat: number, lon: number) => void }) {
  useMapEvents({
    click(e: LeafletMouseEvent) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export interface LocationPickerMapProps {
  /** `null` = no location chosen yet — renders with no marker, a wide
   * continental-US orientation view instead of implying a default pin. */
  latitude: number | null;
  longitude: number | null;
  onChange: (lat: number, lon: number) => void;
  recenterTo: [number, number] | null;
  mapRef: React.RefObject<LeafletMap | null>;
}

/** The actual Leaflet map — loaded client-only via next/dynamic (ssr:false)
 * from LocationPicker.tsx, since Leaflet touches `window` at import time. */
export default function LocationPickerMap({ latitude, longitude, onChange, recenterTo, mapRef }: LocationPickerMapProps) {
  const hasLocation = latitude !== null && longitude !== null;

  useEffect(() => {
    if (recenterTo && mapRef.current) {
      mapRef.current.flyTo(recenterTo, MAP_DEFAULT_ZOOM);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenterTo]);

  return (
    <MapContainer
      center={hasLocation ? [latitude, longitude] : EMPTY_STATE_CENTER}
      zoom={hasLocation ? MAP_DEFAULT_ZOOM : EMPTY_STATE_ZOOM}
      style={{ height: "280px", width: "100%", borderRadius: "0.75rem" }}
      ref={mapRef}
    >
      <TileLayer url={MAP_TILE_URL} attribution={MAP_TILE_ATTRIBUTION} />
      <ClickHandler onPick={onChange} />
      {hasLocation && (
        <Marker
          position={[latitude, longitude]}
          icon={pinIcon}
          draggable
          eventHandlers={{
            dragend: (e) => {
              const marker = e.target as LeafletMarker;
              const pos = marker.getLatLng();
              onChange(pos.lat, pos.lng);
            },
          }}
        />
      )}
    </MapContainer>
  );
}
