import type { FastifyInstance } from "fastify";
import { withTenant } from "@/db/prisma";

// Categorisation matches frontend `data-store.ts` — `t.testType` carries
// the canonical category id (concrete | soil | aggregate | asphalt | ...).
const CATEGORY_LABELS: Record<string, string> = {
  concrete: "Concrete",
  soil: "Soil",
  aggregate: "Aggregate",
  asphalt: "Asphalt",
  steel: "Steel",
  cement: "Cement",
  water: "Water",
  masonry: "Masonry",
};

function monthBuckets(): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleString("en-US", { month: "short" });
    out.push({ key, label });
  }
  return out;
}

export async function dashboardRoutes(app: FastifyInstance) {
  app.get("/v1/dashboard/stats", { onRequest: [app.requireAuth] }, async (req) => {
    return withTenant(req.actor!.tenantId, async (tx) => {
      const [allTests, equipment, activeProjects, recentTests] = await Promise.all([
        tx.test.findMany({
          select: { id: true, status: true, testType: true, testDate: true, passFailStatus: true, createdAt: true },
        }),
        tx.equipment.findMany({ select: { calibrationDueDate: true } }),
        tx.project.findMany({ where: { status: "active" }, orderBy: { createdAt: "desc" } }),
        tx.test.findMany({ orderBy: { createdAt: "desc" }, take: 6 }),
      ]);

      const today = new Date().toISOString().slice(0, 10);
      const month = today.slice(0, 7);

      const testsToday = allTests.filter((t) => (t.testDate?.toISOString().slice(0, 10) ?? "") === today).length;
      const pendingReview = allTests.filter((t) => t.status === "submitted").length;
      const approvedThisMonth = allTests.filter(
        (t) => t.status === "approved" && (t.testDate?.toISOString().slice(0, 7) ?? "") === month
      ).length;
      const overdueCalibrations = equipment.filter((e) => {
        if (!e.calibrationDueDate) return false;
        return e.calibrationDueDate.getTime() < Date.now();
      }).length;

      // Monthly volume — last 6 months.
      const buckets = monthBuckets();
      const monthlyVolume = buckets.map((b) => {
        const inMonth = allTests.filter((t) => (t.testDate?.toISOString().slice(0, 7) ?? "") === b.key);
        const passed = inMonth.filter((t) => t.passFailStatus === "pass" || t.status === "approved" || t.status === "signed").length;
        return { month: b.label, tests: inMonth.length, passed };
      });

      // By category + pass/fail.
      const byCat = new Map<string, number>();
      const passFail = new Map<string, { pass: number; fail: number }>();
      for (const t of allTests) {
        const key = t.testType ?? "other";
        byCat.set(key, (byCat.get(key) ?? 0) + 1);
        const acc = passFail.get(key) ?? { pass: 0, fail: 0 };
        if (t.passFailStatus === "pass") acc.pass += 1;
        else if (t.passFailStatus === "fail") acc.fail += 1;
        passFail.set(key, acc);
      }
      const byCategory = Array.from(byCat.entries()).map(([k, v]) => ({
        name: CATEGORY_LABELS[k] ?? k,
        value: v,
      }));
      const passFailByCategory = Array.from(passFail.entries()).map(([k, v]) => ({
        category: CATEGORY_LABELS[k] ?? k,
        pass: v.pass,
        fail: v.fail,
      }));

      return {
        testsToday,
        pendingReview,
        approvedThisMonth,
        overdueCalibrations,
        monthlyVolume,
        byCategory,
        passFailByCategory,
        activeProjects,
        recentTests,
      };
    });
  });
}
