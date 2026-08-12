import assert from "node:assert/strict";
import { test } from "node:test";
import { planCacheCleanup } from "../lib/cache-cleanup";

const DAY = 86_400_000;
const NOW = 2_000_000_000_000;

function cached(label: "spam" | "uncertain", age: number) {
  return {
    verdict: { label, confidence: 1, reasons: [] },
    signalsHash: "x",
    model: "test",
    ts: NOW - age,
  };
}

test("periodic cleanup removes only expired regenerable cache data", () => {
  const plan = planCacheCleanup(
    {
      "xss:list:v2": { entries: [["1", "spam", "sp"]] },
      "xss:v1:fresh-spam": cached("spam", 2 * DAY),
      "xss:v1:old-spam": cached("spam", 31 * DAY),
      "xss:v1:old-uncertain": cached("uncertain", 4 * DAY),
      "xss:follow-cache:v1": {
        followed: { following: true, ts: NOW - 12 * 60 * 60 * 1000 },
        staleFollowed: { following: true, ts: NOW - 2 * DAY },
        notFollowed: { following: false, ts: NOW - 10 * 60 * 1000 },
        staleNotFollowed: { following: false, ts: NOW - 20 * 60 * 1000 },
      },
    },
    NOW,
  );

  assert.deepEqual(plan.removeKeys.sort(), ["xss:v1:old-spam", "xss:v1:old-uncertain"]);
  assert.deepEqual(Object.keys(plan.followCache).sort(), ["followed", "notFollowed"]);
  assert.equal(plan.report.removedDetection, 2);
  assert.equal(plan.report.removedFollow, 2);
  assert.equal(plan.removeKeys.includes("xss:list:v2"), false);
});

test("malformed cache rows are quarantined during cleanup", () => {
  const plan = planCacheCleanup(
    {
      "xss:v1:broken": { ts: "yesterday" },
      "xss:follow-cache:v1": { broken: { following: true, ts: "never" } },
    },
    NOW,
  );
  assert.deepEqual(plan.removeKeys, ["xss:v1:broken"]);
  assert.deepEqual(plan.followCache, {});
});
