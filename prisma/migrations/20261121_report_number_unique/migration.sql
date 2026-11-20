-- Report numbers are public lookup keys (QR verification), so they must be
-- globally unique across companies.
CREATE UNIQUE INDEX "uniq_report_number" ON "reports" ("report_number");
