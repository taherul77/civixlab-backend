-- Replace the per-tenant tenant_roles table with a richer `roles` table
-- that carries a UUID id and createdBy / updatedBy audit pointers.
DROP TABLE IF EXISTS "tenant_roles";

CREATE TABLE "roles" (
    "id"          UUID         NOT NULL,
    "tenant_id"   UUID         NOT NULL,
    "name"        VARCHAR(100) NOT NULL,
    "permissions" TEXT[]       NOT NULL DEFAULT '{}',
    "is_custom"   BOOLEAN      NOT NULL DEFAULT true,
    "created_by"  UUID,
    "updated_by"  UUID,
    "created_at"  TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uniq_role_per_tenant_name" ON "roles" ("tenant_id", "name");
CREATE INDEX "idx_roles_tenant"               ON "roles" ("tenant_id");

ALTER TABLE "roles"
  ADD CONSTRAINT "roles_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "roles"
  ADD CONSTRAINT "roles_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "roles"
  ADD CONSTRAINT "roles_updated_by_fkey"
  FOREIGN KEY ("updated_by") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_roles
  ON "roles"
  USING (tenant_id = current_setting('app.current_tenant')::uuid);
