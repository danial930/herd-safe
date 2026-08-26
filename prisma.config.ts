import path from "node:path";
import dotenv from "dotenv";
import { defineConfig } from "prisma/config";

// Next.js loads .env.local automatically for the app itself; the Prisma CLI
// (migrate/generate/studio) does not, so we load it explicitly here.
dotenv.config({ path: path.resolve(__dirname, ".env.local") });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
