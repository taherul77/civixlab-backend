-- Report numbers are public lookup keys (QR verification), so they must be
-- globally unique across companies.
--
-- Older rows used RPT-<year>-<test code tail>, which collides across tests and
-- companies. Keep the first row of each duplicate group as-is and suffix the
-- others with a short id fragment so the unique index can be created.
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY report_number ORDER BY generated_at, id) AS rn
  FROM "reports"
)
UPDATE "reports" r
SET report_number = r.report_number || '-' || substr(replace(r.id::text, '-', ''), 1, 6)
FROM ranked
WHERE r.id = ranked.id AND ranked.rn > 1;

CREATE UNIQUE INDEX "uniq_report_number" ON "reports" ("report_number");
