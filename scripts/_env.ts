/** Shared env bootstrap for standalone scripts run via `npx tsx scripts/*.ts`.
 * Next.js loads .env.local automatically for the app itself; these scripts
 * run outside Next.js, so they load it explicitly. Import this first, before
 * any module that reads process.env at import time. */
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
