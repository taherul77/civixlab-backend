import type { FastifyInstance, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import jwt from "@fastify/jwt";
import { env } from "@/config/env";
import { withTenant } from "@/db/prisma";

declare module "fastify" {
  interface FastifyRequest {
    /** Resolved actor — set by the `auth` decorator after JWT verification.
     *  `role` is the primary (first) role for back-compat / display; `roles`
     *  is the full list and `permissions` is their union. */
    actor: {
      sub: string;
      tenantId: string;
      email: string;
      role: string;
      roles: string[];
      permissions: string[];
      mfaVerified: boolean;
      isSuperAdmin: boolean;
    } | null;
  }
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest) => Promise<void>;
    requirePerm: (perm: string) => (req: FastifyRequest) => Promise<void>;
    requireSuperAdmin: (req: FastifyRequest) => Promise<void>;
    /** Enforce the per-role page matrix (view/create/edit/delete) set on /security. */
    requirePage: (pageId: string, action?: "view" | "create" | "edit" | "delete") => (req: FastifyRequest) => Promise<void>;
  }
}

export const authPlugin = fp(async function (app: FastifyInstance) {
  await app.register(jwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: `${env.JWT_TTL_SECONDS}s` },
  });

  app.decorateRequest("actor", null);

  app.decorate("requireAuth", async (req: FastifyRequest) => {
    try {
      const decoded = await req.jwtVerify<{
        sub: string;
        tenant_id?: string;
        email: string;
        role?: string;
        roles?: string[];
        permissions?: string[];
        mfa_verified?: boolean;
        is_super_admin?: boolean;
      }>();
      const roles = decoded.roles ?? (decoded.role ? [decoded.role] : []);
      req.actor = {
        sub: decoded.sub,
        tenantId: decoded.tenant_id ?? "",
        email: decoded.email,
        role: decoded.role ?? roles[0] ?? "",
        roles,
        permissions: decoded.permissions ?? [],
        mfaVerified: !!decoded.mfa_verified,
        isSuperAdmin: !!decoded.is_super_admin,
      };
    } catch {
      const err: Error & { statusCode?: number } = new Error("UNAUTHENTICATED: Invalid or missing JWT");
      err.statusCode = 401;
      throw err;
    }
  });

  app.decorate("requirePerm", (perm: string) => async (req: FastifyRequest) => {
    await app.requireAuth(req);
    if (!req.actor) {
      const err: Error & { statusCode?: number } = new Error("UNAUTHENTICATED");
      err.statusCode = 401;
      throw err;
    }
    // Super Admin bypasses all per-permission checks.
    if (req.actor.isSuperAdmin) return;
    if (!req.actor.permissions.includes(perm)) {
      const err: Error & { statusCode?: number } = new Error(`FORBIDDEN: ${perm}`);
      err.statusCode = 403;
      throw err;
    }
  });

  // Page-matrix guard. Mirrors the frontend's hasPageAction():
  //  - Super Admin bypasses.
  //  - A role with NO stored rows gets the default (view everything, nothing else).
  //  - A role with rows is judged by its row for this page (missing row = denied).
  //  - Multiple roles: any role granting the action is enough.
  //  - Tenant Admin with no stored rows keeps full access so a fresh company is usable.
  app.decorate("requirePage", (pageId: string, action: "view" | "create" | "edit" | "delete" = "view") =>
    async (req: FastifyRequest) => {
      await app.requireAuth(req);
      const actor = req.actor!;
      if (actor.isSuperAdmin) return;
      const forbid = () => {
        const err: Error & { statusCode?: number } = new Error(`FORBIDDEN: ${action} on ${pageId}`);
        err.statusCode = 403;
        return err;
      };
      if (!actor.tenantId || actor.roles.length === 0) throw forbid();

      const rows = await withTenant(actor.tenantId, (tx) =>
        tx.rolePagePermission.findMany({
          where: { tenantId: actor.tenantId, role: { in: actor.roles } },
        }),
      );
      const allowed = actor.roles.some((role) => {
        const own = rows.filter((r) => r.role === role);
        if (own.length === 0) return role === "Tenant Admin" || action === "view";
        const row = own.find((r) => r.pageId === pageId);
        return !!row?.[action];
      });
      if (!allowed) throw forbid();
    });

  app.decorate("requireSuperAdmin", async (req: FastifyRequest) => {
    await app.requireAuth(req);
    if (!req.actor?.isSuperAdmin) {
      const err: Error & { statusCode?: number } = new Error("FORBIDDEN: Super Admin only");
      err.statusCode = 403;
      throw err;
    }
  });
});
