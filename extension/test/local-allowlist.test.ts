import assert from "node:assert/strict";
import { test } from "node:test";
import { matchesLocalAllowlist } from "../lib/local-allowlist";

test("restored accounts match by immutable user id", () => {
  assert.equal(
    matchesLocalAllowlist({ ids: ["2165736150"], handles: [] }, "2165736150", "renamed"),
    true,
  );
});

test("restored accounts match handles case-insensitively", () => {
  assert.equal(
    matchesLocalAllowlist({ ids: [], handles: ["TianCai312"] }, undefined, "@tiancai312"),
    true,
  );
});

test("unrelated accounts remain eligible for filtering", () => {
  assert.equal(
    matchesLocalAllowlist(
      { ids: ["2165736150"], handles: ["tiancai312"] },
      "3511226595",
      "tongbingxue",
    ),
    false,
  );
});
