import { buildSchema, overallOf, EngineValidationError, type EvaluationResult, type TestTemplateDef } from "./types";
import { concreteTemplates, compressiveStrength, placementTemperature } from "./templates/concrete";
import { waterTemplates } from "./templates/water";
import { legacyTemplates } from "./schemas/adapter";

export * from "./types";

// Strict, hand-written concrete templates keep their CONC-* codes. A1 and A4 have
// bespoke frontend forms (not in the schema catalog), so they are also aliased
// under the short code. Schema-driven templates win for every other short code.
const alias = (t: TestTemplateDef, code: string): TestTemplateDef => ({ ...t, code });
const ALL: TestTemplateDef[] = [
  ...legacyTemplates,
  ...concreteTemplates,
  ...waterTemplates,
  alias(compressiveStrength, "A1"),
  alias(placementTemperature, "A4"),
];
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
