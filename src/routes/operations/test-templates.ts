import type { FastifyInstance } from "fastify";
import { listTemplates, getTemplate, evaluate, EngineValidationError } from "@/engine";

const meta = ({ evaluate: _e, ...rest }: ReturnType<typeof listTemplates>[number]) => rest;

export async function testTemplateRoutes(app: FastifyInstance) {
  app.get("/v1/operations/test-templates", { onRequest: [app.requireAuth] }, async (req) => {
    const { category } = req.query as { category?: string };
    return listTemplates().filter((t) => !category || t.category === category).map(meta);
  });

  app.get("/v1/operations/test-templates/:code", { onRequest: [app.requireAuth] }, async (req, reply) => {
    const t = getTemplate((req.params as { code: string }).code);
    if (!t) return reply.code(404).send({ error: "Template not found" });
    return meta(t);
  });

  // Stateless calculation + pass/fail preview, used live by the entry form.
  app.post("/v1/operations/test-templates/:code/evaluate", { onRequest: [app.requireAuth] }, async (req, reply) => {
    try {
      return evaluate((req.params as { code: string }).code, req.body);
    } catch (e) {
      if (e instanceof EngineValidationError) return reply.code(422).send({ error: "Validation failed", issues: e.issues });
      throw e;
    }
  });
}
