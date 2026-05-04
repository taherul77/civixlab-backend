import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { withTenant } from "@/db/prisma";

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

const CreateBody = z.object({
  name:        z.string().min(1).max(100),
  description: z.string().max(2000).optional(),
  isActive:    z.boolean().default(true),
});

// Edit only allows toggling the editable fields. Code stays read-only after
// creation; the client never sets it.
const UpdateBody = z.object({
  name:        z.string().min(1).max(100).optional(),
  description: z.string().max(2000).optional(),
  isActive:    z.boolean().optional(),
});

function userLabel(u: { email: string; firstName?: string | null; lastName?: string | null } | null): string | null {
  if (!u) return null;
  return [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email;
}

type DepartmentRow = {
  id: string; tenantId: string; name: string; code: string;
  description: string | null; isActive: boolean;
  createdAt: Date; updatedAt: Date;
  createdBy: { email: string; firstName: string | null; lastName: string | null } | null;
  updatedBy: { email: string; firstName: string | null; lastName: string | null } | null;
};

function shape(d: DepartmentRow) {
  return {
    id: d.id,
    tenantId: d.tenantId,
    name: d.name,
    code: d.code,
    description: d.description,
    isActive: d.isActive,
    createdBy: userLabel(d.createdBy),
    updatedBy: userLabel(d.updatedBy),
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

const INCLUDE_AUDIT = {
  createdBy: { select: { email: true, firstName: true, lastName: true } },
  updatedBy: { select: { email: true, firstName: true, lastName: true } },
} as const;

/**
 * Server-generated unique code: 4-char uppercase slug of the name + dash +
 * random 4-char alphanumeric suffix. We retry up to 5 times on the rare
 * collision against the `(tenant_id, code)` unique index.
 */
async function generateUniqueCode(
  tx: { department: { findFirst: (args: { where: { tenantId: string; code: string } }) => Promise<unknown> } },
  tenantId: string,
  name: string,
): Promise<string> {
  const slug = name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) || "DEPT";
  for (let i = 0; i < 5; i++) {
    const suffix = Math.random().toString(36).slice(2, 6).toUpperCase().padStart(4, "0");
    const code = `${slug}-${suffix}`;
    const exists = await tx.department.findFirst({ where: { tenantId, code } });
    if (!exists) return code;
  }
  // Last-resort fallback uses a timestamp tail.
  return `${slug}-${Date.now().toString(36).slice(-4).toUpperCase()}`;
}

export async function departmentsRoutes(app: FastifyInstance) {
  app.get("/v1/departments", { onRequest: [app.requireAuth] }, async (req, reply) => {
    const tenantId = requireTenantContext(req, reply);
    if (!tenantId) return;
    return withTenant(tenantId, async (tx) => {
      const items = await tx.department.findMany({
        where:   { tenantId },
        orderBy: { name: "asc" },
        include: INCLUDE_AUDIT,
      });
      return { items: items.map(shape), total: items.length };
    });
  });

  app.get("/v1/departments/:id", { onRequest: [app.requireAuth] }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const tenantId = requireTenantContext(req, reply);
    if (!tenantId) return;
    return withTenant(tenantId, async (tx) => {
      const dept = await tx.department.findFirst({
        where: { id, tenantId },
        include: INCLUDE_AUDIT,
      });
      if (!dept) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Department not found" } });
      return shape(dept);
    });
  });

  app.post("/v1/departments", { onRequest: [app.requirePerm("settings:update")] }, async (req, reply) => {
    const tenantId = requireTenantContext(req, reply);
    if (!tenantId) return;
    const body = CreateBody.parse(req.body);
    return withTenant(tenantId, async (tx) => {
      const exists = await tx.department.findFirst({ where: { tenantId, name: body.name } });
      if (exists) {
        return reply.status(409).send({
          error: { code: "CONFLICT", message: `Department "${body.name}" already exists` },
        });
      }
      const code = await generateUniqueCode(tx, tenantId, body.name);
      const created = await tx.department.create({
        data: {
          tenantId,
          name: body.name,
          description: body.description,
          isActive: body.isActive,
          code,
          createdById: req.actor?.sub,
          updatedById: req.actor?.sub,
        },
        include: INCLUDE_AUDIT,
      });
      reply.code(201);
      return shape(created);
    });
  });

  app.put("/v1/departments/:id", { onRequest: [app.requirePerm("settings:update")] }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const tenantId = requireTenantContext(req, reply);
    if (!tenantId) return;
    const body = UpdateBody.parse(req.body);
    return withTenant(tenantId, async (tx) => {
      const found = await tx.department.findFirst({ where: { id, tenantId } });
      if (!found) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Department not found" } });
      if (body.name && body.name !== found.name) {
        const dup = await tx.department.findFirst({ where: { tenantId, name: body.name } });
        if (dup) {
          return reply.status(409).send({
            error: { code: "CONFLICT", message: `Department "${body.name}" already exists` },
          });
        }
      }
      const updated = await tx.department.update({
        where: { id },
        data:  { ...body, updatedById: req.actor?.sub },
        include: INCLUDE_AUDIT,
      });
      return shape(updated);
    });
  });

  app.delete("/v1/departments/:id", { onRequest: [app.requirePerm("settings:update")] }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const tenantId = requireTenantContext(req, reply);
    if (!tenantId) return;
    return withTenant(tenantId, async (tx) => {
      const found = await tx.department.findFirst({ where: { id, tenantId } });
      if (!found) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Department not found" } });
      await tx.department.delete({ where: { id } });
      reply.code(204);
    });
  });
}
