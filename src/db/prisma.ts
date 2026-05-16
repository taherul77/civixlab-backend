import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "@/config/env";

// Prisma 7 no longer reads `url` from schema.prisma. The runtime client now
// constructs its own pg connection pool via @prisma/adapter-pg and hands it
// to PrismaClient. Migrations are still driven by Prisma CLI but configured
// via `prisma.config.ts` at the repo root.
const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma = global.__prisma ?? new PrismaClient({
  adapter,
  log: ["warn", "error"],
});

if (process.env.NODE_ENV !== "production") global.__prisma = prisma;

export type Tx = Prisma.TransactionClient;

/**
 * Run `fn` with the Postgres `app.current_tenant` GUC set to `tenantId`.
 * Every RLS-protected query inside the callback will see only that tenant's
 * rows. Wraps the callback in a transaction so the SET LOCAL is scoped.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (tx: Tx) => Promise<T>
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.current_tenant = '${tenantId.replace(/'/g, "''")}'`);
    return fn(tx);
  });
}
