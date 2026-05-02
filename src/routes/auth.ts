import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/db/prisma";
import { rolePermissions } from "@/lib/rbac";

const SignInBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const SelectTenantBody = z.object({
  tenantId: z.string().uuid(),
});

export async function authRoutes(app: FastifyInstance) {
  // Step 1 — verify credentials. Returns the list of tenants this user can
  // enter; the client then calls /select-tenant to get a tenant-scoped JWT.
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

    // Short-lived user token — only useful as input to /select-tenant.
    const userToken = await reply.jwtSign(
      { sub: user.id, email: user.email, scope: "user" },
      { expiresIn: "10m" }
    );

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return {
      userToken,
      user: {
        id: user.id,
        email: user.email,
        name: [user.firstName, user.lastName].filter(Boolean).join(" "),
        mfaRequired: user.mfaEnabled,
      },
      memberships,
    };
  });

  // Step 2 — exchange userToken + tenantId for a tenant-scoped session JWT.
  app.post("/v1/auth/select-tenant", async (req, reply) => {
    const body = SelectTenantBody.parse(req.body);

    let decoded: { sub: string; email: string; scope: string };
    try {
      decoded = await req.jwtVerify<{ sub: string; email: string; scope: string }>();
    } catch {
      return reply.status(401).send({ error: { code: "UNAUTHENTICATED", message: "Invalid or missing user token" } });
    }
    if (decoded.scope !== "user") {
      return reply.status(401).send({ error: { code: "UNAUTHENTICATED", message: "Wrong token scope" } });
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

    const permissions = rolePermissions(membership.role);
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
      },
    };
  });

  app.get("/v1/auth/session", { onRequest: [app.requireAuth] }, async (req) => {
    return { actor: req.actor };
  });
}
