import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/db/prisma";
import { rolePermissions } from "@/lib/rbac";

const SignInBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  tenantSubdomain: z.string().min(1),
});

export async function authRoutes(app: FastifyInstance) {
  app.post("/v1/auth/signin", async (req, reply) => {
    const body = SignInBody.parse(req.body);

    const tenant = await prisma.tenant.findUnique({ where: { subdomain: body.tenantSubdomain } });
    if (!tenant) return reply.status(401).send({ error: { code: "UNAUTHENTICATED", message: "Tenant not found" } });

    const user = await prisma.user.findUnique({
      where: { tenantId_email: { tenantId: tenant.id, email: body.email } },
    });
    if (!user || !user.passwordHash) {
      return reply.status(401).send({ error: { code: "UNAUTHENTICATED", message: "Bad credentials" } });
    }
    const ok = await bcrypt.compare(body.password, user.passwordHash);
    if (!ok) {
      return reply.status(401).send({ error: { code: "UNAUTHENTICATED", message: "Bad credentials" } });
    }

    const permissions = rolePermissions(user.role);
    const token = await reply.jwtSign({
      sub: user.id,
      tenant_id: tenant.id,
      email: user.email,
      role: user.role,
      permissions,
      mfa_verified: !user.mfaEnabled, // first-pass: skip MFA challenge if not enrolled
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return {
      token,
      session: {
        email: user.email,
        name: [user.firstName, user.lastName].filter(Boolean).join(" "),
        role: user.role,
        tenant: tenant.name,
        permissions,
        mfaRequired: user.mfaEnabled,
      },
    };
  });

  app.get("/v1/auth/session", { onRequest: [app.requireAuth] }, async (req) => {
    return { actor: req.actor };
  });
}
