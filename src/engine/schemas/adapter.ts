import { schemas, type TestSchema } from "./test-schemas";
import { round, type Check, type FieldDef, type TestTemplateDef } from "../types";

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "value";

function toFields(s: TestSchema): FieldDef[] {
  return s.sections.flatMap((sec) =>
    sec.fields.map((f): FieldDef => {
      const base = { name: f.key, label: f.label, unit: f.unit, required: f.required, help: f.help, section: sec.title };
      if (f.type === "select") {
        return { ...base, type: "enum", options: (f.options ?? []).map((o) => o.value),
          default: f.default !== undefined ? String(f.default) : undefined };
      }
      if (f.type === "number") return { ...base, type: "number", default: f.default as number | undefined };
      if (f.type === "date") return { ...base, type: "date" };
      return { ...base, type: "string", default: f.default as string | undefined };
    }),
  );
}

export function adapt(s: TestSchema): TestTemplateDef {
  const [body, ...rest] = s.standard.split(" ");
  return {
    code: s.code,
    name: s.name,
    category: s.category,
    standardBody: body ?? s.standard,
    standardNumber: rest.join(" "),
    isSaudiSpecific: Boolean(s.saudiSpecific),
    description: s.description,
    fields: toFields(s),
    evaluate(input) {
      const v = input as Record<string, number | string>;
      const used = new Set<string>();
      const results: Record<string, number | string | boolean> = {};
      const rows: { key: string; label: string; unit?: string; value: number | string }[] = [];
      const checks: Check[] = [];

      for (const r of s.results) {
        let value: number | string;
        try {
          value = r.compute(v);
        } catch {
          value = "n/a";
        }
        if (typeof value === "number") value = Number.isFinite(value) ? round(value, r.decimals ?? 2) : "n/a";
        let key = slug(r.label);
        if (used.has(key)) key = `${key}_${slug(r.unit ?? "alt")}`;
        used.add(key);
        results[key] = value;
        rows.push({ key, label: r.label, unit: r.unit, value });
        if (r.passIf && typeof value === "number") {
          checks.push({
            id: key, label: r.label, measured: value, limit: "per specification", unit: r.unit,
            status: r.passIf(v, value) ? "pass" : "fail",
          });
        }
      }
      for (const [i, rule] of s.passRules.entries()) {
        let ok = false;
        try { ok = rule.ok(v); } catch { ok = false; }
        checks.push({
          id: `rule_${i + 1}`, label: rule.label, measured: ok ? "ok" : "not met",
          limit: rule.label, status: ok ? "pass" : "fail",
        });
      }
      return { results, rows, checks, warnings: [] };
    },
  };
}

export const legacyTemplates: TestTemplateDef[] = Object.values(schemas).map(adapt);
