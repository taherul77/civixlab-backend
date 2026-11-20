import PDFDocument from "pdfkit";
import QRCode from "qrcode";

/** Everything the PDF shows. Built by the route from stored data (see report-context.ts). */
export interface ReportDoc {
  reportNumber: string;
  issuedAt: string; // ISO
  tenantName: string;
  tenantCr?: string | null;
  testName: string;
  testCode: string;
  standard: string;
  conformity: "conforms" | "does_not_conform" | "pending";
  project: { code: string; name: string; client?: string | null; city?: string | null };
  sample: { code: string; type: string; date?: string | null; location?: string | null; sampledBy?: string | null };
  testDate?: string | null;
  equipment?: { code: string; name: string; calibrationDue?: string | null } | null;
  inputs: { label: string; value: string }[];
  results: { label: string; value: string; unit?: string }[];
  checks: { label: string; measured: string; limit: string; status: "pass" | "fail" | "warning" | "info" }[];
  warnings: string[];
  remarks?: string | null;
  people: {
    reviewedBy?: string | null; reviewedAt?: string | null;
    approvedBy?: string | null; approvedAt?: string | null;
    signedBy?: string | null; signatureSerial?: string | null;
  };
  verifyUrl: string;
  seal: { algorithm: string; hash: string };
}

const BRAND = "#0e9085";
const INK = "#0f172a";
const MUTED = "#64748b";
const LINE = "#e2e8f0";
const GREEN = "#059669";
const RED = "#dc2626";
const AMBER = "#d97706";

const M = 40; // page margin
const DISCLAIMER =
  "This report shall not be reproduced except in full without written approval of the laboratory. " +
  "Results relate only to the items tested. Verify authenticity by scanning the QR code or visiting the verification URL.";

const fmtDate = (iso?: string | null) => (iso ? iso.slice(0, 10) : "—");
const fmtDateTime = (iso?: string | null) => (iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : "—");

