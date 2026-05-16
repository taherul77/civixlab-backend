import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { withTenant } from "@/db/prisma";

const STANDARD_BODIES = ["ASTM", "SASO", "GSO", "BS", "EN"] as const;
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
  code:                z.string().min(1).max(100),
  name:                z.string().min(1).max(255),
  accreditation:       z.string().max(255).optional(),
  accreditationNumber: z.string().max(100).optional(),
  defaultStandardBody: z.enum(STANDARD_BODIES).default("ASTM"),
  reportPrefix:        z.string().max(20).default("RPT"),
  sampleCodePrefix:    z.string().max(20).default("S"),
  departments:         z.array(z.string().min(1).max(100)).max(100).default([]),
  disciplines:         z.array(z.string().min(1).max(100)).max(100).default([]),
  isActive:            z.boolean().default(true),
});

const UpdateBody = CreateBody.partial();

function shape(l: {
  id: string; tenantId: string; code: string; name: string;
  accreditation: string | null; accreditationNumber: string | null;
  defaultStandardBody: string; reportPrefix: string; sampleCodePrefix: string;
  departments: string[]; disciplines: string[];
  isActive: boolean; createdAt: Date; updatedAt: Date;
}) {
  return {
    id: l.id,
    tenantId: l.tenantId,
    code: l.code,
    name: l.name,
    accreditation: l.accreditation,
    accreditationNumber: l.accreditationNumber,
    defaultStandardBody: l.defaultStandardBody,
    reportPrefix: l.reportPrefix,
    sampleCodePrefix: l.sampleCodePrefix,
    departments: l.departments,
    disciplines: l.disciplines,
    isActive: l.isActive,
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
  };
}

export async function laboratoriesRoutes(app: FastifyInstance) {
  // List labs for the current tenant. Any signed-in member can read.
  app.get("/v1/master-setup/laboratories", { onRequest: [app.requireAuth] }, async (req, reply) => {
    const tenantId = requireTenantContext(req, reply);
    if (!tenantId) return;
    return withTenant(tenantId, async (tx) => {
      const items = await tx.laboratory.findMany({
        where:   { tenantId },
        orderBy: { createdAt: "asc" },
      });
      return { items: items.map(shape), total: items.length };
    });
  });

  app.get("/v1/master-setup/laboratories/:id", { onRequest: [app.requireAuth] }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const tenantId = requireTenantContext(req, reply);
    if (!tenantId) return;
    return withTenant(tenantId, async (tx) => {
      const lab = await tx.laboratory.findFirst({ where: { id, tenantId } });
      if (!lab) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Laboratory not found" } });
      return shape(lab);
    });
  });

  app.post("/v1/master-setup/laboratories", { onRequest: [app.requirePerm("settings:update")] }, async (req, reply) => {
    const tenantId = requireTenantContext(req, reply);
    if (!tenantId) return;
    const body = CreateBody.parse(req.body);
    return withTenant(tenantId, async (tx) => {
      const exists = await tx.laboratory.findFirst({ where: { tenantId, code: body.code } });
      if (exists) {
        return reply.status(409).send({
          error: { code: "CONFLICT", message: `Laboratory code "${body.code}" already exists` },
        });
      }
      const created = await tx.laboratory.create({ data: { ...body, tenantId } });
      reply.code(201);
      return shape(created);
    });
  });

  app.patch("/v1/master-setup/laboratories/:id", { onRequest: [app.requirePerm("settings:update")] }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const tenantId = requireTenantContext(req, reply);
    if (!tenantId) return;
    const body = UpdateBody.parse(req.body);
    return withTenant(tenantId, async (tx) => {
      const found = await tx.laboratory.findFirst({ where: { id, tenantId } });
      if (!found) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Laboratory not found" } });
      if (body.code && body.code !== found.code) {
        const dup = await tx.laboratory.findFirst({ where: { tenantId, code: body.code } });
        if (dup) {
          return reply.status(409).send({
            error: { code: "CONFLICT", message: `Laboratory code "${body.code}" already exists` },
          });
        }
      }
      const updated = await tx.laboratory.update({ where: { id }, data: body });
      return shape(updated);
    });
  });

  app.delete("/v1/master-setup/laboratories/:id", { onRequest: [app.requirePerm("settings:update")] }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const tenantId = requireTenantContext(req, reply);
    if (!tenantId) return;
    return withTenant(tenantId, async (tx) => {
      const found = await tx.laboratory.findFirst({ where: { id, tenantId } });
      if (!found) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Laboratory not found" } });
      await tx.laboratory.delete({ where: { id } });
      reply.code(204);
    });
  });
}
