import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/db/prisma";
import { rolePermissions, BUILT_IN_ROLE_TEMPLATES, TENANT_ADMIN_ROLE } from "@/lib/rbac";

// Resolve a role's effective permissions for a given tenant. Reads the
// tenant's editable copy from `tenant_roles`; on a cold tenant (no rows
// yet) we seed all built-in templates from rbac defaults so subsequent
// reads are consistent. Tenant Admin always gets every permission.
async function resolveTenantPermissions(tenantId: string, role: string): Promise<string[]> {
  if (role === TENANT_ADMIN_ROLE) {
    // Always full perms regardless of any stored row.
    return rolePermissions(role) as string[];
  }
  let row = await prisma.tenantRole.findUnique({
    where: { tenantId_name: { tenantId, name: role } },
  });
  if (!row) {
    // Cold tenant — seed the full built-in template set so the Role
    // Management UI and the JWT see the same data.
    const existing = await prisma.tenantRole.findMany({
      where: { tenantId }, select: { name: true },
    });
    const have = new Set(existing.map((r) => r.name));
    const toCreate = BUILT_IN_ROLE_TEMPLATES
      .filter((n) => !have.has(n))
      .map((name) => ({
        tenantId,
        name,
        permissions: rolePermissions(name) as string[],
        isCustom: false,
      }));
    if (toCreate.length > 0) {
      await prisma.tenantRole.createMany({ data: toCreate, skipDuplicates: true });
    }
    row = await prisma.tenantRole.findUnique({
      where: { tenantId_name: { tenantId, name: role } },
    });
  }
  return row?.permissions ?? (rolePermissions(role) as string[]);
}

const SignInBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const SelectTenantBody = z.object({
  tenantId: z.string().uuid(),
});

export async function authRoutes(app: FastifyInstance) {
  // Step 1 — verify credentials. Super Admin gets a `scope: "super"` token
  // and can immediately call /v1/super/* routes. Regular users get a
  // short-lived user token plus their tenant memberships, and the client
  // calls /v1/auth/select-tenant next to get a tenant-scoped session JWT.
  app.post("/v1/auth/signin", async (req, reply) => {
    const body = SignInBody.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { email: body.email },
      include: {
        memberships: {
          where: { isActive: true },
          include: { tenant: { select: { id: true, name: true, subdomain: true, logoUrl: true } } },
        },
      },
    });
    if (!user || !user.passwordHash || !user.isActive) {
      return reply.status(401).send({ error: { code: "UNAUTHENTICATED", message: "Bad credentials" } });
    }
    const ok = await bcrypt.compare(body.password, user.passwordHash);
    if (!ok) {
      return reply.status(401).send({ error: { code: "UNAUTHENTICATED", message: "Bad credentials" } });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    if (user.isSuperAdmin) {
      const token = await reply.jwtSign({
        sub: user.id,
        email: user.email,
        scope: "super",
        is_super_admin: true,
      });
      return {
        kind: "super-admin",
        token,
        user: {
          id: user.id,
          email: user.email,
          name: [user.firstName, user.lastName].filter(Boolean).join(" "),
          isSuperAdmin: true,
        },
      };
    }

    const memberships = user.memberships.map((m) => ({
      tenantId: m.tenant.id,
      tenantName: m.tenant.name,
      subdomain: m.tenant.subdomain,
      logoUrl: m.tenant.logoUrl,
      role: m.role,
      department: m.department,
    }));

    if (memberships.length === 0) {
      return reply.status(403).send({
        error: { code: "NO_MEMBERSHIPS", message: "User is not a member of any company" },
      });
    }

    const userToken = await reply.jwtSign(
      { sub: user.id, email: user.email, scope: "user" },
      { expiresIn: "10m" }
    );

    return {
      kind: "user",
      userToken,
      user: {
        id: user.id,
        email: user.email,
        name: [user.firstName, user.lastName].filter(Boolean).join(" "),
        mfaRequired: user.mfaEnabled,
        isSuperAdmin: false,
      },
      memberships,
    };
  });

  // Step 2 — exchange userToken (or super token) + tenantId for a tenant-scoped JWT.
  // Super Admins can pick ANY tenant without a membership check.
  app.post("/v1/auth/select-tenant", async (req, reply) => {
    const body = SelectTenantBody.parse(req.body);

    let decoded: { sub: string; email: string; scope?: string; is_super_admin?: boolean };
    try {
      decoded = await req.jwtVerify<{ sub: string; email: string; scope?: string; is_super_admin?: boolean }>();
    } catch {
      return reply.status(401).send({ error: { code: "UNAUTHENTICATED", message: "Invalid or missing token" } });
    }
    // Accept user-scope, super-scope, OR any token with is_super_admin so a
    // Super Admin can keep switching tenants after their first /select-tenant.
    if (decoded.scope !== "user" && decoded.scope !== "super" && !decoded.is_super_admin) {
      return reply.status(401).send({ error: { code: "UNAUTHENTICATED", message: "Wrong token scope" } });
    }

    if (decoded.is_super_admin || decoded.scope === "super") {
      const tenant = await prisma.tenant.findUnique({ where: { id: body.tenantId } });
      if (!tenant) {
        return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Tenant not found" } });
      }
      const role = "Super Admin";
      const permissions = rolePermissions(role);
      // Carry scope:"super" forward so this super admin can call /select-tenant
      // again later to switch into a different company.
      const token = await reply.jwtSign({
        sub: decoded.sub,
        tenant_id: tenant.id,
        email: decoded.email,
        role,
        permissions,
        mfa_verified: true,
        is_super_admin: true,
        scope: "super",
      });
      return {
        token,
        session: {
          email: decoded.email,
          name: decoded.email,
          role,
          tenant: tenant.name,
          permissions,
          mfaRequired: false,
          isSuperAdmin: true,
        },
      };
    }

    const membership = await prisma.userTenantMembership.findUnique({
      where: { userId_tenantId: { userId: decoded.sub, tenantId: body.tenantId } },
      include: {
        tenant: { select: { id: true, name: true, subdomain: true } },
        user:   { select: { email: true, firstName: true, lastName: true, mfaEnabled: true } },
      },
    });
    if (!membership || !membership.isActive) {
      return reply.status(403).send({ error: { code: "FORBIDDEN", message: "Not a member of this company" } });
    }

    // Pull the tenant's editable role definition (auto-seeds on a cold
    // tenant) so any Tenant Admin customizations actually reach the JWT.
    const permissions = await resolveTenantPermissions(membership.tenant.id, membership.role);
    const token = await reply.jwtSign({
      sub: decoded.sub,
      tenant_id: membership.tenant.id,
      email: membership.user.email,
      role: membership.role,
      permissions,
      mfa_verified: !membership.user.mfaEnabled,
    });

    return {
      token,
      session: {
        email: membership.user.email,
        name: [membership.user.firstName, membership.user.lastName].filter(Boolean).join(" "),
        role: membership.role,
        tenant: membership.tenant.name,
        permissions,
        mfaRequired: membership.user.mfaEnabled,
        isSuperAdmin: false,
      },
    };
  });

  app.get("/v1/auth/session", { onRequest: [app.requireAuth] }, async (req) => {
    return { actor: req.actor };
  });
}
