-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "subdomain" VARCHAR(100) NOT NULL,
    "logo_url" VARCHAR(500),
    "cr_number" VARCHAR(50),
    "vat_number" VARCHAR(50),
    "subscription_tier" VARCHAR(50) NOT NULL DEFAULT 'starter',
    "subscription_status" VARCHAR(50) NOT NULL DEFAULT 'active',
    "max_users" INTEGER NOT NULL DEFAULT 5,
    "max_tests_per_month" INTEGER NOT NULL DEFAULT 200,
    "storage_limit_gb" INTEGER NOT NULL DEFAULT 10,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "saudi_compliance_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255),
    "first_name" VARCHAR(100),
    "last_name" VARCHAR(100),
    "phone" VARCHAR(50),
    "iqama_number" VARCHAR(20),
    "role" VARCHAR(50) NOT NULL,
    "department" VARCHAR(100),
    "signature_url" VARCHAR(500),
    "digital_certificate_id" VARCHAR(100),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "mfa_secret" VARCHAR(255),
    "mfa_recovery_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "last_login_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_code" VARCHAR(100) NOT NULL,
    "project_name" VARCHAR(255) NOT NULL,
    "client_name" VARCHAR(255),
    "client_email" VARCHAR(255),
    "location" VARCHAR(500),
    "city" VARCHAR(100),
    "region" VARCHAR(100),
    "engineer_name" VARCHAR(255),
    "engineer_license" VARCHAR(100),
    "start_date" DATE,
    "end_date" DATE,
    "contract_value" DECIMAL(15,2),
    "etimad_contract_number" VARCHAR(100),
    "status" VARCHAR(50) NOT NULL DEFAULT 'active',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "samples" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "sample_code" VARCHAR(100) NOT NULL,
    "sample_type" VARCHAR(100) NOT NULL,
    "sample_date" DATE NOT NULL,
    "received_date" DATE,
    "sampled_by" VARCHAR(255),
    "sample_location" VARCHAR(500),
    "gps_coordinates" TEXT,
    "description" TEXT,
    "status" VARCHAR(50) NOT NULL DEFAULT 'pending',
    "chain_of_custody" JSONB,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "samples_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "sample_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "test_type" VARCHAR(100) NOT NULL,
    "test_code" VARCHAR(100) NOT NULL,
    "standard_body" VARCHAR(50),
    "standard_number" VARCHAR(50),
    "test_date" DATE,
    "tested_by" UUID,
    "reviewed_by" UUID,
    "approved_by" UUID,
    "status" VARCHAR(50) NOT NULL DEFAULT 'pending',
    "input_data" JSONB NOT NULL,
    "calculated_results" JSONB,
    "pass_fail_status" VARCHAR(20),
    "remarks" TEXT,
    "equipment_id" UUID,
    "attachment_urls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "weather_conditions" JSONB,
    "calibration_verified" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMPTZ,
    "reviewed_at" TIMESTAMPTZ,
    "approved_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_templates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "test_category" VARCHAR(100) NOT NULL,
    "test_name" VARCHAR(255) NOT NULL,
    "test_code" VARCHAR(100) NOT NULL,
    "standard_body" VARCHAR(50),
    "standard_number" VARCHAR(50),
    "version" VARCHAR(20),
    "description" TEXT,
    "input_fields" JSONB NOT NULL,
    "calculation_logic" JSONB NOT NULL,
    "validation_rules" JSONB NOT NULL,
    "output_fields" JSONB NOT NULL,
    "pass_fail_criteria" JSONB NOT NULL,
    "graph_config" JSONB,
    "report_template_path" VARCHAR(500),
    "workflow_config" JSONB,
    "equipment_config" JSONB,
    "is_saudi_specific" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_custom" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "test_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "water_tests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "sample_id" UUID,
    "project_id" UUID,
    "water_source_type" VARCHAR(50) NOT NULL,
    "test_purpose" VARCHAR(100),
    "collection_date" TIMESTAMPTZ NOT NULL,
    "collection_location" VARCHAR(500),
    "sampling_method" VARCHAR(100),
    "tested_by" UUID,
    "reviewed_by" UUID,
    "approved_by" UUID,
    "status" VARCHAR(50) NOT NULL DEFAULT 'pending',
    "input_data" JSONB NOT NULL,
    "calculated_results" JSONB,
    "pass_fail_status" VARCHAR(20),
    "compliance_standard" VARCHAR(50),
    "remarks" TEXT,
    "equipment_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "water_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "equipment_code" VARCHAR(100) NOT NULL,
    "equipment_name" VARCHAR(255) NOT NULL,
    "equipment_type" VARCHAR(100),
    "manufacturer" VARCHAR(255),
    "model" VARCHAR(100),
    "serial_number" VARCHAR(100),
    "calibration_date" DATE,
    "calibration_due_date" DATE,
    "calibration_certificate_url" VARCHAR(500),
    "calibration_interval_months" INTEGER NOT NULL DEFAULT 12,
    "accuracy_class" VARCHAR(50),
    "measurement_range" VARCHAR(100),
    "status" VARCHAR(50) NOT NULL DEFAULT 'active',
    "location" VARCHAR(255),
    "api_endpoint" VARCHAR(500),
    "api_key_encrypted" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "user_email" VARCHAR(255),
    "action" VARCHAR(100) NOT NULL,
    "entity_type" VARCHAR(100) NOT NULL,
    "entity_id" UUID NOT NULL,
    "old_values" JSONB,
    "new_values" JSONB,
    "ip_address" INET,
    "user_agent" TEXT,
    "prev_hash" VARCHAR(64),
    "hash" VARCHAR(64),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "test_id" UUID,
    "water_test_id" UUID,
    "report_number" VARCHAR(100) NOT NULL,
    "report_type" VARCHAR(50),
    "file_url" VARCHAR(500),
    "file_size" INTEGER,
    "generated_by" UUID,
    "generated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "digital_signature" JSONB,
    "verification_qr_code" VARCHAR(500),
    "status" VARCHAR(50) NOT NULL DEFAULT 'draft',

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_subdomain_key" ON "tenants"("subdomain");

