// Tamper-evident audit chain — server side (SHA-256).
// Mirrors the canonical-string layout used by `civixlab/src/server/audit-chain.ts`
// so frontend `verifyChain()` can re-derive every hash from the wire payload.

import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { Tx } from "@/db/prisma";

export interface DiffEntry { field: string; from: string; to: string }

export interface AuditInput {
  ts: string;            // ISO timestamp
  userEmail: string;
  userName: string;
  userRole: string;
  action: string;        // create | update | review | approve | sign | login | ...
  entity: string;        // test | sample | project | equipment | user | session | ...
  entityId: string;
  diff?: DiffEntry[];
  ip?: string | null;
  userAgent?: string | null;
}

const SEP_F = "␟"; // ␟  — field separator
const SEP_R = "␞"; // ␞  — record separator (between prevHash and self)

function canonical(e: AuditInput): string {
  const diff = e.diff?.map((d) => `${d.field}:${d.from}>${d.to}`).join("|") ?? "";
  const userTag = `${e.userName} (${e.userRole})`;
  const ip = e.ip ?? "";
  return [e.ts, userTag, e.action, e.entity, e.entityId, diff, ip].join(SEP_F);
}

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

export function expectedHash(prevHash: string, e: AuditInput): string {
  return sha256(`${prevHash}${SEP_R}${canonical(e)}`);
}

/**
 * Append an audit row inside an existing tenant-scoped transaction. Reads the
 * latest hash for this tenant (RLS-filtered) and chains the new row off it.
 *
 * Must be called inside `withTenant(...)` so RLS gives us the right view.
 */
export async function appendAudit(
  tx: Tx,
  tenantId: string,
  e: AuditInput
): Promise<{ id: string; hash: string; prevHash: string }> {
  const last = await tx.auditLog.findFirst({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    select: { hash: true },
  });
  const prevHash = last?.hash ?? "GENESIS";
  const hash = expectedHash(prevHash, e);

  const row = await tx.auditLog.create({
    data: {
      tenantId,
      userEmail: e.userEmail,
      action: e.action,
      entityType: e.entity,
      entityId: e.entityId,
      newValues: e.diff ? (e.diff as unknown as Prisma.InputJsonValue) : undefined,
      ipAddress: e.ip ?? null,
      userAgent: e.userAgent ?? null,
      prevHash,
      hash,
    },
    select: { id: true, hash: true, prevHash: true },
  });
  return { id: row.id, hash: row.hash!, prevHash: row.prevHash! };
}

export interface ChainEntry {
  id: string;
  ts: string;
  user: string;
  action: string;
  entity: string;
  entityId: string;
  diff?: DiffEntry[];
  ip: string | null;
  prevHash: string | null;
  hash: string | null;
}

/**
 * Verify the chain. Entries may be newest-first (the order returned to the UI).
 * Returns the id of the first broken link (oldest such), or null.
 */
export function verifyChain(entries: ChainEntry[]): { ok: boolean; brokenAt: string | null } {
  const ordered = [...entries].reverse();
  let prev = "GENESIS";
  for (const e of ordered) {
    const expected = expectedHash(prev, {
      ts: e.ts,
      userName: e.user.replace(/\s*\([^)]*\)\s*$/, ""),
      userRole: e.user.match(/\(([^)]*)\)\s*$/)?.[1] ?? "",
      userEmail: "",
      action: e.action,
      entity: e.entity,
      entityId: e.entityId,
      diff: e.diff,
      ip: e.ip,
    });
    if (e.hash && e.hash !== expected) return { ok: false, brokenAt: e.id };
    if (e.prevHash && e.prevHash !== prev) return { ok: false, brokenAt: e.id };
    prev = e.hash ?? expected;
  }
  return { ok: true, brokenAt: null };
}
