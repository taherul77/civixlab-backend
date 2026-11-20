import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, EngineValidationError } from "./index";

test("A1: 150mm cube strength and 0.85 f'c check", () => {
  const r = evaluate("CONC-A1", {
    specimenId: "S1", castingDate: "2026-01-01", testDate: "2026-01-29",
    maxLoadKn: 900, designStrengthMpa: 35,
  });
  assert.equal(r.results.finalStrengthMpa, 40);
  assert.equal(r.overall, "pass");
  const low = evaluate("CONC-A1", {
    specimenId: "S2", castingDate: "2026-01-01", testDate: "2026-01-29",
    maxLoadKn: 600, designStrengthMpa: 35,
  });
  assert.equal(low.overall, "fail");
});

test("A4: 35C placement limit enforced", () => {
  const ok = evaluate("CONC-A4", { concreteTemperatureC: 30, ambientTemperatureC: 40, formworkTemperatureC: 40, cementContentKgM3: 350 });
  assert.equal(ok.overall, "pass");
  const bad = evaluate("CONC-A4", { concreteTemperatureC: 36, ambientTemperatureC: 40, formworkTemperatureC: 40, cementContentKgM3: 350 });
  assert.equal(bad.overall, "fail");
  assert.equal(bad.checks.find((c) => c.id === "placement")?.status, "fail");
});

test("A8: chloride limit depends on concrete type", () => {
  const input = { sampleMassG: 10, titrantVolumeMl: 5, titrantNormality: 0.01, blankVolumeMl: 0.5, cementContentPercent: 15 };
  assert.equal(evaluate("CONC-A8", input).overall, "pass");
  assert.equal(evaluate("CONC-A8", { ...input, concreteType: "prestressed" }).overall, "fail");
});

test("A9: SO3 by cement max 4%", () => {
  assert.equal(evaluate("CONC-A9", { sulfateSo3Percent: 0.5, cementContentPercent: 15 }).overall, "pass");
  assert.equal(evaluate("CONC-A9", { sulfateSo3Percent: 0.7, cementContentPercent: 15 }).overall, "fail");
});

test("invalid input is rejected with field issues", () => {
  assert.throws(() => evaluate("CONC-A2", { finalHeightMm: 400, concreteTemperatureC: 30 }), EngineValidationError);
});

test("every registered template evaluates with sample input", async () => {
  const { listTemplates } = await import("./index");
  const all = listTemplates();
  assert.ok(all.length >= 75, `expected >= 75 templates, got ${all.length}`);
  for (const t of all) {
    const input: Record<string, unknown> = {};
    for (const f of t.fields) {
      if (f.default !== undefined) continue;
      if (!f.required) continue;
      if (f.type === "number" || f.type === "integer") input[f.name] = Math.max(f.min ?? 0, 10);
      else if (f.type === "date") input[f.name] = "2026-01-01";
      else if (f.type === "enum") input[f.name] = f.options![0];
      else input[f.name] = "x";
    }
    const r = evaluate(t.code, input);
    assert.ok(r.overall, `${t.code} produced no verdict`);
  }
});

test("H1: SASO 1494 potable water limits", () => {
  const ok = {
    samplingPoint: "tap-1", ph: 7.2, turbidityNtu: 1, colorTcu: 5, tdsMgL: 300, chlorideMgL: 100, sulfateMgL: 100,
    nitrateMgL: 10, nitriteMgL: 0.1, fluorideMgL: 0.5, ironMgL: 0.05, manganeseMgL: 0.05, leadMgL: 0.001,
    arsenicMgL: 0.001, cadmiumMgL: 0.001, residualChlorineMgL: 0.3, totalColiformMpn: 0, eColiMpn: 0,
  };
  assert.equal(evaluate("H1", ok).results.suitableForDrinking, true);
  const bad = evaluate("H1", { ...ok, eColiMpn: 2 });
  assert.equal(bad.overall, "fail");
  assert.ok(bad.warnings.some((w) => w.includes("Bacterial")));
});

test("A1: set average check uses all specimen loads", () => {
  const base = { specimenId: "S1", castingDate: "2026-01-01", testDate: "2026-01-29", maxLoadKn: 900, designStrengthMpa: 35 };
  const ok = evaluate("A1", { ...base, specimenLoadsKn: [900, 880, 910] });
  assert.equal(ok.overall, "pass");
  const lowAvg = evaluate("A1", { ...base, specimenLoadsKn: [900, 700, 700] });
  assert.equal(lowAvg.checks.find((c) => c.id === "average")?.status, "fail");
});

test("H1: nitrite is optional", () => {
  const r = evaluate("H1", {
    samplingPoint: "t", ph: 7, turbidityNtu: 1, colorTcu: 1, tdsMgL: 100, chlorideMgL: 10, sulfateMgL: 10, nitrateMgL: 1,
    fluorideMgL: 0.1, ironMgL: 0.01, manganeseMgL: 0.01, leadMgL: 0, arsenicMgL: 0, cadmiumMgL: 0,
    residualChlorineMgL: 0.3, totalColiformMpn: 0, eColiMpn: 0,
  });
  assert.equal(r.results.suitableForDrinking, true);
});
