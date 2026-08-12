import assert from "node:assert/strict";
import test from "node:test";
import { isIndependentPendingSource, pendingPriority } from "../lib/store";

test("bio template tasks survive generic action-mode changes", () => {
  assert.equal(isIndependentPendingSource("bio_rule"), true);
  assert.equal(isIndependentPendingSource("auto"), false);
});

test("bio template tasks remain paced automatic priority", () => {
  assert.equal(pendingPriority("bio_rule"), 2);
});
