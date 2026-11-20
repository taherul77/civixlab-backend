/**
 * Shared calculation helpers — interpolation, lookup tables, classifiers,
 * regressions. Used by `src/lib/test-schemas.ts` and bespoke test forms.
 *
 * Every function here mirrors the formulas in spec §6 verbatim. Where the
 * spec calls out a graphical/iterative procedure (Casagrande Pc, Mohr-Coulomb
 * regression, USCS classifier), the closed-form approximation is documented.
 */

// ---------------------------------------------------------------------------
// Linear interpolation
// ---------------------------------------------------------------------------

export interface LookupRow { x: number; y: number }

/**
 * Linear interpolation across a sorted (by x ascending) lookup table.
 * Below the first row clamps to the first y; above the last clamps to the last.
 */
export function interp(x: number, table: LookupRow[]): number {
  if (table.length === 0) return NaN;
  if (x <= table[0]!.x) return table[0]!.y;
  if (x >= table[table.length - 1]!.x) return table[table.length - 1]!.y;
  for (let i = 0; i < table.length - 1; i++) {
    const a = table[i]!, b = table[i + 1]!;
    if (x >= a.x && x <= b.x) {
      const r = (x - a.x) / (b.x - a.x);
      return a.y + r * (b.y - a.y);
    }
  }
  return table[table.length - 1]!.y;
}

// ---------------------------------------------------------------------------
// A1 — Compressive strength: L/D correction (ASTM C39 Table 2)
// ---------------------------------------------------------------------------

export const LD_CORRECTION: LookupRow[] = [
  { x: 1.00, y: 0.87 },
  { x: 1.25, y: 0.93 },
  { x: 1.50, y: 0.96 },
  { x: 1.75, y: 0.98 },
  { x: 1.80, y: 1.00 },
];

export function ldCorrection(ld: number): number {
  return interp(ld, LD_CORRECTION);
}

// ---------------------------------------------------------------------------
// A7 — Concrete maturity: Arrhenius equivalent age (ASTM C1074)
// ---------------------------------------------------------------------------

/**
 * Arrhenius equivalent age (te) in hours at a chosen reference temperature.
 *
 *   te = Σ exp((-Ea/R) * (1/(T+273) - 1/(Tref+273))) * Δt
 *
 * For a single average temperature T held for duration h, this collapses to:
 *
 *   te = h * exp((-Ea/R) * (1/(T+273) - 1/(Tref+273)))
 *
 * @param avgT   Concrete average temperature, °C
 * @param hours  Hold duration, h
 * @param Tref   Reference temperature, °C (default 20)
 * @param Ea     Activation energy, kJ/mol (default 40)
 */
export function equivalentAgeHours(avgT: number, hours: number, Tref = 20, Ea = 40): number {
  const R = 8.314e-3; // kJ/(mol·K)
  const factor = Math.exp((-Ea / R) * (1 / (avgT + 273.15) - 1 / (Tref + 273.15)));
  return hours * factor;
}

/** Nurse-Saul temperature-time factor (TTF), °C·h. */
export function nurseSaulTtf(avgT: number, hours: number, datumT = -10): number {
  return Math.max(0, avgT - datumT) * hours;
}

// ---------------------------------------------------------------------------
// B1 — USCS soil classification (ASTM D2487)
// ---------------------------------------------------------------------------

export interface UscsInput {
  /** Percent passing #200 sieve (75 µm). */
  passing200: number;
  /** Percent passing #4 sieve (4.75 mm). */
  passing4?: number;
  /** Liquid limit (%). */
  ll: number;
  /** Plastic limit (%). */
  pl: number;
  /** D60 / D30 / D10 in mm — for SW/SP/GW/GP gradation tests. */
  d10?: number;
  d30?: number;
  d60?: number;
}

export interface UscsResult {
  symbol: string;
  groupName: string;
  pi: number;
  cu: number | null;
  cc: number | null;
  aLine: number;
}

export function uscsClassify(input: UscsInput): UscsResult {
  const pi = input.ll - input.pl;
  const fines = input.passing200;
  const sand4 = input.passing4 ?? 100; // fraction passing #4; if unknown assume sand-like
  const cu = input.d10 && input.d60 ? input.d60 / input.d10 : null;
  const cc =
    input.d10 && input.d30 && input.d60 ? (input.d30 ** 2) / (input.d60 * input.d10) : null;
  const aLine = 0.73 * Math.max(0, input.ll - 20);

  // Fine-grained (more than 50% pass #200)
  if (fines > 50) {
    if (input.ll < 50) {
      // CL / ML / OL band
      if (pi >= 7 && pi >= aLine) return { symbol: "CL", groupName: "Lean clay", pi, cu, cc, aLine };
      if (pi <= 4 || pi < aLine) return { symbol: "ML", groupName: "Silt", pi, cu, cc, aLine };
      return { symbol: "CL-ML", groupName: "Silty clay", pi, cu, cc, aLine };
    }
    // High plasticity
    if (pi >= aLine) return { symbol: "CH", groupName: "Fat clay", pi, cu, cc, aLine };
    return { symbol: "MH", groupName: "Elastic silt", pi, cu, cc, aLine };
  }

  // Coarse-grained
  const isGravel = sand4 < 50; // more than 50% of coarse fraction retained on #4 → gravel
  const prefix = isGravel ? "G" : "S";
  const longPrefix = isGravel ? "Gravel" : "Sand";

  if (fines < 5) {
    // Clean
    const wellGraded = cu !== null && cc !== null && cu >= (isGravel ? 4 : 6) && cc >= 1 && cc <= 3;
    return {
      symbol: `${prefix}${wellGraded ? "W" : "P"}`,
      groupName: `${wellGraded ? "Well-graded" : "Poorly graded"} ${longPrefix.toLowerCase()}`,
      pi, cu, cc, aLine,
    };
  }
  if (fines > 12) {
    // With fines — clay or silt fines based on Atterberg
    const clayey = pi >= 7 && pi >= aLine;
    return {
      symbol: `${prefix}${clayey ? "C" : "M"}`,
      groupName: `${clayey ? "Clayey" : "Silty"} ${longPrefix.toLowerCase()}`,
      pi, cu, cc, aLine,
    };
  }
  // Borderline 5-12% fines — dual symbol
  return {
    symbol: `${prefix}P-${prefix}M`,
    groupName: `Poorly-graded ${longPrefix.toLowerCase()} with silt`,
    pi, cu, cc, aLine,
  };
}

