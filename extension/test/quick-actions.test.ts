import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHTML } from "linkedom";

const { document, window } = parseHTML(`
  <article data-testid="tweet">
    <div id="actions">
      <button data-testid="grok-actions">Grok</button>
      <button data-testid="caret">More</button>
    </div>
  </article>
`);
Object.assign(globalThis, {
  document,
  HTMLElement: window.HTMLElement,
});

const { mountQuickActions } = await import("../lib/quick-actions");

test("mounts mute and block controls immediately before Grok", () => {
  const article = document.querySelector<HTMLElement>("article");
  assert.ok(article);
  assert.equal(mountQuickActions(article, "Example", async () => ({ ok: true })), true);

  const actions = document.querySelector("#actions");
  const host = article.querySelector<HTMLElement>("[data-mxga-quick-actions]");
  assert.equal(actions?.firstElementChild, host);
  assert.equal(host?.dataset.mxgaHandle, "example");
  assert.equal(host?.shadowRoot?.querySelectorAll("button").length, 2);
  assert.equal(
    host?.shadowRoot?.querySelector('[data-action="mute"]')?.getAttribute("aria-label"),
    "用 X 原生功能静音此账号",
  );
});

test("is idempotent for the same account and refreshes recycled articles", () => {
  const article = document.querySelector<HTMLElement>("article");
  assert.ok(article);
  const first = article.querySelector("[data-mxga-quick-actions]");
  mountQuickActions(article, "@Example", async () => ({ ok: true }));
  assert.equal(article.querySelector("[data-mxga-quick-actions]"), first);

  mountQuickActions(article, "Another", async () => ({ ok: true }));
  const replacement = article.querySelector<HTMLElement>("[data-mxga-quick-actions]");
  assert.notEqual(replacement, first);
  assert.equal(replacement?.dataset.mxgaHandle, "another");
  assert.equal(article.querySelectorAll("[data-mxga-quick-actions]").length, 1);
});

test("click delegates the requested native action without opening the post", async () => {
  const article = document.querySelector<HTMLElement>("article");
  assert.ok(article);
  let called = "";
  mountQuickActions(article, "ClickTest", async (action) => {
    called = action;
    return { ok: false, message: "测试失败" };
  });
  const block = article
    .querySelector<HTMLElement>("[data-mxga-quick-actions]")
    ?.shadowRoot?.querySelector<HTMLButtonElement>('[data-action="block"]');
  assert.ok(block);
  block.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(called, "block");
  assert.equal(block.dataset.state, "error");
  assert.equal(block.disabled, false);
  assert.equal(block.title, "测试失败");
});
