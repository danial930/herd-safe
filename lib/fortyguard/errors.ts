/** Port of fortyguard/exceptions.py from the FortyGuard Python quickstart. */

export class FortyGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FortyGuardError";
  }
}

/** The async task finished with status=failed/error. */
export class TaskFailedError extends FortyGuardError {
  constructor(message: string) {
    super(message);
    this.name = "TaskFailedError";
  }
}

/** The async task did not finish within the polling budget. */
export class TaskTimeoutError extends FortyGuardError {
  constructor(message: string) {
    super(message);
    this.name = "TaskTimeoutError";
  }
}

/**
 * The status endpoint 404'd — the activity isn't queryable yet. Expected for
 * a short window right after submission (eventual consistency); callers
 * should retry rather than fail (see client.ts's waitFor).
 */
export class ActivityNotReadyError extends FortyGuardError {
  activityId: string;
  constructor(activityId: string) {
    super(`Activity ${activityId} is not visible yet (status endpoint returned 404).`);
    this.name = "ActivityNotReadyError";
    this.activityId = activityId;
  }
}

/**
 * The request never got a response at all — DNS failure, connection reset,
 * timeout, TLS error, etc. Node's fetch (undici) throws a generic
 * "TypeError: fetch failed" for these with the real cause attached via
 * `.cause`; this wraps that so callers can distinguish "FortyGuard is
 * unreachable" from "FortyGuard responded with an error" (FortyGuardHttpError)
 * or "our own code is broken."
 */
export class FortyGuardUnavailableError extends FortyGuardError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "FortyGuardUnavailableError";
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

/**
 * FortyGuard responded, but with a non-2xx HTTP status — a real API-level
 * error (bad request, auth failure, rate limit, 5xx), as opposed to the
 * connection never completing (FortyGuardUnavailableError).
 */
export class FortyGuardHttpError extends FortyGuardError {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "FortyGuardHttpError";
    this.status = status;
  }
}

/**
 * The three buckets the Add-Farm pipeline classifies a failure into
 * (scripts/run-farm-pipeline.ts), driving both the user-facing message and
 * whether a "Retry" action makes sense:
 * - "network": the request never reached FortyGuard at all (DNS, connection
 *   reset, our own request timeout). Often transient — retry is reasonable.
 * - "api": FortyGuard responded with a non-2xx status, or the async task
 *   itself failed/timed out server-side. May be transient (5xx, rate limit)
 *   or not (a persistent 4xx) — we don't try to tell those apart further;
 *   retry is still offered since we can't distinguish reliably.
 * - "application": anything else — a bug in our own ingestion code (a
 *   Prisma error, a null-shape assumption, etc.). Retrying without a code
 *   fix would just fail the same way, so no Retry action is offered.
 */
export type FortyGuardErrorCategory = "network" | "api" | "application";

export function categorizeError(err: unknown): FortyGuardErrorCategory {
  if (err instanceof FortyGuardUnavailableError) return "network";
  if (err instanceof FortyGuardHttpError) return "api";
  if (err instanceof TaskFailedError || err instanceof TaskTimeoutError || err instanceof ActivityNotReadyError) {
    return "api";
  }
  return "application";
}

export function userFacingMessage(category: FortyGuardErrorCategory): string {
  switch (category) {
    case "network":
      return "We couldn't reach FortyGuard's temperature service — it may be temporarily unreachable. Please try again in a few minutes.";
    case "api":
      return "FortyGuard's temperature service returned an error. Please try again in a few minutes.";
    case "application":
      return "Something went wrong on our end while processing this farm. This isn't a temporary issue — please check the server logs.";
  }
}
