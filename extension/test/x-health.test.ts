import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHTML } from "linkedom";
import { isXPageHealthyForExtensionApi } from "../lib/x-health";

test("pauses extension API traffic on X's fatal reload surface", () => {
  const { document } = parseHTML(
    '<main data-testid="primaryColumn">出错了。请尝试重新加载。<button>重试</button></main>',
  );
  Object.assign(globalThis, { document });
  assert.equal(isXPageHealthyForExtensionApi(), false);
});

test("allows extension API traffic on a normally rendered timeline", () => {
  const { document } = parseHTML(
    '<main data-testid="primaryColumn"><article data-testid="tweet">正常帖子</article></main>',
  );
  Object.assign(globalThis, { document });
  assert.equal(isXPageHealthyForExtensionApi(), true);
});
