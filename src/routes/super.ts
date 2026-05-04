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

const UpdateTenantBody = z.object({
  name:                   z.string().min(1).max(255).optional(),
  subdomain:              z.string().min(1).max(100).regex(/^[a-z0-9-]+$/).optional(),
  crNumber:               z.string().max(50).nullable().optional(),
  vatNumber:              z.string().max(50).nullable().optional(),
  subscriptionTier:       z.enum(["starter", "professional", "enterprise"]).optional(),
  subscriptionStatus:     z.enum(["active", "suspended", "cancelled"]).optional(),
  saudiComplianceEnabled: z.boolean().optional(),
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  // Get a single tenant + a quick membership count.
  app.get("/v1/super/tenants/:id", { onRequest: [app.requireSuperAdmin] }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!UUID_RE.test(id)) {
      return reply.status(400).send({ error: { code: "VALIDATION", message: "Invalid tenant id" } });
    }
    const tenant = await prisma.tenant.findUnique({
      where: { id },
      select: { ...TENANT_SAFE_SELECT, _count: { select: { memberships: true } } },
    });
    if (!tenant) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Tenant not found" } });
    return {
      ...tenant,
      memberCount: tenant._count.memberships,
      createdAt: tenant.createdAt.toISOString(),
      updatedAt: tenant.updatedAt.toISOString(),
    };
  });

  // Update tenant profile fields. Subdomain rename is allowed but checked
  // against the global unique index. Member count is read-only.
  app.put("/v1/super/tenants/:id", { onRequest: [app.requireSuperAdmin] }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!UUID_RE.test(id)) {
      return reply.status(400).send({ error: { code: "VALIDATION", message: "Invalid tenant id" } });
    }
    const body = UpdateTenantBody.parse(req.body);
    const found = await prisma.tenant.findUnique({ where: { id } });
    if (!found) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Tenant not found" } });

    if (body.subdomain && body.subdomain !== found.subdomain) {
      const dup = await prisma.tenant.findUnique({ where: { subdomain: body.subdomain } });
      if (dup) {
        return reply.status(409).send({ error: { code: "CONFLICT", message: "Subdomain already taken" } });
      }
    }

    const updated = await prisma.tenant.update({
      where: { id },
      data: body,
      select: { ...TENANT_SAFE_SELECT, _count: { select: { memberships: true } } },
    });
    return {
      ...updated,
      memberCount: updated._count.memberships,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  });

  // List the members of one tenant. Super-admin only — bypasses the usual
  // tenant-scoped /v1/users endpoint so a platform admin can audit any
  // company without first switching into it.
  app.get("/v1/super/tenants/:id/members", { onRequest: [app.requireSuperAdmin] }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!UUID_RE.test(id)) {
      return reply.status(400).send({ error: { code: "VALIDATION", message: "Invalid tenant id" } });
    }
    const tenant = await prisma.tenant.findUnique({ where: { id }, select: { id: true } });
    if (!tenant) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Tenant not found" } });

    const memberships = await prisma.userTenantMembership.findMany({
      where: { tenantId: id },
      include: {
        user: {
          select: {
            id: true, email: true, firstName: true, lastName: true, phone: true,
            isActive: true, mfaEnabled: true, lastLoginAt: true, createdAt: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return {
      items: memberships.map((m) => ({
        id:               m.user.id,
        email:            m.user.email,
        firstName:        m.user.firstName,
        lastName:         m.user.lastName,
        phone:            m.user.phone,
        roles:            m.roles,
        department:       m.department,
        isActive:         m.user.isActive,
        membershipActive: m.isActive,
        mfaEnabled:       m.user.mfaEnabled,
        lastLoginAt:      m.user.lastLoginAt ? m.user.lastLoginAt.toISOString() : null,
        joinedAt:         m.createdAt.toISOString(),
      })),
      total: memberships.length,
    };
  });

  // Delete a tenant. ON DELETE CASCADE on the related rows (memberships,
  // roles, projects, samples, tests, …) cleans everything tenant-scoped up.
  app.delete("/v1/super/tenants/:id", { onRequest: [app.requireSuperAdmin] }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!UUID_RE.test(id)) {
      return reply.status(400).send({ error: { code: "VALIDATION", message: "Invalid tenant id" } });
    }
    const found = await prisma.tenant.findUnique({ where: { id } });
    if (!found) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Tenant not found" } });
    await prisma.tenant.delete({ where: { id } });
    reply.code(204);
  });
}
