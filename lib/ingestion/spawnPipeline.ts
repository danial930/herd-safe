import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import path from "node:path";

/**
 * Kicks off scripts/run-farm-pipeline.ts as a detached background process
 * (PROJECT_GUIDE.md Section 4, screen 2: "kick off the ingestion script as a
 * background process"). The API route returns immediately — Vercel's
 * serverless functions have short execution limits and FortyGuard tasks can
 * take minutes (Section 7, rule 1), so this can never run inline in the
 * request.
 *
 * DISCOVERED GAP: this used to run with `stdio: "ignore"`, discarding all
 * console output — when a pipeline failed with a generic error (e.g. Node's
 * `fetch failed`, which carries no detail about the underlying cause), there
 * was no way to diagnose it after the fact short of trying to reproduce it
 * live (which costs real credits and might not even reproduce a transient
 * failure). Output now goes to `logs/pipeline-<farmId>.log` instead, so a
 * failure's actual stack trace/cause is always available afterward, not just
 * the one-line summary stored in Farm.statusError.
 *
 * NOTE: detached child processes only survive past the request in a
 * long-running Node server (e.g. `next dev` / `next start`). This won't work
 * on Vercel's serverless platform, where the process exits once the response
 * is sent — a real deployment would need a queue/worker (see README's
 * deployment-scope notes). Fine for this project's current local-dev phase.
 */
export function spawnFarmPipeline(farmId: string): void {
  const logPath = path.join(process.cwd(), "logs", `pipeline-${farmId}.log`);
  const logFd = openSync(logPath, "a");

  const child = spawn("npx", ["tsx", "scripts/run-farm-pipeline.ts", farmId], {
    cwd: process.cwd(),
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: process.env,
  });
  child.unref();
}
