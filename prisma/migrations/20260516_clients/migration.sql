-- Tenant-scoped client directory. Holds the companies your lab tests samples
-- for — projects/invoices/reports link back here.
CREATE TABLE "clients" (
    "id"            UUID         NOT NULL,
    "tenant_id"     UUID         NOT NULL,
    "code"          VARCHAR(100) NOT NULL,
    "name"          VARCHAR(255) NOT NULL,
    "contact_name"  VARCHAR(255),
    "contact_email" VARCHAR(255),
    "contact_phone" VARCHAR(50),
    "address"       VARCHAR(500),
    "city"          VARCHAR(100),
    "country"       VARCHAR(100),
    "vat_number"    VARCHAR(50),
    "cr_number"     VARCHAR(50),
    "notes"         TEXT,
    "is_active"     BOOLEAN      NOT NULL DEFAULT true,
    "created_at"    TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"    TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uniq_client_per_tenant_code" ON "clients" ("tenant_id", "code");
CREATE        INDEX "idx_clients_tenant"          ON "clients" ("tenant_id");

ALTER TABLE "clients"
  ADD CONSTRAINT "clients_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant isolation via RLS — same pattern as the rest of the tenant-owned tables.
ALTER TABLE "clients" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_clients
  ON "clients"
  USING (tenant_id = current_setting('app.current_tenant')::uuid);
