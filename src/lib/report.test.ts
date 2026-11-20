import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalJson, sealOf, generateReportNumber } from "./report-seal";
import { renderReportPdf, type ReportDoc } from "./report-pdf";

test("canonicalJson ignores key order and undefined", () => {
  assert.equal(canonicalJson({ b: 1, a: [{ y: 2, x: undefined, z: 1 }] }), canonicalJson({ a: [{ z: 1, y: 2 }], b: 1 }));
});

test("seal changes when any value changes, and is stable otherwise", () => {
  const base = { inputData: { load: 900 }, passFailStatus: "pass" };
  assert.equal(sealOf(base), sealOf({ passFailStatus: "pass", inputData: { load: 900 } }));
  assert.notEqual(sealOf(base), sealOf({ ...base, inputData: { load: 901 } }));
  assert.notEqual(sealOf(base), sealOf({ ...base, passFailStatus: "fail" }));
  assert.match(sealOf(base), /^[0-9a-f]{64}$/);
});

test("report numbers: format, year, no look-alike characters, effectively unique", () => {
  const n = generateReportNumber(new Date("2026-11-20T00:00:00Z"));
  assert.match(n, /^RPT-2026-[0-9A-HJKMNP-TV-Z]{8}$/);
  const seen = new Set(Array.from({ length: 5000 }, () => generateReportNumber()));
  assert.equal(seen.size, 5000);
});

const doc = (over: Partial<ReportDoc> = {}): ReportDoc => ({
  reportNumber: "RPT-2026-ABCD1234",
  issuedAt: "2026-11-20T10:00:00.000Z",
  tenantName: "Demo Lab",
  testName: "Concrete Placement Temperature",
  testCode: "A4",
  standard: "SBC 304",
  conformity: "does_not_conform",
  project: { code: "PRJ-1", name: "NEOM Module 4", client: "NEOM", city: "Tabuk" },
  sample: { code: "SMP-1", type: "concrete", date: "2026-11-01T00:00:00Z", location: "Site 1", sampledBy: "Khalid" },
  testDate: "2026-11-02T00:00:00Z",
  equipment: { code: "EQ-1", name: "Thermometer", calibrationDue: "2027-01-01T00:00:00Z" },
  inputs: [{ label: "Concrete temperature (C)", value: "37" }],
  results: [{ label: "Internal temperature", value: "44.6", unit: "C" }],
  checks: [{ label: "Placement temperature (SBC 304)", measured: "37", limit: "<= 35 C", status: "fail" }],
  warnings: ["Pre-alert"],
  remarks: "Cooling measures required.",
  people: { reviewedBy: "r@x.sa", reviewedAt: "2026-11-03T09:00:00Z", approvedBy: "a@x.sa", approvedAt: "2026-11-04T09:00:00Z" },
  verifyUrl: "https://example.test/verify/RPT-2026-ABCD1234",
  seal: { algorithm: "SHA-256", hash: "a".repeat(64) },
  ...over,
});

const pageCount = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type \/Page\b(?!s)/g) ?? []).length;

test("renders a well-formed PDF (a full report fits on two pages)", async () => {
  const pdf = await renderReportPdf(doc());
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.match(pdf.subarray(-10).toString("latin1"), /%%EOF/);
  assert.ok(pdf.length > 3000, `suspiciously small PDF: ${pdf.length}`);
  assert.ok(pageCount(pdf) >= 1 && pageCount(pdf) <= 2, `unexpected page count ${pageCount(pdf)}`); // no stray blank footer pages
});

test("a long report flows onto several pages without throwing", async () => {
  const many = Array.from({ length: 120 }, (_, i) => ({ label: `Parameter ${i + 1}`, value: String(i * 1.5) }));
  const pdf = await renderReportPdf(doc({ inputs: many, results: many.slice(0, 60) }));
  assert.ok(pageCount(pdf) >= 3, `expected multiple pages, got ${pageCount(pdf)}`);
});

test("minimal data (no equipment, no checks, no remarks) still renders", async () => {
  const pdf = await renderReportPdf(doc({ equipment: null, checks: [], warnings: [], remarks: null, inputs: [], results: [], conformity: "pending" }));
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
});
