import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { withTenant } from "@/db/prisma";
import { appendAudit } from "@/lib/audit";
import { userAgentOf, localPart } from "@/lib/req";

const CreateBody = z.object({
  equipmentCode: z.string().min(1).max(100),
  equipmentName: z.string().min(1).max(255),
  equipmentType: z.string().max(100).optional(),
  manufacturer: z.string().max(255).optional(),
  model: z.string().max(100).optional(),
  serialNumber: z.string().max(100).optional(),
  calibrationDate: z.string().datetime().optional(),
  calibrationDueDate: z.string().datetime().optional(),
  calibrationCertificateUrl: z.string().url().max(500).optional(),
  calibrationIntervalMonths: z.number().int().min(1).max(60).default(12),
  accuracyClass: z.string().max(50).optional(),
  measurementRange: z.string().max(100).optional(),
  status: z.enum(["active", "calibration_due", "out_of_service", "retired"]).default("active"),
  location: z.string().max(255).optional(),
});

const ConnectBody = z.object({
  vendor: z.string().min(1),
  endpoint: z.string().url().optional(),
  apiKey: z.string().optional(),
});

export async function equipmentRoutes(app: FastifyInstance) {
  app.get("/v1/equipment", { onRequest: [app.requireAuth] }, async (req) => {
    return withTenant(req.actor!.tenantId, async (tx) => {
      const items = await tx.equipment.findMany({ orderBy: { createdAt: "desc" } });
      return { items, total: items.length };
    });
  });

  app.get("/v1/equipment/:id", { onRequest: [app.requireAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    return withTenant(req.actor!.tenantId, async (tx) => {
      const row = await tx.equipment.findUnique({ where: { id } });
      if (!row) return reply.status(404).send({ error: { code: "NOT_FOUND", message: `Equipment ${id}` } });
      return row;
    });
  });

  app.post("/v1/equipment", { onRequest: [app.requirePerm("equipment:create")] }, async (req, reply) => {
    const body = CreateBody.parse(req.body);
    const { tenantId, email, role } = req.actor!;
    return withTenant(tenantId, async (tx) => {
      const created = await tx.equipment.create({
        data: {
          tenantId,
          ...body,
          calibrationDate:    body.calibrationDate    ? new Date(body.calibrationDate)    : null,
          calibrationDueDate: body.calibrationDueDate ? new Date(body.calibrationDueDate) : null,
        },
      });
      await appendAudit(tx, tenantId, {
        ts: new Date().toISOString(),
        userEmail: email,
        userName: localPart(email),
        userRole: role,
        action: "create",
        entity: "equipment",
        entityId: created.id,
        diff: [{ field: "code", from: "—", to: created.equipmentCode }],
        ip: req.ip,
        userAgent: userAgentOf(req),
      });
      reply.code(201);
      return created;
    });
  });

  // Connect / disconnect — store the integration endpoint on the row's
  // `apiEndpoint` / `apiKeyEncrypted` columns. (Real key encryption lands in
  // the equipment-adapter slice; for now we store cleartext but never echo it.)
  app.post("/v1/equipment/:id/connect", { onRequest: [app.requirePerm("equipment:calibrate")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = ConnectBody.parse(req.body);
    const { tenantId, email, role } = req.actor!;
    return withTenant(tenantId, async (tx) => {
      const eq = await tx.equipment.findUnique({ where: { id } });
      if (!eq) return reply.status(404).send({ error: { code: "NOT_FOUND", message: `Equipment ${id}` } });
      const updated = await tx.equipment.update({
        where: { id },
        data: { apiEndpoint: body.endpoint ?? null, apiKeyEncrypted: body.apiKey ?? null },
      });
      await appendAudit(tx, tenantId, {
        ts: new Date().toISOString(),
        userEmail: email,
        userName: localPart(email),
        userRole: role,
        action: "update",
        entity: "equipment",
        entityId: id,
        diff: [{ field: "integration", from: "—", to: `${body.vendor} @ ${body.endpoint ?? "(file import)"}` }],
        ip: req.ip,
        userAgent: userAgentOf(req),
      });
      const { apiKeyEncrypted: _omit, ...safe } = updated;
      void _omit;
      return safe;
    });
  });

  app.post("/v1/equipment/:id/disconnect", { onRequest: [app.requirePerm("equipment:calibrate")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { tenantId, email, role } = req.actor!;
    return withTenant(tenantId, async (tx) => {
      const eq = await tx.equipment.findUnique({ where: { id } });
      if (!eq) return reply.status(404).send({ error: { code: "NOT_FOUND", message: `Equipment ${id}` } });
      const updated = await tx.equipment.update({
        where: { id },
        data: { apiEndpoint: null, apiKeyEncrypted: null },
      });
      await appendAudit(tx, tenantId, {
        ts: new Date().toISOString(),
        userEmail: email,
        userName: localPart(email),
        userRole: role,
        action: "update",
        entity: "equipment",
        entityId: id,
        diff: [{ field: "integration", from: "connected", to: "disconnected" }],
        ip: req.ip,
        userAgent: userAgentOf(req),
      });
      const { apiKeyEncrypted: _omit, ...safe } = updated;
      void _omit;
      return safe;
    });
  });
}
