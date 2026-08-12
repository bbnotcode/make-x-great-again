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

test("repositions an existing control when Grok appears after the initial mount", () => {
  const late = document.createElement("article");
  late.dataset.testid = "tweet";
  late.innerHTML = `<div id="late-actions"><button data-testid="caret">More</button></div>`;
  document.body.appendChild(late);
  assert.equal(mountQuickActions(late, "LateGrok", async () => ({ ok: true })), true);
  const actions = late.querySelector("#late-actions");
  const host = late.querySelector<HTMLElement>("[data-mxga-quick-actions]");
  const grok = document.createElement("button");
  grok.dataset.testid = "grok-actions";
  grok.textContent = "Grok";
  actions?.insertBefore(grok, host);

  assert.equal(mountQuickActions(late, "LateGrok", async () => ({ ok: true })), true);
  assert.equal(actions?.firstElementChild, host);
  assert.equal(host?.nextElementSibling, grok);
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

test("queued clicks acknowledge immediately and report eventual completion", async () => {
  const article = document.querySelector<HTMLElement>("article");
  assert.ok(article);
  let finish!: (result: { ok: boolean; message: string }) => void;
  const completion = new Promise<{ ok: boolean; message: string }>((resolve) => {
    finish = resolve;
  });
  mountQuickActions(article, "QueueTest", async () => ({
    ok: true,
    message: "已加入静音队列",
    completion,
  }));
  const mute = article
    .querySelector<HTMLElement>("[data-mxga-quick-actions]")
    ?.shadowRoot?.querySelector<HTMLButtonElement>('[data-action="mute"]');
  assert.ok(mute);
  mute.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(mute.dataset.state, "queued");
  assert.equal(mute.title, "已加入静音队列");

  finish({ ok: true, message: "X 原生静音成功" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(mute.dataset.state, "success");
  assert.equal(mute.title, "X 原生静音成功");
});
