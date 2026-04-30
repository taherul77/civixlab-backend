import type { FastifyRequest } from "fastify";

/** Coalesce the multi-typed `user-agent` header to a plain `string | null`. */
export function userAgentOf(req: FastifyRequest): string | null {
  const v = req.headers["user-agent"];
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

/** "fahad@aramco-lab.sa" → "fahad". Falls back to the full email. */
export function localPart(email: string): string {
  return email.split("@")[0] ?? email;
}
