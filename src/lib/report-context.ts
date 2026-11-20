import type { Tx } from "@/db/prisma";
import { env } from "@/config/env";
import { evaluate, getTemplate } from "@/engine";
import { SEAL_ALGORITHM, sealOf } from "@/lib/report-seal";
import type { ReportDoc } from "@/lib/report-pdf";

const humanize = (k: string) =>
  k.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());

const show = (v: unknown): string =>
  Array.isArray(v) ? v.join(", ") : typeof v === "boolean" ? (v ? "Yes" : "No") : String(v);

export interface ReportContext {
  test: NonNullable<Awaited<ReturnType<Tx["test"]["findUnique"]>>>;
  sample: Awaited<ReturnType<Tx["sample"]["findUnique"]>>;
  project: Awaited<ReturnType<Tx["project"]["findUnique"]>>;
  equipment: Awaited<ReturnType<Tx["equipment"]["findUnique"]>>;
  tenant: { name: string; crNumber: string | null };
  people: ReportDoc["people"];
}

type DiffRow = { field: string; from: string; to: string };

/** Load everything a report needs (all tenant-scoped via withTenant). Null if the test is missing. */
export async function loadReportContext(tx: Tx, tenantId: string, testId: string): Promise<ReportContext | null> {
  const test = await tx.test.findUnique({ where: { id: testId } });
  if (!test) return null;
  const [sample, project, equipment, tenant, trail] = await Promise.all([
    tx.sample.findUnique({ where: { id: test.sampleId } }),
    tx.project.findUnique({ where: { id: test.projectId } }),
    test.equipmentId ? tx.equipment.findUnique({ where: { id: test.equipmentId } }) : Promise.resolve(null),
    tx.tenant.findUnique({ where: { id: tenantId }, select: { name: true, crNumber: true } }),
    tx.auditLog.findMany({ where: { entityType: "test", entityId: testId }, orderBy: { createdAt: "desc" } }),
  ]);
  const evt = (action: string) => trail.find((a) => a.action === action);
  const review = evt("review"), approve = evt("approve"), sign = evt("sign");
  const sigDiff = Array.isArray(sign?.newValues) ? (sign!.newValues as unknown as DiffRow[]) : [];
  return {
    test, sample, project, equipment,
    tenant: { name: tenant?.name ?? "Laboratory", crNumber: tenant?.crNumber ?? null },
    people: {
      reviewedBy: review?.userEmail ?? null, reviewedAt: review?.createdAt.toISOString() ?? null,
      approvedBy: approve?.userEmail ?? null, approvedAt: approve?.createdAt.toISOString() ?? null,
      signedBy: sign?.userEmail ?? null, signatureSerial: sigDiff.find((d) => d.field === "signature")?.to ?? null,
    },
  };
}

/**
 * The content the integrity seal covers: what was measured, the outcome and the
 * approval. Deliberately excludes the signing step, so signing an already issued
 * report does not invalidate it.
 */
export function sealContent(c: ReportContext) {
  return {
    v: 1,
    testCode: c.test.testCode,
    standard: [c.test.standardBody, c.test.standardNumber].filter(Boolean).join(" "),
    testDate: c.test.testDate?.toISOString().slice(0, 10) ?? null,
    inputData: c.test.inputData,
    calculatedResults: c.test.calculatedResults,
    passFailStatus: c.test.passFailStatus,
    remarks: c.test.remarks,
    projectCode: c.project?.projectCode ?? null,
    sampleCode: c.sample?.sampleCode ?? null,
    approvedBy: c.people.approvedBy,
    approvedAt: c.people.approvedAt,
  };
}

/** The evaluated output frozen at issue time, so later engine/template changes cannot alter an issued report. */
export interface EvalSnapshot {
  results: ReportDoc["results"];
  checks: ReportDoc["checks"];
  warnings: string[];
}

/** Seal over the test content AND the frozen evaluated output. */
export const currentSeal = (c: ReportContext, snapshot: EvalSnapshot | null) =>
  sealOf({ ...sealContent(c), evaluated: snapshot });

export const conformityOf = (passFail: string | null): ReportDoc["conformity"] =>
  passFail === "pass" ? "conforms" : passFail === "fail" ? "does_not_conform" : "pending";

