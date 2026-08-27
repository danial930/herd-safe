"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, RotateCw, TriangleAlert } from "lucide-react";
import { userFacingMessage, type FortyGuardErrorCategory } from "@/lib/fortyguard/errors";

interface FarmStatus {
  status: string;
  statusStage: string | null;
  statusError: string | null;
  statusErrorCategory: FortyGuardErrorCategory | null;
}

const POLL_INTERVAL_MS = 2500;
/** Categories where the failure is plausibly transient — an unavailable
 * service or a bad response, not our own code — so a Retry action makes
 * sense. "application" (a bug in our own ingestion code) is excluded since
 * retrying without a fix would just fail the same way. */
const RETRYABLE_CATEGORIES: FortyGuardErrorCategory[] = ["network", "api"];

export function ProcessingView({ farmId }: { farmId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<FarmStatus | null>(null);
  const [retrying, setRetrying] = useState(false);
  // Same synchronous-guard reasoning as FarmForm.tsx's submitInFlightRef —
  // `retrying` state alone can't rule out a fast double-click firing
  // handleRetry twice before React re-renders the disabled button, and each
  // call re-runs real, billed ingestion.
  const retryInFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const res = await fetch(`/api/farms/${farmId}/status`, { cache: "no-store" });
        if (!res.ok) throw new Error("Farm not found");
        const { farm } = await res.json();
        if (cancelled) return;
        setStatus(farm);
        if (farm.status === "ready") {
          router.push(`/farms/${farmId}`);
          return;
        }
      } catch {
        // transient — keep polling
      }
      if (!cancelled) timer = setTimeout(poll, POLL_INTERVAL_MS);
    }

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [farmId, router]);

  async function handleRetry() {
    if (retryInFlightRef.current) return;
    retryInFlightRef.current = true;
    setRetrying(true);
    try {
      const res = await fetch(`/api/farms/${farmId}/retry`, { method: "POST" });
      if (!res.ok) throw new Error("Retry failed to start");
      setStatus({ status: "processing", statusStage: null, statusError: null, statusErrorCategory: null });
    } catch {
      retryInFlightRef.current = false;
      setRetrying(false);
    }
  }

  if (status?.status === "failed") {
    const category = status.statusErrorCategory;
    const canRetry = category !== null && RETRYABLE_CATEGORIES.includes(category);
    const message = category ? userFacingMessage(category) : (status.statusError ?? "The ingestion pipeline failed unexpectedly.");

    return (
      <div className="flex flex-col items-center gap-4 py-20 text-center">
        <TriangleAlert className="h-10 w-10" style={{ color: "var(--status-severe)" }} aria-hidden />
        <div>
          <h1 className="font-display text-xl font-semibold text-text-primary">
            {canRetry ? "Temporarily unavailable" : "Something went wrong"}
          </h1>
          <p className="mt-1 max-w-md text-sm text-text-secondary">{message}</p>
        </div>
        <div className="flex items-center gap-4">
          {canRetry && (
            <button
              onClick={handleRetry}
              disabled={retrying}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
            >
              <RotateCw className={`h-4 w-4 ${retrying ? "animate-spin" : ""}`} aria-hidden />
              {retrying ? "Retrying…" : "Retry"}
            </button>
          )}
          <Link href="/" className="text-sm font-medium text-brand hover:underline">
            ← Back to the demo farm
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-6 py-24 text-center">
      <Loader2 className="h-9 w-9 animate-spin text-brand" aria-hidden />
      <div>
        <h1 className="font-display text-xl font-semibold text-text-primary">Analyzing heat risk…</h1>
        <p className="mt-2 font-mono text-sm text-text-secondary">
          {status?.statusStage ?? "Starting up…"}
        </p>
      </div>
      <p className="max-w-sm text-xs text-text-muted">
        We&apos;re pulling real current temperature and humidity from FortyGuard for each checkpoint and computing
        THI/spoilage risk — this usually takes under a minute.
      </p>
    </div>
  );
}
