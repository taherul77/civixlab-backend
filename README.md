# CiviXLab Backend

Fastify + Prisma + PostgreSQL (with Row-Level Security) API service for CiviXLab.
Implements spec **§2 (stack), §3 (architecture), §4 (schema), §5 (auth + RBAC)**.

This is a separate Node.js project, deployed independently of the Next.js
frontend (`d:/New folder/civixlab/`). The frontend's `src/server/api.ts`
service layer was designed as a swappable shim — once this backend is
running, the frontend's `fetch('/api/...')` calls hit these routes verbatim.

---

## Stack (Slice 1)

| Concern        | Library                                                |
|----------------|--------------------------------------------------------|
| HTTP server    | Fastify 5 with `@fastify/cors`, `helmet`, `rate-limit` |
| ORM            | Prisma 5 (`@prisma/client`)                            |
| Database       | PostgreSQL 16 (with Row-Level Security)                |
| Cache / queue  | Redis 7.2 (ioredis)                                    |
| JWT            | `@fastify/jwt` HS256, 1 h TTL                          |
| Password hash  | `bcryptjs` (cost 12)                                   |
| MFA            | `speakeasy` (TOTP)                                     |
| Validation     | `zod` 3                                                |
| Logging        | `pino` (`pino-pretty` in dev)                          |

Out of scope for Slice 1 (planned for later slices): Puppeteer reports, BullMQ
workers, equipment integration adapters, ZATCA clearance proxy, Meilisearch,
Speakeasy MFA endpoints, per-route RBAC matrix.

---

## Quick start

### 0) Prerequisites
* Node.js ≥ 20
* Docker (or your own running PostgreSQL 16 + Redis 7)

### 1) Install dependencies
```bash
npm install
```

### 2) Boot infrastructure (Postgres + Redis via Docker Compose)
```bash
npm run docker:up
```

This starts `civixlab-postgres` on `localhost:5432` and `civixlab-redis` on
`localhost:6379` with persistent volumes.

### 3) Configure environment
```bash
cp .env.example .env
# Generate a real JWT secret:
node -e "console.log(require('crypto').randomBytes(64).toString('base64'))"
# Paste the output as JWT_SECRET in .env
```

### 4) Apply schema + RLS migration
```bash
npm run prisma:migrate -- --name init
```

This creates the 10 tables from spec §4 and applies the RLS policies in
`prisma/migrations/20260430_init_rls/migration.sql`.

### 5) Seed a demo tenant + 6 users
```bash
npm run db:seed
```

### 6) Run the server
```bash
npm run dev
```

The API listens on `http://localhost:4000`.

### 7) Smoke-test it
```bash
# Health probe (no auth)
curl http://localhost:4000/health

# Database probe
curl http://localhost:4000/health/ready

# Sign in (returns a JWT)
curl -X POST http://localhost:4000/v1/auth/signin \
  -H 'content-type: application/json' \
  -d '{"email":"fahad@aramco-lab.sa","password":"demo1234!","tenantSubdomain":"aramco-lab"}'

# Use the token
curl http://localhost:4000/v1/auth/session \
  -H "Authorization: Bearer <paste-token-here>"
```

---

## Layout

```
civixlab-backend/
├── prisma/
│   ├── schema.prisma                          # 10 tables — spec §4
│   ├── migrations/20260430_init_rls/
│   │   └── migration.sql                      # RLS policies
│   └── seed.ts                                # demo tenant + users
├── src/
│   ├── config/env.ts                          # Zod-validated env
│   ├── db/prisma.ts                           # PrismaClient + withTenant()
│   ├── plugins/
│   │   ├── auth.ts                            # JWT + actor decorator
│   │   └── error-handler.ts                   # uniform error envelope
│   ├── routes/
│   │   ├── health.ts
│   │   └── auth.ts
│   └── server.ts                              # Fastify entry point
├── docker-compose.yml                         # Postgres 16 + Redis 7
├── .env.example
├── tsconfig.json
└── package.json
```

---

## Tenant isolation (how RLS works here)

Every tenant-owned table has Row-Level Security enabled:

```sql
ALTER TABLE tests ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_tests ON tests
  USING (tenant_id = current_setting('app.current_tenant')::uuid);
```

The API service sets the GUC per request via `withTenant()`:

```ts
import { withTenant } from "@/db/prisma";

await withTenant(req.actor.tenantId, async (tx) => {
  return tx.test.findMany();   // automatically filtered by tenant
});
```

Without that wrapper a query sees zero rows — the database refuses to leak
data across tenants even if route code forgets the filter. This matches the
spec's *"data leakage prevented at database level"* requirement (§3).

---

## What lands in later backend slices

* **Slice 2** — Fastify routes for tests/projects/samples/equipment CRUD,
  the workflow transitions (submit → review → approve → sign), the
  audit-log hash chain (writing into the `audit_logs` table with the same
  canonical input the frontend uses today).
* **Slice 3** — Speakeasy MFA enrolment + verification routes.
* **Slice 4** — Equipment integration adapters server-side (the existing
  `src/server/equipment-adapters/` from the frontend moves to this project).
* **Slice 5** — Puppeteer report generator + S3-style file upload.
* **Slice 6** — ZATCA Phase 2 proxy (calls the real ZATCA Fatoora gateway).
* **Slice 7** — Frontend swap: `civixlab/src/server/api.ts` body changes
  from Zustand reads to `fetch('/api/...')` against this service.

---

## License

Internal — see project root.
# civixlab-backend
