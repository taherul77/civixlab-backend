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
