import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { env } from "@/config/env";
import { authPlugin } from "@/plugins/auth";
import { errorHandlerPlugin } from "@/plugins/error-handler";
import { swaggerPlugin } from "@/plugins/swagger";
import { healthRoutes } from "@/routes/health";
import { authRoutes } from "@/routes/auth";
import { projectRoutes } from "@/routes/projects";
import { sampleRoutes } from "@/routes/samples";
import { testRoutes } from "@/routes/tests";
import { equipmentRoutes } from "@/routes/equipment";
import { userRoutes } from "@/routes/users";
import { auditRoutes } from "@/routes/audit";
import { dashboardRoutes } from "@/routes/dashboard";
import { reportRoutes } from "@/routes/reports";
import { tenantRoutes } from "@/routes/tenant";
import { rolePermissionsRoutes } from "@/routes/role-permissions";
import { rolesRoutes } from "@/routes/roles";
import { superRoutes } from "@/routes/super";
import { laboratoriesRoutes } from "@/routes/laboratories";
import { departmentsRoutes } from "@/routes/departments";
import { clientsRoutes } from "@/routes/clients";

async function build() {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      transport: env.NODE_ENV === "development"
        ? { target: "pino-pretty", options: { colorize: true } }
        : undefined,
    },
    trustProxy: true,
  });

  await app.register(helmet, {
    // Swagger UI needs to inline its own scripts/styles and load SVG icons.
    contentSecurityPolicy: false,
    // HSTS on localhost dev is harmful — once cached, the browser silently
    // upgrades http://localhost:4000 to https:// for ~180 days and every
    // request fails because the server only listens on HTTP. Enable HSTS in
    // production behind TLS only.
    hsts: env.NODE_ENV === "production",
  });

  // Fastify v5 rejects requests that declare Content-Type: application/json
  // with an empty body (FST_ERR_CTP_EMPTY_JSON_BODY). Swagger UI's "Try it
  // out" always sends that header, even for DELETE/GET with no body — so we
  // override the parser to treat empty bodies as undefined.
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_req, body, done) => {
      const raw = (body as string | undefined) ?? "";
      if (raw.trim() === "") return done(null, undefined);
      try {
        done(null, JSON.parse(raw));
      } catch (err) {
        const e = err as Error & { statusCode?: number };
        e.statusCode = 400;
        done(e, undefined);
      }
    },
  );
  await app.register(cors, { origin: true, credentials: true });
  await app.register(rateLimit, { max: 600, timeWindow: "1 minute" });
  await app.register(errorHandlerPlugin);
  await app.register(swaggerPlugin);
  await app.register(authPlugin);

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(projectRoutes);
  await app.register(sampleRoutes);
  await app.register(testRoutes);
  await app.register(equipmentRoutes);
  await app.register(userRoutes);
  await app.register(auditRoutes);
  await app.register(dashboardRoutes);
  await app.register(reportRoutes);
  await app.register(tenantRoutes);
  await app.register(rolePermissionsRoutes);
  await app.register(rolesRoutes);
  await app.register(superRoutes);
  await app.register(laboratoriesRoutes);
  await app.register(departmentsRoutes);
  await app.register(clientsRoutes);

  return app;
}

async function main() {
  const app = await build();
  try {
    await app.listen({ host: env.HOST, port: env.PORT });
    app.log.info(
      `CiviXLab API listening on http://${env.HOST}:${env.PORT} (${env.NODE_ENV})`
    );
    app.log.info(`Swagger UI:  http://${env.HOST}:${env.PORT}/docs`);
    app.log.info(`OpenAPI JSON: http://${env.HOST}:${env.PORT}/docs/json`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
