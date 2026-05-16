import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { withTenant } from "@/db/prisma";
import { appendAudit } from "@/lib/audit";
import { userAgentOf, localPart } from "@/lib/req";

const ListQuery = z.object({
  status: z.enum(["active", "completed", "on_hold", "cancelled", "all"]).optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const CreateBody = z.object({
  projectCode: z.string().min(1).max(100),
  projectName: z.string().min(1).max(255),
  clientName: z.string().max(255).optional(),
  clientEmail: z.string().email().optional(),
  location: z.string().max(500).optional(),
  city: z.string().max(100).optional(),
  region: z.string().max(100).optional(),
  engineerName: z.string().max(255).optional(),
  engineerLicense: z.string().max(100).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  contractValue: z.number().nonnegative().optional(),
  etimadContractNumber: z.string().max(100).optional(),
  status: z.enum(["active", "completed", "on_hold", "cancelled"]).default("active"),
});

const UpdateBody = CreateBody.partial();

export async function projectRoutes(app: FastifyInstance) {
  app.get("/v1/projects", { onRequest: [app.requireAuth] }, async (req) => {
    const q = ListQuery.parse(req.query);
    return withTenant(req.actor!.tenantId, async (tx) => {
      const where: Record<string, unknown> = {};
      if (q.status && q.status !== "all") where.status = q.status;
      if (q.q) {
        where.OR = [
          { projectCode: { contains: q.q, mode: "insensitive" } },
          { projectName: { contains: q.q, mode: "insensitive" } },
          { clientName:  { contains: q.q, mode: "insensitive" } },
          { city:        { contains: q.q, mode: "insensitive" } },
        ];
      }
      const [rows, total] = await Promise.all([
        tx.project.findMany({
          where,
          orderBy: { createdAt: "desc" },
          take: q.limit ?? 100,
          skip: q.offset ?? 0,
          include: { _count: { select: { samples: true, tests: true } } },
        }),
        tx.project.count({ where }),
      ]);
      const items = rows.map(({ _count, ...p }) => ({
        ...p,
        sampleCount: _count.samples,
        testCount:   _count.tests,
      }));
      return { items, total };
    });
  });

  app.get("/v1/projects/:id", { onRequest: [app.requireAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    return withTenant(req.actor!.tenantId, async (tx) => {
      const row = await tx.project.findUnique({ where: { id } });
      if (!row) return reply.status(404).send({ error: { code: "NOT_FOUND", message: `Project ${id}` } });
      return row;
    });
  });

  app.post("/v1/projects", { onRequest: [app.requirePerm("project:create")] }, async (req, reply) => {
    const body = CreateBody.parse(req.body);
    const { tenantId, sub: userId, email, role } = req.actor!;
    return withTenant(tenantId, async (tx) => {
      const created = await tx.project.create({
        data: {
          tenantId,
          createdById: userId,
          ...body,
          startDate: body.startDate ? new Date(body.startDate) : null,
          endDate:   body.endDate   ? new Date(body.endDate)   : null,
          contractValue: body.contractValue ?? null,
        },
      });
      await appendAudit(tx, tenantId, {
        ts: new Date().toISOString(),
        userEmail: email,
        userName: localPart(email),
        userRole: role,
        action: "create",
        entity: "project",
        entityId: created.id,
        diff: [{ field: "code", from: "—", to: created.projectCode }],
        ip: req.ip,
        userAgent: userAgentOf(req),
      });
      reply.code(201);
      return created;
    });
  });

  app.patch("/v1/projects/:id", { onRequest: [app.requirePerm("project:update")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const patch = UpdateBody.parse(req.body);
    const { tenantId, email, role } = req.actor!;
    return withTenant(tenantId, async (tx) => {
      const before = await tx.project.findFirst({ where: { id, tenantId } });
      if (!before) return reply.status(404).send({ error: { code: "NOT_FOUND", message: `Project ${id}` } });
      const updated = await tx.project.update({
        where: { id },
        data: {
          ...patch,
          startDate: patch.startDate ? new Date(patch.startDate) : undefined,
          endDate:   patch.endDate   ? new Date(patch.endDate)   : undefined,
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
          entity: "project",
          entityId: id,
          diff,
          ip: req.ip,
          userAgent: userAgentOf(req),
        });
      }
      return updated;
    });
  });

  app.delete("/v1/projects/:id", { onRequest: [app.requirePerm("project:delete")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { tenantId, email, role } = req.actor!;
    return withTenant(tenantId, async (tx) => {
      const found = await tx.project.findFirst({ where: { id, tenantId } });
      if (!found) return reply.status(404).send({ error: { code: "NOT_FOUND", message: `Project ${id}` } });

      // Cascade — the schema has no onDelete on Project→{Sample,Test,WaterTest}
      // and Test→Report, so we have to clear children manually before the
      // project row can go. All inside the same tenant-scoped transaction.
      const sampleIds = (await tx.sample.findMany({
        where: { projectId: id }, select: { id: true },
      })).map((s) => s.id);
      const testIds = (await tx.test.findMany({
        where: { projectId: id }, select: { id: true },
      })).map((t) => t.id);

      if (testIds.length > 0) {
        await tx.report.deleteMany({ where: { testId: { in: testIds } } });
      }
      await tx.waterTest.deleteMany({ where: { projectId: id } });
      if (testIds.length > 0) {
        await tx.test.deleteMany({ where: { id: { in: testIds } } });
      }
      if (sampleIds.length > 0) {
        await tx.sample.deleteMany({ where: { id: { in: sampleIds } } });
      }
      await tx.project.delete({ where: { id } });

      await appendAudit(tx, tenantId, {
        ts: new Date().toISOString(),
        userEmail: email,
        userName: localPart(email),
        userRole: role,
        action: "delete",
        entity: "project",
        entityId: id,
        diff: [
          { field: "code", from: found.projectCode, to: "—" },
          { field: "samples_deleted", from: "0", to: String(sampleIds.length) },
          { field: "tests_deleted",   from: "0", to: String(testIds.length) },
        ],
        ip: req.ip,
        userAgent: userAgentOf(req),
      });
      reply.code(204);
    });
  });
}
