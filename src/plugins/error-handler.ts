import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { ZodError } from "zod";

/**
 * Maps thrown errors to ZATCA / spec-shaped responses:
 *   { error: { code, message, detail? } }
 */
export const errorHandlerPlugin = fp(async function (app: FastifyInstance) {
  app.setErrorHandler((rawErr, req, reply) => {
    const err = rawErr as Error & { statusCode?: number; code?: string };
    if (err instanceof ZodError) {
      return reply.status(422).send({
        error: { code: "VALIDATION", message: "Invalid request payload", detail: err.errors },
      });
    }
    const msg = typeof err.message === "string" ? err.message : "";
    if (msg.startsWith("FORBIDDEN:")) {
      return reply.status(403).send({ error: { code: "FORBIDDEN", message: msg } });
    }
    if (msg.startsWith("UNAUTHENTICATED")) {
      return reply.status(401).send({ error: { code: "UNAUTHENTICATED", message: msg } });
    }
    req.log.error({ err }, "unhandled error");
    return reply.status(err.statusCode ?? 500).send({
      error: { code: "INTERNAL", message: msg || "Internal server error" },
    });
  });
});