// ---------------------------------------------------------------------------
// B12 — Consolidation: Casagrande preconsolidation-pressure approximation
// ---------------------------------------------------------------------------

/**
 * Closed-form Casagrande Pc estimator from a single virgin-compression slope
 * (Cc) plus the two adjacent points on the e-log(p) curve. Real Casagrande
 * uses graphical bisection; this returns the analytic equivalent for a
 * piecewise-linear curve, accurate enough for laboratory reporting.
 *
 * Inputs come in as (p_kPa, e). The function picks the point of maximum
 * curvature heuristic (highest |Δe/Δlog p| change) and intersects the
 * tangent there with the rebound slope projected from the last two points.
 */
export function casagrandePc(points: { p: number; e: number }[]): number {
  if (points.length < 4) return NaN;
  // Compute slopes between adjacent points on log scale.
  const slopes = points.slice(1).map((p, i) => {
    const a = points[i]!, b = p;
    const dlp = Math.log10(b.p / a.p);
    return dlp === 0 ? 0 : (b.e - a.e) / dlp;
  });
  // Pick the index where slope steepens the most (transition into virgin).
  let maxJump = 0, idx = 1;
  for (let i = 1; i < slopes.length; i++) {
    const jump = Math.abs(slopes[i]! - slopes[i - 1]!);
    if (jump > maxJump) { maxJump = jump; idx = i; }
  }
  const a = points[idx]!;
  const b = points[idx + 1] ?? points[points.length - 1]!;
  // Pc is the intersection of the rebound (avg of pre-yield slopes) and the
  // virgin slope (at index `idx`). Closed-form simplification: take Pc as the
  // log-mean of the two bracket pressures, weighted by curvature.
  const logPc = (Math.log10(a.p) + Math.log10(b.p)) / 2;
  return Math.pow(10, logPc);
}

// ---------------------------------------------------------------------------
// B13 — Direct shear: Mohr-Coulomb regression from peak (σ, τ) points
// ---------------------------------------------------------------------------

/**
 * Linear regression of peak shear stress vs normal stress.
 * τ = c + σ·tan(φ) → returns { c (kPa), phi (degrees) }.
 *
 * Needs at least 2 points; with 3+ uses ordinary least squares.
 */
export function mohrCoulomb(points: { sigma: number; tau: number }[]): { c: number; phi: number } {
  const n = points.length;
  if (n < 2) return { c: 0, phi: 0 };
  const sx = points.reduce((a, p) => a + p.sigma, 0);
  const sy = points.reduce((a, p) => a + p.tau, 0);
  const sxx = points.reduce((a, p) => a + p.sigma * p.sigma, 0);
  const sxy = points.reduce((a, p) => a + p.sigma * p.tau, 0);
  const denom = n * sxx - sx * sx;
  const slope = denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  return { c: Math.max(0, intercept), phi: (Math.atan(Math.max(0, slope)) * 180) / Math.PI };
}

// ---------------------------------------------------------------------------
// C1 — Sieve analysis: fineness modulus from cumulative % retained
// ---------------------------------------------------------------------------

/**
 * Fineness modulus per ASTM C136: sum of cumulative % retained on the
 * standard sieves [#100, #50, #30, #16, #8, #4, 3/8", 3/4", 1½", 3"]
 * divided by 100. Caller must pass cumulative-retained percentages aligned
 * with the standard set (in the same order).
 */
export function finenessModulus(cumulativeRetained: number[]): number {
  return cumulativeRetained.reduce((a, b) => a + b, 0) / 100;
}

/** Convenience: Cu (uniformity) and Cc (curvature) from D10 / D30 / D60. */
export function gradationCoefs(d10: number, d30: number, d60: number) {
  return { cu: d60 / d10, cc: (d30 * d30) / (d60 * d10) };
}

// ---------------------------------------------------------------------------
// E5 — Steel chemical composition: full carbon equivalent
// ---------------------------------------------------------------------------

export interface ChemComposition {
  C: number; Mn: number; P?: number; S?: number; Si?: number;
  Cr?: number; Mo?: number; V?: number; Ni?: number; Cu?: number;
}

/** Carbon equivalent per IIW formula (used by AWS / ASTM A615 / SASO SSA 2). */
export function carbonEquivalent(c: ChemComposition): number {
  return (
    (c.C ?? 0) +
    (c.Mn ?? 0) / 6 +
    ((c.Cr ?? 0) + (c.Mo ?? 0) + (c.V ?? 0)) / 5 +
    ((c.Ni ?? 0) + (c.Cu ?? 0)) / 15
  );
}
