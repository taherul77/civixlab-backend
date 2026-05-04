-- Tenant-scoped departments. One row per (tenant, department-name).
-- Used as the picker source for user memberships, samples, and tests.
CREATE TABLE "departments" (
    "id"          UUID        NOT NULL,
    "tenant_id"   UUID        NOT NULL,
    "name"        VARCHAR(100) NOT NULL,
    "code"        VARCHAR(50),
    "description" TEXT,
    "manager"     VARCHAR(255),
    "is_active"   BOOLEAN      NOT NULL DEFAULT true,
    "created_at"  TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uniq_dept_per_tenant_name" ON "departments" ("tenant_id", "name");
CREATE        INDEX "idx_departments_tenant"    ON "departments" ("tenant_id");

ALTER TABLE "departments"
  ADD CONSTRAINT "departments_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant isolation via RLS — same pattern as the rest of the tenant-owned tables.
ALTER TABLE "departments" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_departments
  ON "departments"
  USING (tenant_id = current_setting('app.current_tenant')::uuid);

-- Backfill: pull the per-tenant set of distinct department strings already in
-- use (from laboratories.departments[] and user_tenant_memberships.department)
-- so existing tenants land on the new table with their current catalogue.
INSERT INTO "departments" (id, tenant_id, name, is_active)
SELECT gen_random_uuid(), tenant_id, name, true
FROM (
  SELECT l.tenant_id, UNNEST(l.departments) AS name FROM "laboratories" l
  UNION
  SELECT m.tenant_id, m.department AS name
  FROM "user_tenant_memberships" m
  WHERE m.department IS NOT NULL AND m.department <> ''
) src
WHERE name IS NOT NULL AND name <> ''
ON CONFLICT (tenant_id, name) DO NOTHING;
