import { type TestTemplateDef, type Check, round } from "../types";

const DAY = 86_400_000;

// ASTM C39 L/D correction table (cylinders with L/D < 1.8)
const LD_X = [1.0, 1.25, 1.5, 1.75];
const LD_Y = [0.87, 0.93, 0.96, 0.98];
function ldFactor(ld: number): number {
  if (ld <= LD_X[0]!) return LD_Y[0]!;
  for (let i = 1; i < LD_X.length; i++) {
    if (ld <= LD_X[i]!) {
      const x0 = LD_X[i - 1]!, x1 = LD_X[i]!, y0 = LD_Y[i - 1]!, y1 = LD_Y[i]!;
      return y0 + ((ld - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return 1;
}

/** A1 - Compressive strength (SASO GSO ASTM C39/C94, SBC 304). */
export const compressiveStrength: TestTemplateDef = {
  code: "CONC-A1",
  name: "Compressive Strength of Concrete",
  category: "concrete",
  standardBody: "SASO",
  standardNumber: "GSO ASTM C39 / C94",
  isSaudiSpecific: true,
  description: "Compressive strength of 150 mm cube specimens (SBC 304) or cylinders.",
  fields: [
    { name: "specimenType", label: "Specimen type", type: "enum", required: true, default: "cube_150mm",
      options: ["cube_150mm", "cylinder_150x300mm", "cylinder_100x200mm"], section: "Specimen",
      help: "Saudi Arabia requires 150 mm cubes per SBC 304" },
    { name: "specimenId", label: "Specimen ID", type: "string", required: true, section: "Specimen" },
    { name: "castingDate", label: "Casting date", type: "date", required: true, section: "Specimen" },
    { name: "testDate", label: "Test date", type: "date", required: true, section: "Specimen" },
    { name: "ageDays", label: "Age", type: "enum", unit: "days", required: true, default: "28",
      options: ["3", "7", "28", "56", "90"], section: "Specimen" },
    { name: "diameterMm", label: "Diameter / side length", type: "number", unit: "mm", required: true,
      default: 150, min: 50, max: 300, section: "Dimensions", help: "Cube: side length. Cylinder: diameter." },
    { name: "heightMm", label: "Height", type: "number", unit: "mm", required: true,
      default: 150, min: 50, max: 600, section: "Dimensions" },
    { name: "maxLoadKn", label: "Maximum load", type: "number", unit: "kN", required: true,
      min: 0.01, max: 5000, section: "Test" },
    { name: "loadingRateMpaS", label: "Loading rate", type: "number", unit: "MPa/s", default: 0.25,
      min: 0.1, max: 5, section: "Test", help: "ASTM C39 requires 0.14-0.34 MPa/s" },
    { name: "temperatureC", label: "Temperature", type: "number", unit: "C", default: 23,
      min: 15, max: 30, section: "Environment" },
    { name: "humidityPercent", label: "Humidity", type: "number", unit: "%", default: 50,
      min: 30, max: 100, section: "Environment" },
    { name: "designStrengthMpa", label: "Design strength f'c", type: "number", unit: "MPa",
      min: 10, max: 100, section: "Specification" },
  ],
  evaluate(i) {
    const cube = i.specimenType === "cube_150mm";
    const warnings: string[] = [];
    const area = cube ? i.diameterMm ** 2 : Math.PI * (i.diameterMm / 2) ** 2;
    const raw = (i.maxLoadKn * 1000) / area;
    const ld = cube ? 1 : i.heightMm / i.diameterMm;
    const factor = !cube && ld < 1.8 ? ldFactor(ld) : 1;
    const final = round(raw * factor, 1);

    if (!cube) warnings.push("Saudi projects should use 150 mm cubes per SBC 304.");
    if (i.humidityPercent < 95) warnings.push("Moist curing requires RH > 95% per SBC 304.");
    const earliest = Date.parse(i.castingDate) + Number(i.ageDays) * DAY;
    if (Date.parse(i.testDate) < earliest) warnings.push("Test date is earlier than casting date + age.");
    if (i.loadingRateMpaS < 0.14 || i.loadingRateMpaS > 0.34)
      warnings.push("Loading rate outside ASTM C39 range 0.14-0.34 MPa/s.");

    const checks: Check[] = [];
    if (i.designStrengthMpa !== undefined) {
      const min = round(0.85 * i.designStrengthMpa, 2);
      checks.push({
        id: "individual", label: "Individual strength >= 0.85 f'c", measured: final,
        limit: `>= ${min} MPa`, unit: "MPa", status: final >= min ? "pass" : "fail",
      });
    }
    return {
      results: {
        crossSectionalAreaMm2: round(area, 1),
        ldRatio: round(ld, 2),
        correctionFactor: round(factor, 3),
        compressiveStrengthMpa: round(raw, 1),
        finalStrengthMpa: final,
        strengthPsi: round(final * 145.038, 0),
      },
      checks,
      warnings,
    };
  },
};

/** A2 - Slump (ASTM C143) with SBC 304 temperature check. */
export const slump: TestTemplateDef = {
  code: "CONC-A2",
  name: "Concrete Slump Test",
  category: "concrete",
  standardBody: "ASTM",
  standardNumber: "C143",
  isSaudiSpecific: false,
  description: "Consistency of fresh concrete using the slump cone.",
  fields: [
    { name: "initialHeightMm", label: "Initial height", type: "number", unit: "mm", default: 300, min: 1, max: 300 },
    { name: "finalHeightMm", label: "Height after lifting cone", type: "number", unit: "mm", required: true, min: 0, max: 300 },
    { name: "concreteTemperatureC", label: "Concrete temperature", type: "number", unit: "C", required: true, min: -10, max: 80 },
    { name: "ambientTemperatureC", label: "Ambient temperature", type: "number", unit: "C" },
    { name: "specMinMm", label: "Specified slump min", type: "number", unit: "mm", min: 0 },
    { name: "specMaxMm", label: "Specified slump max", type: "number", unit: "mm", min: 0 },
  ],
  evaluate(i) {
    const s = i.initialHeightMm - i.finalHeightMm;
    const cls = s < 25 ? "Very Low" : s < 50 ? "Low" : s < 100 ? "Medium" : s < 175 ? "High" : "Very High";
    const checks: Check[] = [
      {
        id: "temp-max", label: "Concrete temperature <= 35 C (SBC 304)", measured: i.concreteTemperatureC,
        limit: "<= 35 C", unit: "C", critical: true,
        status: i.concreteTemperatureC <= 35 ? "pass" : "fail",
        message: i.concreteTemperatureC <= 35 ? undefined : "Exceeds SBC 304 max 35 C",
      },
    ];
    const warnings: string[] = [];
    if (i.concreteTemperatureC < 5) warnings.push("Below minimum placement temperature (5 C).");
    if (i.specMinMm !== undefined || i.specMaxMm !== undefined) {
      const lo = i.specMinMm ?? 0;
      const hi = i.specMaxMm ?? Infinity;
      checks.push({
        id: "slump-range", label: "Slump within specified range", measured: s,
        limit: `${lo}-${hi === Infinity ? "max" : hi} mm`, unit: "mm", status: s >= lo && s <= hi ? "pass" : "fail",
      });
    }
    return {
      results: { slumpMm: round(s, 0), slumpInches: round(s / 25.4, 2), workabilityClass: cls },
      checks,
      warnings,
    };
  },
};

/** A4 - Temperature at placement (SBC 304, mandatory in KSA). */
export const placementTemperature: TestTemplateDef = {
  code: "CONC-A4",
  name: "Concrete Temperature at Placement",
  category: "concrete",
  standardBody: "SBC",
  standardNumber: "304 / ASTM C1064",
  isSaudiSpecific: true,
  description: "Mandatory hot-weather monitoring: placement, internal and differential temperature limits.",
  fields: [
    { name: "concreteTemperatureC", label: "Concrete temperature", type: "number", unit: "C", required: true, min: -10, max: 80 },
    { name: "ambientTemperatureC", label: "Ambient temperature", type: "number", unit: "C", required: true, min: -10, max: 70 },
    { name: "formworkTemperatureC", label: "Formwork temperature", type: "number", unit: "C", required: true, min: -10, max: 90 },
    { name: "cementContentKgM3", label: "Cement content", type: "number", unit: "kg/m3", required: true, min: 0, max: 800 },
    { name: "coolingMeasures", label: "Cooling measures", type: "enum", default: "none",
      options: ["none", "ice", "chilled_water", "retarder", "shading"] },
  ],
  evaluate(i) {
    const internal = i.concreteTemperatureC + i.cementContentKgM3 * 0.02;
    const dSurface = internal - i.formworkTemperatureC;
    const dAmbient = internal - i.ambientTemperatureC;
    const mk = (id: string, label: string, v: number, max: number, msg: string): Check => ({
      id, label, measured: round(v, 1), limit: `<= ${max} C`, unit: "C", critical: true,
      status: v <= max ? "pass" : "fail", message: v <= max ? undefined : msg,
    });
    const warnings: string[] = [];
    if (i.concreteTemperatureC > 32 && i.concreteTemperatureC <= 35)
      warnings.push("Pre-alert: approaching the 35 C placement limit.");
    return {
      results: {
        internalTempEstimateC: round(internal, 1),
        tempDiffSurfaceC: round(dSurface, 1),
        tempDiffAmbientC: round(dAmbient, 1),
        heatOfHydrationIndex: round(i.cementContentKgM3 * (i.concreteTemperatureC / 20), 1),
      },
      checks: [
        mk("placement", "Placement temperature (SBC 304)", i.concreteTemperatureC, 35, "SBC 304: max placement temp 35 C"),
        mk("internal", "Internal temperature (SBC 304)", internal, 65, "SBC 304: max internal temp 65 C"),
        mk("diff-surface", "Interior-surface differential (SBC 304)", dSurface, 25, "SBC 304: interior-surface diff max 25 C"),
        mk("diff-ambient", "Interior-ambient differential (SBC 304)", dAmbient, 20, "SBC 304: interior-ambient diff max 20 C"),
      ],
      warnings,
    };
  },
};

/** A8 - Acid-soluble chloride (ASTM C1152 / SBC 304). */
export const chlorideContent: TestTemplateDef = {
  code: "CONC-A8",
  name: "Concrete Chloride Content (Acid-Soluble)",
  category: "concrete",
  standardBody: "SBC",
  standardNumber: "304 / ASTM C1152",
  isSaudiSpecific: true,
  description: "Chloride by weight of cement, critical for coastal and desert exposure.",
  fields: [
    { name: "sampleMassG", label: "Sample mass", type: "number", unit: "g", required: true, min: 0.001 },
    { name: "titrantVolumeMl", label: "AgNO3 titrant volume", type: "number", unit: "mL", required: true, min: 0 },
    { name: "titrantNormality", label: "Titrant normality", type: "number", unit: "N", required: true, min: 0.0001 },
    { name: "blankVolumeMl", label: "Blank titrant volume", type: "number", unit: "mL", required: true, min: 0 },
    { name: "cementContentPercent", label: "Cement content", type: "number", unit: "%", required: true, min: 5, max: 20 },
    { name: "concreteType", label: "Concrete type", type: "enum", default: "reinforced",
      options: ["plain", "reinforced", "prestressed"] },
  ],
  evaluate(i) {
    const pct = (((i.titrantVolumeMl - i.blankVolumeMl) * i.titrantNormality * 0.03545) / i.sampleMassG) * 100;
    const byCement = pct / (i.cementContentPercent / 100);
    const limit = ({ plain: 1.0, reinforced: 0.25, prestressed: 0.1 } as Record<string, number>)[i.concreteType]!;
    return {
      results: { chloridePercent: round(pct, 4), chlorideByCementPercent: round(byCement, 3) },
      checks: [{
        id: "chloride", label: `Chloride by cement weight (${i.concreteType})`, measured: round(byCement, 3),
        limit: `<= ${limit}%`, unit: "%", critical: true, status: byCement <= limit ? "pass" : "fail",
      }],
      warnings: i.titrantVolumeMl <= i.blankVolumeMl ? ["Titrant volume must exceed the blank volume."] : [],
    };
  },
};

/** A9 - Sulfate (SO3) content (ASTM C114 / SBC 304). */
export const sulfateContent: TestTemplateDef = {
  code: "CONC-A9",
  name: "Concrete Sulfate Content",
  category: "concrete",
  standardBody: "SBC",
  standardNumber: "304 / ASTM C114",
  isSaudiSpecific: true,
  description: "Sulfate as SO3 by weight of cement (max 4%).",
  fields: [
    { name: "sulfateSo3Percent", label: "SO3 in sample", type: "number", unit: "%", required: true, min: 0 },
    { name: "cementContentPercent", label: "Cement content", type: "number", unit: "%", required: true, min: 5, max: 20 },
    { name: "exposureClass", label: "Exposure class", type: "enum", default: "S0", options: ["S0", "S1", "S2", "S3"] },
  ],
  evaluate(i) {
    const byCement = i.sulfateSo3Percent / (i.cementContentPercent / 100);
    return {
      results: { sulfateByCementPercent: round(byCement, 2) },
      checks: [{
        id: "so3", label: "SO3 by cement weight (SBC 304)", measured: round(byCement, 2),
        limit: "<= 4.0%", unit: "%", critical: true, status: byCement <= 4 ? "pass" : "fail",
      }],
      warnings: [],
    };
  },
};

export const concreteTemplates = [compressiveStrength, slump, placementTemperature, chlorideContent, sulfateContent];
