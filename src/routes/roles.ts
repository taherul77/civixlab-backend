import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma, withTenant } from "@/db/prisma";
import { rolePermissions } from "@/lib/rbac";

// On a cold tenant we seed exactly one row: "Super Admin" with the full
// permission list. Every other role is created on demand.
const BUILT_IN_TEMPLATES = ["Super Admin"] as const;
const DEFAULTS: Record<string, string[]> = Object.fromEntries(
  BUILT_IN_TEMPLATES.map((n) => [n, rolePermissions(n) as string[]]),
);

const RoleIdParam   = z.object({ id: z.string().uuid() });
const TenantIdQuery = z.object({ tenantId: z.string().uuid().optional() });
const CreateBody = z.object({
  tenantId:    z.string().uuid().optional(),
  name:        z.string().min(1).max(100),
  permissions: z.array(z.string().max(100)).default([]),
});
const UpdateBody = z.object({
  name:        z.string().min(1).max(100).optional(),
  permissions: z.array(z.string().max(100)).optional(),
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve the tenant the action targets. Super Admins can pass `tenantId`
 * (in body or query) to operate on any tenant; everyone else is pinned to
 * their own.
 */
function resolveTargetTenant(req: FastifyRequest, reply: FastifyReply, fromCaller?: string): string | null {
  const actor = req.actor;
  if (!actor) {
    reply.status(401).send({ error: { code: "UNAUTHENTICATED", message: "Sign-in required" } });
    return null;
  }
  const requested = fromCaller && UUID_RE.test(fromCaller) ? fromCaller : null;
  if (actor.isSuperAdmin) {
    const tid = requested ?? actor.tenantId;
    if (!tid || !UUID_RE.test(tid)) {
      reply.status(400).send({ error: { code: "NO_TENANT", message: "Super Admin must specify tenantId" } });
      return null;
    }
    return tid;
  }
  if (!actor.tenantId || !UUID_RE.test(actor.tenantId)) {
    reply.status(400).send({ error: { code: "NO_TENANT_CONTEXT", message: "Active tenant required" } });
    return null;
  }
  if (requested && requested !== actor.tenantId) {
    reply.status(403).send({ error: { code: "FORBIDDEN", message: "Cannot operate on another tenant" } });
    return null;
  }
  return actor.tenantId;
}

export async function rolesRoutes(app: FastifyInstance) {
  // List the tenant's roles. Super Admin may pass ?tenantId=... to inspect
  // any company. On first read for a cold tenant, we seed the Super Admin
  // template so subsequent calls are stable.
  app.get("/v1/roles", { onRequest: [app.requireAuth] }, async (req, reply) => {
    const q = TenantIdQuery.parse(req.query);
    const tenantId = resolveTargetTenant(req, reply, q.tenantId);
    if (!tenantId) return;
    return withTenant(tenantId, async (tx) => {
      let rows = await tx.role.findMany({
        where:   { tenantId },
        orderBy: [{ isCustom: "asc" }, { name: "asc" }],
        include: {
          createdBy: { select: { id: true, email: true, firstName: true, lastName: true } },
          updatedBy: { select: { id: true, email: true, firstName: true, lastName: true } },
        },
      });
      if (rows.length === 0) {
        await tx.role.createMany({
          data: Object.entries(DEFAULTS).map(([name, permissions]) => ({
            tenantId, name, permissions, isCustom: false,
          })),
        });
        rows = await tx.role.findMany({
          where:   { tenantId },
          orderBy: [{ isCustom: "asc" }, { name: "asc" }],
          include: {
            createdBy: { select: { id: true, email: true, firstName: true, lastName: true } },
            updatedBy: { select: { id: true, email: true, firstName: true, lastName: true } },
          },
        });
      }
      return {
        items: rows.map((r) => ({
          id: r.id,
          name: r.name,
          permissions: r.permissions,
          isCustom: r.isCustom,
          createdBy: r.createdBy ? userLabel(r.createdBy) : null,
          updatedBy: r.updatedBy ? userLabel(r.updatedBy) : null,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        })),
      };
    });
  });

  // Create a custom role for the resolved tenant.
  app.post("/v1/roles", { onRequest: [app.requirePerm("security:update")] }, async (req, reply) => {
    const body = CreateBody.parse(req.body);
    const tenantId = resolveTargetTenant(req, reply, body.tenantId);
    if (!tenantId) return;
    const name = body.name.trim();
    if (!name) {
      return reply.status(400).send({ error: { code: "VALIDATION", message: "name required" } });
    }
    if (name === "Super Admin" && !req.actor?.isSuperAdmin) {
      return reply.status(403).send({
        error: { code: "FORBIDDEN_ROLE", message: '"Super Admin" can only be managed by a Super Admin' },
      });
    }
    return withTenant(tenantId, async (tx) => {
      const existing = await tx.role.findFirst({ where: { tenantId, name } });
      if (existing) {
        return reply.status(409).send({ error: { code: "ROLE_EXISTS", message: `Role "${name}" already exists` } });
      }
      const created = await tx.role.create({
        data: {
          tenantId,
          name,
          permissions: body.permissions,
          isCustom: true,
          createdById: req.actor?.sub,
          updatedById: req.actor?.sub,
        },
      });
      reply.code(201);
      return { id: created.id, name: created.name, permissions: created.permissions, isCustom: created.isCustom };
    });
  });

  // Update a role by id. Renames and permission updates both go through here.
  app.put("/v1/roles/:id", { onRequest: [app.requirePerm("security:update")] }, async (req, reply) => {
    const { id } = RoleIdParam.parse(req.params);
    const body = UpdateBody.parse(req.body);
    return withTenant(req.actor?.isSuperAdmin ? "" : (req.actor?.tenantId ?? ""), async () => {
      // Look up the row first so we know which tenant it belongs to (Super
      // Admin can edit any tenant's roles).
      const row = await prisma.role.findUnique({ where: { id } });
      if (!row) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Role not found" } });
      if (!req.actor?.isSuperAdmin && row.tenantId !== req.actor?.tenantId) {
        return reply.status(403).send({ error: { code: "FORBIDDEN", message: "Cannot edit another tenant's role" } });
      }
      if (row.name === "Super Admin" && !req.actor?.isSuperAdmin) {
        return reply.status(403).send({ error: { code: "FORBIDDEN_ROLE", message: '"Super Admin" can only be modified by a Super Admin' } });
      }
      // Protect platform role names from rename — keeps the Tenant Admin
      // short-circuit / login flow stable.
      if (body.name && body.name !== row.name && (row.name === "Super Admin" || row.name === "Tenant Admin")) {
        return reply.status(400).send({ error: { code: "PROTECTED_ROLE", message: `"${row.name}" cannot be renamed` } });
      }
      if (body.name && body.name !== row.name) {
        const dup = await prisma.role.findFirst({ where: { tenantId: row.tenantId, name: body.name, NOT: { id } } });
        if (dup) {
          return reply.status(409).send({ error: { code: "ROLE_EXISTS", message: `Role "${body.name}" already exists` } });
        }
      }
      const updated = await prisma.role.update({
        where: { id },
        data: {
          name:        body.name        ?? undefined,
          permissions: body.permissions ?? undefined,
          updatedById: req.actor?.sub,
        },
      });
      return { id: updated.id, name: updated.name, permissions: updated.permissions, isCustom: updated.isCustom };
    });
  });

  // Delete a role by id. Tenant Admin and Super Admin are platform-protected.
  app.delete("/v1/roles/:id", { onRequest: [app.requirePerm("security:update")] }, async (req, reply) => {
    const { id } = RoleIdParam.parse(req.params);
    const row = await prisma.role.findUnique({ where: { id } });
    if (!row) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Role not found" } });
    if (!req.actor?.isSuperAdmin && row.tenantId !== req.actor?.tenantId) {
      return reply.status(403).send({ error: { code: "FORBIDDEN", message: "Cannot delete another tenant's role" } });
    }
    if (row.name === "Super Admin" || row.name === "Tenant Admin") {
      return reply.status(400).send({
        error: { code: "PROTECTED_ROLE", message: `"${row.name}" is a platform role and cannot be deleted` },
      });
    }
    await prisma.role.delete({ where: { id } });
    return { ok: true };
  });
}

function userLabel(u: { email: string; firstName?: string | null; lastName?: string | null }): string {
  return [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email;
}
