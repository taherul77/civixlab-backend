import type { FastifyInstance } from "fastify";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { withTenant } from "@/db/prisma";

const PageRow = z.object({
  pageId: z.string().min(1).max(100),
  view:   z.boolean(),
  create: z.boolean(),
  edit:   z.boolean(),
  delete: z.boolean(),
});

const PutBody = z.object({
  pages: z.array(PageRow),
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Guard against actors without a tenant context (e.g. a Super Admin who has
 * not yet selected a tenant via /v1/auth/select-tenant). Returns the tenantId
 * if valid, otherwise sends a 400 and returns null.
 */
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

export async function rolePermissionsRoutes(app: FastifyInstance) {
  // List every (role, pageId) row for the current tenant. Any signed-in
  // member can read this — the sidebar uses it on session start.
  app.get("/v1/role-permissions", { onRequest: [app.requireAuth] }, async (req, reply) => {
    const tenantId = requireTenantContext(req, reply);
    if (!tenantId) return;
    return withTenant(tenantId, async (tx) => {
      const rows = await tx.rolePagePermission.findMany({
        where:   { tenantId },
        orderBy: [{ role: "asc" }, { pageId: "asc" }],
      });
      return {
        items: rows.map((r) => ({
          role: r.role,
          pageId: r.pageId,
          view: r.view, create: r.create, edit: r.edit, delete: r.delete,
        })),
      };
    });
  });

  // Replace ALL rows for a single role. Sends a `pages` array; we upsert
  // each row and delete any rows for this role that aren't in the payload.
  app.put("/v1/role-permissions/:role", { onRequest: [app.requirePerm("security:update")] }, async (req, reply) => {
    const role = (req.params as { role: string }).role;
    if (!role || role.length > 100) {
      return reply.status(400).send({ error: { code: "VALIDATION", message: "Invalid role name" } });
    }
    const tenantId = requireTenantContext(req, reply);
    if (!tenantId) return;
    const body = PutBody.parse(req.body);

    return withTenant(tenantId, async (tx) => {
      const wantedIds = new Set(body.pages.map((p) => p.pageId));

      // Delete rows for this role that are no longer in the payload.
      await tx.rolePagePermission.deleteMany({
        where: { tenantId, role, pageId: { notIn: Array.from(wantedIds) } },
      });

      // Upsert each provided row.
      for (const p of body.pages) {
        await tx.rolePagePermission.upsert({
          where: {
            tenantId_role_pageId: { tenantId, role, pageId: p.pageId },
          },
          create: {
            tenantId, role, pageId: p.pageId,
            view: p.view, create: p.create, edit: p.edit, delete: p.delete,
          },
          update: {
            view: p.view, create: p.create, edit: p.edit, delete: p.delete,
          },
        });
      }

      reply.code(200);
      return { ok: true, role, count: body.pages.length };
    });
  });
}
