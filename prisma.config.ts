// Prisma 7 moved the datasource `url` / `directUrl` out of schema.prisma and
// into this config file. The CLI auto-loads project-root .env before reading
// this file, so `env()` resolves DATABASE_URL / DIRECT_DATABASE_URL as before.
//
// The runtime client (src/db/prisma.ts) configures its own pg adapter — this
// file is only consumed by the Prisma CLI for generate / migrate / studio.

import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  // Migrations open a direct (non-pooled) Postgres connection. If you proxy
  // app traffic through PgBouncer / Supavisor via DATABASE_URL, set
  // DIRECT_DATABASE_URL to the direct host so migrations bypass the pooler.
  datasource: {
    url: env("DIRECT_DATABASE_URL"),
  },
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
});
