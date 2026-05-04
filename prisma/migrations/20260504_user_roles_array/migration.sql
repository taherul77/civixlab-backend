-- Replace the single "role" column on user_tenant_memberships with an array
-- so a user can hold multiple roles in the same company at once. Existing
-- single-role rows are migrated by wrapping the value in a one-element array.

ALTER TABLE "user_tenant_memberships"
  ADD COLUMN "roles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "user_tenant_memberships"
   SET "roles" = ARRAY["role"]
 WHERE "role" IS NOT NULL AND "role" <> '';

ALTER TABLE "user_tenant_memberships"
  DROP COLUMN "role";
