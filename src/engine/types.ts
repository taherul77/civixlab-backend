import { z } from "zod";

export type FieldType = "number" | "integer" | "string" | "date" | "boolean" | "enum";

/** Declarative field definition. One source of truth for the UI form AND server validation. */
export interface FieldDef {
  name: string;
  label: string;
  type: FieldType;
  unit?: string;
  required?: boolean;
  min?: number;
  max?: number;
  default?: string | number | boolean;
  options?: string[];
  help?: string;
  section?: string;
}

export type CheckStatus = "pass" | "fail" | "warning" | "info";

export interface Check {
  id: string;
  label: string;
  measured: number | string;
  limit: string;
  unit?: string;
  status: CheckStatus;
  /** Critical failures are code-mandated limits (e.g. SBC 304) */
  critical?: boolean;
  message?: string;
}

export type Overall = "pass" | "fail" | "warning" | "pending";

export interface EvaluationResult {
  testCode: string;
  results: Record<string, number | string | boolean>;
  /** Ordered, labelled rows for display (optional; legacy schemas provide them). */
  rows?: { key: string; label: string; unit?: string; value: number | string }[];
  checks: Check[];
  warnings: string[];
  overall: Overall;
}

export interface TestTemplateDef {
  code: string;
  name: string;
  category: "concrete" | "soil" | "aggregate" | "asphalt" | "steel" | "cement" | "masonry" | "water";
  standardBody: string;
  standardNumber: string;
  isSaudiSpecific: boolean;
  description: string;
  fields: FieldDef[];
  /** Runs calculations + pass/fail on already-validated input. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  evaluate(input: Record<string, any>): Omit<EvaluationResult, "testCode" | "overall">;
}

export class EngineValidationError extends Error {
  statusCode = 422;
  constructor(public issues: { field: string; message: string }[]) {
    super("Input validation failed");
  }
}

/** Build a zod schema from the declarative field list. */
export function buildSchema(fields: FieldDef[]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of fields) {
    let s: z.ZodTypeAny;
    switch (f.type) {
      case "number":
      case "integer": {
        let n = f.type === "integer" ? z.number().int() : z.number();
        if (f.min !== undefined) n = n.min(f.min, `${f.label} must be >= ${f.min}`);
        if (f.max !== undefined) n = n.max(f.max, `${f.label} must be <= ${f.max}`);
        s = n;
        break;
      }
      case "enum":
        s = z.enum(f.options as [string, ...string[]]);
        break;
      case "boolean":
        s = z.boolean();
        break;
      case "date":
        s = z.string().refine((v) => !Number.isNaN(Date.parse(v)), `${f.label} must be a valid date`);
        break;
      default:
        s = z.string();
    }
    if (f.default !== undefined) s = s.default(f.default);
    else if (!f.required) s = s.optional();
    shape[f.name] = s;
  }
  return z.object(shape);
}

export const round = (v: number, dp = 1) => {
  const m = 10 ** dp;
  return Math.round((v + Number.EPSILON) * m) / m;
};

export function overallOf(checks: Check[]): Overall {
  const scored = checks.filter((c) => c.status !== "info");
  if (scored.some((c) => c.status === "fail")) return "fail";
  if (scored.length === 0) return "pending";
  if (scored.some((c) => c.status === "warning")) return "warning";
  return "pass";
}
