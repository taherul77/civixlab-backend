import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma, withTenant } from "@/db/prisma";
import { appendAudit } from "@/lib/audit";
import { userAgentOf, localPart } from "@/lib/req";

const InviteBody = z.object({
  email: z.string().email(),
  role: z.string().min(1),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  phone: z.string().max(50).optional(),
  iqamaNumber: z.string().max(20).optional(),
  department: z.string().max(100).optional(),
  // Temp password — only used when creating a brand-new user account.
  initialPassword: z.string().min(8).optional(),
});

const SAFE_USER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  iqamaNumber: true,
  signatureUrl: true,
  digitalCertificateId: true,
  isActive: true,
  mfaEnabled: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

export async function userRoutes(app: FastifyInstance) {
  // List all users belonging to the current tenant (via memberships).
  app.get("/v1/users", { onRequest: [app.requireAuth] }, async (req) => {
    return withTenant(req.actor!.tenantId, async (tx) => {
      const memberships = await tx.userTenantMembership.findMany({
        where: { tenantId: req.actor!.tenantId },
        include: { user: { select: SAFE_USER_SELECT } },
        orderBy: { createdAt: "desc" },
      });
      const items = memberships.map((m) => ({
        ...m.user,
        role: m.role,
        department: m.department,
        membershipActive: m.isActive,
      }));
      return { items, total: items.length };
    });
  });

  app.post("/v1/users/invite", { onRequest: [app.requirePerm("user:invite")] }, async (req, reply) => {
    const body = InviteBody.parse(req.body);
    const { tenantId, email: actorEmail, role: actorRole } = req.actor!;

    // The user record is global. Either reuse an existing account or create a
    // new one. Either way, we then attach a membership for this tenant.
    let user = await prisma.user.findUnique({ where: { email: body.email } });

    if (user) {
      const existingMembership = await prisma.userTenantMembership.findUnique({
        where: { userId_tenantId: { userId: user.id, tenantId } },
      });
      if (existingMembership) {
        return reply.status(409).send({
          error: { code: "CONFLICT", message: "User is already a member of this company" },
        });
      }
    } else {
      const passwordHash = body.initialPassword
        ? await bcrypt.hash(body.initialPassword, 12)
        : null;
      user = await prisma.user.create({
        data: {
          email: body.email,
          passwordHash,
          firstName: body.firstName,
          lastName: body.lastName,
          phone: body.phone,
          iqamaNumber: body.iqamaNumber,
        },
      });
    }

    return withTenant(tenantId, async (tx) => {
      const membership = await tx.userTenantMembership.create({
        data: {
          userId: user!.id,
          tenantId,
          role: body.role,
          department: body.department,
        },
      });
      await appendAudit(tx, tenantId, {
        ts: new Date().toISOString(),
        userEmail: actorEmail,
        userName: localPart(actorEmail),
        userRole: actorRole,
        action: "create",
        entity: "user_membership",
        entityId: user!.id,
        diff: [
          { field: "email", from: "—", to: user!.email },
          { field: "role",  from: "—", to: membership.role },
        ],
        ip: req.ip,
        userAgent: userAgentOf(req),
      });
      reply.code(201);
      return {
        id: user!.id,
        email: user!.email,
        firstName: user!.firstName,
        lastName: user!.lastName,
        role: membership.role,
        department: membership.department,
      };
    });
  });
}
