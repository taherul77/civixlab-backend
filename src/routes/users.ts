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

const UpdateMembershipBody = z.object({
  role:       z.string().min(1).max(100).optional(),
  department: z.string().max(100).nullable().optional(),
  isActive:   z.boolean().optional(),
  firstName:  z.string().max(100).optional(),
  lastName:   z.string().max(100).optional(),
  phone:      z.string().max(50).nullable().optional(),
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  // Update a user's membership (role / department / active flag) for the
  // current tenant. Optional firstName / lastName / phone fields update the
  // global user record so a Tenant Admin can fix typos without removing the
  // membership.
  app.patch("/v1/users/:id/membership", { onRequest: [app.requirePerm("user:update")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!UUID_RE.test(id)) {
      return reply.status(400).send({ error: { code: "VALIDATION", message: "Invalid user id" } });
    }
    const body = UpdateMembershipBody.parse(req.body);
    const { tenantId, sub: actorUserId } = req.actor!;

    // Don't let an admin deactivate themselves and lock the tenant. Cosmetic
    // self-edits (name, department) and re-saving the same role are fine.
    if (id === actorUserId && body.isActive === false) {
      return reply.status(400).send({
        error: { code: "SELF_DEACTIVATE", message: "Cannot deactivate your own membership from this screen" },
      });
    }

    return withTenant(tenantId, async (tx) => {
      const membership = await tx.userTenantMembership.findUnique({
        where: { userId_tenantId: { userId: id, tenantId } },
      });
      if (!membership) {
        return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Not a member of this company" } });
      }

      const updatedMembership = await tx.userTenantMembership.update({
        where: { userId_tenantId: { userId: id, tenantId } },
        data: {
          role:       body.role       ?? undefined,
          department: body.department === undefined ? undefined : body.department,
          isActive:   body.isActive   ?? undefined,
        },
      });

      const userUpdates: { firstName?: string; lastName?: string; phone?: string | null } = {};
      if (body.firstName !== undefined) userUpdates.firstName = body.firstName;
      if (body.lastName  !== undefined) userUpdates.lastName  = body.lastName;
      if (body.phone     !== undefined) userUpdates.phone     = body.phone;

      const updatedUser = Object.keys(userUpdates).length
        ? await prisma.user.update({ where: { id }, data: userUpdates, select: SAFE_USER_SELECT })
        : await prisma.user.findUnique({ where: { id }, select: SAFE_USER_SELECT });

      return {
        ...updatedUser,
        role: updatedMembership.role,
        department: updatedMembership.department,
        membershipActive: updatedMembership.isActive,
      };
    });
  });

  // Remove a user's membership from the current tenant. The user's global
  // account is preserved (they may belong to other tenants).
  app.delete("/v1/users/:id/membership", { onRequest: [app.requirePerm("user:delete")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!UUID_RE.test(id)) {
      return reply.status(400).send({ error: { code: "VALIDATION", message: "Invalid user id" } });
    }
    const { tenantId, sub: actorUserId } = req.actor!;
    if (id === actorUserId) {
      return reply.status(400).send({
        error: { code: "SELF_DELETE", message: "Cannot remove your own membership from this company" },
      });
    }

    return withTenant(tenantId, async (tx) => {
      const result = await tx.userTenantMembership.deleteMany({
        where: { userId: id, tenantId },
      });
      if (result.count === 0) {
        return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Not a member of this company" } });
      }
      return { ok: true };
    });
  });
}
