import assert from "node:assert/strict";
import test from "node:test";
import {
  readJsonBounded,
  validateLiteArtifact,
  validateWhitelist,
} from "../lib/list-sync";

test("accepts a valid lite artifact", () => {
  const result = validateLiteArtifact({
    schema: 2,
    version: "vabc-2",
    count: 2,
    entries: [
      ["123", "good_user", "sma"],
      ["", "handle_only", "pph"],
    ],
    rules: [["promo", "b", "sm"]],
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.entries.length, 2);
    assert.equal(result.value.rules?.length, 1);
  }
});

test("rejects malformed identities, codes, counts, and rules", () => {
  const base = { schema: 2, version: "v1", count: 1 };
  const cases = [
    { ...base, entries: [["not-numeric", "user", "sma"]] },
    { ...base, entries: [["1", "../escape", "sma"]] },
    { ...base, entries: [["1", "user", "javascript:"]] },
    { ...base, count: 2, entries: [["1", "user", "sma"]] },
    { ...base, entries: [["1", "user", "sma"]], rules: [["", "a", "so"]] },
    { ...base, entries: [["1", "user", "sma"]], rules: [["x", "unknown", "so"]] },
  ];
  for (const value of cases) assert.equal(validateLiteArtifact(value).ok, false);
});

test("rejects oversized entry and rule collections", () => {
  const entries = Array.from({ length: 250_001 }, () => ["1", "user", "sma"]);
  assert.equal(validateLiteArtifact({ schema: 2, entries }).ok, false);
  const rules = Array.from({ length: 10_001 }, () => ["x", "a", "so"]);
  assert.equal(
    validateLiteArtifact({ schema: 2, entries: [["1", "user", "sma"]], rules }).ok,
    false,
  );
});

test("validates whitelist rows all-or-nothing", () => {
  const valid = validateWhitelist({
    list: [
      { x_user_id: "123", handle: "good_user" },
      { x_user_id: null, handle: "good_null" },
    ],
  });
  assert.equal(valid.ok, true);
  assert.equal(
    validateWhitelist({ list: [{ x_user_id: "", handle: "good_user" }] }).ok,
    true,
  );
  assert.equal(
    validateWhitelist({ list: [{ x_user_id: "not-numeric", handle: "bad-user" }] }).ok,
    false,
  );
});

test("bounded JSON reader accepts small payloads and rejects large streams", async () => {
  const small = await readJsonBounded(
    new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
    }),
    64,
  );
  assert.deepEqual(small, { ok: true });

  await assert.rejects(
    readJsonBounded(new Response(JSON.stringify({ payload: "x".repeat(100) })), 32),
    /response too large/,
  );
  await assert.rejects(
    readJsonBounded(
      new Response("{}", { headers: { "content-length": "1000" } }),
      32,
    ),
    /response too large/,
  );
});
