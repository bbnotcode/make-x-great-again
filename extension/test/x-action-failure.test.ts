import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyXActionFailure } from "../lib/x-action";

test("authentication and rate-limit failures pause the mutation queue", () => {
  const auth = classifyXActionFailure({ ok: false, status: 401, retryable: false });
  assert.equal(auth.kind, "auth");
  assert.equal(auth.shouldPauseQueue, true);
  const limited = classifyXActionFailure({ ok: false, status: 429, retryable: true });
  assert.equal(limited.kind, "rate_limit");
  assert.equal(limited.shouldPauseQueue, true);
});

test("ambiguous 403 rejection fails one task without freezing the whole queue", () => {
  const result = classifyXActionFailure({ ok: false, status: 403, retryable: false });
  assert.equal(result.kind, "rejected");
  assert.equal(result.shouldPauseQueue, false);
  assert.match(result.message, /403/);
});

test("transient and account-specific failures remain isolated to one task", () => {
  assert.deepEqual(
    classifyXActionFailure({ ok: false, retryable: true }).kind,
    "network",
  );
  assert.equal(
    classifyXActionFailure({ ok: false, status: 404, retryable: false }).kind,
    "not_found",
  );
  assert.equal(
    classifyXActionFailure({ ok: false, status: 503, retryable: true }).kind,
    "server",
  );
  for (const attempt of [
    { ok: false, retryable: true },
    { ok: false, status: 404, retryable: false },
    { ok: false, status: 503, retryable: true },
  ]) {
    assert.equal(classifyXActionFailure(attempt).shouldPauseQueue, false);
  }
});
