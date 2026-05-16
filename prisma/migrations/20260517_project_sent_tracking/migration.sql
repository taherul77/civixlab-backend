-- Track who pushed a project from "active/on_hold" into the sample workflow
-- (status = "in_process"). Both nullable since pre-existing rows have never
-- been sent.
ALTER TABLE "projects"
  ADD COLUMN "sent_by_id" UUID,
  ADD COLUMN "sent_at"    TIMESTAMPTZ;

ALTER TABLE "projects"
  ADD CONSTRAINT "projects_sent_by_id_fkey"
  FOREIGN KEY ("sent_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "idx_projects_sent_by" ON "projects" ("sent_by_id");
