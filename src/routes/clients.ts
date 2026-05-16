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
  code:         z.string().min(1).max(100),
  name:         z.string().min(1).max(255),
  contactName:  z.string().max(255).optional(),
  contactEmail: z.string().email().max(255).optional(),
  contactPhone: z.string().max(50).optional(),
  address:      z.string().max(500).optional(),
  city:         z.string().max(100).optional(),
  country:      z.string().max(100).optional(),
  vatNumber:    z.string().max(50).optional(),
  crNumber:     z.string().max(50).optional(),
  notes:        z.string().optional(),
  isActive:     z.boolean().default(true),
});

const UpdateBody = CreateBody.partial();

function shape(c: {
  id: string; tenantId: string; code: string; name: string;
  contactName: string | null; contactEmail: string | null; contactPhone: string | null;
  address: string | null; city: string | null; country: string | null;
  vatNumber: string | null; crNumber: string | null;
  notes: string | null; isActive: boolean;
  createdAt: Date; updatedAt: Date;
}) {
  return {
    id: c.id,
    tenantId: c.tenantId,
    code: c.code,
    name: c.name,
    contactName:  c.contactName,
    contactEmail: c.contactEmail,
    contactPhone: c.contactPhone,
    address: c.address,
    city:    c.city,
    country: c.country,
    vatNumber: c.vatNumber,
    crNumber:  c.crNumber,
    notes:     c.notes,
    isActive:  c.isActive,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export async function clientsRoutes(app: FastifyInstance) {
  app.get("/v1/clients", { onRequest: [app.requireAuth] }, async (req, reply) => {
    const tenantId = requireTenantContext(req, reply);
    if (!tenantId) return;
    return withTenant(tenantId, async (tx) => {
      const items = await tx.client.findMany({
        where:   { tenantId },
        orderBy: { createdAt: "asc" },
      });
      return { items: items.map(shape), total: items.length };
    });
  });

  app.get("/v1/clients/:id", { onRequest: [app.requireAuth] }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const tenantId = requireTenantContext(req, reply);
    if (!tenantId) return;
    return withTenant(tenantId, async (tx) => {
      const found = await tx.client.findFirst({ where: { id, tenantId } });
      if (!found) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Client not found" } });
      return shape(found);
    });
  });

  app.post("/v1/clients", { onRequest: [app.requirePerm("settings:update")] }, async (req, reply) => {
    const tenantId = requireTenantContext(req, reply);
    if (!tenantId) return;
    const body = CreateBody.parse(req.body);
    return withTenant(tenantId, async (tx) => {
      const exists = await tx.client.findFirst({ where: { tenantId, code: body.code } });
      if (exists) {
        return reply.status(409).send({
          error: { code: "CONFLICT", message: `Client code "${body.code}" already exists` },
        });
      }
      const created = await tx.client.create({ data: { ...body, tenantId } });
      reply.code(201);
      return shape(created);
    });
  });

  app.patch("/v1/clients/:id", { onRequest: [app.requirePerm("settings:update")] }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const tenantId = requireTenantContext(req, reply);
    if (!tenantId) return;
    const body = UpdateBody.parse(req.body);
    return withTenant(tenantId, async (tx) => {
      const found = await tx.client.findFirst({ where: { id, tenantId } });
      if (!found) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Client not found" } });
      if (body.code && body.code !== found.code) {
        const dup = await tx.client.findFirst({ where: { tenantId, code: body.code } });
        if (dup) {
          return reply.status(409).send({
            error: { code: "CONFLICT", message: `Client code "${body.code}" already exists` },
          });
        }
      }
      const updated = await tx.client.update({ where: { id }, data: body });
      return shape(updated);
    });
  });

  app.delete("/v1/clients/:id", { onRequest: [app.requirePerm("settings:update")] }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const tenantId = requireTenantContext(req, reply);
    if (!tenantId) return;
    return withTenant(tenantId, async (tx) => {
      const found = await tx.client.findFirst({ where: { id, tenantId } });
      if (!found) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Client not found" } });
      await tx.client.delete({ where: { id } });
      reply.code(204);
    });
  });
}