export const verifyUrlFor = (reportNumber: string) => `${env.PUBLIC_VERIFY_BASE_URL.replace(/\/$/, "")}/${reportNumber}`;

/** Evaluate once, at issue time. Falls back to the stored values if the template/inputs no longer evaluate. */
export function evaluateSnapshot(c: ReportContext): EvalSnapshot {
  const t = c.test;
  try {
    const ev = evaluate(t.testCode, (t.inputData ?? {}) as Record<string, unknown>);
    return {
      results: ev.rows
        ? ev.rows.map((r) => ({ label: r.label, value: show(r.value), unit: r.unit }))
        : Object.entries(ev.results).map(([k, v]) => ({ label: humanize(k), value: show(v) })),
      checks: ev.checks.map((x) => ({ label: x.label, measured: show(x.measured), limit: x.limit, status: x.status })),
      warnings: ev.warnings,
    };
  } catch {
    const calc = (t.calculatedResults ?? {}) as Record<string, unknown>;
    let results: ReportDoc["results"] = Object.entries(calc)
      .filter(([k, v]) => k !== "primaryResult" && (typeof v === "number" || typeof v === "string" || typeof v === "boolean"))
      .map(([k, v]) => ({ label: humanize(k), value: show(v) }));
    const primary = calc.primaryResult as { value: number; unit?: string; label?: string } | undefined;
    if (results.length === 0 && primary) results = [{ label: primary.label || "Result", value: String(primary.value), unit: primary.unit }];
    return { results, checks: [], warnings: [] };
  }
}

/** Turn the context + frozen snapshot into the document model. */
export function buildReportDoc(
  c: ReportContext,
  report: { reportNumber: string; generatedAt: Date; seal: string },
  snapshot: EvalSnapshot | null,
): ReportDoc {
  const t = c.test;
  const tpl = getTemplate(t.testCode);
  const stored = (t.inputData ?? {}) as Record<string, unknown>;
  const labelFor = (name: string) => {
    const f = tpl?.fields.find((x) => x.name === name);
    return f ? { label: f.label, unit: f.unit } : { label: humanize(name), unit: undefined };
  };
  // Template field order (as on the entry form); unknown keys go last, alphabetically.
  const order = (k: string) => { const i = tpl?.fields.findIndex((f) => f.name === k) ?? -1; return i < 0 ? Number.MAX_SAFE_INTEGER : i; };
  const inputs: ReportDoc["inputs"] = Object.entries(stored)
    .filter(([, v]) => v !== "" && v !== null && v !== undefined)
    .sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b))
    .map(([k, v]) => {
      const { label, unit } = labelFor(k);
      return { label: unit ? `${label} (${unit})` : label, value: show(v) };
    });
  const { results, checks, warnings } = snapshot ?? { results: [], checks: [], warnings: [] };

  return {
    reportNumber: report.reportNumber,
    issuedAt: report.generatedAt.toISOString(),
    tenantName: c.tenant.name,
    tenantCr: c.tenant.crNumber,
    testName: tpl?.name ?? t.testType,
    testCode: t.testCode,
    standard: [t.standardBody, t.standardNumber].filter(Boolean).join(" "),
    conformity: conformityOf(t.passFailStatus),
    project: { code: c.project?.projectCode ?? "—", name: c.project?.projectName ?? "—", client: c.project?.clientName, city: c.project?.city },
    sample: {
      code: c.sample?.sampleCode ?? "—", type: c.sample?.sampleType ?? "—",
      date: c.sample?.sampleDate?.toISOString() ?? null, location: c.sample?.sampleLocation, sampledBy: c.sample?.sampledBy,
    },
    testDate: t.testDate?.toISOString() ?? null,
    equipment: c.equipment
      ? { code: c.equipment.equipmentCode, name: c.equipment.equipmentName, calibrationDue: c.equipment.calibrationDueDate?.toISOString() ?? null }
      : null,
    inputs, results, checks, warnings,
    remarks: t.remarks,
    people: c.people,
    verifyUrl: verifyUrlFor(report.reportNumber),
    seal: { algorithm: SEAL_ALGORITHM, hash: report.seal },
  };
}
