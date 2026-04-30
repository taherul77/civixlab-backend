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
  // Temp password — in production this would be a magic-link invite token.
  initialPassword: z.string().min(8).optional(),
});

function strip<T extends { passwordHash?: string | null; mfaSecret?: string | null; mfaRecoveryCodes?: string[] }>(u: T) {
  const { passwordHash: _a, mfaSecret: _b, mfaRecoveryCodes: _c, ...safe } = u;
  void _a; void _b; void _c;
  return safe;
}

export async function userRoutes(app: FastifyInstance) {
  app.get("/v1/users", { onRequest: [app.requireAuth] }, async (req) => {
    return withTenant(req.actor!.tenantId, async (tx) => {
      const items = await tx.user.findMany({ orderBy: { createdAt: "desc" } });
      return { items: items.map(strip), total: items.length };
    });
  });

  app.post("/v1/users/invite", { onRequest: [app.requirePerm("user:invite")] }, async (req, reply) => {
    const body = InviteBody.parse(req.body);
    const { tenantId, email: actorEmail, role: actorRole } = req.actor!;

    // Pre-check for existing email outside the audit transaction so the
    // duplicate-email path returns a clean 409.
    const existing = await prisma.user.findUnique({
      where: { tenantId_email: { tenantId, email: body.email } },
    });
    if (existing) return reply.status(409).send({ error: { code: "CONFLICT", message: "User with this email already exists in tenant" } });

    const passwordHash = body.initialPassword
      ? await bcrypt.hash(body.initialPassword, 12)
      : null;

    return withTenant(tenantId, async (tx) => {
      const created = await tx.user.create({
        data: {
          tenantId,
          email: body.email,
          passwordHash,
          firstName: body.firstName,
          lastName: body.lastName,
          phone: body.phone,
          iqamaNumber: body.iqamaNumber,
          department: body.department,
          role: body.role,
        },
      });
      await appendAudit(tx, tenantId, {
        ts: new Date().toISOString(),
        userEmail: actorEmail,
        userName: localPart(actorEmail),
        userRole: actorRole,
        action: "create",
        entity: "user",
        entityId: created.id,
        diff: [
          { field: "email", from: "—", to: created.email },
          { field: "role",  from: "—", to: created.role },
        ],
        ip: req.ip,
        userAgent: userAgentOf(req),
      });
      reply.code(201);
      return strip(created);
    });
  });
}
