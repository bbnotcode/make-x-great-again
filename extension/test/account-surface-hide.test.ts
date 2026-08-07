import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHTML } from "linkedom";

const { document, window } = parseHTML(`
  <main data-testid="primaryColumn">
    <div data-testid="cellInnerDiv" id="timeline-cell" style="transform:translateY(400px);position:absolute;width:100%">
      <article><div data-testid="User-Name"><span id="timeline-anchor">@spam</span></div></article>
    </div>
    <section id="profile-surface">
      <a href="/spam/header_photo"></a>
      <div>
        <div data-testid="UserName"><span id="badge-anchor">@spam</span></div>
      </div>
    </section>
  </main>
`);

Object.assign(globalThis, {
  HTMLElement: window.HTMLElement,
});

const { hideAccountSurface, showAccountSurface } = await import("../lib/account-surface");

test("manual local hide removes the visible profile header surface", () => {
  const anchor = document.querySelector("#badge-anchor");
  const profileSurface = document.querySelector<HTMLElement>("#profile-surface");

  assert.equal(hideAccountSurface(anchor), true);
  assert.equal(profileSurface?.style.display, "none");
});

test("timeline hide keeps X virtual-row geometry instead of display:none", () => {
  const anchor = document.querySelector("#timeline-anchor");
  const cell = document.querySelector<HTMLElement>("#timeline-cell");

  assert.equal(hideAccountSurface(anchor), true);
  assert.notEqual(cell?.style.display, "none");
  assert.equal(cell?.style.opacity, "0");
  assert.equal(cell?.style.pointerEvents, "none");
  assert.equal(cell?.getAttribute("data-mxga-surface-hidden"), "");
  assert.match(cell?.getAttribute("style") ?? "", /translateY\(400px\)/);

  assert.equal(showAccountSurface(anchor), true);
  assert.notEqual(cell?.style.opacity, "0");
  assert.equal(cell?.hasAttribute("data-mxga-surface-hidden"), false);
});

test("protected accounts restore the visible profile header surface", () => {
  const anchor = document.querySelector("#badge-anchor");
  const profileSurface = document.querySelector<HTMLElement>("#profile-surface");

  profileSurface?.style.setProperty("display", "none");
  assert.equal(showAccountSurface(anchor), true);
  assert.notEqual(profileSurface?.style.display, "none");
});
