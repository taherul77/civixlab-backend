import { PrismaClient, Prisma } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma = global.__prisma ?? new PrismaClient({
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
