"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MapPin, Milk, Truck, Warehouse } from "lucide-react";
import { LocationPicker } from "./LocationPicker";
import type { FarmFormInput } from "@/lib/farms/createFarm";

interface FarmFormProps {
  mode: "create" | "edit";
  farmId?: string;
  initialValues?: FarmFormInput;
}

/**
 * The form's own draft state, distinct from FarmFormInput (the validated
 * wire payload — see lib/farms/createFarm.ts): the four coordinate fields
 * are nullable here, representing "not chosen yet." The form used to
 * default these to a real Houston-area coordinate pair, which meant a
 * premature submit (e.g. pressing Enter in the location search box — now
 * fixed separately in LocationPicker.tsx) silently created a farm at a
 * location the user never actually picked. Starting empty + gating submit
 * (handleSubmit below) on all four being real numbers closes that off
 * structurally, not just by fixing the one triggering interaction.
 */
type FarmFormDraft = Omit<FarmFormInput, "farmLatitude" | "farmLongitude" | "storageLatitude" | "storageLongitude"> & {
  farmLatitude: number | null;
  farmLongitude: number | null;
  storageLatitude: number | null;
  storageLongitude: number | null;
};

const DEFAULTS: FarmFormDraft = {
  name: "",
  farmLatitude: null,
  farmLongitude: null,
  storageLatitude: null,
  storageLongitude: null,
  grazingStart: "06:00",
  grazingEnd: "18:00",
  transportDepartureTime: "05:00",
  herdSize: null,
};

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="mb-1.5 block text-sm font-medium text-text-primary">{children}</label>;
}

const inputClasses =
  "w-full rounded-lg border border-border-subtle bg-white px-3 py-2 text-sm text-text-primary outline-none transition focus:border-brand";

export function FarmForm({ mode, farmId, initialValues }: FarmFormProps) {
  const router = useRouter();
  const [values, setValues] = useState<FarmFormDraft>(initialValues ?? DEFAULTS);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A plain boolean ref, checked synchronously at the very top of
  // handleSubmit — `submitting` state alone isn't enough to rule out a
  // double-submit: React batches/re-renders asynchronously, so a fast
  // double-click can fire handleSubmit twice before the disabled button
  // attribute actually takes effect in the DOM. Each submit creates a real
  // farm with real billed ingestion (lib/ingestion/runFarmPipeline.ts) —
  // this makes that race structurally impossible rather than just unlikely.
  const submitInFlightRef = useRef(false);

  function set<K extends keyof FarmFormDraft>(key: K, value: FarmFormDraft[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  const missingFarmLocation = values.farmLatitude === null || values.farmLongitude === null;
  const missingStorageLocation = values.storageLatitude === null || values.storageLongitude === null;
  const locationsIncomplete = missingFarmLocation || missingStorageLocation;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitInFlightRef.current) return;

    setError(null);

    // Belt-and-suspenders alongside the disabled submit button below and
    // the search box's Enter-key fix (LocationPicker.tsx) — no path should
    // be able to create a farm without a real, user-chosen location. Direct
    // property checks here (not the precomputed missing*/locationsIncomplete
    // booleans above) so TypeScript can narrow values.*Latitude/*Longitude
    // to `number` for the payload below.
    const { farmLatitude, farmLongitude, storageLatitude, storageLongitude } = values;
    if (farmLatitude === null || farmLongitude === null) {
      setError("Please select the pasture location on the map before submitting.");
      return;
    }
    if (storageLatitude === null || storageLongitude === null) {
      setError("Please select the storage location on the map before submitting.");
      return;
    }

    submitInFlightRef.current = true;
    setSubmitting(true);
    const payload: FarmFormInput = { ...values, farmLatitude, farmLongitude, storageLatitude, storageLongitude };

    try {
      const url = mode === "create" ? "/api/farms" : `/api/farms/${farmId}`;
      const method = mode === "create" ? "POST" : "PUT";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Something went wrong — try again.");
      }
      const { farm } = await res.json();
      router.push(`/farms/${farm.id}/processing`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong — try again.");
      submitInFlightRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div>
        <FieldLabel>Farm name</FieldLabel>
        <input
          type="text"
          required
          value={values.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="e.g. Brazos Valley Dairy"
          className={inputClasses}
        />
      </div>

      <section className="rounded-xl border border-border-subtle p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-primary">
          <Milk className="h-4 w-4 text-brand" aria-hidden />
          Pasture
        </h2>
        <LocationPicker
          label="Pasture location"
          latitude={values.farmLatitude}
          longitude={values.farmLongitude}
          onChange={(lat, lon) => setValues((v) => ({ ...v, farmLatitude: lat, farmLongitude: lon }))}
        />
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <FieldLabel>Grazing start</FieldLabel>
            <input
              type="time"
              required
              value={values.grazingStart}
              onChange={(e) => set("grazingStart", e.target.value)}
              className={inputClasses}
            />
          </div>
          <div>
            <FieldLabel>Grazing end</FieldLabel>
            <input
              type="time"
              required
              value={values.grazingEnd}
              onChange={(e) => set("grazingEnd", e.target.value)}
              className={inputClasses}
            />
          </div>
        </div>
        <div className="mt-3">
          <FieldLabel>Herd size (optional)</FieldLabel>
          <input
            type="number"
            min={0}
            step={1}
            value={values.herdSize ?? ""}
            onChange={(e) => set("herdSize", e.target.value === "" ? null : Number(e.target.value))}
            placeholder="e.g. 150"
            className={inputClasses}
          />
          <p className="mt-1 text-xs text-text-muted">
            Used for herd-level water/feed/shade totals on the Checkpoint Detail screen. Leave blank to see per-animal
            figures instead.
          </p>
        </div>
      </section>

      <section className="rounded-xl border border-border-subtle p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-primary">
          <Truck className="h-4 w-4 text-brand" aria-hidden />
          Transport
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <FieldLabel>Departure time</FieldLabel>
          <span />
          <input
            type="time"
            required
            value={values.transportDepartureTime}
            onChange={(e) => set("transportDepartureTime", e.target.value)}
            className={inputClasses}
          />
        </div>
        <p className="mt-2 flex items-center gap-1 text-xs text-text-muted">
          <MapPin className="h-3 w-3" aria-hidden />
          Route runs from the pasture coordinates above to the storage coordinates below.
        </p>
      </section>

      <section className="rounded-xl border border-border-subtle p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-primary">
          <Warehouse className="h-4 w-4 text-brand" aria-hidden />
          Storage
        </h2>
        <LocationPicker
          label="Storage location"
          latitude={values.storageLatitude}
          longitude={values.storageLongitude}
          onChange={(lat, lon) => setValues((v) => ({ ...v, storageLatitude: lat, storageLongitude: lon }))}
        />
      </section>

      {error && (
        <p className="rounded-lg px-3 py-2 text-sm" style={{ background: "var(--status-severe-tint)", color: "var(--status-severe)" }}>
          {error}
        </p>
      )}

      {!error && locationsIncomplete && (
        <p className="text-xs text-text-muted">
          Select both the pasture and storage locations on the map above to continue.
        </p>
      )}

      <button
        type="submit"
        disabled={submitting || locationsIncomplete}
        className="inline-flex items-center justify-center gap-2 rounded-full bg-brand px-5 py-3 text-sm font-semibold text-white transition hover:bg-brand-ink disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        {mode === "create" ? "Analyze Heat Risk" : "Save & Re-analyze"}
      </button>
    </form>
  );
}
