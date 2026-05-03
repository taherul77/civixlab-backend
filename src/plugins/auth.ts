import type { FastifyInstance, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import jwt from "@fastify/jwt";
import { env } from "@/config/env";

declare module "fastify" {
  interface FastifyRequest {
    /** Resolved actor — set by the `auth` decorator after JWT verification. */
    actor: {
      sub: string;
      tenantId: string;
      email: string;
      role: string;
      permissions: string[];
      mfaVerified: boolean;
      isSuperAdmin: boolean;
    } | null;
  }
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest) => Promise<void>;
    requirePerm: (perm: string) => (req: FastifyRequest) => Promise<void>;
    requireSuperAdmin: (req: FastifyRequest) => Promise<void>;
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
        permissions?: string[];
        mfa_verified?: boolean;
        is_super_admin?: boolean;
      }>();
      req.actor = {
        sub: decoded.sub,
        tenantId: decoded.tenant_id ?? "",
        email: decoded.email,
        role: decoded.role ?? "",
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

  app.decorate("requireSuperAdmin", async (req: FastifyRequest) => {
    await app.requireAuth(req);
    if (!req.actor?.isSuperAdmin) {
      const err: Error & { statusCode?: number } = new Error("FORBIDDEN: Super Admin only");
      err.statusCode = 403;
      throw err;
    }
  });
});
