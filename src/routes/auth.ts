import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/db/prisma";
import { rolePermissions, BUILT_IN_ROLE_TEMPLATES, TENANT_ADMIN_ROLE } from "@/lib/rbac";

// Resolve effective permissions for a list of role names within one tenant.
// Reads the tenant's editable copies from `roles`; cold tenants get their
// built-in templates seeded so subsequent reads are stable. Tenant Admin
// always grants every permission. The result is the *union* across every
// assigned role, with duplicates removed and original order preserved.
async function resolveTenantPermissions(tenantId: string, roles: readonly string[]): Promise<string[]> {
  if (!roles || roles.length === 0) return [];
  if (roles.includes(TENANT_ADMIN_ROLE)) {
    // Tenant Admin shortcut — always full perms regardless of any stored row.
    return rolePermissions(TENANT_ADMIN_ROLE) as string[];
  }
  try {
    // Make sure the built-in templates exist for this tenant; create only
    // the missing ones so we never overwrite a tenant's customisation.
    const haveRows = await prisma.role.findMany({ where: { tenantId }, select: { name: true } });
    const have = new Set(haveRows.map((r) => r.name));
    const toCreate = BUILT_IN_ROLE_TEMPLATES
      .filter((n) => !have.has(n))
      .map((name) => ({
        tenantId,
        name,
        permissions: rolePermissions(name) as string[],
        isCustom: false,
      }));
    if (toCreate.length > 0) {
      await prisma.role.createMany({ data: toCreate, skipDuplicates: true });
    }
    const rows = await prisma.role.findMany({
      where: { tenantId, name: { in: [...roles] } },
    });
    const byName = new Map(rows.map((r) => [r.name, r.permissions]));
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of roles) {
      const perms = byName.get(r) ?? (rolePermissions(r) as string[]);
      for (const p of perms) {
        if (!seen.has(p)) { seen.add(p); out.push(p); }
      }
    }
    return out;
  } catch {
    // Fallback to built-in defaults if the DB read explodes (cold start, etc).
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of roles) {
      for (const p of (rolePermissions(r) as string[])) {
        if (!seen.has(p)) { seen.add(p); out.push(p); }
      }
    }
    return out;
  }
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
      roles: m.roles,
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
      const roles = ["Super Admin"];
      const permissions = rolePermissions(roles[0]);
      // Carry scope:"super" forward so this super admin can call /select-tenant
      // again later to switch into a different company.
      const token = await reply.jwtSign({
        sub: decoded.sub,
        tenant_id: tenant.id,
        email: decoded.email,
        role: roles[0],
        roles,
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
          role: roles[0],
          roles,
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

    // Pull the tenant's editable role definitions (auto-seeds on a cold
    // tenant) so any Tenant Admin customizations actually reach the JWT.
    // Permissions are the union across every role on the membership.
    const roles = membership.roles ?? [];
    const permissions = await resolveTenantPermissions(membership.tenant.id, roles);
    const primary = roles[0] ?? "";
    const token = await reply.jwtSign({
      sub: decoded.sub,
      tenant_id: membership.tenant.id,
      email: membership.user.email,
      role: primary,
      roles,
      permissions,
      mfa_verified: !membership.user.mfaEnabled,
    });

    return {
      token,
      session: {
        email: membership.user.email,
        name: [membership.user.firstName, membership.user.lastName].filter(Boolean).join(" "),
        role: primary,
        roles,
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
