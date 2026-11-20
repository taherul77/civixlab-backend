import crypto from "node:crypto";

/** Deterministic JSON: object keys sorted, undefined dropped. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

export const SEAL_ALGORITHM = "SHA-256";

/** Integrity seal over the report's content. NOT a PKI signature: it proves the
 *  content is unchanged since issue, not who produced it. */
export function sealOf(content: unknown): string {
  return crypto.createHash("sha256").update(canonicalJson(content), "utf8").digest("hex");
}

// Crockford-style base32 without I, L, O, U: no look-alike characters.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** RPT-2026-K7M2QX4H: unguessable (40 bits of randomness) and short enough to type. */
export function generateReportNumber(now = new Date(), random: (n: number) => Buffer = crypto.randomBytes): string {
  const bytes = random(8);
  let id = "";
  for (let i = 0; i < 8; i++) id += ALPHABET[bytes[i]! % 32];
  return `RPT-${now.getUTCFullYear()}-${id}`;
}
