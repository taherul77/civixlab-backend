import { test } from "node:test";
import assert from "node:assert/strict";
import { expectedHash, verifyChain, type ChainEntry, type Hashable } from "./audit";

function chain(rows: Omit<Hashable, "ts">[]): ChainEntry[] {
  const out: ChainEntry[] = [];
  let prev = "GENESIS";
  rows.forEach((r, i) => {
    const h: Hashable = { ts: new Date(1_700_000_000_000 + i).toISOString(), ...r };
    const hash = expectedHash(prev, h);
    out.push({ id: `id${i}`, ...h, prevHash: prev, hash });
    prev = hash;
  });
  return out.reverse(); // newest-first, like the API
}

const base = { userEmail: "a@x.sa", action: "create", entity: "test", entityId: "e", ip: "127.0.0.1" };

test("an untouched chain verifies", () => {
  const c = chain([{ ...base }, { ...base, action: "update", diff: [{ field: "status", from: "draft", to: "submitted" }] }, { ...base, action: "approve" }]);
  assert.deepEqual(verifyChain(c), { ok: true, brokenAt: null, checked: 3 });
});

test("editing a stored field breaks the chain at that row", () => {
  const c = chain([{ ...base }, { ...base, action: "update" }, { ...base, action: "approve" }]);
  c[1]!.action = "delete"; // middle row, tampered
  const r = verifyChain(c);
  assert.equal(r.ok, false);
  assert.equal(r.brokenAt, "id1");
});

test("deleting a row breaks the chain", () => {
  const c = chain([{ ...base }, { ...base, action: "update" }, { ...base, action: "approve" }]);
  c.splice(1, 1);
  assert.equal(verifyChain(c).ok, false);
});

test("a row with no hash is unverifiable", () => {
  const c = chain([{ ...base }]);
  c[0]!.hash = null;
  assert.equal(verifyChain(c).ok, false);
});
