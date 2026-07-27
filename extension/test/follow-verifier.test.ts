import assert from "node:assert/strict";
import { test } from "node:test";
import { parseFollowingLookup } from "../lib/follow-verifier";

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
