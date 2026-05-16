import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { withTenant } from "@/db/prisma";
import { appendAudit } from "@/lib/audit";
import { userAgentOf, localPart } from "@/lib/req";

// Sample types per spec §6 — concrete, soil, aggregate, asphalt, steel, cement,
// masonry, water. We keep the validator open-ended so custom categories don't
// break ingest.
const SampleType = z.string().min(1).max(100);

const ListQuery = z.object({
  type: z.string().optional(),
  projectId: z.string().uuid().optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const CreateBody = z.object({
  projectId: z.string().uuid(),
  /** Optional — the server auto-generates a SMP-YYYY-NNN code per tenant when
   *  the client doesn't send one (undefined or empty string both qualify). */
  sampleCode: z.string().max(100).optional(),
  sampleType: SampleType,
  sampleDate: z.string().datetime(),
  receivedDate: z.string().datetime().optional(),
  sampledBy: z.string().max(255).optional(),
  sampleLocation: z.string().max(500).optional(),
  gpsCoordinates: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(["pending", "received", "in_progress", "completed", "rejected"]).default("pending"),
  chainOfCustody: z.unknown().optional(),
});

const UpdateBody = z.object({
  sampleType: SampleType.optional(),
  sampleDate: z.string().datetime().optional(),
  receivedDate: z.string().datetime().optional(),
  sampledBy: z.string().max(255).optional(),
  sampleLocation: z.string().max(500).optional(),
  gpsCoordinates: z.string().optional(),
  description: z.string().optional(),
  // Limit user-driven status edits to the pre-send states. Workflow
  // transitions (in_progress, completed) happen through dedicated endpoints
  // — letting the edit modal flip them would bypass the audit trail.
  status: z.enum(["pending", "received", "rejected"]).optional(),
});

const SENT_STATES = new Set(["in_progress", "completed"]);

export async function sampleRoutes(app: FastifyInstance) {
  app.get("/v1/operations/samples", { onRequest: [app.requireAuth] }, async (req) => {
    const q = ListQuery.parse(req.query);
    return withTenant(req.actor!.tenantId, async (tx) => {
      const where: Record<string, unknown> = {};
      if (q.type && q.type !== "all") where.sampleType = q.type;
      if (q.projectId) where.projectId = q.projectId;
      if (q.q) {
        where.OR = [
          { sampleCode:     { contains: q.q, mode: "insensitive" } },
          { sampleLocation: { contains: q.q, mode: "insensitive" } },
          { sampledBy:      { contains: q.q, mode: "insensitive" } },
        ];
      }
      const [items, total] = await Promise.all([
        tx.sample.findMany({
          where,
          orderBy: { createdAt: "desc" },
          take: q.limit ?? 100,
          skip: q.offset ?? 0,
        }),
        tx.sample.count({ where }),
      ]);
      return { items, total };
    });
  });

  app.get("/v1/operations/samples/:id", { onRequest: [app.requireAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    return withTenant(req.actor!.tenantId, async (tx) => {
      const row = await tx.sample.findUnique({ where: { id } });
      if (!row) return reply.status(404).send({ error: { code: "NOT_FOUND", message: `Sample ${id}` } });
      return row;
    });
  });

  app.post("/v1/operations/samples", { onRequest: [app.requirePerm("sample:create")] }, async (req, reply) => {
    const body = CreateBody.parse(req.body);
    const { tenantId, sub: userId, email, role } = req.actor!;
    return withTenant(tenantId, async (tx) => {
      // Validate the project belongs to this tenant (RLS already filters,
      // but a hand-shaped 422 is friendlier than a generic FK violation).
      const project = await tx.project.findUnique({ where: { id: body.projectId } });
      if (!project) return reply.status(422).send({ error: { code: "VALIDATION", message: "Unknown projectId for this tenant" } });

      // Auto-generate a SMP-YYYY-NNN code per tenant when the client doesn't
      // provide one. Same pattern as projects — highest suffix wins, padded
      // to 3 digits, P2002 on (tenantId, sampleCode) catches races.
      let sampleCode = body.sampleCode;
      if (!sampleCode) {
        const year = new Date().getFullYear();
        const prefix = `SMP-${year}-`;
        const last = await tx.sample.findFirst({
          where:   { tenantId, sampleCode: { startsWith: prefix } },
          orderBy: { sampleCode: "desc" },
          select:  { sampleCode: true },
        });
        let next = 1;
        if (last) {
          const m = last.sampleCode.match(/-(\d+)$/);
          if (m) next = Number(m[1]) + 1;
        }
        sampleCode = `${prefix}${String(next).padStart(3, "0")}`;
      }

      const created = await tx.sample.create({
        data: {
          tenantId,
          createdById: userId,
          projectId: body.projectId,
          sampleCode,
          sampleType: body.sampleType,
          sampleDate: new Date(body.sampleDate),
          receivedDate: body.receivedDate ? new Date(body.receivedDate) : null,
          sampledBy: body.sampledBy,
          sampleLocation: body.sampleLocation,
          gpsCoordinates: body.gpsCoordinates,
          description: body.description,
          status: body.status,
          chainOfCustody: (body.chainOfCustody ?? undefined) as never,
        },
      });
      await appendAudit(tx, tenantId, {
        ts: new Date().toISOString(),
        userEmail: email,
        userName: localPart(email),
        userRole: role,
        action: "create",
        entity: "sample",
        entityId: created.id,
        diff: [{ field: "code", from: "—", to: created.sampleCode }],
        ip: req.ip,
        userAgent: userAgentOf(req),
      });
      reply.code(201);
      return created;
    });
  });

  app.patch("/v1/operations/samples/:id", { onRequest: [app.requirePerm("sample:update")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const patch = UpdateBody.parse(req.body);
    const { tenantId, email, role } = req.actor!;
    return withTenant(tenantId, async (tx) => {
      const before = await tx.sample.findFirst({ where: { id, tenantId } });
      if (!before) return reply.status(404).send({ error: { code: "NOT_FOUND", message: `Sample ${id}` } });
      if (SENT_STATES.has(before.status)) {
        return reply.status(409).send({
          error: {
            code: "SAMPLE_LOCKED",
            message: `Sample is ${before.status} — edits are disabled once a sample has been sent to tests.`,
          },
        });
      }
      const updated = await tx.sample.update({
        where: { id },
        data: {
          ...patch,
          sampleDate:   patch.sampleDate   ? new Date(patch.sampleDate)   : undefined,
          receivedDate: patch.receivedDate ? new Date(patch.receivedDate) : undefined,
        },
      });
      const before_ = before as Record<string, unknown>;
      const after_  = updated as Record<string, unknown>;
      const diff = Object.keys(patch)
        .map((k) => ({
          field: k,
          from: String(before_[k] ?? "—"),
          to:   String(after_[k]  ?? "—"),
        }))
        .filter((d) => d.from !== d.to);
      if (diff.length > 0) {
        await appendAudit(tx, tenantId, {
          ts: new Date().toISOString(),
          userEmail: email,
          userName: localPart(email),
          userRole: role,
          action: "update",
          entity: "sample",
          entityId: id,
          diff,
          ip: req.ip,
          userAgent: userAgentOf(req),
        });
      }
      return updated;
    });
  });

  app.delete("/v1/operations/samples/:id", { onRequest: [app.requirePerm("sample:delete")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { tenantId, email, role } = req.actor!;
    return withTenant(tenantId, async (tx) => {
      const found = await tx.sample.findFirst({ where: { id, tenantId } });
      if (!found) return reply.status(404).send({ error: { code: "NOT_FOUND", message: `Sample ${id}` } });
      if (SENT_STATES.has(found.status)) {
        return reply.status(409).send({
          error: {
            code: "SAMPLE_LOCKED",
            message: `Cannot delete a ${found.status} sample — it has been pushed to the test workflow.`,
          },
        });
      }

      // No onDelete cascade from Sample→{Test,WaterTest,Report}; clear
      // children inside the same tenant-scoped transaction.
      const testIds = (await tx.test.findMany({
        where: { sampleId: id }, select: { id: true },
      })).map((t) => t.id);
      if (testIds.length > 0) {
        await tx.report.deleteMany({ where: { testId: { in: testIds } } });
        await tx.test.deleteMany({ where: { id: { in: testIds } } });
      }
      await tx.waterTest.deleteMany({ where: { sampleId: id } });
      await tx.sample.delete({ where: { id } });

      await appendAudit(tx, tenantId, {
        ts: new Date().toISOString(),
        userEmail: email,
        userName: localPart(email),
        userRole: role,
        action: "delete",
        entity: "sample",
        entityId: id,
        diff: [
          { field: "code",          from: found.sampleCode,  to: "—" },
          { field: "tests_deleted", from: "0",               to: String(testIds.length) },
        ],
        ip: req.ip,
        userAgent: userAgentOf(req),
      });
      reply.code(204);
    });
  });

  /**
   * Push a sample into the test workflow. Allowed from `pending` and
   * `received`. Refuses `rejected` (need to re-collect), `in_progress` /
   * `completed` (already sent / terminal). Flips status to `in_progress`.
   * The audit log captures who/when so we don't need an extra column.
   */
  app.post("/v1/operations/samples/:id/send", { onRequest: [app.requirePerm("sample:update")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { tenantId, email, role } = req.actor!;
    return withTenant(tenantId, async (tx) => {
      const found = await tx.sample.findFirst({ where: { id, tenantId } });
      if (!found) {
        return reply.status(404).send({ error: { code: "NOT_FOUND", message: `Sample ${id}` } });
      }
      if (found.status === "rejected") {
        return reply.status(409).send({
          error: {
            code: "SAMPLE_REJECTED",
            message: "Sample was rejected — it must be re-collected before sending to tests.",
          },
        });
      }
      if (SENT_STATES.has(found.status)) {
        return reply.status(409).send({
          error: {
            code: "ALREADY_SENT",
            message: `Sample is already ${found.status}.`,
          },
        });
      }

      const updated = await tx.sample.update({
        where: { id },
        data: { status: "in_progress" },
      });

      await appendAudit(tx, tenantId, {
        ts: new Date().toISOString(),
        userEmail: email,
        userName: localPart(email),
        userRole: role,
        action: "send",
        entity: "sample",
        entityId: id,
        diff: [{ field: "status", from: found.status, to: "in_progress" }],
        ip: req.ip,
        userAgent: userAgentOf(req),
      });

      return updated;
    });
  });
}
