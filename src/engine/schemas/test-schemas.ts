// JSON-driven schemas for the remaining 72 tests. Each schema defines:
// - sections of fields (number / select / date)
// - calculation closures
// - pass/fail rules with limit references
// The generic /tests/new/[code] page renders any of these.

export type FieldType = "number" | "select" | "date" | "text";

export interface SchemaField {
  key: string;
  label: string;
  type: FieldType;
  unit?: string;
  default?: number | string;
  options?: { value: string; label: string }[];
  help?: string;
  required?: boolean;
  step?: number;
}

export interface SchemaSection {
  title: string;
  description?: string;
  fields: SchemaField[];
}

export interface ResultRow {
  label: string;
  unit?: string;
  decimals?: number;
  compute: (v: Record<string, number | string>) => number | string;
  passIf?: (v: Record<string, number | string>, computed: number) => boolean;
}

export interface PassRule {
  label: string;
  ok: (v: Record<string, number | string>) => boolean;
}

export interface TestSchema {
  code: string;
  name: string;
  standard: string;
  saudiSpecific?: boolean;
  description: string;
  category: "concrete" | "soil" | "aggregate" | "asphalt" | "steel" | "cement" | "masonry" | "water";
  sections: SchemaSection[];
  results: ResultRow[];
  passRules: PassRule[];
}

const num = (v: Record<string, number | string>, k: string) => Number(v[k] ?? 0);

import { uscsClassify, casagrandePc, mohrCoulomb, carbonEquivalent, finenessModulus } from "./calc-helpers";

