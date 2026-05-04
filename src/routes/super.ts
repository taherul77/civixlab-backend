import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/db/prisma";
import { BUILT_IN_ROLE_TEMPLATES, rolePermissions } from "@/lib/rbac";

const CreateTenantBody = z.object({
  name:      z.string().min(1).max(255),
  subdomain: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, "lowercase letters, digits, hyphens only"),
  crNumber:  z.string().max(50).optional(),
  vatNumber: z.string().max(50).optional(),
  subscriptionTier: z.enum(["starter", "professional", "enterprise"]).default("starter"),
  // First admin user for the new tenant.
  admin: z.object({
    email:     z.string().email(),
    firstName: z.string().max(100).optional(),
    lastName:  z.string().max(100).optional(),
    password:  z.string().min(8).max(200),
  }),
});

const TENANT_SAFE_SELECT = {
  id: true, name: true, subdomain: true, logoUrl: true,
  crNumber: true, vatNumber: true,
  subscriptionTier: true, subscriptionStatus: true,
  maxUsers: true, maxTestsPerMonth: true, storageLimitGb: true,
  saudiComplianceEnabled: true,
  createdAt: true, updatedAt: true,
} as const;

export async function superRoutes(app: FastifyInstance) {
  // List every tenant + a quick membership count. Super-admin only.
  app.get("/v1/super/tenants", { onRequest: [app.requireSuperAdmin] }, async () => {
    const tenants = await prisma.tenant.findMany({
      select: {
        ...TENANT_SAFE_SELECT,
        _count: { select: { memberships: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return {
      items: tenants.map((t) => ({
        ...t,
        memberCount: t._count.memberships,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      })),
    };
  });

  // Create a new tenant + its first Tenant Admin in one transaction.
  // If the admin email already exists globally, attach them as a Tenant Admin
  // membership rather than failing.
  app.post("/v1/super/tenants", { onRequest: [app.requireSuperAdmin] }, async (req, reply) => {
    const body = CreateTenantBody.parse(req.body);

    const existingSubdomain = await prisma.tenant.findUnique({ where: { subdomain: body.subdomain } });
    if (existingSubdomain) {
      return reply.status(409).send({
        error: { code: "CONFLICT", message: "Subdomain already taken" },
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name:      body.name,
          subdomain: body.subdomain,
          crNumber:  body.crNumber,
          vatNumber: body.vatNumber,
          subscriptionTier: body.subscriptionTier,
        },
      });

      let user = await tx.user.findUnique({ where: { email: body.admin.email } });
      if (!user) {
        const passwordHash = await bcrypt.hash(body.admin.password, 12);
        user = await tx.user.create({
          data: {
            email:        body.admin.email,
            passwordHash,
            firstName:    body.admin.firstName,
            lastName:     body.admin.lastName,
          },
        });
      }

      const membership = await tx.userTenantMembership.upsert({
        where:  { userId_tenantId: { userId: user.id, tenantId: tenant.id } },
        create: { userId: user.id, tenantId: tenant.id, roles: ["Tenant Admin"] },
        update: { roles: ["Tenant Admin"], isActive: true },
      });

      // Materialise the platform roles in the new tenant's `roles` table so
      // they show up immediately in Settings → Roles instead of waiting
      // for the lazy auto-seed on first sign-in.
      await tx.role.createMany({
        data: BUILT_IN_ROLE_TEMPLATES.map((name) => ({
          tenantId:    tenant.id,
          name,
          permissions: rolePermissions(name) as string[],
          isCustom:    false,
          createdById: req.actor?.sub,
          updatedById: req.actor?.sub,
        })),
        skipDuplicates: true,
      });

      return { tenant, user, membership };
    });

    reply.code(201);
    return {
      tenant: {
        ...result.tenant,
        createdAt: result.tenant.createdAt.toISOString(),
        updatedAt: result.tenant.updatedAt.toISOString(),
      },
      admin: {
        userId: result.user.id,
        email:  result.user.email,
        role:   result.membership.roles[0] ?? "",
        roles:  result.membership.roles,
      },
    };
  });
}
