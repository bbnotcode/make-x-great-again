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

const { hideAccountSurface, showAccountSurface, virtualRowDocumentDelta } = await import(
  "../lib/account-surface"
);

test("manual local hide removes the visible profile header surface", () => {
  const anchor = document.querySelector("#badge-anchor");
  const profileSurface = document.querySelector<HTMLElement>("#profile-surface");

  assert.equal(hideAccountSurface(anchor), true);
  assert.equal(profileSurface?.style.display, "none");
});

test("timeline hide collapses the virtual row without deleting X positioning", () => {
  const anchor = document.querySelector("#timeline-anchor");
  const cell = document.querySelector<HTMLElement>("#timeline-cell");

  assert.equal(hideAccountSurface(anchor), true);
  assert.equal(cell?.style.display, "none");
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

test("virtual-list correction ignores user scroll but follows X row recycling", () => {
  const initialDocumentTop = 1_200;
  // User scrolls down 300px: rect moves up 300px, document position is stable.
  assert.equal(virtualRowDocumentDelta(initialDocumentTop, 700, 500), 0);
  // X then compacts hidden rows by 240px while scrollY stays unchanged.
  assert.equal(virtualRowDocumentDelta(initialDocumentTop, 460, 500), -240);
});

test("a recycled hidden row can be restored and hidden again without a blank placeholder", () => {
  const anchor = document.querySelector("#timeline-anchor");
  const cell = document.querySelector<HTMLElement>("#timeline-cell");
  assert.equal(hideAccountSurface(anchor), true);
  assert.equal(cell?.style.display, "none");
  assert.equal(showAccountSurface(anchor), true);
  assert.equal(cell?.style.display, "");
  assert.equal(hideAccountSurface(anchor), true);
  assert.equal(cell?.style.display, "none");
});
