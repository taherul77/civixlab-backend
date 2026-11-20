import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma, withTenant, type Tx } from "@/db/prisma";
import { appendAudit, verifyChain, toChainEntry } from "@/lib/audit";
import { userAgentOf, localPart } from "@/lib/req";
import { generateReportNumber, SEAL_ALGORITHM } from "@/lib/report-seal";
import { buildReportDoc, conformityOf, currentSeal, evaluateSnapshot, loadReportContext, verifyUrlFor, type EvalSnapshot } from "@/lib/report-context";
import { renderReportPdf } from "@/lib/report-pdf";

const ReportFormat = z.enum(["pdf", "docx", "xlsx"]);
const MarkBody = z.object({ format: ReportFormat });

/** Allocate a globally unique report number (public lookup key), retrying on collision. */
async function allocateReportNumber(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const n = generateReportNumber();
    if (!(await prisma.report.findUnique({ where: { reportNumber: n }, select: { id: true } }))) return n;
  }
  throw new Error("Could not allocate a unique report number");
}

const notFound = (what: string) => ({ error: { code: "NOT_FOUND", message: what } });

/** The current issued report of a test. Legacy "draft" and "superseded" rows are never "the report". */
async function issuedReport(tx: Tx, testId: string) {
  return tx.report.findFirst({ where: { testId, status: "issued" }, orderBy: { generatedAt: "desc" } });
}

interface StoredSeal { algorithm?: string; hash?: string; sealedAt?: string; snapshot?: EvalSnapshot }
const sealOfRow = (r: { digitalSignature: unknown } | null | undefined): StoredSeal => (r?.digitalSignature as StoredSeal | null) ?? {};

/** True when the report's stored seal still matches the live test + its frozen snapshot. */
const sealHolds = (stored: StoredSeal, ctx: Parameters<typeof currentSeal>[0]) =>
  !!stored.hash && stored.hash === currentSeal(ctx, stored.snapshot ?? null);

/** Public display name: never expose staff emails on the unauthenticated verify page. */
async function displayName(email: string | null): Promise<string | null> {
  if (!email) return null;
  const u = await prisma.user.findUnique({ where: { email }, select: { firstName: true, lastName: true } });
  return [u?.firstName, u?.lastName].filter(Boolean).join(" ") || "Laboratory staff";
}

