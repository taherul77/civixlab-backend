import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TENANT_MODELS, TENANT_ID_EXEMPT } from "./tenant-models";

/** Models in schema.prisma that declare a `tenantId` column. */
function modelsWithTenantId(): { name: string; nullable: boolean }[] {
  const schema = readFileSync(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
  const out: { name: string; nullable: boolean }[] = [];
  for (const m of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    const field = m[2]!.match(/^\s*tenantId\s+\w+(\?)?/m);
    if (field) out.push({ name: m[1]!, nullable: field[1] === "?" });
  }
  return out;
}

test("every model with a tenantId column is auto-scoped or explicitly exempt", () => {
  const found = modelsWithTenantId();
  assert.ok(found.length >= TENANT_MODELS.size, "schema parsing found fewer tenant models than TENANT_MODELS lists");
  for (const { name } of found) {
    assert.ok(
      TENANT_MODELS.has(name) || TENANT_ID_EXEMPT.has(name),
      `Model ${name} has a tenantId column but is not in TENANT_MODELS (src/db/tenant-models.ts). ` +
        "Queries on it would not be company-scoped. Add it, or add it to TENANT_ID_EXEMPT with a reason.",
    );
  }
});

test("exempt models really have a nullable tenantId (global rows)", () => {
  const byName = new Map(modelsWithTenantId().map((m) => [m.name, m]));
  for (const name of TENANT_ID_EXEMPT) {
    assert.equal(byName.get(name)?.nullable, true, `${name} is exempt but its tenantId is not nullable`);
  }
});

test("TENANT_MODELS only lists models that exist with a tenantId", () => {
  const byName = new Map(modelsWithTenantId().map((m) => [m.name, m]));
  for (const name of TENANT_MODELS) {
    const m = byName.get(name);
    assert.ok(m, `${name} in TENANT_MODELS has no tenantId column`);
    assert.equal(m.nullable, false, `${name} has a nullable tenantId; scoping would hide its global rows (use TENANT_ID_EXEMPT)`);
  }
});
