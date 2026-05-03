-- Per-tenant role catalogue used by the Role Management UI. Stores both
-- built-in roles (seeded by the API on first read) and tenant-defined
-- custom roles, with the resource:action permission strings inline.
CREATE TABLE "tenant_roles" (
    "tenant_id"   UUID         NOT NULL,
    "name"        VARCHAR(100) NOT NULL,
    "permissions" TEXT[]       NOT NULL DEFAULT '{}',
    "is_custom"   BOOLEAN      NOT NULL DEFAULT false,
    "updated_at"  TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_roles_pkey" PRIMARY KEY ("tenant_id", "name")
);

CREATE INDEX "idx_tenant_roles_tenant" ON "tenant_roles" ("tenant_id");

ALTER TABLE "tenant_roles"
  ADD CONSTRAINT "tenant_roles_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tenant_roles" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_tenant_roles
  ON "tenant_roles"
  USING (tenant_id = current_setting('app.current_tenant')::uuid);
