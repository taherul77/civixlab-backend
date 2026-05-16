import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { withTenant } from "@/db/prisma";
import { verifyChain, type ChainEntry } from "@/lib/audit";

const ListQuery = z.object({
  q: z.string().optional(),
  entity: z.string().optional(),
  entityId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

export async function auditRoutes(app: FastifyInstance) {
  app.get("/v1/lab/audit", { onRequest: [app.requirePerm("audit:read")] }, async (req) => {
    const q = ListQuery.parse(req.query);
    return withTenant(req.actor!.tenantId, async (tx) => {
      const where: Record<string, unknown> = {};
      if (q.entity && q.entity !== "all") where.entityType = q.entity;
      if (q.entityId) where.entityId = q.entityId;
      if (q.q) {
        where.OR = [
          { userEmail:  { contains: q.q, mode: "insensitive" } },
          { action:     { contains: q.q, mode: "insensitive" } },
          { entityType: { contains: q.q, mode: "insensitive" } },
        ];
      }
      const items = await tx.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: q.limit ?? 200,
      });
      return {
        items: items.map((a) => ({
          id: a.id,
          ts: a.createdAt.toISOString(),
          user: a.userEmail ?? "—",
          action: a.action,
          entity: a.entityType,
          entityId: a.entityId,
          diff: a.newValues,
          ip: a.ipAddress,
          prevHash: a.prevHash,
          hash: a.hash,
        })),
        total: items.length,
      };
    });
  });

  app.get("/v1/lab/audit/verify", { onRequest: [app.requirePerm("audit:read")] }, async (req) => {
    return withTenant(req.actor!.tenantId, async (tx) => {
      const items = await tx.auditLog.findMany({ orderBy: { createdAt: "desc" } });
      const chain: ChainEntry[] = items.map((a) => ({
        id: a.id,
        ts: a.createdAt.toISOString(),
        user: a.userEmail ?? "—",
        action: a.action,
        entity: a.entityType,
        entityId: a.entityId,
        diff: undefined,                 // server-side verify uses stored hash directly
        ip: a.ipAddress,
        prevHash: a.prevHash,
        hash: a.hash,
      }));
      return verifyChain(chain);
    });
  });
}
