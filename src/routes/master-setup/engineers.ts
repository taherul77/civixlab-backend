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
  /** Optional — the server auto-generates ENG-NNN per tenant when omitted. */
  code:          z.string().max(100).optional(),
  name:          z.string().min(1).max(255),
  email:         z.string().email().max(255).optional(),
  phone:         z.string().max(50).optional(),
  licenseNumber: z.string().max(100).optional(),
  specialty:     z.string().max(100).optional(),
  notes:         z.string().optional(),
  isActive:      z.boolean().default(true),
});

const UpdateBody = CreateBody.partial();

function shape(e: {
  id: string; tenantId: string; code: string; name: string;
  email: string | null; phone: string | null;
  licenseNumber: string | null; specialty: string | null;
  notes: string | null; isActive: boolean;
  createdAt: Date; updatedAt: Date;
}) {
  return {
    id: e.id,
    tenantId: e.tenantId,
    code: e.code,
    name: e.name,
    email: e.email,
    phone: e.phone,
    licenseNumber: e.licenseNumber,
    specialty: e.specialty,
    notes: e.notes,
    isActive: e.isActive,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}

export async function engineersRoutes(app: FastifyInstance) {
  app.get("/v1/master-setup/engineers", { onRequest: [app.requireAuth] }, async (req, reply) => {
    const tenantId = requireTenantContext(req, reply);
    if (!tenantId) return;
    return withTenant(tenantId, async (tx) => {
      const items = await tx.engineer.findMany({
        where:   { tenantId },
        orderBy: { createdAt: "asc" },
      });
      return { items: items.map(shape), total: items.length };
    });
  });

  app.get("/v1/master-setup/engineers/:id", { onRequest: [app.requireAuth] }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const tenantId = requireTenantContext(req, reply);
    if (!tenantId) return;
    return withTenant(tenantId, async (tx) => {
      const found = await tx.engineer.findFirst({ where: { id, tenantId } });
      if (!found) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Engineer not found" } });
      return shape(found);
    });
  });

  app.post("/v1/master-setup/engineers", { onRequest: [app.requirePerm("settings:update")] }, async (req, reply) => {
    const tenantId = requireTenantContext(req, reply);
    if (!tenantId) return;
    const body = CreateBody.parse(req.body);
    return withTenant(tenantId, async (tx) => {
      // Auto-generate ENG-NNN per tenant when the client omits the code.
      let code = body.code;
      if (!code) {
        const prefix = "ENG-";
        const last = await tx.engineer.findFirst({
          where:   { tenantId, code: { startsWith: prefix } },
          orderBy: { code: "desc" },
          select:  { code: true },
        });
        let next = 1;
        if (last) {
          const m = last.code.match(/-(\d+)$/);
          if (m) next = Number(m[1]) + 1;
        }
        code = `${prefix}${String(next).padStart(3, "0")}`;
      }
      const exists = await tx.engineer.findFirst({ where: { tenantId, code } });
      if (exists) {
        return reply.status(409).send({
          error: { code: "CONFLICT", message: `Engineer code "${code}" already exists` },
        });
      }
      const created = await tx.engineer.create({ data: { ...body, code, tenantId } });
      reply.code(201);
      return shape(created);
    });
  });

  app.patch("/v1/master-setup/engineers/:id", { onRequest: [app.requirePerm("settings:update")] }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const tenantId = requireTenantContext(req, reply);
    if (!tenantId) return;
    const body = UpdateBody.parse(req.body);
    return withTenant(tenantId, async (tx) => {
      const found = await tx.engineer.findFirst({ where: { id, tenantId } });
      if (!found) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Engineer not found" } });
      if (body.code && body.code !== found.code) {
        const dup = await tx.engineer.findFirst({ where: { tenantId, code: body.code } });
        if (dup) {
          return reply.status(409).send({
            error: { code: "CONFLICT", message: `Engineer code "${body.code}" already exists` },
          });
        }
      }
      const updated = await tx.engineer.update({ where: { id }, data: body });
      return shape(updated);
    });
  });

  app.delete("/v1/master-setup/engineers/:id", { onRequest: [app.requirePerm("settings:update")] }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const tenantId = requireTenantContext(req, reply);
    if (!tenantId) return;
    return withTenant(tenantId, async (tx) => {
      const found = await tx.engineer.findFirst({ where: { id, tenantId } });
      if (!found) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Engineer not found" } });
      await tx.engineer.delete({ where: { id } });
      reply.code(204);
    });
  });
}
