import path from "node:path";
import dotenv from "dotenv";
import { defineConfig } from "prisma/config";

// Next.js loads .env.local automatically for the app itself; the Prisma CLI
// (migrate/generate/studio) does not, so we load it explicitly here.
dotenv.config({ path: path.resolve(__dirname, ".env.local") });

// Prisma 7 removed `directUrl` from the datasource block entirely ("The
// datasource.directUrl property has been removed in Prisma ORM v7 in favor
// of the url property" — Prisma's v7 upgrade guide). The CLI-vs-runtime
// pooled/direct split (needed for Supabase/PgBouncer — see below) is now
// done by pointing THIS file (CLI-only: migrate/generate/studio) and
// lib/db.ts (app runtime) at different env vars, not different schema
// fields.
//
// DIRECT_URL, when set, is Supabase's direct (non-pooled) connection —
// required for Prisma Migrate, since PgBouncer's transaction-pooling mode
// (DATABASE_URL, port 6543) doesn't support the prepared statements Migrate
// needs. Falls back to DATABASE_URL when DIRECT_URL isn't set, so local dev
// (a single native Postgres connection, no pooler — docs/local-postgres.md)
// needs no change. The app's own queries (lib/db.ts's driver adapter)
// always use DATABASE_URL — the pooled connection — regardless of this file.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // `?? ` alone isn't enough here: an unset-but-present DIRECT_URL="" in
    // .env.local (e.g. before it's filled in) is an empty string, not
    // undefined, so nullish coalescing wouldn't fall through — checked this
    // against a real `prisma migrate status` run before shipping it.
    url: process.env["DIRECT_URL"] || process.env["DATABASE_URL"],
  },
});