export async function reportRoutes(app: FastifyInstance) {
  // Report context for the UI: test + sample + project + people, plus the latest issued report (if any).
  app.get("/v1/reports/test/:testId", { onRequest: [app.requirePage("reports")] }, async (req, reply) => {
    const { testId } = req.params as { testId: string };
    const { tenantId } = req.actor!;
    return withTenant(tenantId, async (tx) => {
      const ctx = await loadReportContext(tx, tenantId, testId);
      if (!ctx) return reply.status(404).send(notFound(`Test ${testId}`));
      const report = await issuedReport(tx, testId);
      return {
        test: ctx.test,
        sample: ctx.sample,
        project: ctx.project,
        reportNumber: report?.reportNumber ?? null,
        reportId: report?.id ?? null,
        reportStatus: report ? (sealHolds(sealOfRow(report), ctx) ? "issued" : "stale") : "not_issued",
        generatedAt: report?.generatedAt.toISOString() ?? null,
        signedBy: ctx.people.signedBy ?? null,
        signatureSerial: ctx.people.signatureSerial ?? null,
        reviewedBy: ctx.people.reviewedBy ?? null,
        reviewedAt: ctx.people.reviewedAt ?? null,
        approvedBy: ctx.people.approvedBy ?? null,
        approvedAt: ctx.people.approvedAt ?? null,
        conformity: conformityOf(ctx.test.passFailStatus),
      };
    });
  });

  // Issue a report for an approved test: allocates the public report number and
  // records the SHA-256 seal of the report content. Idempotent while unchanged.
  app.post("/v1/reports/test/:testId/issue", { onRequest: [app.requirePage("reports", "create")] }, async (req, reply) => {
    const { testId } = req.params as { testId: string };
    const { tenantId, email, role, sub: userId } = req.actor!;
    return withTenant(tenantId, async (tx) => {
      const ctx = await loadReportContext(tx, tenantId, testId);
      if (!ctx) return reply.status(404).send(notFound(`Test ${testId}`));
      if (ctx.test.status !== "approved" && ctx.test.status !== "signed") {
        return reply.status(409).send({ error: { code: "NOT_APPROVED", message: "Only approved tests can be issued as reports." } });
      }
      // Serialise issuing per test so a double click cannot create two "issued" reports.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${testId}, 1))`;
      const existing = await issuedReport(tx, testId);
      if (existing && sealHolds(sealOfRow(existing), ctx)) {
        return { reportId: existing.id, reportNumber: existing.reportNumber, seal: sealOfRow(existing).hash, reused: true };
      }
      const snapshot = evaluateSnapshot(ctx);
      const seal = currentSeal(ctx, snapshot);

      const reportNumber = await allocateReportNumber();
      if (existing) await tx.report.updateMany({ where: { testId, status: "issued" }, data: { status: "superseded" } });
      const report = await tx.report.create({
        data: {
          tenantId, testId, reportNumber, reportType: "pdf", status: "issued", generatedById: userId,
          digitalSignature: { algorithm: SEAL_ALGORITHM, hash: seal, sealedAt: new Date().toISOString(), snapshot } as never,
          verificationQrCode: verifyUrlFor(reportNumber),
        },
      });
      await appendAudit(tx, tenantId, {
        userEmail: email, userName: localPart(email), userRole: role,
        action: "report", entity: "test", entityId: testId,
        diff: [{ field: "report", from: existing?.reportNumber ?? "—", to: reportNumber }],
        ip: req.ip, userAgent: userAgentOf(req),
      });
      reply.code(201);
      return { reportId: report.id, reportNumber, seal, reused: false };
    });
  });

  // Download the PDF of an issued report. Refuses if the test changed after issue.
  app.get("/v1/reports/:reportId/pdf", { onRequest: [app.requirePage("reports")] }, async (req, reply) => {
    const { reportId } = req.params as { reportId: string };
    const { tenantId } = req.actor!;
    const built = await withTenant(tenantId, async (tx) => {
      const report = await tx.report.findUnique({ where: { id: reportId } });
      if (!report || !report.testId) return { error: notFound(`Report ${reportId}`), code: 404 as const };
      const ctx = await loadReportContext(tx, tenantId, report.testId);
      if (!ctx) return { error: notFound("Test for this report"), code: 404 as const };
      const stored = sealOfRow(report);
      if (report.status !== "issued" || !sealHolds(stored, ctx)) {
        return {
          error: { error: { code: "REPORT_STALE", message: "The test changed after this report was issued. Issue a new report." } },
          code: 409 as const,
        };
      }
      return { doc: buildReportDoc(ctx, { reportNumber: report.reportNumber, generatedAt: report.generatedAt, seal: stored.hash! }, stored.snapshot ?? null) };
    });
    if (!built.doc) return reply.status(built.code ?? 500).send(built.error);

    const pdf = await renderReportPdf(built.doc);
    return reply
      .header("content-type", "application/pdf")
      .header("content-disposition", `attachment; filename="${built.doc.reportNumber}.pdf"`)
      .header("cache-control", "private, no-store")
      .send(pdf);
  });

  // Mark a report as generated (legacy browser-PDF flow). Kept for compatibility;
  // new numbers are unique, and the proper flow is POST .../issue.
  app.post("/v1/reports/test/:testId/generated", { onRequest: [app.requirePerm("report:export")] }, async (req, reply) => {
    const { testId } = req.params as { testId: string };
    const body = MarkBody.parse(req.body);
    const { tenantId, email, role, sub: userId } = req.actor!;
    return withTenant(tenantId, async (tx) => {
      const test = await tx.test.findUnique({ where: { id: testId } });
      if (!test) return reply.status(404).send(notFound(`Test ${testId}`));
      const reportNumber = await allocateReportNumber();
      const report = await tx.report.create({
        data: { tenantId, testId, reportNumber, reportType: body.format, generatedById: userId, status: "draft" },
      });
      await appendAudit(tx, tenantId, {
        userEmail: email, userName: localPart(email), userRole: role,
        action: "update", entity: "test", entityId: testId,
        diff: [{ field: "report", from: "—", to: `${reportNumber} (${body.format})` }],
        ip: req.ip, userAgent: userAgentOf(req),
      });
      reply.code(201);
      return { reportNumber, reportId: report.id };
    });
  });

  // Public verification (QR target, no auth). Looks up by the unguessable report
  // number only, then answers: is it genuine, unchanged since issue, chain intact?
  app.get("/v1/reports/verify/:key", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const { key } = req.params as { key: string };
    const report = await prisma.report.findUnique({ where: { reportNumber: key } });
    if (!report?.testId) return { reportNumber: key, found: false };

    const result = await withTenant(report.tenantId, async (tx) => {
      const ctx = await loadReportContext(tx, report.tenantId, report.testId!);
      if (!ctx) return null;
      const chain = verifyChain((await tx.auditLog.findMany({ orderBy: { createdAt: "desc" } })).map(toChainEntry));
      return { ctx, chain };
    });
    if (!result) return { reportNumber: key, found: false };
    const { ctx, chain } = result;

    const stored = sealOfRow(report);
    const sealOk = sealHolds(stored, ctx);
    // One explicit state so a client cannot mistake a superseded/unsealed report for a current one.
    const state =
      !stored.hash ? "unsealed" :
      !sealOk ? "modified" :
      report.status === "superseded" ? "superseded" :
      report.status === "issued" ? "valid" : "unsealed";
    return {
      reportNumber: report.reportNumber,
      found: true,
      state,                                         // valid | superseded | modified | unsealed
      issuer: ctx.tenant.name,
      testCode: ctx.test.testCode,
      standard: [ctx.test.standardBody, ctx.test.standardNumber].filter(Boolean).join(" "),
      conformity: conformityOf(ctx.test.passFailStatus),
      issuedAt: report.generatedAt.toISOString(),
      status: report.status,
      sealAlgorithm: stored.algorithm ?? null,
      sealOk,                                        // test content + frozen results unchanged since issue
      approvedBy: await displayName(ctx.people.approvedBy ?? null),
      approvedAt: ctx.people.approvedAt,
      signedBy: await displayName(ctx.people.signedBy ?? null),
      signatureSerial: ctx.people.signatureSerial,
      chainOk: chain.ok,
      brokenAt: chain.brokenAt,
    };
  });
}