export async function renderReportPdf(d: ReportDoc, opts: { compress?: boolean } = {}): Promise<Buffer> {
  const qr = await QRCode.toBuffer(d.verifyUrl, { margin: 1, width: 240, errorCorrectionLevel: "M" });

  const doc = new PDFDocument({
    size: "A4",
    margin: M,
    bufferPages: true,
    compress: opts.compress ?? true,
    info: {
      Title: `${d.reportNumber} - ${d.testName}`,
      Author: d.tenantName,
      Subject: `${d.testCode} ${d.standard}`,
      Keywords: `CiviXLab, ${d.testCode}, ${d.reportNumber}`,
    },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const W = doc.page.width - M * 2;
  const bottom = () => doc.page.height - M - 30; // keep room for the footer

  const ensure = (h: number) => {
    if (doc.y + h > bottom()) doc.addPage();
  };

  const section = (title: string) => {
    ensure(40);
    doc.moveDown(0.8);
    doc.font("Helvetica-Bold").fontSize(9).fillColor(BRAND).text(title.toUpperCase(), M, doc.y, { characterSpacing: 0.8 });
    doc.moveTo(M, doc.y + 2).lineTo(M + W, doc.y + 2).strokeColor(BRAND).lineWidth(1).stroke();
    doc.moveDown(0.5);
  };

  /** Two-column key/value rows. */
  const kv = (rows: [string, string][], labelW = 140) => {
    for (const [k, v] of rows) {
      const h = Math.max(
        doc.font("Helvetica").fontSize(9).heightOfString(v || "—", { width: W - labelW }),
        12,
      );
      ensure(h + 4);
      const y = doc.y;
      doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(k, M, y, { width: labelW - 8 });
      doc.font("Helvetica").fontSize(9).fillColor(INK).text(v || "—", M + labelW, y, { width: W - labelW });
      doc.y = y + h + 3;
      doc.moveTo(M, doc.y - 1).lineTo(M + W, doc.y - 1).strokeColor(LINE).lineWidth(0.5).stroke();
    }
  };

  // ---- Header band --------------------------------------------------------
  doc.rect(0, 0, doc.page.width, 78).fill(BRAND);
  doc.font("Helvetica-Bold").fontSize(20).fillColor("#ffffff").text("CiviXLab", M, 22);
  doc.font("Helvetica").fontSize(9).fillColor("#d1fae5").text(`${d.tenantName}${d.tenantCr ? `  |  CR ${d.tenantCr}` : ""}`, M, 48);
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#ffffff").text("TEST REPORT", M, 24, { width: W, align: "right" });
  doc.font("Helvetica").fontSize(10).fillColor("#d1fae5").text(d.reportNumber, M, 42, { width: W, align: "right" });
  doc.font("Helvetica").fontSize(8).fillColor("#d1fae5").text(`Issued ${fmtDateTime(d.issuedAt)}`, M, 58, { width: W, align: "right" });

  // ---- Title + QR ---------------------------------------------------------
  const titleY = 96;
  doc.font("Helvetica-Bold").fontSize(15).fillColor(INK).text(d.testName, M, titleY, { width: W - 110 });
  doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(`${d.testCode}  |  ${d.standard}`, M, doc.y + 2, { width: W - 110 });

  const badge =
    d.conformity === "conforms" ? { text: "CONFORMS", color: GREEN } :
    d.conformity === "does_not_conform" ? { text: "DOES NOT CONFORM", color: RED } :
    { text: "PENDING", color: AMBER };
  const by = doc.y + 8;
  doc.roundedRect(M, by, 150, 22, 4).fill(badge.color);
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#ffffff").text(badge.text, M, by + 6, { width: 150, align: "center" });

  doc.image(qr, M + W - 92, titleY - 2, { width: 92 });
  doc.font("Helvetica").fontSize(7).fillColor(MUTED).text("Scan to verify", M + W - 92, titleY + 92, { width: 92, align: "center" });
  doc.y = Math.max(by + 30, titleY + 108);

  // ---- Project / sample / test -------------------------------------------
  section("Project");
  kv([
    ["Project", `${d.project.code}  ${d.project.name}`],
    ["Client", d.project.client ?? "—"],
    ["City", d.project.city ?? "—"],
  ]);

  section("Sample");
  kv([
    ["Sample code", d.sample.code],
    ["Type", d.sample.type],
    ["Date sampled", fmtDate(d.sample.date)],
    ["Location", d.sample.location ?? "—"],
    ["Sampled by", d.sample.sampledBy ?? "—"],
  ]);

  section("Test");
  kv([
    ["Test date", fmtDate(d.testDate)],
    ["Equipment", d.equipment ? `${d.equipment.code}  ${d.equipment.name}` : "—"],
    ["Calibration due", d.equipment ? fmtDate(d.equipment.calibrationDue) : "—"],
  ]);

  // ---- Inputs / results / checks -----------------------------------------
  if (d.inputs.length > 0) {
    section("Input data");
    kv(d.inputs.map((r): [string, string] => [r.label, r.value]), 220);
  }

  if (d.results.length > 0) {
    section("Results");
    kv(d.results.map((r): [string, string] => [r.label, `${r.value}${r.unit ? ` ${r.unit}` : ""}`]), 220);
  }

  if (d.checks.length > 0) {
    section("Pass / fail determination");
    for (const c of d.checks) {
      ensure(18);
      const y = doc.y;
      const color = c.status === "pass" ? GREEN : c.status === "fail" ? RED : c.status === "warning" ? AMBER : MUTED;
      const label = c.status === "pass" ? "PASS" : c.status === "fail" ? "FAIL" : c.status === "warning" ? "WARN" : "INFO";
      doc.roundedRect(M, y, 34, 13, 3).fill(color);
      doc.font("Helvetica-Bold").fontSize(7).fillColor("#ffffff").text(label, M, y + 3.5, { width: 34, align: "center" });
      doc.font("Helvetica").fontSize(9).fillColor(INK).text(c.label, M + 42, y + 1, { width: W - 42 - 190 });
      doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(`${c.measured}  (limit ${c.limit})`, M + W - 190, y + 1, { width: 190, align: "right" });
      doc.y = y + 18;
    }
  }

  if (d.warnings.length > 0) {
    section("Notes");
    for (const w of d.warnings) {
      ensure(14);
      doc.font("Helvetica").fontSize(9).fillColor(AMBER).text(`! ${w}`, M, doc.y, { width: W });
      doc.moveDown(0.2);
    }
  }

  if (d.remarks) {
    section("Remarks");
    ensure(30);
    doc.font("Helvetica").fontSize(9).fillColor(INK).text(d.remarks, M, doc.y, { width: W });
  }

  // ---- Approvals + seal ---------------------------------------------------
  section("Review and approval");
  kv([
    ["Reviewed by", d.people.reviewedBy ? `${d.people.reviewedBy}  (${fmtDateTime(d.people.reviewedAt)})` : "—"],
    ["Approved by", d.people.approvedBy ? `${d.people.approvedBy}  (${fmtDateTime(d.people.approvedAt)})` : "—"],
    ["Signed by", d.people.signedBy ? `${d.people.signedBy}${d.people.signatureSerial ? `  [${d.people.signatureSerial}]` : ""}` : "Not signed"],
  ]);

  section(`Integrity seal (${d.seal.algorithm})`);
  ensure(60);
  doc.font("Courier").fontSize(8).fillColor(INK).text(d.seal.hash, M, doc.y, { width: W });
  doc.font("Helvetica").fontSize(8).fillColor(MUTED).moveDown(0.4)
    .text("The seal covers the test inputs, results, pass/fail outcome and approval. Verification reports whether the stored content still matches it.", M, doc.y, { width: W });
  doc.font("Helvetica").fontSize(8).fillColor(BRAND).moveDown(0.4).text(d.verifyUrl, M, doc.y, { width: W, link: d.verifyUrl, underline: true });

  doc.moveDown(1);
  ensure(40);
  doc.font("Helvetica").fontSize(7.5).fillColor(MUTED).text(DISCLAIMER, M, doc.y, { width: W });

  // ---- Footers (page x of y) ---------------------------------------------
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    // Inside the bottom margin: text below page.maxY() makes PDFKit add a page.
    const fy = doc.page.height - M - 14;
    doc.moveTo(M, fy - 6).lineTo(M + W, fy - 6).strokeColor(LINE).lineWidth(0.5).stroke();
    doc.font("Helvetica").fontSize(7.5).fillColor(MUTED)
      .text(`${d.reportNumber}  |  ${d.tenantName}`, M, fy, { width: W / 2, lineBreak: false })
      .text(`Page ${i + 1} of ${range.count}`, M + W / 2, fy, { width: W / 2, align: "right", lineBreak: false });
  }

  doc.end();
  return done;
}
