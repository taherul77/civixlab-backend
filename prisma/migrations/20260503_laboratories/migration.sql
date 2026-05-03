-- One company can run multiple physical labs (main lab + branch lab + …).
CREATE TABLE "laboratories" (
    "id"                     UUID        NOT NULL,
    "tenant_id"              UUID        NOT NULL,
    "code"                   VARCHAR(100) NOT NULL,
    "name"                   VARCHAR(255) NOT NULL,
    "accreditation"          VARCHAR(255),
    "accreditation_number"   VARCHAR(100),
    "default_standard_body"  VARCHAR(20)  NOT NULL DEFAULT 'ASTM',
    "report_prefix"          VARCHAR(20)  NOT NULL DEFAULT 'RPT',
    "sample_code_prefix"     VARCHAR(20)  NOT NULL DEFAULT 'S',
    "departments"            TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
    "disciplines"            TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
    "is_active"              BOOLEAN      NOT NULL DEFAULT true,
    "created_at"             TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"             TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "laboratories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uniq_lab_per_tenant_code"  ON "laboratories" ("tenant_id", "code");
CREATE        INDEX "idx_laboratories_tenant"   ON "laboratories" ("tenant_id");

ALTER TABLE "laboratories"
  ADD CONSTRAINT "laboratories_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant isolation via RLS — same pattern as the rest of the tenant-owned tables.
ALTER TABLE "laboratories" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_laboratories
  ON "laboratories"
  USING (tenant_id = current_setting('app.current_tenant')::uuid);

-- Backfill: copy any existing tenant.settings.laboratory JSON blob into a row
-- so the previous single-instance Laboratory setup data isn't lost.
INSERT INTO "laboratories" (id, tenant_id, code, name, accreditation, accreditation_number,
                            default_standard_body, report_prefix, sample_code_prefix,
                            departments, disciplines)
SELECT
  gen_random_uuid(),
  t.id,
  COALESCE(NULLIF(t.settings #>> '{laboratory,labCode}', ''), 'LAB-001'),
  COALESCE(NULLIF(t.settings #>> '{laboratory,labName}', ''), 'Main laboratory'),
  NULLIF(t.settings #>> '{laboratory,accreditation}', ''),
  NULLIF(t.settings #>> '{laboratory,accreditationNumber}', ''),
  COALESCE(NULLIF(t.settings #>> '{laboratory,defaultStandardBody}', ''), 'ASTM'),
  COALESCE(NULLIF(t.settings #>> '{laboratory,reportPrefix}', ''),  'RPT'),
  COALESCE(NULLIF(t.settings #>> '{laboratory,sampleCodePrefix}', ''), 'S'),
  COALESCE(
    ARRAY(SELECT jsonb_array_elements_text(t.settings #> '{laboratory,departments}')),
    ARRAY[]::text[]
  ),
  COALESCE(
    ARRAY(SELECT jsonb_array_elements_text(t.settings #> '{laboratory,disciplines}')),
    ARRAY[]::text[]
  )
FROM tenants t
WHERE t.settings ? 'laboratory'
  AND (t.settings -> 'laboratory') IS NOT NULL;
