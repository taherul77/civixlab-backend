import { AsyncLocalStorage } from "node:async_hooks";
import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "@/config/env";
import { TENANT_MODELS } from "@/db/tenant-models";

// Prisma 7 no longer reads `url` from schema.prisma. The runtime client now
// constructs its own pg connection pool via @prisma/adapter-pg and hands it
// to PrismaClient. Migrations are still driven by Prisma CLI but configured
// via `prisma.config.ts` at the repo root.
const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

/**
 * Tenant scoping — defence in depth on top of Postgres RLS.
 *
 * Inside `withTenant(tenantId, ...)` every query on a tenant-owned model gets
 * `tenantId` merged into its `where` (and into `data` on create), so a route
 * that forgets its own filter still cannot read or modify another company's
 * rows. Queries made outside `withTenant` (sign-in, super-admin, public
 * report verification) are untouched.
 *
 * TestTemplate is excluded: its tenantId is nullable (null = global template).
 */
const tenantStore = new AsyncLocalStorage<{ tenantId: string }>();



const WHERE_OPS = new Set([
  "findMany", "findFirst", "findFirstOrThrow", "findUnique", "findUniqueOrThrow",
  "count", "aggregate", "groupBy", "update", "updateMany", "delete", "deleteMany", "upsert",
]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const withTenantData = (data: any, tenantId: string) =>
  data && typeof data === "object" && !("tenantId" in data) && !("tenant" in data)
    ? { ...data, tenantId }
    : data;

const baseClient = global.__prismaBase ?? new PrismaClient({ adapter, log: ["warn", "error"] });

export const prisma = baseClient.$extends({
  query: {
    $allModels: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async $allOperations({ model, operation, args, query }: any) {
        const ctx = tenantStore.getStore();
        if (!ctx || !TENANT_MODELS.has(model)) return query(args);
        const { tenantId } = ctx;

        if (WHERE_OPS.has(operation)) {
          args.where = { ...(args.where ?? {}), tenantId };
        }
        if (operation === "create") args.data = withTenantData(args.data, tenantId);
        if (operation === "createMany") {
          args.data = Array.isArray(args.data)
            ? args.data.map((d: unknown) => withTenantData(d, tenantId))
            : withTenantData(args.data, tenantId);
        }
        if (operation === "upsert") args.create = withTenantData(args.create, tenantId);
        return query(args);
      },
    },
  },
});

declare global {
  // eslint-disable-next-line no-var
  var __prismaBase: PrismaClient | undefined;
}
if (process.env.NODE_ENV !== "production") global.__prismaBase = baseClient;

export type Tx = Prisma.TransactionClient;

/**
 * Run `fn` with the Postgres `app.current_tenant` GUC set to `tenantId`
 * (RLS) and with the tenant-scoping extension above active.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (tx: Tx) => Promise<T>
): Promise<T> {
  return tenantStore.run({ tenantId }, () =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.current_tenant = '${tenantId.replace(/'/g, "''")}'`);
      return fn(tx as unknown as Tx);
    })
  );
}
