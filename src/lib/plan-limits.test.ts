import { test } from "node:test";
import assert from "node:assert/strict";
import { monthStartUtc, monthlyLimitReached, monthlyLimitMessage } from "./plan-limits";

test("month window starts on the 1st at 00:00 UTC", () => {
  assert.equal(monthStartUtc(new Date("2026-11-20T15:30:00Z")).toISOString(), "2026-11-01T00:00:00.000Z");
  assert.equal(monthStartUtc(new Date("2026-12-01T00:00:00Z")).toISOString(), "2026-12-01T00:00:00.000Z");
  assert.equal(monthStartUtc(new Date("2026-11-30T23:59:59Z")).toISOString(), "2026-11-01T00:00:00.000Z");
});

test("the allowance is inclusive: the Nth test is allowed, the N+1th is not", () => {
  assert.equal(monthlyLimitReached(199, 200), false);
  assert.equal(monthlyLimitReached(200, 200), true);
  assert.equal(monthlyLimitReached(250, 200), true);
});

test("a limit of zero or less allows nothing", () => {
  assert.equal(monthlyLimitReached(0, 0), true);
  assert.equal(monthlyLimitReached(0, -5), true);
});

test("the message does not push anyone to upgrade", () => {
  assert.doesNotMatch(monthlyLimitMessage(200), /upgrade|plan|pay/i);
  assert.match(monthlyLimitMessage(200), /platform administrator/);
});
