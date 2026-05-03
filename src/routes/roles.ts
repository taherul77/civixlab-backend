import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { withTenant } from "@/db/prisma";

// Default permission map mirrors src/lib/rbac.ts. On first read for a tenant
// we seed the table from this so each tenant gets an editable copy.
import { rolePermissions } from "@/lib/rbac";

const BUILT_IN_NAMES_LIST = [
  "Super Admin","Tenant Admin","Quality Manager","Project Manager",
  "Lab Engineer","Lab Technician","Field Technician","Reviewer",
  "Approver","Client","Billing Admin",
] as const;

const DEFAULTS: Record<string, string[]> = Object.fromEntries(
  BUILT_IN_NAMES_LIST.map((name) => [name, rolePermissions(name) as string[]]),
);
const BUILT_IN_NAMES = new Set<string>(BUILT_IN_NAMES_LIST);

const RoleNameParam = z.object({ name: z.string().min(1).max(100) });
const CreateBody = z.object({
  name:        z.string().min(1).max(100),
  permissions: z.array(z.string().max(100)).default([]),
});
const UpdateBody = z.object({
  permissions: z.array(z.string().max(100)),
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireTenantContext(req: FastifyRequest, reply: FastifyReply): string | null {
  const tenantId = req.actor?.tenantId ?? "";
  if (!tenantId || !UUID_RE.test(tenantId)) {
    reply.status(400).send({
      error: {
        code: "NO_TENANT_CONTEXT",
        message: "This endpoint requires an active tenant. Call /v1/auth/select-tenant first.",
      },
    });
    return null;
  }
  return tenantId;
}

export async function rolesRoutes(app: FastifyInstance) {
  // List the tenant's roles. On first call (table empty for this tenant), we
  // seed the built-in defaults so the tenant has an editable copy.
  app.get("/v1/roles", { onRequest: [app.requireAuth] }, async (req, reply) => {
    const tenantId = requireTenantContext(req, reply);
    if (!tenantId) return;
    return withTenant(tenantId, async (tx) => {
      let rows = await tx.tenantRole.findMany({
        where:   { tenantId },
        orderBy: [{ isCustom: "asc" }, { name: "asc" }],
      });
      if (rows.length === 0) {
        await tx.tenantRole.createMany({
          data: Object.entries(DEFAULTS).map(([name, permissions]) => ({
            tenantId, name, permissions, isCustom: false,
          })),
        });
        rows = await tx.tenantRole.findMany({
          where:   { tenantId },
          orderBy: [{ isCustom: "asc" }, { name: "asc" }],
        });
      }
      return {
        items: rows.map((r) => ({
          name: r.name,
          permissions: r.permissions,
          isCustom: r.isCustom,
        })),
      };
    });
  });

  // Create a custom role. Non-super-admin actors cannot create a role
  // named "Super Admin" — that is a platform-only role.
  app.post("/v1/roles", { onRequest: [app.requirePerm("security:update")] }, async (req, reply) => {
    const tenantId = requireTenantContext(req, reply);
    if (!tenantId) return;
    const body = CreateBody.parse(req.body);
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
      const existing = await tx.tenantRole.findUnique({
        where: { tenantId_name: { tenantId, name } },
      });
      if (existing) {
        return reply.status(409).send({ error: { code: "ROLE_EXISTS", message: `Role "${name}" already exists` } });
      }
      const created = await tx.tenantRole.create({
        data: { tenantId, name, permissions: body.permissions, isCustom: true },
      });
      reply.code(201);
      return { name: created.name, permissions: created.permissions, isCustom: created.isCustom };
    });
  });

  // Update a role's permission list (built-in or custom). Only a Super Admin
  // can modify the "Super Admin" role.
  app.put("/v1/roles/:name", { onRequest: [app.requirePerm("security:update")] }, async (req, reply) => {
    const tenantId = requireTenantContext(req, reply);
    if (!tenantId) return;
    const { name } = RoleNameParam.parse(req.params);
    if (name === "Super Admin" && !req.actor?.isSuperAdmin) {
      return reply.status(403).send({
        error: { code: "FORBIDDEN_ROLE", message: '"Super Admin" can only be modified by a Super Admin' },
      });
    }
    const body = UpdateBody.parse(req.body);
    return withTenant(tenantId, async (tx) => {
      const updated = await tx.tenantRole.upsert({
        where:  { tenantId_name: { tenantId, name } },
        update: { permissions: body.permissions },
        create: { tenantId, name, permissions: body.permissions, isCustom: !BUILT_IN_NAMES.has(name) },
      });
      return { name: updated.name, permissions: updated.permissions, isCustom: updated.isCustom };
    });
  });

  // Delete a role. Tenant Admin and Super Admin are platform-protected
  // and never deletable; other built-in *templates* CAN now be deleted by
  // a tenant admin who doesn't want them — they are starter data, not law.
  app.delete("/v1/roles/:name", { onRequest: [app.requirePerm("security:update")] }, async (req, reply) => {
    const tenantId = requireTenantContext(req, reply);
    if (!tenantId) return;
    const { name } = RoleNameParam.parse(req.params);
    if (name === "Super Admin" || name === "Tenant Admin") {
      return reply.status(400).send({
        error: { code: "PROTECTED_ROLE", message: `"${name}" is a platform role and cannot be deleted` },
      });
    }
    return withTenant(tenantId, async (tx) => {
      await tx.tenantRole.deleteMany({ where: { tenantId, name } });
      return { ok: true };
    });
  });
}
