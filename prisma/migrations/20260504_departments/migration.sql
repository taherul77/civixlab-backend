-- Tenant-scoped departments. One row per (tenant, department-name).
-- `code` is server-generated and unique per tenant. `created_by` /
-- `updated_by` track which user last touched the row.
CREATE TABLE "departments" (
    "id"          UUID        NOT NULL,
    "tenant_id"   UUID        NOT NULL,
    "name"        VARCHAR(100) NOT NULL,
    "code"        VARCHAR(50)  NOT NULL,
    "description" TEXT,
    "is_active"   BOOLEAN      NOT NULL DEFAULT true,
    "created_by"  UUID,
    "updated_by"  UUID,
    "created_at"  TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uniq_dept_per_tenant_name" ON "departments" ("tenant_id", "name");
CREATE UNIQUE INDEX "uniq_dept_per_tenant_code" ON "departments" ("tenant_id", "code");
CREATE        INDEX "idx_departments_tenant"    ON "departments" ("tenant_id");

ALTER TABLE "departments"
  ADD CONSTRAINT "departments_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "departments"
  ADD CONSTRAINT "departments_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "departments"
  ADD CONSTRAINT "departments_updated_by_fkey"
  FOREIGN KEY ("updated_by") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Tenant isolation via RLS — same pattern as the rest of the tenant-owned tables.
ALTER TABLE "departments" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_departments
  ON "departments"
  USING (tenant_id = current_setting('app.current_tenant')::uuid);

-- Backfill: pull the per-tenant set of distinct department strings already in
-- use (from laboratories.departments[] and user_tenant_memberships.department)
-- so existing tenants land on the new table with their current catalogue.
-- The code column is auto-generated as upper-case slug + 4 random chars.
INSERT INTO "departments" (id, tenant_id, name, code, is_active)
SELECT
  gen_random_uuid(),
  tenant_id,
  name,
  CONCAT(
    UPPER(SUBSTRING(REGEXP_REPLACE(name, '[^A-Za-z0-9]', '', 'g'), 1, 4)),
    '-',
    UPPER(SUBSTRING(MD5(RANDOM()::text), 1, 4))
  ),
  true
FROM (
  SELECT l.tenant_id, UNNEST(l.departments) AS name FROM "laboratories" l
  UNION
  SELECT m.tenant_id, m.department AS name
  FROM "user_tenant_memberships" m
  WHERE m.department IS NOT NULL AND m.department <> ''
) src
WHERE name IS NOT NULL AND name <> ''
ON CONFLICT (tenant_id, name) DO NOTHING;
