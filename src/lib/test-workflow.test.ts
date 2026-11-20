import { test } from "node:test";
import assert from "node:assert/strict";
import { canMove, isEditable, REASON_REQUIRED, TRANSITIONS } from "./test-workflow";

test("a returned test can be edited and resubmitted", () => {
  assert.ok(isEditable("returned"));
  assert.ok(canMove("submit", "returned"));
});

test("legacy 'rejected' rows behave like returned (not a dead end any more)", () => {
  assert.ok(isEditable("rejected"));
  assert.ok(canMove("submit", "rejected"));
});

test("approved and signed results are locked", () => {
  for (const s of ["approved", "signed", "submitted", "reviewed"]) assert.equal(isEditable(s), false, s);
});

test("return is only possible while a test awaits a decision", () => {
  assert.ok(canMove("return", "submitted"));
  assert.ok(canMove("return", "reviewed"));
  for (const s of ["draft", "returned", "approved", "signed"]) assert.equal(canMove("return", s), false, s);
});

test("a reason is required to return a test, not to approve it", () => {
  assert.ok(REASON_REQUIRED.has("return"));
  assert.equal(REASON_REQUIRED.has("approve"), false);
});

test("the only way back into review is submit", () => {
  const entries = Object.entries(TRANSITIONS).filter(([, v]) => v.to === "submitted").map(([k]) => k);
  assert.deepEqual(entries, ["submit"]);
});
