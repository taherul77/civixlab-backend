-- Tenant-scoped engineer roster. Drives the engineer picker on the Project
-- form. Projects still store engineerName as a plain string, so this is a
-- master-data catalogue rather than a true FK relation.
CREATE TABLE "engineers" (
    "id"             UUID         NOT NULL,
    "tenant_id"      UUID         NOT NULL,
    "code"           VARCHAR(100) NOT NULL,
    "name"           VARCHAR(255) NOT NULL,
    "email"          VARCHAR(255),
    "phone"          VARCHAR(50),
    "license_number" VARCHAR(100),
    "specialty"      VARCHAR(100),
    "notes"          TEXT,
    "is_active"      BOOLEAN      NOT NULL DEFAULT true,
    "created_at"     TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engineers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uniq_engineer_per_tenant_code" ON "engineers" ("tenant_id", "code");
CREATE        INDEX "idx_engineers_tenant"          ON "engineers" ("tenant_id");

ALTER TABLE "engineers"
  ADD CONSTRAINT "engineers_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant isolation via RLS — same pattern as the rest of the tenant-owned tables.
ALTER TABLE "engineers" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_engineers
  ON "engineers"
  USING (tenant_id = current_setting('app.current_tenant')::uuid);