export const schemas: Record<string, TestSchema> = {
  // ---------- CONCRETE ----------
  A2: {
    code: "A2", name: "Concrete Slump Test", standard: "ASTM C143", category: "concrete",
    description: "Workability of fresh concrete using slump cone.",
    sections: [{
      title: "Measurements",
      fields: [
        { key: "initial_h", label: "Initial cone height", unit: "mm", type: "number", default: 300 },
        { key: "final_h", label: "Final height after lift", unit: "mm", type: "number", default: 220, required: true },
        { key: "concrete_t", label: "Concrete temperature", unit: "°C", type: "number", default: 32 },
        { key: "ambient_t", label: "Ambient temperature", unit: "°C", type: "number", default: 38 },
        { key: "elapsed_min", label: "Elapsed since mix", unit: "min", type: "number", default: 30 },
      ],
    }],
    results: [
      { label: "Slump", unit: "mm", decimals: 0, compute: (v) => num(v, "initial_h") - num(v, "final_h") },
      { label: "Slump", unit: "in", decimals: 2, compute: (v) => (num(v, "initial_h") - num(v, "final_h")) / 25.4 },
      { label: "Workability class", compute: (v) => {
        const s = num(v, "initial_h") - num(v, "final_h");
        return s < 25 ? "Very low" : s < 50 ? "Low" : s < 100 ? "Medium" : s < 175 ? "High" : "Very high";
      }},
    ],
    passRules: [
      { label: "Concrete T ≤ 35 °C (SBC 304)", ok: (v) => num(v, "concrete_t") <= 35 },
      { label: "Slump 50–175 mm typical range", ok: (v) => { const s = num(v, "initial_h") - num(v, "final_h"); return s >= 50 && s <= 175; }},
    ],
  },

  A3: {
    code: "A3", name: "Concrete Air Content (Pressure)", standard: "ASTM C231", category: "concrete", saudiSpecific: true,
    description: "Air content in fresh concrete via pressure method.",
    sections: [{
      title: "Pressure measurements",
      fields: [
        { key: "bowl_v", label: "Bowl volume", unit: "L", type: "number", default: 8 },
        { key: "p_initial", label: "Initial gauge pressure", unit: "%", type: "number", default: 0 },
        { key: "p_final", label: "Final gauge pressure", unit: "%", type: "number", default: 4.5, required: true },
        { key: "agg_corr", label: "Aggregate correction factor", unit: "%", type: "number", default: 0.4 },
        { key: "cal_factor", label: "Calibration factor", unit: "%", type: "number", default: 0 },
        { key: "spec_min", label: "Spec min", unit: "%", type: "number", default: 1 },
        { key: "spec_max", label: "Spec max", unit: "%", type: "number", default: 3 },
      ],
    }],
    results: [
      { label: "Air content", unit: "%", decimals: 2, compute: (v) => num(v, "p_final") - num(v, "agg_corr") + num(v, "cal_factor") },
    ],
    passRules: [{ label: "Within project specification", ok: (v) => {
      const a = num(v, "p_final") - num(v, "agg_corr") + num(v, "cal_factor");
      return a >= num(v, "spec_min") && a <= num(v, "spec_max");
    }}],
  },

  A5: {
    code: "A5", name: "Concrete Density / Unit Weight", standard: "ASTM C138", category: "concrete",
    description: "Density and yield of fresh concrete.",
    sections: [{ title: "Measurements", fields: [
      { key: "vol", label: "Container volume", unit: "m³", type: "number", default: 0.014 },
      { key: "m_empty", label: "Empty mass", unit: "kg", type: "number", default: 5.42 },
      { key: "m_full", label: "Full mass", unit: "kg", type: "number", default: 38.7, required: true },
      { key: "moisture", label: "Moisture content", unit: "%", type: "number", default: 5 },
    ]}],
    results: [
      { label: "Mass of concrete", unit: "kg", decimals: 2, compute: (v) => num(v, "m_full") - num(v, "m_empty") },
      { label: "Wet density", unit: "kg/m³", decimals: 0, compute: (v) => (num(v, "m_full") - num(v, "m_empty")) / num(v, "vol") },
      { label: "Dry density", unit: "kg/m³", decimals: 0, compute: (v) => ((num(v, "m_full") - num(v, "m_empty")) / num(v, "vol")) / (1 + num(v, "moisture") / 100) },
    ],
    passRules: [{ label: "Within 2200–2600 kg/m³ for normal concrete", ok: (v) => {
      const d = (num(v, "m_full") - num(v, "m_empty")) / num(v, "vol");
      return d >= 2200 && d <= 2600;
    }}],
  },

  A6: {
    code: "A6", name: "Concrete Setting Time", standard: "ASTM C403", category: "concrete",
    description: "Initial and final set by penetration resistance.",
    sections: [{ title: "Times", fields: [
      { key: "initial_min", label: "Initial set (penetration = 3.5 MPa)", unit: "min", type: "number", default: 240 },
      { key: "final_min", label: "Final set (penetration = 27.6 MPa)", unit: "min", type: "number", default: 420 },
      { key: "concrete_t", label: "Concrete temperature", unit: "°C", type: "number", default: 32 },
    ]}],
    results: [
      { label: "Initial set", unit: "min", decimals: 0, compute: (v) => num(v, "initial_min") },
      { label: "Final set", unit: "min", decimals: 0, compute: (v) => num(v, "final_min") },
      { label: "Setting duration", unit: "h", decimals: 2, compute: (v) => (num(v, "final_min") - num(v, "initial_min")) / 60 },
    ],
    passRules: [
      { label: "Initial set ≥ 45 min", ok: (v) => num(v, "initial_min") >= 45 },
      { label: "Final set ≤ 600 min", ok: (v) => num(v, "final_min") <= 600 },
    ],
  },

  A7: {
    code: "A7", name: "Concrete Maturity Method", standard: "ASTM C1074", category: "concrete",
    description: "In-place strength via Nurse-Saul TTF and Arrhenius equivalent age.",
    sections: [{ title: "Inputs", fields: [
      { key: "datum_t", label: "Datum temperature", unit: "°C", type: "number", default: -10 },
      { key: "avg_t", label: "Average concrete temp", unit: "°C", type: "number", default: 35 },
      { key: "time_h", label: "Elapsed time", unit: "h", type: "number", default: 168 },
      { key: "ref_t", label: "Reference temperature (Tref)", unit: "°C", type: "number", default: 20 },
      { key: "Ea", label: "Activation energy (Ea)", unit: "kJ/mol", type: "number", default: 40 },
      { key: "design_fc", label: "Design f'c", unit: "MPa", type: "number", default: 30 },
      { key: "stripping_pct", label: "Stripping % of f'c", unit: "%", type: "number", default: 70 },
    ]}],
    results: [
      { label: "TTF (Nurse-Saul)", unit: "°C·h", decimals: 0, compute: (v) =>
        Math.max(0, num(v, "avg_t") - num(v, "datum_t")) * num(v, "time_h") },
      { label: "Equivalent age (Arrhenius)", unit: "h", decimals: 1, compute: (v) => {
        const R = 8.314e-3; // kJ/(mol·K)
        const factor = Math.exp(
          (-num(v, "Ea") / R) *
            (1 / (num(v, "avg_t") + 273.15) - 1 / (num(v, "ref_t") + 273.15))
        );
        return num(v, "time_h") * factor;
      }},
      { label: "Estimated strength", unit: "MPa", decimals: 1, compute: (v) => {
        const ttf = Math.max(0, num(v, "avg_t") - num(v, "datum_t")) * num(v, "time_h");
        const pct = Math.min(100, 18 * Math.log10(Math.max(ttf, 1)) + 5);
        return (pct / 100) * num(v, "design_fc");
      }},
    ],
    passRules: [{ label: "Strength ≥ stripping requirement", ok: (v) => {
      const ttf = Math.max(0, num(v, "avg_t") - num(v, "datum_t")) * num(v, "time_h");
      const pct = Math.min(100, 18 * Math.log10(Math.max(ttf, 1)) + 5);
      return pct >= num(v, "stripping_pct");
    }}],
  },

  A8: {
    code: "A8", name: "Chloride Content (Acid-Soluble)", standard: "ASTM C1152 / SBC 304", category: "concrete", saudiSpecific: true,
    description: "Chloride content. ≤ 0.25% by weight of cement (reinforced).",
    sections: [{ title: "Titration", fields: [
      { key: "sample_g", label: "Sample mass", unit: "g", type: "number", default: 5, required: true },
      { key: "titrant_ml", label: "AgNO₃ volume", unit: "mL", type: "number", default: 6.4 },
      { key: "blank_ml", label: "Blank volume", unit: "mL", type: "number", default: 0.2 },
      { key: "normality", label: "AgNO₃ normality", unit: "N", type: "number", default: 0.05 },
      { key: "cement_pct", label: "Cement content of concrete", unit: "%", type: "number", default: 14 },
      { key: "concrete_type", label: "Concrete type", type: "select", default: "reinforced",
        options: [{ value: "reinforced", label: "Reinforced" }, { value: "prestressed", label: "Prestressed" }, { value: "plain", label: "Plain" }] },
    ]}],
    results: [
      { label: "Chloride", unit: "% mass of sample", decimals: 4, compute: (v) =>
        ((num(v, "titrant_ml") - num(v, "blank_ml")) * num(v, "normality") * 0.03545) / num(v, "sample_g") * 100 },
      { label: "Chloride / cement", unit: "%", decimals: 3, compute: (v) => {
        const cl = ((num(v, "titrant_ml") - num(v, "blank_ml")) * num(v, "normality") * 0.03545) / num(v, "sample_g") * 100;
        return cl / (num(v, "cement_pct") / 100);
      }},
    ],
    passRules: [{ label: "Below SBC 304 limit", ok: (v) => {
      const cl = ((num(v, "titrant_ml") - num(v, "blank_ml")) * num(v, "normality") * 0.03545) / num(v, "sample_g") * 100;
      const byCement = cl / (num(v, "cement_pct") / 100);
      const limit = v.concrete_type === "prestressed" ? 0.10 : v.concrete_type === "plain" ? 1.0 : 0.25;
      return byCement <= limit;
    }}],
  },

  A9: {
    code: "A9", name: "Concrete Sulfate Content (SO₃)", standard: "ASTM C114 / SBC 304", category: "concrete", saudiSpecific: true,
    description: "≤ 4% SO₃ by weight of cement.",
    sections: [{ title: "Inputs", fields: [
      { key: "so3_pct", label: "SO₃ in concrete", unit: "%", type: "number", default: 0.45 },
      { key: "cement_pct", label: "Cement content of concrete", unit: "%", type: "number", default: 14 },
    ]}],
    results: [{ label: "SO₃ / cement", unit: "%", decimals: 2, compute: (v) => num(v, "so3_pct") / (num(v, "cement_pct") / 100) }],
    passRules: [{ label: "SO₃ ≤ 4% by mass of cement", ok: (v) => num(v, "so3_pct") / (num(v, "cement_pct") / 100) <= 4 }],
  },

  A10: {
    code: "A10", name: "Splitting Tensile Strength", standard: "ASTM C496", category: "concrete",
    description: "Tensile strength of cylindrical specimens.",
    sections: [{ title: "Specimen", fields: [
      { key: "d", label: "Diameter", unit: "mm", type: "number", default: 150 },
      { key: "L", label: "Length", unit: "mm", type: "number", default: 300 },
      { key: "load", label: "Max load", unit: "kN", type: "number", default: 245, required: true },
      { key: "min_spec", label: "Specified min", unit: "MPa", type: "number", default: 3 },
    ]}],
    results: [{ label: "Tensile strength", unit: "MPa", decimals: 2,
      compute: (v) => (2 * num(v, "load") * 1000) / (Math.PI * num(v, "d") * num(v, "L")) }],
    passRules: [{ label: "≥ specified minimum", ok: (v) => (2 * num(v, "load") * 1000) / (Math.PI * num(v, "d") * num(v, "L")) >= num(v, "min_spec") }],
  },

  A11: {
    code: "A11", name: "Flexural Strength (MOR)", standard: "ASTM C78", category: "concrete",
    description: "Modulus of rupture by third-point loading.",
    sections: [{ title: "Beam", fields: [
      { key: "b", label: "Width", unit: "mm", type: "number", default: 150 },
      { key: "d", label: "Depth", unit: "mm", type: "number", default: 150 },
      { key: "L", label: "Span", unit: "mm", type: "number", default: 450 },
      { key: "load", label: "Max load", unit: "kN", type: "number", default: 32 },
      { key: "spec_min", label: "Specified min", unit: "MPa", type: "number", default: 4.5 },
    ]}],
    results: [{ label: "Modulus of rupture", unit: "MPa", decimals: 2,
      compute: (v) => (num(v, "load") * 1000 * num(v, "L")) / (num(v, "b") * num(v, "d") ** 2) }],
    passRules: [{ label: "≥ specified minimum", ok: (v) =>
      (num(v, "load") * 1000 * num(v, "L")) / (num(v, "b") * num(v, "d") ** 2) >= num(v, "spec_min") }],
  },

  A12: {
    code: "A12", name: "Modulus of Elasticity", standard: "ASTM C469", category: "concrete",
    description: "Static chord modulus and Poisson's ratio.",
    sections: [{ title: "Inputs", fields: [
      { key: "stress_40", label: "Stress at 40% ultimate", unit: "MPa", type: "number", default: 14 },
      { key: "strain_40", label: "Strain at 40% ultimate", unit: "µε", type: "number", default: 425 },
      { key: "stress_0", label: "Stress at 0", unit: "MPa", type: "number", default: 0.5 },
      { key: "strain_0", label: "Strain at 0", unit: "µε", type: "number", default: 50 },
      { key: "trans_strain", label: "Transverse strain @ 40%", unit: "µε", type: "number", default: 80 },
      { key: "long_strain", label: "Longitudinal strain @ 40%", unit: "µε", type: "number", default: 425 },
    ]}],
    results: [
      { label: "Chord modulus", unit: "GPa", decimals: 1, compute: (v) =>
        ((num(v, "stress_40") - num(v, "stress_0")) / ((num(v, "strain_40") - num(v, "strain_0")) * 1e-6)) / 1000 },
      { label: "Poisson's ratio", decimals: 3, compute: (v) => num(v, "trans_strain") / num(v, "long_strain") },
    ],
    passRules: [{ label: "Modulus 20–40 GPa typical", ok: (v) => {
      const E = ((num(v, "stress_40") - num(v, "stress_0")) / ((num(v, "strain_40") - num(v, "strain_0")) * 1e-6)) / 1000;
      return E >= 20 && E <= 40;
    }}],
  },

  A13: {
    code: "A13", name: "Rapid Chloride Permeability", standard: "ASTM C1202", category: "concrete", saudiSpecific: true,
    description: "Charge passed in coulombs over 6h.",
    sections: [{ title: "Test", fields: [
      { key: "i_initial", label: "Initial current", unit: "µA", type: "number", default: 95000 },
      { key: "i_final", label: "Final current", unit: "µA", type: "number", default: 62000 },
      { key: "duration_h", label: "Duration", unit: "h", type: "number", default: 6 },
      { key: "exposure", label: "Exposure class", type: "select", default: "moderate",
        options: [{ value: "moderate", label: "Moderate" }, { value: "severe", label: "Severe (Saudi coast)" }] },
    ]}],
    results: [
      { label: "Charge passed", unit: "C", decimals: 0, compute: (v) =>
        ((num(v, "i_initial") + num(v, "i_final")) / 2 / 1e6) * num(v, "duration_h") * 3600 },
      { label: "Permeability rating", compute: (v) => {
        const c = ((num(v, "i_initial") + num(v, "i_final")) / 2 / 1e6) * num(v, "duration_h") * 3600;
        return c < 100 ? "Negligible" : c < 1000 ? "Very Low" : c < 2000 ? "Low" : c < 4000 ? "Moderate" : "High";
      }},
    ],
    passRules: [{ label: "Below exposure-class limit", ok: (v) => {
      const c = ((num(v, "i_initial") + num(v, "i_final")) / 2 / 1e6) * num(v, "duration_h") * 3600;
      return c < (v.exposure === "severe" ? 2000 : 4000);
    }}],
  },

  A14: {
    code: "A14", name: "Carbonation Depth", standard: "SBC 304", category: "concrete", saudiSpecific: true,
    description: "Depth via phenolphthalein indicator. Predicts cover required for design life.",
    sections: [{ title: "Measurements", fields: [
      { key: "age", label: "Age", unit: "days", type: "number", default: 365 },
      { key: "depth_avg", label: "Average depth", unit: "mm", type: "number", default: 6 },
      { key: "depth_max", label: "Maximum depth", unit: "mm", type: "number", default: 9 },
      { key: "cover", label: "Specified concrete cover", unit: "mm", type: "number", default: 40 },
      { key: "design_life_yr", label: "Design life", unit: "yr", type: "number", default: 50 },
      { key: "safety_factor", label: "Safety factor", type: "number", default: 1.5 },
    ]}],
    results: [
      { label: "Carbonation rate", unit: "mm/√yr", decimals: 2, compute: (v) =>
        num(v, "depth_avg") / Math.sqrt(num(v, "age") / 365.25) },
      { label: "Predicted at design life", unit: "mm", decimals: 1, compute: (v) =>
        (num(v, "depth_avg") / Math.sqrt(num(v, "age") / 365.25)) * Math.sqrt(num(v, "design_life_yr")) },
      { label: "Required cover (with SF)", unit: "mm", decimals: 1, compute: (v) =>
        (num(v, "depth_avg") / Math.sqrt(num(v, "age") / 365.25)) * Math.sqrt(num(v, "design_life_yr")) * num(v, "safety_factor") },
    ],
    passRules: [
      { label: "Carbonation has not reached steel", ok: (v) => num(v, "depth_max") < num(v, "cover") },
      { label: "Cover ≥ predicted × SF for design life", ok: (v) =>
        num(v, "cover") >= (num(v, "depth_avg") / Math.sqrt(num(v, "age") / 365.25)) * Math.sqrt(num(v, "design_life_yr")) * num(v, "safety_factor") },
    ],
  },

  A15: {
    code: "A15", name: "Concrete Resistivity", standard: "AASHTO TP 95", category: "concrete",
    description: "Electrical resistivity for corrosion risk assessment.",
    sections: [{ title: "Inputs", fields: [
      { key: "spacing", label: "Probe spacing", unit: "mm", type: "number", default: 50 },
      { key: "resistance", label: "Measured resistance", unit: "Ω", type: "number", default: 1500 },
    ]}],
    results: [
      { label: "Resistivity", unit: "Ω·cm", decimals: 0, compute: (v) =>
        (2 * Math.PI * num(v, "spacing") * num(v, "resistance")) / 10 },
      { label: "Corrosion risk", compute: (v) => {
        const r = (2 * Math.PI * num(v, "spacing") * num(v, "resistance")) / 10;
        return r > 10000 ? "Low" : r > 5000 ? "Moderate" : r > 1000 ? "High" : "Very High";
      }},
    ],
    passRules: [{ label: "Resistivity > 5000 Ω·cm (low–moderate risk)", ok: (v) =>
      (2 * Math.PI * num(v, "spacing") * num(v, "resistance")) / 10 > 5000 }],
  },

  A16: {
    code: "A16", name: "Concrete Pullout Test", standard: "ASTM C900", category: "concrete",
    description: "In-situ strength using pullout inserts.",
    sections: [{ title: "Inputs", fields: [
      { key: "d", label: "Insert diameter", unit: "mm", type: "number", default: 25 },
      { key: "load", label: "Pullout load", unit: "kN", type: "number", default: 38 },
      { key: "factor", label: "Calibration factor", type: "number", default: 0.95 },
      { key: "design_fc", label: "Design f'c", unit: "MPa", type: "number", default: 30 },
    ]}],
    results: [
      { label: "Estimated f'c", unit: "MPa", decimals: 1, compute: (v) =>
        num(v, "factor") * (num(v, "load") * 1000) / (Math.PI * (num(v, "d") / 2) ** 2) },
    ],
    passRules: [{ label: "≥ 0.85 × design f'c (SBC 304)", ok: (v) =>
      num(v, "factor") * (num(v, "load") * 1000) / (Math.PI * (num(v, "d") / 2) ** 2) >= 0.85 * num(v, "design_fc") }],
  },

  // ---------- SOIL ----------
  B1: {
    code: "B1", name: "Soil Classification (USCS)", standard: "ASTM D2487", category: "soil",
    description: "Unified Soil Classification — full GW/GP/GM/GC/SW/SP/SM/SC/ML/CL/MH/CH branching.",
    sections: [{ title: "Atterberg & gradation", fields: [
      { key: "ll", label: "Liquid limit", unit: "%", type: "number", default: 38 },
      { key: "pl", label: "Plastic limit", unit: "%", type: "number", default: 21 },
      { key: "p200", label: "Passing #200 (75 µm)", unit: "%", type: "number", default: 65 },
      { key: "p4", label: "Passing #4 (4.75 mm)", unit: "%", type: "number", default: 90 },
      { key: "d10", label: "D10", unit: "mm", type: "number", default: 0.05 },
      { key: "d30", label: "D30", unit: "mm", type: "number", default: 0.2 },
      { key: "d60", label: "D60", unit: "mm", type: "number", default: 0.6 },
    ]}],
    results: [
      { label: "Plasticity index", unit: "%", decimals: 1, compute: (v) => num(v, "ll") - num(v, "pl") },
      { label: "Cu", decimals: 2, compute: (v) => num(v, "d60") / num(v, "d10") },
      { label: "Cc", decimals: 2, compute: (v) => num(v, "d30") ** 2 / (num(v, "d60") * num(v, "d10")) },
      { label: "A-line value", decimals: 1, compute: (v) => 0.73 * Math.max(0, num(v, "ll") - 20) },
      { label: "USCS symbol", compute: (v) => uscsClassify({
        ll: num(v, "ll"), pl: num(v, "pl"),
        passing200: num(v, "p200"), passing4: num(v, "p4"),
        d10: num(v, "d10"), d30: num(v, "d30"), d60: num(v, "d60"),
      }).symbol },
      { label: "Group name", compute: (v) => uscsClassify({
        ll: num(v, "ll"), pl: num(v, "pl"),
        passing200: num(v, "p200"), passing4: num(v, "p4"),
        d10: num(v, "d10"), d30: num(v, "d30"), d60: num(v, "d60"),
      }).groupName },
    ],
    passRules: [],
  },

  B2: {
    code: "B2", name: "Visual Soil Classification", standard: "ASTM D2488", category: "soil",
    description: "Field classification by inspection.",
    sections: [{ title: "Observations", fields: [
      { key: "angularity", label: "Angularity", type: "select", default: "subangular",
        options: ["angular","subangular","subrounded","rounded"].map(v => ({ value: v, label: v })) },
      { key: "dry_strength", label: "Dry strength", type: "select", default: "medium",
        options: ["none","low","medium","high","very_high"].map(v => ({ value: v, label: v })) },
      { key: "plasticity", label: "Plasticity", type: "select", default: "medium",
        options: ["nonplastic","low","medium","high"].map(v => ({ value: v, label: v })) },
    ]}],
    results: [{ label: "Probable USCS", compute: (v) => v.plasticity === "nonplastic" ? "ML / SM" : v.plasticity === "high" ? "CH" : "CL" }],
    passRules: [],
  },

  B3: {
    code: "B3", name: "Standard Proctor", standard: "ASTM D698", category: "soil",
    description: "Moisture-density compaction (standard effort).",
    sections: [{ title: "Peak point", fields: [
      { key: "max_dd", label: "Max dry density", unit: "kg/m³", type: "number", default: 1820 },
      { key: "omc", label: "Optimum moisture", unit: "%", type: "number", default: 14.2 },
    ]}],
    results: [{ label: "MDD", unit: "kg/m³", decimals: 0, compute: (v) => num(v, "max_dd") }, { label: "OMC", unit: "%", decimals: 1, compute: (v) => num(v, "omc") }],
    passRules: [],
  },

  B4: {
    code: "B4", name: "Modified Proctor", standard: "ASTM D1557", category: "soil",
    description: "Moisture-density compaction (modified effort).",
    sections: [{ title: "Peak point", fields: [
      { key: "max_dd", label: "Max dry density", unit: "kg/m³", type: "number", default: 2010 },
      { key: "omc", label: "Optimum moisture", unit: "%", type: "number", default: 9.8 },
    ]}],
    results: [{ label: "MDD", unit: "kg/m³", decimals: 0, compute: (v) => num(v, "max_dd") }, { label: "OMC", unit: "%", decimals: 1, compute: (v) => num(v, "omc") }],
    passRules: [],
  },

  B5: {
    code: "B5", name: "Liquid Limit (Casagrande)", standard: "ASTM D4318", category: "soil",
    description: "Plastic-to-liquid transition water content.",
    sections: [{ title: "Inputs", fields: [
      { key: "ll_at_25", label: "Moisture content at 25 blows", unit: "%", type: "number", default: 38.5 },
    ]}],
    results: [{ label: "Liquid limit", unit: "%", decimals: 1, compute: (v) => num(v, "ll_at_25") }],
    passRules: [],
  },

  B6: {
    code: "B6", name: "Plastic Limit", standard: "ASTM D4318", category: "soil",
    description: "Crumbling water content at 3.2 mm thread.",
    sections: [{ title: "Inputs", fields: [
      { key: "w1", label: "Reading 1", unit: "%", type: "number", default: 21.2 },
      { key: "w2", label: "Reading 2", unit: "%", type: "number", default: 20.8 },
      { key: "w3", label: "Reading 3", unit: "%", type: "number", default: 21.0 },
      { key: "ll", label: "Liquid limit", unit: "%", type: "number", default: 38 },
    ]}],
    results: [
      { label: "Plastic limit", unit: "%", decimals: 1, compute: (v) => (num(v, "w1") + num(v, "w2") + num(v, "w3")) / 3 },
      { label: "Plasticity index", unit: "%", decimals: 1, compute: (v) => num(v, "ll") - (num(v, "w1") + num(v, "w2") + num(v, "w3")) / 3 },
    ],
    passRules: [],
  },

  B7: {
    code: "B7", name: "California Bearing Ratio (CBR)", standard: "ASTM D1883", category: "soil",
    description: "Penetration resistance vs standard crushed stone (6.9 / 10.3 MPa). Piston area 1935 mm².",
    sections: [{ title: "Inputs", fields: [
      { key: "load_25", label: "Load at 2.5 mm penetration", unit: "kN", type: "number", default: 7.5 },
      { key: "load_50", label: "Load at 5.0 mm penetration", unit: "kN", type: "number", default: 11.6 },
      { key: "min_spec", label: "Specified min CBR", unit: "%", type: "number", default: 25 },
      { key: "swell", label: "Swell after soak", unit: "%", type: "number", default: 0.4 },
    ]}],
    results: [
      // Unit load (kPa) at piston (1935 mm²) = load_kn * 1e6 / 1935.
      // CBR % = unit_load / 6900 kPa * 100 (at 2.5 mm) or / 10300 (at 5.0 mm).
      { label: "Unit load @ 2.5 mm", unit: "kPa", decimals: 0, compute: (v) =>
        (num(v, "load_25") * 1e6) / 1935 },
      { label: "Unit load @ 5.0 mm", unit: "kPa", decimals: 0, compute: (v) =>
        (num(v, "load_50") * 1e6) / 1935 },
      { label: "CBR @ 2.5 mm", unit: "%", decimals: 1, compute: (v) =>
        ((num(v, "load_25") * 1e6) / 1935) / 6900 * 100 },
      { label: "CBR @ 5.0 mm", unit: "%", decimals: 1, compute: (v) =>
        ((num(v, "load_50") * 1e6) / 1935) / 10300 * 100 },
      { label: "Reported CBR", unit: "%", decimals: 1, compute: (v) => {
        const c1 = ((num(v, "load_25") * 1e6) / 1935) / 6900 * 100;
        const c2 = ((num(v, "load_50") * 1e6) / 1935) / 10300 * 100;
        // Per ASTM D1883: report CBR @ 2.5 mm unless CBR @ 5.0 is greater (within 10%),
        // in which case re-test and use 5.0-mm value.
        return c2 > c1 ? c2 : c1;
      }},
    ],
    passRules: [
      { label: "Reported CBR ≥ specified minimum", ok: (v) => {
        const c1 = ((num(v, "load_25") * 1e6) / 1935) / 6900 * 100;
        const c2 = ((num(v, "load_50") * 1e6) / 1935) / 10300 * 100;
        return Math.max(c1, c2) >= num(v, "min_spec");
      }},
      { label: "Swell ≤ 1% (typical pavement subgrade)", ok: (v) => num(v, "swell") <= 1 },
    ],
  },

  B8: {
    code: "B8", name: "Field Density (Sand Cone)", standard: "ASTM D1556", category: "soil",
    description: "In-place density by sand replacement.",
    sections: [{ title: "Inputs", fields: [
      { key: "sand_cf", label: "Sand calibration", unit: "kg/m³", type: "number", default: 1480 },
      { key: "sand_used", label: "Sand mass in hole", unit: "kg", type: "number", default: 2.42 },
      { key: "wet_soil", label: "Wet soil from hole", unit: "kg", type: "number", default: 3.36 },
      { key: "moisture", label: "Moisture content", unit: "%", type: "number", default: 8 },
      { key: "lab_mdd", label: "Lab MDD", unit: "kg/m³", type: "number", default: 2050 },
      { key: "spec", label: "Specified compaction", unit: "%", type: "number", default: 95 },
    ]}],
    results: [
      { label: "Hole volume", unit: "m³", decimals: 5, compute: (v) => num(v, "sand_used") / num(v, "sand_cf") },
      { label: "Wet density", unit: "kg/m³", decimals: 0, compute: (v) => num(v, "wet_soil") / (num(v, "sand_used") / num(v, "sand_cf")) },
      { label: "Dry density", unit: "kg/m³", decimals: 0, compute: (v) => (num(v, "wet_soil") / (num(v, "sand_used") / num(v, "sand_cf"))) / (1 + num(v, "moisture") / 100) },
      { label: "% Compaction", unit: "%", decimals: 1, compute: (v) => (((num(v, "wet_soil") / (num(v, "sand_used") / num(v, "sand_cf"))) / (1 + num(v, "moisture") / 100)) / num(v, "lab_mdd")) * 100 },
    ],
    passRules: [{ label: "≥ specified compaction", ok: (v) => {
      const dd = (num(v, "wet_soil") / (num(v, "sand_used") / num(v, "sand_cf"))) / (1 + num(v, "moisture") / 100);
      return (dd / num(v, "lab_mdd")) * 100 >= num(v, "spec");
    }}],
  },

  B9: {
    code: "B9", name: "Field Density (Nuclear Gauge)", standard: "ASTM D6938", category: "soil",
    description: "In-place density and moisture by nuclear method.",
    sections: [{ title: "Readings", fields: [
      { key: "wet_d", label: "Wet density", unit: "kg/m³", type: "number", default: 2150 },
      { key: "moisture", label: "Moisture", unit: "%", type: "number", default: 7.5 },
      { key: "lab_mdd", label: "Lab MDD", unit: "kg/m³", type: "number", default: 2050 },
      { key: "spec", label: "Specified compaction", unit: "%", type: "number", default: 95 },
    ]}],
    results: [
      { label: "Dry density", unit: "kg/m³", decimals: 0, compute: (v) => num(v, "wet_d") / (1 + num(v, "moisture") / 100) },
      { label: "% Compaction", unit: "%", decimals: 1, compute: (v) => ((num(v, "wet_d") / (1 + num(v, "moisture") / 100)) / num(v, "lab_mdd")) * 100 },
    ],
    passRules: [{ label: "≥ specified compaction", ok: (v) =>
      ((num(v, "wet_d") / (1 + num(v, "moisture") / 100)) / num(v, "lab_mdd")) * 100 >= num(v, "spec") }],
  },

  B10: {
    code: "B10", name: "Permeability (Constant Head)", standard: "ASTM D2434", category: "soil",
    description: "k for granular soils.",
    sections: [{ title: "Inputs", fields: [
      { key: "d", label: "Specimen diameter", unit: "mm", type: "number", default: 100 },
      { key: "L", label: "Specimen length", unit: "mm", type: "number", default: 150 },
      { key: "h", label: "Head difference", unit: "mm", type: "number", default: 250 },
      { key: "vol", label: "Outflow volume", unit: "cm³", type: "number", default: 250 },
      { key: "t", label: "Collection time", unit: "s", type: "number", default: 300 },
    ]}],
    results: [{ label: "k", unit: "cm/s", decimals: 6, compute: (v) => {
      const A = Math.PI * (num(v, "d") / 20) ** 2;
      const i = num(v, "h") / num(v, "L");
      const q = num(v, "vol") / num(v, "t");
      return q / (A * i);
    }}],
    passRules: [],
  },

  B11: {
    code: "B11", name: "Permeability (Falling Head)", standard: "ASTM D5084", category: "soil",
    description: "k for fine-grained soils.",
    sections: [{ title: "Inputs", fields: [
      { key: "a", label: "Standpipe area", unit: "cm²", type: "number", default: 0.785 },
      { key: "L", label: "Specimen length", unit: "cm", type: "number", default: 12 },
      { key: "A", label: "Specimen area", unit: "cm²", type: "number", default: 78.5 },
      { key: "h1", label: "Initial head", unit: "cm", type: "number", default: 100 },
      { key: "h2", label: "Final head", unit: "cm", type: "number", default: 60 },
      { key: "t", label: "Time", unit: "s", type: "number", default: 1800 },
    ]}],
    results: [{ label: "k", unit: "cm/s", decimals: 8, compute: (v) =>
      (num(v, "a") * num(v, "L")) / (num(v, "A") * num(v, "t")) * Math.log(num(v, "h1") / num(v, "h2")) }],
    passRules: [],
  },

  B12: {
    code: "B12", name: "Consolidation (Oedometer)", standard: "ASTM D2435", category: "soil",
    description: "Cc, Cr, preconsolidation pressure (Casagrande construction from 4-point e-log p curve).",
    sections: [{ title: "Specimen", fields: [
      { key: "e0", label: "Initial void ratio e₀", type: "number", default: 0.95 },
      { key: "Gs", label: "Specific gravity Gs", type: "number", default: 2.70 },
      { key: "H_dr", label: "Drainage path", unit: "mm", type: "number", default: 12.7 },
      { key: "t50", label: "Time at 50% consolidation (Taylor √t)", unit: "min", type: "number", default: 4.2 },
    ]},
    { title: "e–log p curve points", description: "Pressure (kPa) and void ratio at each load step.", fields: [
      { key: "p1", label: "p₁", unit: "kPa", type: "number", default: 25 },
      { key: "e1", label: "e₁", type: "number", default: 0.945 },
      { key: "p2", label: "p₂", unit: "kPa", type: "number", default: 100 },
      { key: "e2", label: "e₂", type: "number", default: 0.92 },
      { key: "p3", label: "p₃", unit: "kPa", type: "number", default: 200 },
      { key: "e3", label: "e₃", type: "number", default: 0.83 },
      { key: "p4", label: "p₄", unit: "kPa", type: "number", default: 400 },
      { key: "e4", label: "e₄", type: "number", default: 0.71 },
      { key: "p5", label: "p₅", unit: "kPa", type: "number", default: 800 },
      { key: "e5", label: "e₅", type: "number", default: 0.58 },
    ]}],
    results: [
      { label: "Compression index Cc", decimals: 3, compute: (v) => {
        // Cc = -(e₅ - e₃)/log10(p₅/p₃) — slope on virgin compression branch.
        return -((num(v, "e5") - num(v, "e3")) / Math.log10(num(v, "p5") / num(v, "p3")));
      }},
      { label: "Recompression index Cr", decimals: 4, compute: (v) => {
        return -((num(v, "e2") - num(v, "e1")) / Math.log10(num(v, "p2") / num(v, "p1")));
      }},
      { label: "Preconsolidation pressure Pc", unit: "kPa", decimals: 0, compute: (v) =>
        casagrandePc([
          { p: num(v, "p1"), e: num(v, "e1") },
          { p: num(v, "p2"), e: num(v, "e2") },
          { p: num(v, "p3"), e: num(v, "e3") },
          { p: num(v, "p4"), e: num(v, "e4") },
          { p: num(v, "p5"), e: num(v, "e5") },
        ])
      },
      { label: "Cv (Taylor √t)", unit: "m²/yr", decimals: 2, compute: (v) => {
        // Cv = T50 * H_dr² / t50 ; T50 (Taylor) = 0.848 ; convert mm²/min → m²/yr.
        const Hdr_m = num(v, "H_dr") / 1000;
        const t50_yr = num(v, "t50") / (60 * 24 * 365.25);
        return (0.848 * Hdr_m ** 2) / t50_yr;
      }},
    ],
    passRules: [],
  },

  B13: {
    code: "B13", name: "Direct Shear Test", standard: "ASTM D3080", category: "soil",
    description: "Shear strength c, φ — least-squares Mohr-Coulomb regression on three (σ, τ) points.",
    sections: [{ title: "Three normal-stress points", fields: [
      { key: "s1", label: "σ₁ normal", unit: "kPa", type: "number", default: 50 },
      { key: "t1", label: "τ₁ peak shear", unit: "kPa", type: "number", default: 41 },
      { key: "s2", label: "σ₂ normal", unit: "kPa", type: "number", default: 100 },
      { key: "t2", label: "τ₂ peak shear", unit: "kPa", type: "number", default: 73 },
      { key: "s3", label: "σ₃ normal", unit: "kPa", type: "number", default: 200 },
      { key: "t3", label: "τ₃ peak shear", unit: "kPa", type: "number", default: 137 },
    ]}],
    results: [
      { label: "Cohesion c", unit: "kPa", decimals: 1, compute: (v) => mohrCoulomb([
        { sigma: num(v, "s1"), tau: num(v, "t1") },
        { sigma: num(v, "s2"), tau: num(v, "t2") },
        { sigma: num(v, "s3"), tau: num(v, "t3") },
      ]).c },
      { label: "Friction angle φ", unit: "°", decimals: 1, compute: (v) => mohrCoulomb([
        { sigma: num(v, "s1"), tau: num(v, "t1") },
        { sigma: num(v, "s2"), tau: num(v, "t2") },
        { sigma: num(v, "s3"), tau: num(v, "t3") },
      ]).phi },
    ],
    passRules: [],
  },

  B14: {
    code: "B14", name: "Plate Load Test", standard: "ASTM D1196", category: "soil",
    description: "In-situ bearing capacity and ks.",
    sections: [{ title: "Inputs", fields: [
      { key: "load_at_fail", label: "Load at failure", unit: "kPa", type: "number", default: 720 },
      { key: "settlement_at_25", label: "Settlement at 25 mm load", unit: "mm", type: "number", default: 8.5 },
      { key: "load_at_25", label: "Load at 25 mm settlement", unit: "kPa", type: "number", default: 240 },
      { key: "fos", label: "Factor of safety", type: "number", default: 3 },
    ]}],
    results: [
      { label: "Ultimate bearing capacity", unit: "kPa", decimals: 0, compute: (v) => num(v, "load_at_fail") },
      { label: "Allowable bearing", unit: "kPa", decimals: 0, compute: (v) => num(v, "load_at_fail") / num(v, "fos") },
      { label: "ks (modulus of subgrade)", unit: "MPa/m", decimals: 1, compute: (v) => num(v, "load_at_25") / num(v, "settlement_at_25") },
    ],
    passRules: [],
  },

  // ---------- AGGREGATE ----------
  C1: {
    code: "C1", name: "Sieve Analysis", standard: "ASTM C117 / C136", category: "aggregate",
    description: "Particle size distribution. Fineness modulus from cumulative % retained on standard sieves.",
    sections: [
      { title: "Cumulative % retained on standard sieves", description: "ASTM C136 sieve set (#100…3 in).", fields: [
        { key: "r_100", label: "#100 (0.150 mm)", unit: "%", type: "number", default: 95 },
        { key: "r_50",  label: "#50 (0.300 mm)",  unit: "%", type: "number", default: 78 },
        { key: "r_30",  label: "#30 (0.600 mm)",  unit: "%", type: "number", default: 60 },
        { key: "r_16",  label: "#16 (1.18 mm)",   unit: "%", type: "number", default: 40 },
        { key: "r_8",   label: "#8 (2.36 mm)",    unit: "%", type: "number", default: 12 },
        { key: "r_4",   label: "#4 (4.75 mm)",    unit: "%", type: "number", default: 0 },
        { key: "r_38",  label: "3/8 in (9.5 mm)", unit: "%", type: "number", default: 0 },
        { key: "r_34",  label: "3/4 in (19 mm)",  unit: "%", type: "number", default: 0 },
        { key: "r_112", label: "1½ in (37.5 mm)", unit: "%", type: "number", default: 0 },
        { key: "r_3",   label: "3 in (75 mm)",    unit: "%", type: "number", default: 0 },
      ]},
      { title: "Effective sizes", fields: [
        { key: "d10", label: "D10", unit: "mm", type: "number", default: 0.18 },
        { key: "d30", label: "D30", unit: "mm", type: "number", default: 0.65 },
        { key: "d60", label: "D60", unit: "mm", type: "number", default: 2.4 },
      ]},
    ],
    results: [
      { label: "Fineness modulus", decimals: 2, compute: (v) => finenessModulus([
        num(v, "r_100"), num(v, "r_50"), num(v, "r_30"), num(v, "r_16"),
        num(v, "r_8"),   num(v, "r_4"),  num(v, "r_38"), num(v, "r_34"),
        num(v, "r_112"), num(v, "r_3"),
      ]) },
      { label: "Cu (uniformity)", decimals: 2, compute: (v) => num(v, "d60") / num(v, "d10") },
      { label: "Cc (curvature)", decimals: 2, compute: (v) => num(v, "d30") ** 2 / (num(v, "d60") * num(v, "d10")) },
      { label: "Gradation", compute: (v) => {
        const cu = num(v, "d60") / num(v, "d10");
        const cc = num(v, "d30") ** 2 / (num(v, "d60") * num(v, "d10"));
        return cu >= 4 && cc >= 1 && cc <= 3 ? "Well graded" : "Poorly graded";
      }},
    ],
    passRules: [
      { label: "FM 2.3–3.1 (fine aggregate, ASTM C33)", ok: (v) => {
        const fm = finenessModulus([
          num(v, "r_100"), num(v, "r_50"), num(v, "r_30"), num(v, "r_16"),
          num(v, "r_8"),   num(v, "r_4"),  num(v, "r_38"), num(v, "r_34"),
          num(v, "r_112"), num(v, "r_3"),
        ]);
        return fm >= 2.3 && fm <= 3.1;
      }},
    ],
  },

  C2: {
    code: "C2", name: "Clay Lumps & Friable Particles", standard: "ASTM C142 / 09-SAMSS-088", category: "aggregate", saudiSpecific: true,
    description: "≤ 5% coarse, ≤ 3% fine.",
    sections: [{ title: "Inputs", fields: [
      { key: "initial", label: "Initial mass", unit: "g", type: "number", default: 5000 },
      { key: "passing", label: "Material passing 4.75 mm after wash", unit: "g", type: "number", default: 120 },
      { key: "agg_type", label: "Aggregate type", type: "select", default: "coarse",
        options: [{ value: "coarse", label: "Coarse" }, { value: "fine", label: "Fine" }] },
    ]}],
    results: [{ label: "Clay lumps", unit: "%", decimals: 2, compute: (v) => (num(v, "passing") / num(v, "initial")) * 100 }],
    passRules: [{ label: "Within 09-SAMSS-088 limit", ok: (v) =>
      (num(v, "passing") / num(v, "initial")) * 100 <= (v.agg_type === "fine" ? 3 : 5) }],
  },

  C3: {
    code: "C3", name: "Los Angeles Abrasion", standard: "ASTM C131 / C535", category: "aggregate", saudiSpecific: true,
    description: "Resistance to abrasion. ≤ 40%.",
    sections: [{ title: "Inputs", fields: [
      { key: "initial", label: "Initial mass", unit: "g", type: "number", default: 5000 },
      { key: "final", label: "Final mass after revolutions", unit: "g", type: "number", default: 3450 },
    ]}],
    results: [{ label: "LA abrasion loss", unit: "%", decimals: 1, compute: (v) =>
      ((num(v, "initial") - num(v, "final")) / num(v, "initial")) * 100 }],
    passRules: [{ label: "≤ 40%", ok: (v) => ((num(v, "initial") - num(v, "final")) / num(v, "initial")) * 100 <= 40 }],
  },

  C4: {
    code: "C4", name: "Specific Gravity (Coarse)", standard: "ASTM C127", category: "aggregate",
    description: "Bulk, SSD, apparent SG and absorption.",
    sections: [{ title: "Inputs", fields: [
      { key: "od", label: "Oven-dry mass", unit: "g", type: "number", default: 4925 },
      { key: "ssd", label: "SSD mass", unit: "g", type: "number", default: 5000 },
      { key: "sub", label: "Submerged mass", unit: "g", type: "number", default: 3120 },
    ]}],
    results: [
      { label: "Bulk SG", decimals: 3, compute: (v) => num(v, "od") / (num(v, "ssd") - num(v, "sub")) },
      { label: "Bulk SG (SSD)", decimals: 3, compute: (v) => num(v, "ssd") / (num(v, "ssd") - num(v, "sub")) },
      { label: "Apparent SG", decimals: 3, compute: (v) => num(v, "od") / (num(v, "od") - num(v, "sub")) },
      { label: "Absorption", unit: "%", decimals: 2, compute: (v) => ((num(v, "ssd") - num(v, "od")) / num(v, "od")) * 100 },
    ],
    passRules: [{ label: "Absorption ≤ 2.5% (09-SAMSS-088)", ok: (v) => ((num(v, "ssd") - num(v, "od")) / num(v, "od")) * 100 <= 2.5 }],
  },

  C5: {
    code: "C5", name: "Specific Gravity (Fine)", standard: "ASTM C128", category: "aggregate",
    description: "SG and absorption of fine aggregate.",
    sections: [{ title: "Inputs", fields: [
      { key: "od", label: "Oven-dry mass", unit: "g", type: "number", default: 495 },
      { key: "ssd", label: "SSD mass", unit: "g", type: "number", default: 500 },
      { key: "pyc_water_sample", label: "Pycnometer + water + sample", unit: "g", type: "number", default: 990 },
      { key: "pyc_water", label: "Pycnometer + water", unit: "g", type: "number", default: 680 },
    ]}],
    results: [
      { label: "Bulk SG", decimals: 3, compute: (v) => num(v, "od") / (num(v, "pyc_water") + num(v, "ssd") - num(v, "pyc_water_sample")) },
      { label: "Absorption", unit: "%", decimals: 2, compute: (v) => ((num(v, "ssd") - num(v, "od")) / num(v, "od")) * 100 },
    ],
    passRules: [{ label: "Absorption ≤ 2.5%", ok: (v) => ((num(v, "ssd") - num(v, "od")) / num(v, "od")) * 100 <= 2.5 }],
  },

  C6: {
    code: "C6", name: "Sulfate Soundness", standard: "ASTM C88", category: "aggregate", saudiSpecific: true,
    description: "Resistance to disintegration in sulfate.",
    sections: [{ title: "Inputs", fields: [
      { key: "initial", label: "Initial mass", unit: "g", type: "number", default: 1000 },
      { key: "final", label: "Mass after 5 cycles", unit: "g", type: "number", default: 880 },
      { key: "agg_type", label: "Aggregate type", type: "select", default: "coarse",
        options: [{ value: "coarse", label: "Coarse" }, { value: "fine_mg", label: "Fine MgSO₄" }, { value: "fine_na", label: "Fine Na₂SO₄" }] },
    ]}],
    results: [{ label: "Soundness loss", unit: "%", decimals: 1, compute: (v) =>
      ((num(v, "initial") - num(v, "final")) / num(v, "initial")) * 100 }],
    passRules: [{ label: "Within 09-SAMSS-088 limit", ok: (v) => {
      const loss = ((num(v, "initial") - num(v, "final")) / num(v, "initial")) * 100;
      return loss <= (v.agg_type === "coarse" ? 25 : v.agg_type === "fine_mg" ? 20 : 15);
    }}],
  },

  C7: {
    code: "C7", name: "Flat & Elongated Particles", standard: "ASTM D4791", category: "aggregate",
    description: "Particle shape limits.",
    sections: [{ title: "Counts", fields: [
      { key: "tested", label: "Particles tested", type: "number", default: 200 },
      { key: "fe", label: "Flat & elongated count", type: "number", default: 18 },
      { key: "limit", label: "Specified max", unit: "%", type: "number", default: 10 },
    ]}],
    results: [{ label: "F&E", unit: "%", decimals: 1, compute: (v) => (num(v, "fe") / num(v, "tested")) * 100 }],
    passRules: [{ label: "≤ specified", ok: (v) => (num(v, "fe") / num(v, "tested")) * 100 <= num(v, "limit") }],
  },

  C8: {
    code: "C8", name: "Sand Equivalent", standard: "ASTM D2419", category: "aggregate",
    description: "Fines vs sand proportion.",
    sections: [{ title: "Readings", fields: [
      { key: "floc", label: "Floc reading", unit: "mm", type: "number", default: 95 },
      { key: "sand", label: "Sand reading", unit: "mm", type: "number", default: 70 },
      { key: "min_spec", label: "Minimum SE", type: "number", default: 60 },
    ]}],
    results: [{ label: "Sand equivalent", decimals: 0, compute: (v) => (num(v, "sand") / num(v, "floc")) * 100 }],
    passRules: [{ label: "≥ minimum", ok: (v) => (num(v, "sand") / num(v, "floc")) * 100 >= num(v, "min_spec") }],
  },

  C9: {
    code: "C9", name: "Acid-Soluble Chlorides (Aggregate)", standard: "ASTM C1152 / 09-SAMSS-088", category: "aggregate", saudiSpecific: true,
    description: "≤ 0.03% (coarse) / ≤ 0.06% (fine).",
    sections: [{ title: "Inputs", fields: [
      { key: "cl", label: "Chloride content", unit: "%", type: "number", default: 0.018 },
      { key: "agg_type", label: "Aggregate type", type: "select", default: "coarse",
        options: [{ value: "coarse", label: "Coarse" }, { value: "fine", label: "Fine" }] },
    ]}],
    results: [{ label: "Cl content", unit: "%", decimals: 4, compute: (v) => num(v, "cl") }],
    passRules: [{ label: "Below 09-SAMSS-088 limit", ok: (v) => num(v, "cl") <= (v.agg_type === "fine" ? 0.06 : 0.03) }],
  },

  C10: {
    code: "C10", name: "Aggregate Crushing Value", standard: "BS 812-110", category: "aggregate",
    description: "Crushing resistance.",
    sections: [{ title: "Inputs", fields: [
      { key: "initial", label: "Initial mass", unit: "g", type: "number", default: 2500 },
      { key: "passing", label: "Mass passing 2.36 mm", unit: "g", type: "number", default: 580 },
      { key: "application", label: "Application", type: "select", default: "wearing",
        options: [{ value: "wearing", label: "Wearing course" }, { value: "base", label: "Base course" }] },
    ]}],
    results: [{ label: "ACV", unit: "%", decimals: 1, compute: (v) => (num(v, "passing") / num(v, "initial")) * 100 }],
    passRules: [{ label: "Within limit", ok: (v) =>
      (num(v, "passing") / num(v, "initial")) * 100 <= (v.application === "wearing" ? 30 : 45) }],
  },

  C11: {
    code: "C11", name: "Organic Impurities", standard: "ASTM C40", category: "aggregate",
    description: "Color comparison vs standard.",
    sections: [{ title: "Observation", fields: [
      { key: "color", label: "Sample color vs standard", type: "select", default: "lighter",
        options: ["lighter","same","darker"].map(v => ({ value: v, label: v })) },
    ]}],
    results: [{ label: "Result", compute: (v) => (v.color === "darker" ? "Reject — high organics" : "Acceptable") }],
    passRules: [{ label: "Not darker than standard", ok: (v) => v.color !== "darker" }],
  },

  C12: {
    code: "C12", name: "Lightweight Pieces", standard: "ASTM C123", category: "aggregate",
    description: "≤ 0.5% by mass for structural.",
    sections: [{ title: "Inputs", fields: [
      { key: "initial", label: "Initial mass", unit: "g", type: "number", default: 1000 },
      { key: "light", label: "Light material mass", unit: "g", type: "number", default: 3.4 },
    ]}],
    results: [{ label: "Lightweight pieces", unit: "%", decimals: 2, compute: (v) => (num(v, "light") / num(v, "initial")) * 100 }],
    passRules: [{ label: "≤ 0.5% (structural)", ok: (v) => (num(v, "light") / num(v, "initial")) * 100 <= 0.5 }],
  },

  // ---------- ASPHALT ----------
  D1: {
    code: "D1", name: "Marshall Stability & Flow", standard: "ASTM D6927 / SAES-Q-006", category: "asphalt", saudiSpecific: true,
    description: "Stability ≥ 8 kN (light) / 12 kN (heavy).",
    sections: [{ title: "Inputs", fields: [
      { key: "stability", label: "Stability", unit: "kN", type: "number", default: 13.4 },
      { key: "flow", label: "Flow", unit: "mm", type: "number", default: 3.2 },
      { key: "traffic", label: "Traffic", type: "select", default: "heavy",
        options: [{ value: "light", label: "Light" }, { value: "heavy", label: "Heavy" }] },
    ]}],
    results: [
      { label: "Stability", unit: "kN", decimals: 2, compute: (v) => num(v, "stability") },
      { label: "Flow", unit: "mm", decimals: 1, compute: (v) => num(v, "flow") },
      { label: "Marshall quotient", unit: "kN/mm", decimals: 2, compute: (v) => num(v, "stability") / num(v, "flow") },
    ],
    passRules: [
      { label: "Stability ≥ traffic limit", ok: (v) => num(v, "stability") >= (v.traffic === "heavy" ? 12 : 8) },
      { label: "Flow 2–4 mm", ok: (v) => num(v, "flow") >= 2 && num(v, "flow") <= 4 },
    ],
  },

  D2: {
    code: "D2", name: "Asphalt Content (Ignition)", standard: "ASTM D6307", category: "asphalt",
    description: "Binder content via ignition oven.",
    sections: [{ title: "Inputs", fields: [
      { key: "initial", label: "Initial mass", unit: "g", type: "number", default: 1500 },
      { key: "final", label: "Final mass", unit: "g", type: "number", default: 1432 },
      { key: "correction", label: "Aggregate correction factor", unit: "%", type: "number", default: 0.2 },
      { key: "jmf", label: "Job-mix formula target", unit: "%", type: "number", default: 4.5 },
    ]}],
    results: [{ label: "Asphalt content", unit: "%", decimals: 2, compute: (v) =>
      ((num(v, "initial") - num(v, "final")) / num(v, "initial")) * 100 - num(v, "correction") }],
    passRules: [{ label: "Within JMF ± 0.5%", ok: (v) => {
      const ac = ((num(v, "initial") - num(v, "final")) / num(v, "initial")) * 100 - num(v, "correction");
      return Math.abs(ac - num(v, "jmf")) <= 0.5;
    }}],
  },

  D3: {
    code: "D3", name: "Penetration", standard: "ASTM D5", category: "asphalt",
    description: "Binder consistency.",
    sections: [{ title: "Inputs", fields: [
      { key: "pen", label: "Penetration depth", unit: "0.1 mm", type: "number", default: 65 },
      { key: "grade_min", label: "Grade min", type: "number", default: 60 },
      { key: "grade_max", label: "Grade max", type: "number", default: 70 },
    ]}],
    results: [{ label: "Penetration", unit: "0.1 mm", decimals: 0, compute: (v) => num(v, "pen") }],
    passRules: [{ label: "Within grade range", ok: (v) => num(v, "pen") >= num(v, "grade_min") && num(v, "pen") <= num(v, "grade_max") }],
  },

  D4: {
    code: "D4", name: "Softening Point", standard: "ASTM D36", category: "asphalt",
    description: "Ring-and-ball method.",
    sections: [{ title: "Inputs", fields: [
      { key: "sp", label: "Softening point", unit: "°C", type: "number", default: 49 },
      { key: "min", label: "Grade min", type: "number", default: 47 },
      { key: "max", label: "Grade max", type: "number", default: 56 },
    ]}],
    results: [{ label: "Softening point", unit: "°C", decimals: 1, compute: (v) => num(v, "sp") }],
    passRules: [{ label: "Within grade range", ok: (v) => num(v, "sp") >= num(v, "min") && num(v, "sp") <= num(v, "max") }],
  },

  D5: {
    code: "D5", name: "Ductility", standard: "ASTM D113", category: "asphalt",
    description: "Elongation at break.",
    sections: [{ title: "Inputs", fields: [
      { key: "duct", label: "Elongation at break", unit: "cm", type: "number", default: 110 },
    ]}],
    results: [{ label: "Ductility", unit: "cm", decimals: 0, compute: (v) => num(v, "duct") }],
    passRules: [{ label: "≥ 100 cm", ok: (v) => num(v, "duct") >= 100 }],
  },

  D6: {
    code: "D6", name: "Specific Gravity (Binder)", standard: "ASTM D70", category: "asphalt",
    description: "Pycnometer method.",
    sections: [{ title: "Inputs", fields: [
      { key: "sg", label: "Specific gravity", type: "number", default: 1.025 },
    ]}],
    results: [{ label: "SG (binder)", decimals: 3, compute: (v) => num(v, "sg") }],
    passRules: [{ label: "Typical 1.00–1.05", ok: (v) => num(v, "sg") >= 1.0 && num(v, "sg") <= 1.05 }],
  },

  D7: {
    code: "D7", name: "Theoretical Max SG (Rice)", standard: "ASTM D2041", category: "asphalt",
    description: "Gmm of mixture.",
    sections: [{ title: "Inputs", fields: [
      { key: "sample", label: "Sample mass", unit: "g", type: "number", default: 2000 },
      { key: "flask_water", label: "Flask + water", unit: "g", type: "number", default: 7600 },
      { key: "flask_sample_water", label: "Flask + sample + water", unit: "g", type: "number", default: 8825 },
    ]}],
    results: [{ label: "Gmm", decimals: 3, compute: (v) =>
      num(v, "sample") / (num(v, "flask_water") - num(v, "flask_sample_water") + num(v, "sample")) }],
    passRules: [],
  },

  D8: {
    code: "D8", name: "Bulk Specific Gravity (Compacted)", standard: "ASTM D2726", category: "asphalt",
    description: "Gmb of compacted specimens.",
    sections: [{ title: "Inputs", fields: [
      { key: "dry", label: "Dry mass", unit: "g", type: "number", default: 1235 },
      { key: "ssd", label: "SSD mass", unit: "g", type: "number", default: 1238 },
      { key: "sub", label: "Submerged mass", unit: "g", type: "number", default: 720 },
    ]}],
    results: [{ label: "Gmb", decimals: 3, compute: (v) => num(v, "dry") / (num(v, "ssd") - num(v, "sub")) }],
    passRules: [],
  },

  D9: {
    code: "D9", name: "Air Voids Content", standard: "ASTM D3203", category: "asphalt",
    description: "Va in compacted mix (target 3-5%).",
    sections: [{ title: "Inputs", fields: [
      { key: "gmm", label: "Gmm", type: "number", default: 2.485 },
      { key: "gmb", label: "Gmb", type: "number", default: 2.378 },
    ]}],
    results: [{ label: "Air voids", unit: "%", decimals: 2, compute: (v) =>
      ((num(v, "gmm") - num(v, "gmb")) / num(v, "gmm")) * 100 }],
    passRules: [{ label: "Va between 3–5%", ok: (v) => {
      const va = ((num(v, "gmm") - num(v, "gmb")) / num(v, "gmm")) * 100;
      return va >= 3 && va <= 5;
    }}],
  },

  D10: {
    code: "D10", name: "VMA & VFA", standard: "ASTM D6997", category: "asphalt",
    description: "Voids in mineral aggregate and voids filled with asphalt.",
    sections: [{ title: "Inputs", fields: [
      { key: "gmb", label: "Gmb", type: "number", default: 2.378 },
      { key: "gsb", label: "Gsb (aggregate)", type: "number", default: 2.685 },
      { key: "pb", label: "Asphalt content Pb", unit: "%", type: "number", default: 4.5 },
      { key: "va", label: "Air voids Va", unit: "%", type: "number", default: 4 },
      { key: "vma_min", label: "VMA min spec", unit: "%", type: "number", default: 14 },
    ]}],
    results: [
      { label: "VMA", unit: "%", decimals: 2, compute: (v) => 100 - (num(v, "gmb") * (100 - num(v, "pb"))) / num(v, "gsb") },
      { label: "VFA", unit: "%", decimals: 1, compute: (v) => {
        const vma = 100 - (num(v, "gmb") * (100 - num(v, "pb"))) / num(v, "gsb");
        return ((vma - num(v, "va")) / vma) * 100;
      }},
    ],
    passRules: [
      { label: "VMA ≥ minimum", ok: (v) => 100 - (num(v, "gmb") * (100 - num(v, "pb"))) / num(v, "gsb") >= num(v, "vma_min") },
      { label: "VFA 65–75%", ok: (v) => {
        const vma = 100 - (num(v, "gmb") * (100 - num(v, "pb"))) / num(v, "gsb");
        const vfa = ((vma - num(v, "va")) / vma) * 100;
        return vfa >= 65 && vfa <= 75;
      }},
    ],
  },

  // ---------- STEEL ----------
  E1: {
    code: "E1", name: "Tensile Test (Rebar)", standard: "SASO SSA 2 / ASTM A615", category: "steel", saudiSpecific: true,
    description: "Yield, tensile, elongation per Saudi grades.",
    sections: [{ title: "Inputs", fields: [
      { key: "d", label: "Bar diameter", unit: "mm", type: "number", default: 20 },
      { key: "yield_load", label: "Yield load", unit: "kN", type: "number", default: 162 },
      { key: "ult_load", label: "Ultimate load", unit: "kN", type: "number", default: 215 },
      { key: "Lo", label: "Original gauge length", unit: "mm", type: "number", default: 100 },
      { key: "Lf", label: "Final gauge length", unit: "mm", type: "number", default: 112 },
      { key: "grade", label: "Grade", type: "select", default: "60",
        options: [{ value: "40", label: "Grade 40" },{ value: "60", label: "Grade 60" },{ value: "75", label: "Grade 75" },{ value: "80", label: "Grade 80" }] },
    ]}],
    results: [
      { label: "Area", unit: "mm²", decimals: 1, compute: (v) => Math.PI * (num(v, "d") / 2) ** 2 },
      { label: "Yield strength", unit: "MPa", decimals: 0, compute: (v) => (num(v, "yield_load") * 1000) / (Math.PI * (num(v, "d") / 2) ** 2) },
      { label: "Tensile strength", unit: "MPa", decimals: 0, compute: (v) => (num(v, "ult_load") * 1000) / (Math.PI * (num(v, "d") / 2) ** 2) },
      { label: "Y/T ratio", decimals: 2, compute: (v) => num(v, "yield_load") / num(v, "ult_load") },
      { label: "Elongation", unit: "%", decimals: 1, compute: (v) => ((num(v, "Lf") - num(v, "Lo")) / num(v, "Lo")) * 100 },
    ],
    passRules: [
      { label: "Yield ≥ grade min", ok: (v) => {
        const y = (num(v, "yield_load") * 1000) / (Math.PI * (num(v, "d") / 2) ** 2);
        const limits: Record<string, number> = { "40": 276, "60": 414, "75": 517, "80": 550 };
        return y >= limits[String(v.grade)]!;
      }},
      { label: "Tensile ≥ grade min", ok: (v) => {
        const t = (num(v, "ult_load") * 1000) / (Math.PI * (num(v, "d") / 2) ** 2);
        const limits: Record<string, number> = { "40": 414, "60": 620, "75": 689, "80": 690 };
        return t >= limits[String(v.grade)]!;
      }},
      { label: "Elongation ≥ grade min", ok: (v) => {
        const e = ((num(v, "Lf") - num(v, "Lo")) / num(v, "Lo")) * 100;
        const limits: Record<string, number> = { "40": 12, "60": 9, "75": 7, "80": 7 };
        return e >= limits[String(v.grade)]!;
      }},
    ],
  },

  E2: {
    code: "E2", name: "Bend Test", standard: "ASTM A615", category: "steel",
    description: "Ductility around specified pin.",
    sections: [{ title: "Inputs", fields: [
      { key: "cracks", label: "Cracks observed", type: "select", default: "no",
        options: [{ value: "no", label: "No" },{ value: "yes", label: "Yes" }] },
    ]}],
    results: [{ label: "Result", compute: (v) => v.cracks === "no" ? "PASS — no cracks" : "FAIL — cracks observed" }],
    passRules: [{ label: "No cracks", ok: (v) => v.cracks === "no" }],
  },

  E3: {
    code: "E3", name: "Rebend Test", standard: "ASTM A615", category: "steel",
    description: "Reverse bend simulating field.",
    sections: [{ title: "Inputs", fields: [
      { key: "cracks", label: "Cracks after rebend", type: "select", default: "no",
        options: [{ value: "no", label: "No" },{ value: "yes", label: "Yes" }] },
    ]}],
    results: [{ label: "Result", compute: (v) => v.cracks === "no" ? "PASS" : "FAIL" }],
    passRules: [{ label: "No cracks", ok: (v) => v.cracks === "no" }],
  },

  E4: {
    code: "E4", name: "Epoxy Coating Thickness", standard: "ASTM A775", category: "steel",
    description: "Thickness, holidays, adhesion.",
    sections: [{ title: "Inputs", fields: [
      { key: "avg_um", label: "Average thickness", unit: "µm", type: "number", default: 220 },
      { key: "min_um", label: "Minimum thickness", unit: "µm", type: "number", default: 170 },
      { key: "holidays", label: "Holidays detected", type: "number", default: 0 },
      { key: "adhesion", label: "Adhesion test", type: "select", default: "pass",
        options: [{ value: "pass", label: "Pass" }, { value: "fail", label: "Fail" }] },
    ]}],
    results: [
      { label: "Avg thickness", unit: "µm", decimals: 0, compute: (v) => num(v, "avg_um") },
      { label: "Min thickness", unit: "µm", decimals: 0, compute: (v) => num(v, "min_um") },
    ],
    passRules: [
      { label: "Avg 175–300 µm", ok: (v) => num(v, "avg_um") >= 175 && num(v, "avg_um") <= 300 },
      { label: "Min ≥ 125 µm", ok: (v) => num(v, "min_um") >= 125 },
      { label: "No holidays", ok: (v) => num(v, "holidays") === 0 },
      { label: "Adhesion passes", ok: (v) => v.adhesion === "pass" },
    ],
  },

  E5: {
    code: "E5", name: "Chemical Composition", standard: "ASTM A615 / SASO SSA 2", category: "steel",
    description: "C, Mn, P, S, Si plus full IIW carbon equivalent including Cr, Mo, V, Ni, Cu.",
    sections: [{ title: "Composition (% mass)", fields: [
      { key: "C", label: "Carbon",     unit: "%", type: "number", default: 0.27 },
      { key: "Mn", label: "Manganese", unit: "%", type: "number", default: 1.0 },
      { key: "P", label: "Phosphorus", unit: "%", type: "number", default: 0.025 },
      { key: "S", label: "Sulfur",     unit: "%", type: "number", default: 0.035 },
      { key: "Si", label: "Silicon",   unit: "%", type: "number", default: 0.18 },
      { key: "Cr", label: "Chromium",  unit: "%", type: "number", default: 0.05 },
      { key: "Mo", label: "Molybdenum",unit: "%", type: "number", default: 0.01 },
      { key: "V", label: "Vanadium",   unit: "%", type: "number", default: 0.01 },
      { key: "Ni", label: "Nickel",    unit: "%", type: "number", default: 0.05 },
      { key: "Cu", label: "Copper",    unit: "%", type: "number", default: 0.10 },
      { key: "grade", label: "Grade", type: "select", default: "60",
        options: [{ value: "40", label: "Grade 40" }, { value: "60", label: "Grade 60" }, { value: "75", label: "Grade 75" }, { value: "80", label: "Grade 80" }] },
    ]}],
    results: [
      { label: "Carbon equivalent (IIW)", unit: "%", decimals: 3, compute: (v) => carbonEquivalent({
        C: num(v, "C"), Mn: num(v, "Mn"), Cr: num(v, "Cr"), Mo: num(v, "Mo"),
        V: num(v, "V"), Ni: num(v, "Ni"), Cu: num(v, "Cu"),
      }) },
      { label: "Weldability", compute: (v) => {
        const ce = carbonEquivalent({
          C: num(v, "C"), Mn: num(v, "Mn"), Cr: num(v, "Cr"), Mo: num(v, "Mo"),
          V: num(v, "V"), Ni: num(v, "Ni"), Cu: num(v, "Cu"),
        });
        return ce <= 0.40 ? "Excellent" : ce <= 0.50 ? "Good" : ce <= 0.55 ? "Fair (preheat)" : "Difficult";
      }},
    ],
    passRules: [
      { label: "P ≤ 0.06%", ok: (v) => num(v, "P") <= 0.06 },
      { label: "S ≤ 0.06%", ok: (v) => num(v, "S") <= 0.06 },
      { label: "C ≤ grade limit", ok: (v) => num(v, "C") <= (v.grade === "75" ? 0.35 : 0.30) },
    ],
  },

  E6: {
    code: "E6", name: "Mechanical Coupler Test", standard: "ACI 318 / ICC-ES AC133", category: "steel",
    description: "Type 2 mechanical splice strength.",
    sections: [{ title: "Inputs", fields: [
      { key: "splice_load", label: "Splice ultimate load", unit: "kN", type: "number", default: 240 },
      { key: "bar_load", label: "Bar ultimate load (control)", unit: "kN", type: "number", default: 215 },
    ]}],
    results: [{ label: "Splice/Bar ratio", decimals: 2, compute: (v) => num(v, "splice_load") / num(v, "bar_load") }],
    passRules: [{ label: "Splice develops ≥ 100% of bar tensile (Type 2)", ok: (v) => num(v, "splice_load") >= num(v, "bar_load") }],
  },

  E7: {
    code: "E7", name: "Weight per Meter", standard: "SASO SSA 2", category: "steel",
    description: "Mass tolerance check.",
    sections: [{ title: "Inputs", fields: [
      { key: "d", label: "Bar diameter", unit: "mm", type: "number", default: 20 },
      { key: "actual", label: "Measured kg/m", unit: "kg/m", type: "number", default: 2.45 },
    ]}],
    results: [
      { label: "Nominal kg/m", decimals: 3, compute: (v) => 0.006165 * num(v, "d") ** 2 },
      { label: "Deviation", unit: "%", decimals: 2, compute: (v) =>
        ((num(v, "actual") - 0.006165 * num(v, "d") ** 2) / (0.006165 * num(v, "d") ** 2)) * 100 },
    ],
    passRules: [{ label: "Within ±4.5% (SASO)", ok: (v) => {
      const dev = ((num(v, "actual") - 0.006165 * num(v, "d") ** 2) / (0.006165 * num(v, "d") ** 2)) * 100;
      return Math.abs(dev) <= 4.5;
    }}],
  },

  // ---------- CEMENT ----------
  F1: {
    code: "F1", name: "Fineness (Blaine)", standard: "ASTM C204 / SASO SSA 1", category: "cement", saudiSpecific: true,
    description: "Specific surface from Blaine permeability time. S = K · √ρ · √t (apparatus constant calibrated to m²/kg).",
    sections: [{ title: "Inputs", fields: [
      { key: "k", label: "Apparatus constant K", type: "number", default: 21.5,
        help: "Calibrated against NIST 114 reference cement so the formula returns m²/kg directly." },
      { key: "rho", label: "Cement density", unit: "g/cm³", type: "number", default: 3.15 },
      { key: "t", label: "Air-flow time", unit: "s", type: "number", default: 78 },
      { key: "cement_type", label: "Cement type", type: "select", default: "OPC",
        options: [{ value: "OPC", label: "Ordinary Portland (≥ 280)" }, { value: "SRC", label: "Sulfate-resistant (≥ 300)" }] },
    ]}],
    results: [{ label: "Specific surface", unit: "m²/kg", decimals: 0, compute: (v) =>
      num(v, "k") * Math.sqrt(num(v, "rho")) * Math.sqrt(num(v, "t")) }],
    passRules: [{ label: "Above SASO SSA 1 limit for cement type", ok: (v) => {
      const s = num(v, "k") * Math.sqrt(num(v, "rho")) * Math.sqrt(num(v, "t"));
      return s >= (v.cement_type === "SRC" ? 300 : 280);
    }}],
  },

  F2: {
    code: "F2", name: "Normal Consistency", standard: "ASTM C187", category: "cement",
    description: "Water for standard paste. Vicat plunger penetration must equal 10 ± 1 mm from the bottom.",
    sections: [{ title: "Inputs", fields: [
      { key: "cement", label: "Cement mass", unit: "g", type: "number", default: 650 },
      { key: "water", label: "Water added", unit: "mL", type: "number", default: 175 },
      { key: "penetration", label: "Vicat plunger penetration", unit: "mm", type: "number", default: 10,
        help: "Standard paste reaches normal consistency when penetration is 10 ± 1 mm." },
    ]}],
    results: [
      { label: "Water requirement", unit: "%", decimals: 1, compute: (v) => (num(v, "water") / num(v, "cement")) * 100 },
      { label: "Penetration result", compute: (v) => {
        const p = num(v, "penetration");
        return p >= 9 && p <= 11 ? "At normal consistency" : p < 9 ? "Too dry — add water" : "Too wet — reduce water";
      }},
    ],
    passRules: [
      { label: "Penetration 10 ± 1 mm", ok: (v) => {
        const p = num(v, "penetration");
        return p >= 9 && p <= 11;
      }},
    ],
  },

  F3: {
    code: "F3", name: "Initial & Final Set Time", standard: "ASTM C191", category: "cement", saudiSpecific: true,
    description: "Vicat needle. Initial ≥ 45 min.",
    sections: [{ title: "Inputs", fields: [
      { key: "initial", label: "Initial set", unit: "min", type: "number", default: 110 },
      { key: "final", label: "Final set", unit: "min", type: "number", default: 240 },
    ]}],
    results: [
      { label: "Initial set", unit: "min", decimals: 0, compute: (v) => num(v, "initial") },
      { label: "Final set", unit: "min", decimals: 0, compute: (v) => num(v, "final") },
    ],
    passRules: [
      { label: "Initial ≥ 45 min", ok: (v) => num(v, "initial") >= 45 },
      { label: "Final ≤ 375 min", ok: (v) => num(v, "final") <= 375 },
    ],
  },

  F4: {
    code: "F4", name: "Mortar Cube Compressive Strength", standard: "ASTM C109 / SASO SSA 1", category: "cement", saudiSpecific: true,
    description: "50 mm cubes at 3, 7, 28 days.",
    sections: [{ title: "Inputs", fields: [
      { key: "size", label: "Cube size", unit: "mm", type: "number", default: 50 },
      { key: "load", label: "Max load", unit: "kN", type: "number", default: 75 },
      { key: "age", label: "Age", unit: "days", type: "number", default: 28 },
    ]}],
    results: [{ label: "Strength", unit: "MPa", decimals: 1, compute: (v) =>
      (num(v, "load") * 1000) / num(v, "size") ** 2 }],
    passRules: [{ label: "≥ SASO SSA 1 minimum for age", ok: (v) => {
      const fc = (num(v, "load") * 1000) / num(v, "size") ** 2;
      const limits: Record<number, number> = { 3: 12, 7: 19, 28: 28 };
      return fc >= (limits[num(v, "age")] ?? 0);
    }}],
  },

  F5: {
    code: "F5", name: "Soundness (Le Chatelier)", standard: "ASTM C151", category: "cement",
    description: "Expansion ≤ 10 mm.",
    sections: [{ title: "Inputs", fields: [
      { key: "initial", label: "Initial distance", unit: "mm", type: "number", default: 14 },
      { key: "final", label: "Final after boiling", unit: "mm", type: "number", default: 18 },
    ]}],
    results: [{ label: "Expansion", unit: "mm", decimals: 1, compute: (v) => num(v, "final") - num(v, "initial") }],
    passRules: [{ label: "Expansion ≤ 10 mm", ok: (v) => num(v, "final") - num(v, "initial") <= 10 }],
  },

  F6: {
    code: "F6", name: "Autoclave Expansion", standard: "ASTM C151", category: "cement",
    description: "Severe soundness check.",
    sections: [{ title: "Inputs", fields: [
      { key: "initial", label: "Initial length", unit: "mm", type: "number", default: 250 },
      { key: "final", label: "Final length", unit: "mm", type: "number", default: 250.4 },
    ]}],
    results: [{ label: "Expansion", unit: "%", decimals: 3, compute: (v) =>
      ((num(v, "final") - num(v, "initial")) / num(v, "initial")) * 100 }],
    passRules: [{ label: "≤ 0.80%", ok: (v) =>
      ((num(v, "final") - num(v, "initial")) / num(v, "initial")) * 100 <= 0.80 }],
  },

  F7: {
    code: "F7", name: "Air Content (Mortar)", standard: "ASTM C185", category: "cement",
    description: "Air content of mortar.",
    sections: [{ title: "Inputs", fields: [
      { key: "actual", label: "Mortar mass", unit: "g", type: "number", default: 1850 },
      { key: "theoretical", label: "Theoretical air-free mass", unit: "g", type: "number", default: 1965 },
    ]}],
    results: [{ label: "Air content", unit: "%", decimals: 2, compute: (v) =>
      ((num(v, "theoretical") - num(v, "actual")) / num(v, "theoretical")) * 100 }],
    passRules: [],
  },

  F8: {
    code: "F8", name: "Cement Density", standard: "ASTM C188", category: "cement",
    description: "3.00–3.20 g/cm³ (OPC).",
    sections: [{ title: "Inputs", fields: [
      { key: "mass", label: "Cement mass", unit: "g", type: "number", default: 64 },
      { key: "vol", label: "Displaced volume", unit: "mL", type: "number", default: 20.5 },
    ]}],
    results: [{ label: "Density", unit: "g/cm³", decimals: 3, compute: (v) => num(v, "mass") / num(v, "vol") }],
    passRules: [{ label: "3.00–3.20 g/cm³", ok: (v) => {
      const d = num(v, "mass") / num(v, "vol");
      return d >= 3.0 && d <= 3.2;
    }}],
  },

  F9: {
    code: "F9", name: "Heat of Hydration", standard: "ASTM C186", category: "cement", saudiSpecific: true,
    description: "Mass concrete. ≤ 250 J/g @ 7d.",
    sections: [{ title: "Inputs", fields: [
      { key: "k", label: "Calorimeter constant", type: "number", default: 25 },
      { key: "deltaT", label: "Temperature rise", unit: "°C", type: "number", default: 7.5 },
      { key: "cement", label: "Cement mass", unit: "g", type: "number", default: 1.0 },
      { key: "age", label: "Age", unit: "days", type: "number", default: 7 },
    ]}],
    results: [{ label: "Heat of hydration", unit: "J/g", decimals: 0, compute: (v) =>
      (num(v, "k") * num(v, "deltaT")) / num(v, "cement") }],
    passRules: [{ label: "Within SSA 1 low-heat limit", ok: (v) => {
      const h = (num(v, "k") * num(v, "deltaT")) / num(v, "cement");
      return num(v, "age") === 7 ? h <= 250 : h <= 290;
    }}],
  },

  // ---------- MASONRY ----------
  G1: {
    code: "G1", name: "Compressive Strength (Blocks)", standard: "ASTM C140", category: "masonry",
    description: "Hollow / solid / cellular blocks.",
    sections: [{ title: "Inputs", fields: [
      { key: "load", label: "Max load", unit: "kN", type: "number", default: 290 },
      { key: "net_area", label: "Net bearing area", unit: "mm²", type: "number", default: 38000 },
      { key: "type", label: "Block type", type: "select", default: "hollow_a",
        options: [{ value: "solid", label: "Solid" }, { value: "hollow_a", label: "Hollow A" }, { value: "hollow_b", label: "Hollow B" }] },
    ]}],
    results: [{ label: "Compressive strength", unit: "MPa", decimals: 2, compute: (v) =>
      (num(v, "load") * 1000) / num(v, "net_area") }],
    passRules: [{ label: "≥ grade minimum", ok: (v) => {
      const fc = (num(v, "load") * 1000) / num(v, "net_area");
      return fc >= (v.type === "solid" ? 7 : v.type === "hollow_a" ? 5 : 3.5);
    }}],
  },

  G2: {
    code: "G2", name: "Block Absorption", standard: "ASTM C140", category: "masonry",
    description: "Water absorption.",
    sections: [{ title: "Inputs", fields: [
      { key: "od", label: "Oven-dry mass", unit: "kg", type: "number", default: 12.4 },
      { key: "ssd", label: "SSD mass", unit: "kg", type: "number", default: 13.4 },
    ]}],
    results: [{ label: "Absorption", unit: "%", decimals: 2, compute: (v) =>
      ((num(v, "ssd") - num(v, "od")) / num(v, "od")) * 100 }],
    passRules: [{ label: "≤ 10%", ok: (v) => ((num(v, "ssd") - num(v, "od")) / num(v, "od")) * 100 <= 10 }],
  },

  G3: {
    code: "G3", name: "Block Moisture Content", standard: "ASTM C140", category: "masonry",
    description: "At delivery.",
    sections: [{ title: "Inputs", fields: [
      { key: "wet", label: "Wet mass", unit: "kg", type: "number", default: 12.7 },
      { key: "od", label: "Oven-dry mass", unit: "kg", type: "number", default: 12.4 },
    ]}],
    results: [{ label: "Moisture", unit: "%", decimals: 2, compute: (v) =>
      ((num(v, "wet") - num(v, "od")) / num(v, "od")) * 100 }],
    passRules: [],
  },

  G4: {
    code: "G4", name: "Unit Weight", standard: "ASTM C140", category: "masonry",
    description: "Density of block units.",
    sections: [{ title: "Inputs", fields: [
      { key: "mass", label: "Block mass", unit: "kg", type: "number", default: 12.4 },
      { key: "vol", label: "Volume", unit: "m³", type: "number", default: 0.0066 },
    ]}],
    results: [{ label: "Unit weight", unit: "kg/m³", decimals: 0, compute: (v) => num(v, "mass") / num(v, "vol") }],
    passRules: [],
  },

  G5: {
    code: "G5", name: "Mortar Compressive Strength", standard: "ASTM C109", category: "masonry",
    description: "Type M/S/N/O.",
    sections: [{ title: "Inputs", fields: [
      { key: "load", label: "Max load (kN)", type: "number", default: 50 },
      { key: "type", label: "Mortar type", type: "select", default: "S",
        options: [{ value: "M", label: "M" }, { value: "S", label: "S" }, { value: "N", label: "N" }, { value: "O", label: "O" }] },
    ]}],
    results: [{ label: "Strength", unit: "MPa", decimals: 1, compute: (v) => (num(v, "load") * 1000) / 2500 }],
    passRules: [{ label: "≥ 28-day type minimum", ok: (v) => {
      const fc = (num(v, "load") * 1000) / 2500;
      const limits: Record<string, number> = { M: 17.2, S: 12.4, N: 5.2, O: 2.4 };
      return fc >= limits[String(v.type)]!;
    }}],
  },

  G6: {
    code: "G6", name: "Grout Compressive Strength", standard: "ASTM C1019", category: "masonry",
    description: "Grout for masonry.",
    sections: [{ title: "Inputs", fields: [
      { key: "load", label: "Max load", unit: "kN", type: "number", default: 145 },
      { key: "area", label: "Bearing area", unit: "mm²", type: "number", default: 10000 },
      { key: "fm", label: "Specified f'm", unit: "MPa", type: "number", default: 12 },
    ]}],
    results: [{ label: "Grout strength", unit: "MPa", decimals: 1, compute: (v) => (num(v, "load") * 1000) / num(v, "area") }],
    passRules: [{ label: "≥ specified f'm", ok: (v) => (num(v, "load") * 1000) / num(v, "area") >= num(v, "fm") }],
  },

  G7: {
    code: "G7", name: "Prism Test", standard: "ASTM C1314", category: "masonry",
    description: "Block + mortar assemblage.",
    sections: [{ title: "Inputs", fields: [
      { key: "load", label: "Max load", unit: "kN", type: "number", default: 380 },
      { key: "area", label: "Net area", unit: "mm²", type: "number", default: 38000 },
      { key: "fm_des", label: "Design f'm", unit: "MPa", type: "number", default: 8 },
    ]}],
    results: [{ label: "f'm", unit: "MPa", decimals: 1, compute: (v) => (num(v, "load") * 1000) / num(v, "area") }],
    passRules: [{ label: "≥ design f'm", ok: (v) => (num(v, "load") * 1000) / num(v, "area") >= num(v, "fm_des") }],
  },

  // ---------- WATER (the rest) ----------
  H2: {
    code: "H2", name: "Concrete Mixing Water", standard: "ASTM C1602 / SBC 304", category: "water", saudiSpecific: true,
    description: "Cl, SO₄, TDS, organics for mixing.",
    sections: [{ title: "Parameters", fields: [
      { key: "ph", label: "pH", type: "number", default: 7.4 },
      { key: "cl", label: "Chloride", unit: "mg/L", type: "number", default: 380 },
      { key: "so4", label: "Sulfate", unit: "mg/L", type: "number", default: 1100 },
      { key: "tds", label: "TDS", unit: "mg/L", type: "number", default: 2200 },
      { key: "tss", label: "TSS", unit: "mg/L", type: "number", default: 250 },
      { key: "organics", label: "Organics (COD)", unit: "mg/L", type: "number", default: 80 },
    ]}],
    results: [
      { label: "Suitable for concrete", compute: (v) =>
        num(v, "ph") >= 6.0 && num(v, "cl") <= 500 && num(v, "so4") <= 3000 && num(v, "tds") <= 50000 && num(v, "organics") <= 3000
          ? "Yes" : "No" },
    ],
    passRules: [
      { label: "pH ≥ 6.0", ok: (v) => num(v, "ph") >= 6.0 },
      { label: "Chloride ≤ 500 mg/L", ok: (v) => num(v, "cl") <= 500 },
      { label: "Sulfate ≤ 3000 mg/L", ok: (v) => num(v, "so4") <= 3000 },
      { label: "TDS ≤ 50000 mg/L", ok: (v) => num(v, "tds") <= 50000 },
      { label: "Organics ≤ 3000 mg/L", ok: (v) => num(v, "organics") <= 3000 },
    ],
  },

  H3: {
    code: "H3", name: "Wastewater Effluent", standard: "GSO 1914", category: "water", saudiSpecific: true,
    description: "BOD, COD, TSS for discharge compliance.",
    sections: [{ title: "Parameters", fields: [
      { key: "ph", label: "pH", type: "number", default: 7.6 },
      { key: "bod", label: "BOD₅", unit: "mg/L", type: "number", default: 22 },
      { key: "cod", label: "COD", unit: "mg/L", type: "number", default: 110 },
      { key: "tss", label: "TSS", unit: "mg/L", type: "number", default: 38 },
      { key: "og", label: "Oil & grease", unit: "mg/L", type: "number", default: 8 },
      { key: "fc", label: "Fecal coliform", unit: "MPN/100mL", type: "number", default: 600 },
    ]}],
    results: [],
    passRules: [
      { label: "pH 6.0–9.0", ok: (v) => num(v, "ph") >= 6 && num(v, "ph") <= 9 },
      { label: "BOD₅ ≤ 30 mg/L", ok: (v) => num(v, "bod") <= 30 },
      { label: "COD ≤ 150 mg/L", ok: (v) => num(v, "cod") <= 150 },
      { label: "TSS ≤ 60 mg/L", ok: (v) => num(v, "tss") <= 60 },
      { label: "Oil & grease ≤ 15 mg/L", ok: (v) => num(v, "og") <= 15 },
      { label: "Fecal coliform ≤ 1000", ok: (v) => num(v, "fc") <= 1000 },
    ],
  },

  H4: {
    code: "H4", name: "Groundwater Monitoring", standard: "MEWA Guidelines", category: "water",
    description: "Dewatering quality.",
    sections: [{ title: "Parameters", fields: [
      { key: "ph", label: "pH", type: "number", default: 7.2 },
      { key: "tds", label: "TDS", unit: "mg/L", type: "number", default: 3500 },
      { key: "cl", label: "Chloride", unit: "mg/L", type: "number", default: 800 },
      { key: "so4", label: "Sulfate", unit: "mg/L", type: "number", default: 1200 },
    ]}],
    results: [{ label: "Classification", compute: (v) => num(v, "tds") < 1000 ? "Fresh" : num(v, "tds") < 10000 ? "Brackish" : "Saline" }],
    passRules: [{ label: "Below MEWA permit limits", ok: (v) => num(v, "tds") < 5000 }],
  },

  H5: {
    code: "H5", name: "Recreational Water", standard: "SASO 1494 App.", category: "water",
    description: "Pool / camp facility water.",
    sections: [{ title: "Parameters", fields: [
      { key: "free_cl", label: "Free chlorine", unit: "mg/L", type: "number", default: 1.8 },
      { key: "comb_cl", label: "Combined chlorine", unit: "mg/L", type: "number", default: 0.3 },
      { key: "ph", label: "pH", type: "number", default: 7.5 },
      { key: "alk", label: "Total alkalinity", unit: "mg/L", type: "number", default: 95 },
      { key: "cya", label: "Cyanuric acid", unit: "mg/L", type: "number", default: 32 },
      { key: "turb", label: "Turbidity", unit: "NTU", type: "number", default: 0.4 },
    ]}],
    results: [],
    passRules: [
      { label: "Free Cl 1.0–3.0", ok: (v) => num(v, "free_cl") >= 1 && num(v, "free_cl") <= 3 },
      { label: "Combined Cl < 0.5", ok: (v) => num(v, "comb_cl") < 0.5 },
      { label: "pH 7.2–7.8", ok: (v) => num(v, "ph") >= 7.2 && num(v, "ph") <= 7.8 },
      { label: "Alkalinity 80–120", ok: (v) => num(v, "alk") >= 80 && num(v, "alk") <= 120 },
      { label: "Cyanuric < 50", ok: (v) => num(v, "cya") < 50 },
      { label: "Turbidity < 1.0 NTU", ok: (v) => num(v, "turb") < 1 },
    ],
  },

  H6: {
    code: "H6", name: "Cooling Tower Water", standard: "ASHRAE", category: "water",
    description: "Includes Legionella check.",
    sections: [{ title: "Parameters", fields: [
      { key: "cond", label: "Conductivity", unit: "µS/cm", type: "number", default: 1200 },
      { key: "hard", label: "Hardness", unit: "mg/L", type: "number", default: 280 },
      { key: "silica", label: "Silica", unit: "mg/L", type: "number", default: 60 },
      { key: "iron", label: "Iron", unit: "mg/L", type: "number", default: 0.2 },
      { key: "bacteria", label: "Bacteria", unit: "CFU/mL", type: "number", default: 8000 },
      { key: "legionella", label: "Legionella", type: "select", default: "negative",
        options: [{ value: "negative", label: "Negative" }, { value: "positive", label: "Positive" }] },
    ]}],
    results: [],
    passRules: [
      { label: "Legionella negative", ok: (v) => v.legionella === "negative" },
      { label: "Bacteria < 100,000 CFU/mL", ok: (v) => num(v, "bacteria") < 100000 },
    ],
  },

  H7: {
    code: "H7", name: "Irrigation Water", standard: "FAO / MEWA", category: "water",
    description: "EC, SAR, salinity hazard.",
    sections: [{ title: "Parameters", fields: [
      { key: "ec", label: "EC", unit: "dS/m", type: "number", default: 1.6 },
      { key: "sar", label: "SAR", type: "number", default: 6 },
      { key: "cl", label: "Chloride", unit: "mg/L", type: "number", default: 280 },
      { key: "b", label: "Boron", unit: "mg/L", type: "number", default: 0.6 },
    ]}],
    results: [
      { label: "Salinity hazard", compute: (v) => num(v, "ec") < 0.7 ? "None" : num(v, "ec") < 3 ? "Slight–Moderate" : "Severe" },
      { label: "Sodium hazard", compute: (v) => num(v, "sar") < 10 ? "Low" : num(v, "sar") < 18 ? "Medium" : num(v, "sar") < 26 ? "High" : "Very high" },
    ],
    passRules: [{ label: "Suitable for irrigation", ok: (v) => num(v, "ec") < 3 && num(v, "sar") < 18 }],
  },

  H8: {
    code: "H8", name: "Construction Dewatering Water", standard: "GSO 1914", category: "water",
    description: "Pumped excavation water.",
    sections: [{ title: "Parameters", fields: [
      { key: "ph", label: "pH", type: "number", default: 7.5 },
      { key: "tss", label: "TSS", unit: "mg/L", type: "number", default: 45 },
      { key: "og", label: "Oil & grease", unit: "mg/L", type: "number", default: 3 },
      { key: "sediment", label: "Sediment", unit: "mg/L", type: "number", default: 80 },
    ]}],
    results: [],
    passRules: [
      { label: "pH 6–9", ok: (v) => num(v, "ph") >= 6 && num(v, "ph") <= 9 },
      { label: "TSS ≤ 60 mg/L", ok: (v) => num(v, "tss") <= 60 },
      { label: "Oil & grease ≤ 15 mg/L", ok: (v) => num(v, "og") <= 15 },
    ],
  },

  H9: {
    code: "H9", name: "Bottled Water Quality", standard: "SASO 1494", category: "water",
    description: "Bottled drinking water.",
    sections: [{ title: "Parameters", fields: [
      { key: "ph", label: "pH", type: "number", default: 7.4 },
      { key: "tds", label: "TDS", unit: "mg/L", type: "number", default: 220 },
      { key: "coliform", label: "Total coliform", unit: "MPN/100mL", type: "number", default: 0 },
    ]}],
    results: [],
    passRules: [
      { label: "pH 6.5–8.5", ok: (v) => num(v, "ph") >= 6.5 && num(v, "ph") <= 8.5 },
      { label: "TDS ≤ 1000 mg/L", ok: (v) => num(v, "tds") <= 1000 },
      { label: "Coliform = 0", ok: (v) => num(v, "coliform") === 0 },
    ],
  },

  H10: {
    code: "H10", name: "Seawater Analysis", standard: "ASTM C114 / SBC 304", category: "water", saudiSpecific: true,
    description: "Marine concrete applications.",
    sections: [{ title: "Parameters", fields: [
      { key: "salinity", label: "Salinity", unit: "PSU", type: "number", default: 39 },
      { key: "cl", label: "Chloride", unit: "mg/L", type: "number", default: 21000 },
      { key: "so4", label: "Sulfate", unit: "mg/L", type: "number", default: 2900 },
      { key: "ph", label: "pH", type: "number", default: 8.1 },
      { key: "concrete_use", label: "Concrete application", type: "select", default: "plain",
        options: [{ value: "plain", label: "Plain" }, { value: "reinforced", label: "Reinforced" }, { value: "prestressed", label: "Prestressed" }] },
    ]}],
    results: [{ label: "Suitability", compute: (v) =>
      v.concrete_use === "plain" ? "Acceptable with SRC" : v.concrete_use === "reinforced" ? "Protective measures required" : "Special approval required" }],
    passRules: [{ label: "Plain concrete only (SBC 304)", ok: (v) => v.concrete_use === "plain" }],
  },
};
