import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma, withTenant } from "@/db/prisma";
import { appendAudit, verifyChain, type ChainEntry } from "@/lib/audit";
import { userAgentOf, localPart } from "@/lib/req";

const ReportFormat = z.enum(["pdf", "docx", "xlsx"]);
const MarkBody = z.object({ format: ReportFormat });

function reportNumberFor(testCode: string): string {
  const tail = testCode.split("-").pop() ?? testCode;
  return `RPT-${new Date().getFullYear()}-${tail}`;
}

export async function reportRoutes(app: FastifyInstance) {
  // Hydrate the report context — test + sample + project + signature trail.
  app.get("/v1/reports/test/:testId", { onRequest: [app.requireAuth] }, async (req, reply) => {
    const { testId } = req.params as { testId: string };
    return withTenant(req.actor!.tenantId, async (tx) => {
      const test = await tx.test.findUnique({ where: { id: testId } });
      if (!test) return reply.status(404).send({ error: { code: "NOT_FOUND", message: `Test ${testId}` } });
      const [sample, project, trail] = await Promise.all([
        tx.sample.findUnique({ where: { id: test.sampleId } }),
        tx.project.findUnique({ where: { id: test.projectId } }),
        tx.auditLog.findMany({
          where: { entityType: "test", entityId: testId },
          orderBy: { createdAt: "desc" },
        }),
      ]);
      const reviewEvt   = trail.find((a) => a.action === "review");
      const approveEvt  = trail.find((a) => a.action === "approve");
      const signEvt     = trail.find((a) => a.action === "sign");

      // Pull signatureSerial out of the sign event's diff payload.
      let signatureSerial: string | null = null;
      if (signEvt?.newValues && Array.isArray(signEvt.newValues)) {
        const diff = signEvt.newValues as Array<{ field: string; from: string; to: string }>;
        signatureSerial = diff.find((d) => d.field === "signature")?.to ?? null;
      }

      return {
        test,
        sample,
        project,
        reportNumber: reportNumberFor(test.testCode),
        generatedAt:  (signEvt ?? approveEvt)?.createdAt.toISOString() ?? null,
        signedBy:     signEvt?.userEmail ?? null,
        signatureSerial,
        reviewedBy:   reviewEvt?.userEmail ?? null,
        reviewedAt:   reviewEvt?.createdAt.toISOString() ?? null,
        approvedBy:   approveEvt?.userEmail ?? null,
        approvedAt:   approveEvt?.createdAt.toISOString() ?? null,
        conformity:
          test.passFailStatus === "pass" ? "conforms" :
          test.passFailStatus === "fail" ? "does_not_conform" :
          "pending",
      };
    });
  });

  // Mark a report as generated — appends to audit + creates a Report row.
  app.post("/v1/reports/test/:testId/generated", { onRequest: [app.requirePerm("report:export")] }, async (req, reply) => {
    const { testId } = req.params as { testId: string };
    const body = MarkBody.parse(req.body);
    const { tenantId, email, role, sub: userId } = req.actor!;
    return withTenant(tenantId, async (tx) => {
      const test = await tx.test.findUnique({ where: { id: testId } });
      if (!test) return reply.status(404).send({ error: { code: "NOT_FOUND", message: `Test ${testId}` } });
      const reportNumber = reportNumberFor(test.testCode);
      const report = await tx.report.create({
        data: {
          tenantId,
          testId,
          reportNumber,
          reportType: body.format,
          generatedById: userId,
          status: "draft",
        },
      });
      await appendAudit(tx, tenantId, {
        ts: new Date().toISOString(),
        userEmail: email,
        userName: localPart(email),
        userRole: role,
        action: "update",
        entity: "test",
        entityId: testId,
        diff: [{ field: "report", from: "—", to: `${reportNumber} (${body.format})` }],
        ip: req.ip,
        userAgent: userAgentOf(req),
      });
      reply.code(201);
      return { reportNumber, reportId: report.id };
    });
  });

  // Public verification — no auth (the QR target). Resolves via reportNumber
  // or testCode and returns a redacted summary + chain integrity flag.
  app.get("/v1/reports/verify/:key", async (req) => {
    const { key } = req.params as { key: string };

    // Without an actor we can't set the GUC, so look up by report_number /
    // test_code globally then re-bind RLS to that row's tenant.
    const reportRow = await prisma.report.findFirst({ where: { reportNumber: key } });
    let testCode: string | null = null;
    let tenantId: string | null = reportRow?.tenantId ?? null;
    let testId: string | null = reportRow?.testId ?? null;

    if (!reportRow) {
      const t = await prisma.test.findFirst({ where: { testCode: key } });
      if (t) { tenantId = t.tenantId; testId = t.id; testCode = t.testCode; }
    }

    if (!tenantId || !testId) return { reportNumber: key, found: false };

    return withTenant(tenantId, async (tx) => {
      const test = await tx.test.findUnique({ where: { id: testId! } });
      if (!test) return { reportNumber: key, found: false };
      const trail = await tx.auditLog.findMany({
        where: { entityType: "test", entityId: testId! },
        orderBy: { createdAt: "desc" },
      });
      const fullChainRaw = await tx.auditLog.findMany({ orderBy: { createdAt: "desc" } });
      const fullChain: ChainEntry[] = fullChainRaw.map((a) => ({
        id: a.id,
        ts: a.createdAt.toISOString(),
        user: a.userEmail ?? "—",
        action: a.action,
        entity: a.entityType,
        entityId: a.entityId,
        diff: undefined,
        ip: a.ipAddress,
        prevHash: a.prevHash,
        hash: a.hash,
      }));
      const integrity = verifyChain(fullChain);
      const signEvt    = trail.find((a) => a.action === "sign");
      const approveEvt = trail.find((a) => a.action === "approve");
      let signatureSerial: string | null = null;
      if (signEvt?.newValues && Array.isArray(signEvt.newValues)) {
        const diff = signEvt.newValues as Array<{ field: string; from: string; to: string }>;
        signatureSerial = diff.find((d) => d.field === "signature")?.to ?? null;
      }

      return {
        reportNumber: reportRow?.reportNumber ?? reportNumberFor(testCode ?? test.testCode),
        found: true,
        testCode: test.testCode,
        standard: [test.standardBody, test.standardNumber].filter(Boolean).join(" "),
        conformity:
          test.passFailStatus === "pass" ? "conforms" :
          test.passFailStatus === "fail" ? "does_not_conform" :
          "pending",
        signedBy: signEvt?.userEmail ?? null,
        signatureSerial,
        signedAt: signEvt?.createdAt.toISOString() ?? null,
        approvedAt: approveEvt?.createdAt.toISOString() ?? null,
        chainOk: integrity.ok,
        brokenAt: integrity.brokenAt,
      };
    });
  });
}
