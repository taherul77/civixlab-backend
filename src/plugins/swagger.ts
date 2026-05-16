import type { FastifyInstance, FastifySchema } from "fastify";
import fp from "fastify-plugin";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { env } from "@/config/env";

/**
 * Derive a Swagger tag from a route URL so routes group sensibly in the UI
 * without each handler having to set its own `schema.tags`.
 *
 *   /health                  -> "health"
 *   /v1/auth/signin          -> "auth"
 *   /v1/projects/:id         -> "projects"
 *   /v1/super/tenants/:id    -> "super"
 *   /v1/role-permissions     -> "role-permissions"
 *   /docs                    -> skipped (Swagger UI's own routes)
 */
function tagFromUrl(url: string): string | null {
  if (url.startsWith("/docs") || url === "/json") return null;
  const segments = url.split("/").filter(Boolean);
  if (segments.length === 0) return "default";
  // Strip the /v1 version segment if present.
  const start = segments[0] === "v1" ? 1 : 0;
  return segments[start] ?? "default";
}

/**
 * OpenAPI 3 + Swagger UI.
 *
 *   - Spec:        GET /docs/json
 *   - Interactive: GET /docs
 *
 * Route bodies / params / queries are validated with Zod, which Swagger's
 * auto-discovery can't read — so per-route schemas don't appear unless the
 * route adds a `schema: { ... }` block. The UI is still useful as a discovery
 * surface: every registered route shows up with method / path / tag and the
 * `Authorize` button lets you paste a Bearer JWT and try requests live.
 */
// Wrapped with fastify-plugin so the @fastify/swagger `onRoute` listener
// runs at the root context. Without this, the swagger plugin would be
// encapsulated and miss every route registered as a sibling.
async function swaggerPluginInner(app: FastifyInstance) {
  await app.register(swagger, {
    // Auto-tag routes from their URL so the Swagger UI groups them under the
    // named tag sections instead of dumping everything under "default".
    transform: ({ schema, url }: { schema: FastifySchema; url: string }) => {
      const tag = tagFromUrl(url);
      if (!tag) return { schema, url };
      if (schema?.tags && schema.tags.length > 0) return { schema, url };
      return { schema: { ...schema, tags: [tag] }, url };
    },
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "CiviXLab API",
        description: "Multi-tenant lab testing platform — SBC 304 / SASO / ISO 17025 / ZATCA Phase 2.",
        version: "0.1.0",
      },
      servers: [
        // Both entries so Swagger UI's "Try it out" can match whichever
        // hostname the user has open in the browser. Useful when the
        // localhost HSTS cache is forcing HTTPS upgrades — opening
        // http://127.0.0.1:PORT/docs sidesteps the cached rule.
        { url: `http://localhost:${env.PORT}`, description: "Local dev (localhost)" },
        { url: `http://127.0.0.1:${env.PORT}`, description: "Local dev (127.0.0.1 — bypasses HSTS cache)" },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
            description:
              "Tenant-scoped session JWT returned by POST /v1/auth/select-tenant. " +
              "Super-admin operations require the token returned by POST /v1/auth/signin (kind=super-admin).",
          },
        },
      },
      security: [{ bearerAuth: [] }],
      tags: [
        { name: "auth",          description: "Sign-in, tenant selection, MFA, session" },
        { name: "tenant",        description: "Current tenant settings + logo" },
        { name: "projects",      description: "Project CRUD" },
        { name: "samples",       description: "Sample CRUD" },
        { name: "tests",         description: "Test CRUD + workflow (submit / review / approve / sign)" },
        { name: "equipment",     description: "Equipment register + integrations" },
        { name: "users",         description: "Tenant membership management" },
        { name: "audit",         description: "Tamper-evident audit log (SHA-256 chain)" },
        { name: "dashboard",     description: "Aggregate stats for the dashboard" },
        { name: "reports",       description: "Test certificates + ZATCA-style verify" },
        { name: "laboratories",  description: "Master setup → laboratories" },
        { name: "departments",   description: "Master setup → departments" },
        { name: "clients",       description: "Master setup → clients" },
        { name: "roles",         description: "Role catalogue (tenant-scoped)" },
        { name: "role-permissions", description: "Per-role page-action matrix" },
        { name: "super",         description: "Super-admin platform-wide management" },
        { name: "health",        description: "Liveness / readiness probes" },
      ],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: {
      docExpansion: "list",
      deepLinking: true,
      persistAuthorization: true,
    },
    staticCSP: true,
  });
}

export const swaggerPlugin = fp(swaggerPluginInner, { name: "swagger" });
