import { type TestTemplateDef, type Check, type FieldDef, round } from "../types";

type Limit = { name: string; label: string; unit: string; max: number; min?: number };

// SASO 1494 mandatory limits (spec section 6 H1)
const LIMITS: Limit[] = [
  { name: "ph", label: "pH", unit: "", min: 6.5, max: 8.5 },
  { name: "turbidityNtu", label: "Turbidity", unit: "NTU", max: 5 },
  { name: "colorTcu", label: "Color", unit: "TCU", max: 15 },
  { name: "tdsMgL", label: "Total dissolved solids", unit: "mg/L", max: 1000 },
  { name: "chlorideMgL", label: "Chloride", unit: "mg/L", max: 250 },
  { name: "sulfateMgL", label: "Sulfate", unit: "mg/L", max: 250 },
  { name: "nitrateMgL", label: "Nitrate (as NO3)", unit: "mg/L", max: 50 },
  { name: "nitriteMgL", label: "Nitrite (as NO2)", unit: "mg/L", max: 3 },
  { name: "fluorideMgL", label: "Fluoride", unit: "mg/L", max: 1.5 },
  { name: "ironMgL", label: "Iron", unit: "mg/L", max: 0.3 },
  { name: "manganeseMgL", label: "Manganese", unit: "mg/L", max: 0.4 },
  { name: "leadMgL", label: "Lead", unit: "mg/L", max: 0.01 },
  { name: "arsenicMgL", label: "Arsenic", unit: "mg/L", max: 0.01 },
  { name: "cadmiumMgL", label: "Cadmium", unit: "mg/L", max: 0.003 },
  { name: "residualChlorineMgL", label: "Residual chlorine", unit: "mg/L", min: 0.2, max: 0.5 },
  { name: "totalColiformMpn", label: "Total coliform", unit: "MPN/100mL", max: 0 },
  { name: "eColiMpn", label: "E. coli", unit: "MPN/100mL", max: 0 },
];

export const potableWater: TestTemplateDef = {
  code: "H1",
  name: "Potable Water Analysis (SASO 1494)",
  category: "water",
  standardBody: "SASO",
  standardNumber: "1494 / GSO 1494",
  isSaudiSpecific: true,
  description: "Physical, chemical and bacteriological analysis against SASO 1494 mandatory limits.",
  fields: [
    { name: "samplingPoint", label: "Sampling point", type: "string", required: true, section: "Sample" },
    { name: "sampleType", label: "Sample type", type: "enum", default: "tap",
      options: ["tap", "well", "tank", "bottle"], section: "Sample" },
    ...LIMITS.map((l): FieldDef => ({
      name: l.name, label: l.label, type: "number", unit: l.unit || undefined, required: l.name !== "nitriteMgL", min: 0,
      max: l.name === "ph" ? 14 : undefined, section: l.name.endsWith("Mpn") ? "Bacteriological" : "Chemical / physical",
    })),
  ],
  evaluate(i) {
    const checks: Check[] = [];
    const warnings: string[] = [];
    let ratioSum = 0;
    for (const l of LIMITS) {
      const v = i[l.name] as number | undefined;
      if (v === undefined) continue; // optional parameter not measured
      const okMax = v <= l.max;
      const okMin = l.min === undefined || v >= l.min;
      const ok = okMax && okMin;
      const limit = l.min !== undefined ? `${l.min} - ${l.max} ${l.unit}`.trim() : `<= ${l.max} ${l.unit}`.trim();
      const nearLimit = ok && l.max > 0 && l.min === undefined && v >= 0.8 * l.max;
      checks.push({
        id: l.name, label: l.label, measured: v, limit, unit: l.unit || undefined,
        status: ok ? (nearLimit ? "warning" : "pass") : "fail", critical: l.name.endsWith("Mpn"),
      });
      if (l.max > 0) ratioSum += Math.min(v / l.max, 2);
    }
    if (i.totalColiformMpn > 0 || i.eColiMpn > 0) warnings.push("Bacterial contamination: immediate health hazard.");
    if (i.chlorideMgL > 500 || i.sulfateMgL > 400) warnings.push("Not suitable for concrete mixing (chloride > 500 or sulfate > 400 mg/L).");
    const failed = checks.filter((c) => c.status === "fail").length;
    return {
      results: {
        parametersFailed: failed,
        waterQualityIndex: round(100 - (ratioSum / Math.max(1, LIMITS.filter((l) => l.max > 0 && i[l.name] !== undefined).length)) * 50, 1),
        suitableForDrinking: failed === 0,
        suitableForConcrete: !(i.chlorideMgL > 500 || i.sulfateMgL > 400),
      },
      checks,
      warnings,
    };
  },
};

export const waterTemplates = [potableWater];
