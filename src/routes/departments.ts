import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { withTenant } from "@/db/prisma";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireTenantContext(req: FastifyRequest, reply: FastifyReply): string | null {
  const tenantId = req.actor?.tenantId ?? "";
  if (!tenantId || !UUID_RE.test(tenantId)) {
    reply.status(400).send({
      error: {
        code: "NO_TENANT_CONTEXT",
        message: "This endpoint requires an active tenant. Call /v1/auth/select-tenant first.",
      },
    });
    return null;
  }
  return tenantId;
}

const CreateBody = z.object({
  name:        z.string().min(1).max(100),
  code:        z.string().max(50).optional(),
  description: z.string().max(2000).optional(),
  manager:     z.string().max(255).optional(),
  isActive:    z.boolean().default(true),
});

const UpdateBody = CreateBody.partial();

function shape(d: {
  id: string; tenantId: string; name: string;
  code: string | null; description: string | null; manager: string | null;
  isActive: boolean; createdAt: Date; updatedAt: Date;
}) {
  return {
    id: d.id,
    tenantId: d.tenantId,
    name: d.name,
    code: d.code,
    description: d.description,
    manager: d.manager,
    isActive: d.isActive,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

export async function departmentsRoutes(app: FastifyInstance) {
  // List departments for the current tenant. Any signed-in member can read.
  app.get("/v1/departments", { onRequest: [app.requireAuth] }, async (req, reply) => {
    const tenantId = requireTenantContext(req, reply);
    if (!tenantId) return;
    return withTenant(tenantId, async (tx) => {
      const items = await tx.department.findMany({
        where:   { tenantId },
        orderBy: { name: "asc" },
      });
      return { items: items.map(shape), total: items.length };
    });
  });

  app.get("/v1/departments/:id", { onRequest: [app.requireAuth] }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const tenantId = requireTenantContext(req, reply);
    if (!tenantId) return;
    return withTenant(tenantId, async (tx) => {
      const dept = await tx.department.findFirst({ where: { id, tenantId } });
      if (!dept) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Department not found" } });
      return shape(dept);
    });
  });

  app.post("/v1/departments", { onRequest: [app.requirePerm("settings:update")] }, async (req, reply) => {
    const tenantId = requireTenantContext(req, reply);
    if (!tenantId) return;
    const body = CreateBody.parse(req.body);
    return withTenant(tenantId, async (tx) => {
      const exists = await tx.department.findFirst({ where: { tenantId, name: body.name } });
      if (exists) {
        return reply.status(409).send({
          error: { code: "CONFLICT", message: `Department "${body.name}" already exists` },
        });
      }
      const created = await tx.department.create({ data: { ...body, tenantId } });
      reply.code(201);
      return shape(created);
    });
  });

  app.put("/v1/departments/:id", { onRequest: [app.requirePerm("settings:update")] }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const tenantId = requireTenantContext(req, reply);
    if (!tenantId) return;
    const body = UpdateBody.parse(req.body);
    return withTenant(tenantId, async (tx) => {
      const found = await tx.department.findFirst({ where: { id, tenantId } });
      if (!found) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Department not found" } });
      if (body.name && body.name !== found.name) {
        const dup = await tx.department.findFirst({ where: { tenantId, name: body.name } });
        if (dup) {
          return reply.status(409).send({
            error: { code: "CONFLICT", message: `Department "${body.name}" already exists` },
          });
        }
      }
      const updated = await tx.department.update({ where: { id }, data: body });
      return shape(updated);
    });
  });

  app.delete("/v1/departments/:id", { onRequest: [app.requirePerm("settings:update")] }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const tenantId = requireTenantContext(req, reply);
    if (!tenantId) return;
    return withTenant(tenantId, async (tx) => {
      const found = await tx.department.findFirst({ where: { id, tenantId } });
      if (!found) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Department not found" } });
      await tx.department.delete({ where: { id } });
      reply.code(204);
    });
  });
}
