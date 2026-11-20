-- Reviewer/technician comment thread on a test, including workflow decisions
-- (return for correction, review, approve). Tenant-scoped like every other table.
CREATE TABLE "test_comments" (
    "id"           UUID          NOT NULL,
    "tenant_id"    UUID          NOT NULL,
    "test_id"      UUID          NOT NULL,
    "author_email" VARCHAR(255)  NOT NULL,
    "author_name"  VARCHAR(255),
    "kind"         VARCHAR(30)   NOT NULL DEFAULT 'comment',
    "body"         TEXT          NOT NULL,
    "created_at"   TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "test_comments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_test_comments_test" ON "test_comments" ("tenant_id", "test_id", "created_at");

ALTER TABLE "test_comments"
  ADD CONSTRAINT "test_comments_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "test_comments"
  ADD CONSTRAINT "test_comments_test_id_fkey"
  FOREIGN KEY ("test_id") REFERENCES "tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "test_comments" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_test_comments
  ON "test_comments"
  USING (tenant_id = current_setting('app.current_tenant')::uuid);
