import assert from "node:assert/strict";
import { test } from "node:test";
import { parseFollowingLookup, parseFollowingLookupBatch } from "../lib/follow-verifier";

test("reads an authoritative following connection from X friendship lookup", () => {
  assert.equal(
    parseFollowingLookup(
      [
        {
          screen_name: "maimaiRC_",
          connections: ["following", "followed_by"],
        },
      ],
      "@MAIMAIRC_",
    ),
    true,
  );
});

test("distinguishes a known non-followed account from an unavailable response", () => {
  assert.equal(
    parseFollowingLookup(
      [{ screen_name: "spam", connections: ["followed_by"] }],
      "spam",
    ),
    false,
  );
  assert.equal(parseFollowingLookup({ error: "rate limited" }, "spam"), null);
  assert.equal(
    parseFollowingLookup([{ screen_name: "someone_else", connections: ["following"] }], "spam"),
    null,
  );
});

test("parses a batched friendship lookup without mixing account relationships", () => {
  const result = parseFollowingLookupBatch([
    { screen_name: "followed", connections: ["following"] },
    { screen_name: "not_followed", connections: ["followed_by"] },
    { screen_name: "broken" },
  ]);
  assert.equal(result.get("followed"), true);
  assert.equal(result.get("not_followed"), false);
  assert.equal(result.has("broken"), false);
});
