import { buildSchema, overallOf, EngineValidationError, type EvaluationResult, type TestTemplateDef } from "./types";
import { concreteTemplates } from "./templates/concrete";

export * from "./types";

const ALL: TestTemplateDef[] = [...concreteTemplates];
const BY_CODE = new Map(ALL.map((t) => [t.code, t]));

export const listTemplates = () => ALL;
export const getTemplate = (code: string) => BY_CODE.get(code);

/** Validate raw input against the template schema, then calculate + judge pass/fail. */
export function evaluate(code: string, raw: unknown): EvaluationResult {
  const tpl = BY_CODE.get(code);
  if (!tpl) throw Object.assign(new Error(`Unknown test template: ${code}`), { statusCode: 404 });

  const parsed = buildSchema(tpl.fields).safeParse(raw);
  if (!parsed.success) {
    throw new EngineValidationError(
      parsed.error.issues.map((x) => ({ field: x.path.join("."), message: x.message })),
    );
  }
  const out = tpl.evaluate(parsed.data);
  return { testCode: code, ...out, overall: overallOf(out.checks) };
}
