import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@/db/prisma";

const UpdateBody = z.object({
  name:             z.string().min(1).max(255).optional(),
  subdomain:        z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, "lowercase letters, digits, hyphens only").optional(),
  logoUrl:          z.string().url().max(500).nullable().optional(),
  crNumber:         z.string().max(50).nullable().optional(),
  vatNumber:        z.string().max(50).nullable().optional(),
  subscriptionTier: z.enum(["starter", "professional", "enterprise"]).optional(),
  saudiComplianceEnabled: z.boolean().optional(),
});

// Laboratory profile is stored as a JSON sub-tree on tenant.settings.laboratory
// — keeps the schema simple while letting the admin tune it freely.
const LaboratoryBody = z.object({
  labCode:              z.string().max(100).optional(),
  labName:              z.string().max(255).optional(),
  accreditation:        z.string().max(255).optional(),
  accreditationNumber:  z.string().max(100).optional(),
  defaultStandardBody:  z.enum(["ASTM", "SASO", "GSO", "BS", "EN"]).optional(),
  reportPrefix:         z.string().max(20).optional(),
  sampleCodePrefix:     z.string().max(20).optional(),
  departments:          z.array(z.string().min(1).max(100)).max(100).optional(),
  disciplines:          z.array(z.string().min(1).max(100)).max(100).optional(),
});

function shape(t: {
  id: string; name: string; subdomain: string; logoUrl: string | null;
  crNumber: string | null; vatNumber: string | null;
  subscriptionTier: string; subscriptionStatus: string;
  maxUsers: number; maxTestsPerMonth: number; storageLimitGb: number;
  saudiComplianceEnabled: boolean;
  createdAt: Date; updatedAt: Date;
}) {
  return {
    id: t.id,
    name: t.name,
    subdomain: t.subdomain,
    logoUrl: t.logoUrl,
    crNumber: t.crNumber,
    vatNumber: t.vatNumber,
    subscriptionTier: t.subscriptionTier,
    subscriptionStatus: t.subscriptionStatus,
    limits: {
      maxUsers: t.maxUsers,
      maxTestsPerMonth: t.maxTestsPerMonth,
      storageLimitGb: t.storageLimitGb,
    },
    saudiComplianceEnabled: t.saudiComplianceEnabled,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

export async function tenantRoutes(app: FastifyInstance) {
  // Read the current tenant — any signed-in user can see their own company.
  app.get("/v1/master-setup/tenant", { onRequest: [app.requireAuth] }, async (req, reply) => {
    const tenant = await prisma.tenant.findUnique({ where: { id: req.actor!.tenantId } });
    if (!tenant) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Tenant not found" } });
    return shape(tenant);
  });

  // Update the current tenant — restricted to settings:update (Tenant Admin / Super Admin).
  app.patch("/v1/master-setup/tenant", { onRequest: [app.requirePerm("settings:update")] }, async (req, reply) => {
    const body = UpdateBody.parse(req.body);

    if (body.subdomain) {
      const taken = await prisma.tenant.findUnique({ where: { subdomain: body.subdomain } });
      if (taken && taken.id !== req.actor!.tenantId) {
        return reply.status(409).send({
          error: { code: "CONFLICT", message: "Subdomain is already taken" },
        });
      }
    }

    const updated = await prisma.tenant.update({
      where: { id: req.actor!.tenantId },
      data: body,
    });
    return shape(updated);
  });

  // -------------------------------------------------------------------------
  // Laboratory profile (lives on tenant.settings.laboratory).
  // -------------------------------------------------------------------------

  app.get("/v1/master-setup/tenant/laboratory", { onRequest: [app.requireAuth] }, async (req, reply) => {
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.actor!.tenantId },
      select: { settings: true },
    });
    if (!tenant) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Tenant not found" } });
    const settings = (tenant.settings ?? {}) as Record<string, unknown>;
    const laboratory = (settings.laboratory ?? {}) as Record<string, unknown>;
    return laboratory;
  });

  app.put("/v1/master-setup/tenant/laboratory", { onRequest: [app.requirePerm("settings:update")] }, async (req) => {
    const body = LaboratoryBody.parse(req.body);
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.actor!.tenantId },
      select: { settings: true },
    });
    const current = (tenant?.settings ?? {}) as Record<string, unknown>;
    const merged  = { ...current, laboratory: body };
    const updated = await prisma.tenant.update({
      where: { id: req.actor!.tenantId },
      data:  { settings: merged },
      select: { settings: true },
    });
    const settings = (updated.settings ?? {}) as Record<string, unknown>;
    return (settings.laboratory ?? {}) as Record<string, unknown>;
  });
}
