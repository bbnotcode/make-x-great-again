import assert from "node:assert/strict";
import { test } from "node:test";
import { autoEligible } from "../lib/auto-policy";

test("list hits: human-confirmed entries follow autoScope", () => {
  assert.equal(
    autoEligible({ source: "list", tier: "confirmed", inReply: true, autoScope: "replies" }),
    true,
  );
  assert.equal(
    autoEligible({ source: "list", tier: "confirmed", inReply: false, autoScope: "replies" }),
    false,
  );
  assert.equal(
    autoEligible({ source: "list", tier: "confirmed", inReply: false, autoScope: "all" }),
    true,
  );
});

test("HARD LINE — auto-tier list entries never auto-act, any scope", () => {
  // An AI/rule/mention auto-published false positive must stay badge-only:
  // it must never mute/block/hide with the user's own X session.
  assert.equal(
    autoEligible({ source: "list", tier: "auto", inReply: true, autoScope: "replies" }),
    false,
  );
  assert.equal(
    autoEligible({ source: "list", tier: "auto", inReply: true, autoScope: "all" }),
    false,
  );
  assert.equal(
    autoEligible({ source: "list", tier: "auto", inReply: false, autoScope: "all" }),
    false,
  );
});

test("rule hits: reply sections only, autoScope cannot widen them", () => {
  assert.equal(
    autoEligible({ source: "rule", tier: "auto", inReply: true, autoScope: "replies" }),
    true,
  );
  assert.equal(
    autoEligible({ source: "rule", tier: "auto", inReply: false, autoScope: "all" }),
    false,
  );
});

test("cache and fresh verdicts never auto-act", () => {
  for (const source of ["cache", "fresh"] as const) {
    assert.equal(
      autoEligible({ source, tier: "confirmed", inReply: true, autoScope: "all" }),
      false,
    );
  }
});
