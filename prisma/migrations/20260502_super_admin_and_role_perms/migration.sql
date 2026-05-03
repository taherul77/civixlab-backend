-- Add Super Admin flag (global, not tenant-scoped).
ALTER TABLE "users"
  ADD COLUMN "is_super_admin" BOOLEAN NOT NULL DEFAULT false;

-- Per-tenant, per-role page action grants.
CREATE TABLE "role_page_permissions" (
    "tenant_id" UUID NOT NULL,
    "role"      VARCHAR(100) NOT NULL,
    "page_id"   VARCHAR(100) NOT NULL,
    "view"      BOOLEAN NOT NULL DEFAULT false,
    "create"    BOOLEAN NOT NULL DEFAULT false,
    "edit"      BOOLEAN NOT NULL DEFAULT false,
    "delete"    BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_page_permissions_pkey" PRIMARY KEY ("tenant_id", "role", "page_id")
);

CREATE INDEX "idx_role_page_perms_tenant_role"
  ON "role_page_permissions" ("tenant_id", "role");

ALTER TABLE "role_page_permissions"
  ADD CONSTRAINT "role_page_permissions_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS — same pattern as the rest of the tenant-owned tables.
ALTER TABLE "role_page_permissions" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_role_page_permissions
  ON "role_page_permissions"
  USING (tenant_id = current_setting('app.current_tenant')::uuid);
