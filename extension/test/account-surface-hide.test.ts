import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHTML } from "linkedom";

const { document, window } = parseHTML(`
  <main data-testid="primaryColumn">
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

test("protected accounts restore the visible profile header surface", () => {
  const anchor = document.querySelector("#badge-anchor");
  const profileSurface = document.querySelector<HTMLElement>("#profile-surface");

  profileSurface?.style.setProperty("display", "none");
  assert.equal(showAccountSurface(anchor), true);
  assert.notEqual(profileSurface?.style.display, "none");
});