-- CreateIndex
CREATE INDEX "idx_users_tenant_email" ON "users"("tenant_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_email_key" ON "users"("tenant_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "projects_tenant_id_project_code_key" ON "projects"("tenant_id", "project_code");

-- CreateIndex
CREATE UNIQUE INDEX "samples_tenant_id_sample_code_key" ON "samples"("tenant_id", "sample_code");

-- CreateIndex
CREATE INDEX "idx_tests_tenant_sample" ON "tests"("tenant_id", "sample_id");

-- CreateIndex
CREATE INDEX "idx_tests_tenant_status" ON "tests"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "idx_tests_tenant_date" ON "tests"("tenant_id", "test_date");

-- CreateIndex
CREATE INDEX "idx_tests_tenant_type" ON "tests"("tenant_id", "test_type");

-- CreateIndex
CREATE INDEX "idx_water_tests_tenant" ON "water_tests"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_tenant_id_equipment_code_key" ON "equipment"("tenant_id", "equipment_code");

-- CreateIndex
CREATE INDEX "idx_audit_logs_tenant" ON "audit_logs"("tenant_id", "entity_type");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "samples" ADD CONSTRAINT "samples_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "samples" ADD CONSTRAINT "samples_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "samples" ADD CONSTRAINT "samples_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tests" ADD CONSTRAINT "tests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tests" ADD CONSTRAINT "tests_sample_id_fkey" FOREIGN KEY ("sample_id") REFERENCES "samples"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tests" ADD CONSTRAINT "tests_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tests" ADD CONSTRAINT "tests_tested_by_fkey" FOREIGN KEY ("tested_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tests" ADD CONSTRAINT "tests_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tests" ADD CONSTRAINT "tests_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tests" ADD CONSTRAINT "tests_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "equipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_templates" ADD CONSTRAINT "test_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "water_tests" ADD CONSTRAINT "water_tests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "water_tests" ADD CONSTRAINT "water_tests_sample_id_fkey" FOREIGN KEY ("sample_id") REFERENCES "samples"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "water_tests" ADD CONSTRAINT "water_tests_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "water_tests" ADD CONSTRAINT "water_tests_tested_by_fkey" FOREIGN KEY ("tested_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "water_tests" ADD CONSTRAINT "water_tests_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "equipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "tests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_generated_by_fkey" FOREIGN KEY ("generated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row-Level Security policies — spec §3 tenant isolation.
-- Run by `prisma migrate deploy` (or `prisma migrate dev`) after the
-- generated table definitions have been applied.
--
-- Strategy: every tenant-owned table has an RLS policy that filters by the
-- `app.current_tenant` GUC. The API service sets this per request via:
--
--     SET LOCAL app.current_tenant = '<tenant-uuid>';
--
-- Any query that omits the GUC sees zero rows from these tables.

-- A safe no-op default so admin tools don't crash when GUC is unset.
ALTER DATABASE civixlab SET app.current_tenant TO '00000000-0000-0000-0000-000000000000';

-- Enable RLS on every tenant-owned table.
ALTER TABLE users          ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects       ENABLE ROW LEVEL SECURITY;
ALTER TABLE samples        ENABLE ROW LEVEL SECURITY;
ALTER TABLE tests          ENABLE ROW LEVEL SECURITY;
ALTER TABLE water_tests    ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment      ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports        ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_templates ENABLE ROW LEVEL SECURITY;

-- One policy per table — same shape, different table.
CREATE POLICY tenant_isolation_users          ON users          USING (tenant_id = current_setting('app.current_tenant')::uuid);
CREATE POLICY tenant_isolation_projects       ON projects       USING (tenant_id = current_setting('app.current_tenant')::uuid);
CREATE POLICY tenant_isolation_samples        ON samples        USING (tenant_id = current_setting('app.current_tenant')::uuid);
CREATE POLICY tenant_isolation_tests          ON tests          USING (tenant_id = current_setting('app.current_tenant')::uuid);
CREATE POLICY tenant_isolation_water_tests    ON water_tests    USING (tenant_id = current_setting('app.current_tenant')::uuid);
CREATE POLICY tenant_isolation_equipment      ON equipment      USING (tenant_id = current_setting('app.current_tenant')::uuid);
CREATE POLICY tenant_isolation_reports        ON reports        USING (tenant_id = current_setting('app.current_tenant')::uuid);
CREATE POLICY tenant_isolation_audit_logs     ON audit_logs     USING (tenant_id = current_setting('app.current_tenant')::uuid);

-- Test templates are slightly different — global rows (tenant_id NULL) are
-- visible to everyone; tenant-specific rows follow the standard policy.
CREATE POLICY tenant_isolation_test_templates
  ON test_templates
  USING (tenant_id IS NULL OR tenant_id = current_setting('app.current_tenant')::uuid);

-- Audit log is append-only at the policy level.
CREATE POLICY audit_logs_append_only
  ON audit_logs
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
REVOKE UPDATE, DELETE ON audit_logs FROM PUBLIC;
