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
  sampleCode: z.string().min(1).max(100),
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

      const created = await tx.sample.create({
        data: {
          tenantId,
          createdById: userId,
          projectId: body.projectId,
          sampleCode: body.sampleCode,
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
}
