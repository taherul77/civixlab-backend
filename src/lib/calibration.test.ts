import { test } from "node:test";
import assert from "node:assert/strict";
import { calibrationBlockReason } from "./calibration";

const eq = (over: Partial<Parameters<typeof calibrationBlockReason>[0]> = {}) => ({
  equipmentCode: "EQ-1", status: "active", calibrationDueDate: new Date("2026-10-01"), ...over,
});

test("in calibration when the test was performed: allowed", () => {
  assert.equal(calibrationBlockReason(eq(), new Date("2026-09-15")), null);
});

test("expired before the test was performed: blocked", () => {
  assert.match(calibrationBlockReason(eq(), new Date("2026-10-05"))!, /expired on 2026-10-01/);
});

test("the due date itself is valid through the end of that day", () => {
  assert.equal(calibrationBlockReason(eq(), new Date("2026-10-01T09:00:00Z")), null);
  assert.equal(calibrationBlockReason(eq(), new Date("2026-10-01T23:59:59Z")), null);
  assert.ok(calibrationBlockReason(eq(), new Date("2026-10-02T00:00:00Z")));
});

test("a test done while calibrated stays valid after the due date passes", () => {
  // Approving in December a test performed in September is fine.
  assert.equal(calibrationBlockReason(eq(), new Date("2026-09-30")), null);
});

test("out of service or retired equipment is blocked", () => {
  assert.match(calibrationBlockReason(eq({ status: "out_of_service" }), new Date("2026-09-01"))!, /out of service/);
  assert.match(calibrationBlockReason(eq({ status: "retired" }), new Date("2026-09-01"))!, /retired/);
});

test("no due date recorded: not blocked (nothing proves it expired)", () => {
  assert.equal(calibrationBlockReason(eq({ calibrationDueDate: null }), new Date("2026-09-01")), null);
});
