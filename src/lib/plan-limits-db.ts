import type { Tx } from "@/db/prisma";
import { monthStartUtc, monthlyLimitMessage, monthlyLimitReached } from "@/lib/plan-limits";

/**
 * The one place that decides whether a tenant may create another test this month.
 * Any route that creates tests must call this inside withTenant and before creating.
 *
 * Takes a per-tenant lock so concurrent creates cannot overshoot, and fails CLOSED:
 * a missing tenant row refuses instead of skipping the check.
 * Returns an error to send (HTTP 403), or null when creating is allowed.
 */
export async function monthlyTestAllowanceError(tx: Tx, tenantId: string): Promise<{ code: string; message: string } | null> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId}, 2))`;
  const plan = await tx.tenant.findUnique({ where: { id: tenantId }, select: { maxTestsPerMonth: true } });
  if (!plan) return { code: "TENANT_NOT_FOUND", message: "Company record not found; cannot verify the monthly allowance." };
  const used = await tx.test.count({ where: { createdAt: { gte: monthStartUtc() } } });
  return monthlyLimitReached(used, plan.maxTestsPerMonth)
    ? { code: "PLAN_LIMIT", message: monthlyLimitMessage(plan.maxTestsPerMonth) }
    : null;
}
