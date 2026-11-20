// Tamper-evident audit chain — server side (SHA-256).
// Mirrors the canonical-string layout used by `civixlab/src/server/audit-chain.ts`
// so frontend `verifyChain()` can re-derive every hash from the wire payload.

import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { Tx } from "@/db/prisma";

export interface DiffEntry { field: string; from: string; to: string }

export interface AuditInput {
  /** Ignored: the timestamp is assigned inside appendAudit (see below). */
  ts?: string;
  userEmail: string;
  /** Display-only; not part of the hash (only persisted fields are hashed). */
  userName?: string;
  userRole?: string;
  action: string;        // create | update | review | approve | sign | login | ...
  entity: string;        // test | sample | project | equipment | user | session | ...
  entityId: string;
  diff?: DiffEntry[];
  ip?: string | null;
  userAgent?: string | null;
}

const SEP_F = "␟"; // field separator
const SEP_R = "␞"; // record separator (between prevHash and self)

/** The hash covers ONLY values that are persisted and returned by the API, so
 *  anyone (server verify, auditors) can recompute it from a stored row. */
export interface Hashable {
  ts: string;            // == audit_logs.created_at, ISO
  userEmail: string;
  action: string;
  entity: string;
  entityId: string;
  diff?: DiffEntry[] | null;
  ip?: string | null;
}

function canonical(e: Hashable): string {
  const diff = e.diff?.map((d) => `${d.field}:${d.from}>${d.to}`).join("|") ?? "";
  return [e.ts, e.userEmail, e.action, e.entity, e.entityId, diff, e.ip ?? ""].join(SEP_F);
}

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

export function expectedHash(prevHash: string, e: Hashable): string {
  return sha256(`${prevHash}${SEP_R}${canonical(e)}`);
}

/**
 * Append an audit row inside an existing tenant-scoped transaction.
 *
 * - Takes a per-tenant advisory lock so concurrent appends are serialised and
 *   the chain cannot fork.
 * - Assigns the timestamp itself (strictly after the previous row) and stores
 *   it as created_at, so the hashed value equals the stored value.
 *
 * Must be called inside `withTenant(...)` so RLS gives us the right view.
 */
export async function appendAudit(
  tx: Tx,
  tenantId: string,
  e: AuditInput
): Promise<{ id: string; hash: string; prevHash: string }> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId}, 0))`;

  const last = await tx.auditLog.findFirst({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    select: { hash: true, createdAt: true },
  });
  const prevHash = last?.hash ?? "GENESIS";
  const tsMs = Math.max(Date.now(), last ? last.createdAt.getTime() + 1 : 0);
  const ts = new Date(tsMs).toISOString();
  const hash = expectedHash(prevHash, {
    ts, userEmail: e.userEmail, action: e.action, entity: e.entity,
    entityId: e.entityId, diff: e.diff, ip: e.ip ?? null,
  });

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
      createdAt: new Date(tsMs),
    },
    select: { id: true, hash: true, prevHash: true },
  });
  return { id: row.id, hash: row.hash!, prevHash: row.prevHash! };
}

export interface ChainEntry extends Hashable {
  id: string;
  prevHash: string | null;
  hash: string | null;
}

/**
 * Verify the chain. Entries may be newest-first (the order returned to the UI).
 * Returns the id of the first broken link (oldest such), or null. A row with
 * no stored hash cannot be verified and counts as broken.
 */
export function verifyChain(entries: ChainEntry[]): { ok: boolean; brokenAt: string | null; checked: number } {
  const ordered = [...entries].reverse();
  let prev = "GENESIS";
  for (const e of ordered) {
    if (!e.hash || e.hash !== expectedHash(prev, e) || e.prevHash !== prev) {
      return { ok: false, brokenAt: e.id, checked: ordered.length };
    }
    prev = e.hash;
  }
  return { ok: true, brokenAt: null, checked: ordered.length };
}

/** Convert a stored audit_logs row into the shape verifyChain() hashes. */
export function toChainEntry(a: {
  id: string; createdAt: Date; userEmail: string | null; action: string; entityType: string;
  entityId: string; newValues: unknown; ipAddress: string | null; prevHash: string | null; hash: string | null;
}): ChainEntry {
  return {
    id: a.id,
    ts: a.createdAt.toISOString(),
    userEmail: a.userEmail ?? "",
    action: a.action,
    entity: a.entityType,
    entityId: a.entityId,
    diff: Array.isArray(a.newValues) ? (a.newValues as DiffEntry[]) : undefined,
    ip: a.ipAddress,
    prevHash: a.prevHash,
    hash: a.hash,
  };
}
