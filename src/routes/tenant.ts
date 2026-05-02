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
  app.get("/v1/tenant", { onRequest: [app.requireAuth] }, async (req, reply) => {
    const tenant = await prisma.tenant.findUnique({ where: { id: req.actor!.tenantId } });
    if (!tenant) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Tenant not found" } });
    return shape(tenant);
  });

  // Update the current tenant — restricted to settings:write (Tenant Admin / Super Admin).
  app.patch("/v1/tenant", { onRequest: [app.requirePerm("settings:write")] }, async (req, reply) => {
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
}
