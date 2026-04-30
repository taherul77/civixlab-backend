import type { FastifyInstance } from "fastify";
import { prisma } from "@/db/prisma";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({ ok: true, ts: new Date().toISOString() }));

  app.get("/health/ready", async () => {
    // Touch the database — proves Postgres + RLS GUC are reachable.
    await prisma.$queryRawUnsafe("SELECT 1");
    return { ok: true, db: "ready" };
  });
}
