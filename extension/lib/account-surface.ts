function profileHeaderSurface(node: Element | null): HTMLElement | null {
  const userName = node?.closest<HTMLElement>('[data-testid="UserName"]');
  if (!userName) return null;

  const primaryColumn = userName.closest('[data-testid="primaryColumn"]');
  for (let el = userName.parentElement; el && el !== primaryColumn; el = el.parentElement) {
    if (el.querySelector('a[href$="/header_photo"]')) return el;
  }
  return null;
}

type ScrollAnchor = {
  element: HTMLElement;
  documentTop: number;
  expiresAt: number;
};

let scrollAnchor: ScrollAnchor | null = null;
let scrollFrame = 0;

function now(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

/** Document-space movement excludes ordinary user scrolling (rect.top and
 * scrollY cancel each other) but captures X moving a recycled virtual row. */
export function virtualRowDocumentDelta(
  previousDocumentTop: number,
  currentRectTop: number,
  currentScrollY: number,
): number {
  return currentRectTop + currentScrollY - previousDocumentTop;
}

function captureScrollAnchor(surface: HTMLElement): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const targetRect = surface.getBoundingClientRect();
  // Removing a row below the viewport cannot move what the user is reading.
  if (targetRect.top >= window.innerHeight) return;

  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>('[data-testid="cellInnerDiv"]'),
  ).filter((cell) => cell !== surface && !cell.hasAttribute("data-mxga-surface-hidden"));
  const element =
    candidates.find((cell) => {
      const rect = cell.getBoundingClientRect();
      return rect.top >= 0 && rect.top < window.innerHeight;
    }) ?? candidates.find((cell) => cell.getBoundingClientRect().bottom > 0);
  if (!element) return;

  if (!scrollAnchor || !scrollAnchor.element.isConnected || scrollAnchor.element === surface) {
    scrollAnchor = {
      element,
      documentTop: element.getBoundingClientRect().top + window.scrollY,
      expiresAt: 0,
    };
  }
  scrollAnchor.expiresAt = now() + 350;
  scheduleScrollCorrection();
}

function scheduleScrollCorrection(): void {
  if (typeof window === "undefined" || typeof requestAnimationFrame === "undefined") return;
  if (scrollFrame) return;
  const correct = () => {
    scrollFrame = 0;
    const anchor = scrollAnchor;
    if (!anchor || !anchor.element.isConnected) {
      scrollAnchor = null;
      return;
    }
    // rect.top alone also changes when the user scrolls. The document-space
    // position changes only when X reflows its virtual rows, so compensating
    // this delta does not fight an intentional wheel/touch scroll.
    const rectTop = anchor.element.getBoundingClientRect().top;
    const documentTop = rectTop + window.scrollY;
    const delta = virtualRowDocumentDelta(anchor.documentTop, rectTop, window.scrollY);
    if (Math.abs(delta) > 0.5) {
      window.scrollBy(0, delta);
      anchor.documentTop = documentTop;
    }
    if (now() < anchor.expiresAt) scrollFrame = requestAnimationFrame(correct);
    else scrollAnchor = null;
  };
  scrollFrame = requestAnimationFrame(correct);
}

export function hideAccountSurface(node: Element | null): boolean {
  const timelineSurface =
    node?.closest<HTMLElement>('[data-testid="cellInnerDiv"]') ??
    node?.closest<HTMLElement>("article");
  const surface = timelineSurface ?? profileHeaderSurface(node);
  if (!surface) return false;
  if (timelineSurface) {
    // X's timeline is an absolutely-positioned virtual list. Collapse the row
    // for real, then keep a visible neighbouring row anchored while X updates
    // its measurements. This avoids both an empty placeholder and scrollY
    // being clamped when many replies disappear.
    captureScrollAnchor(surface);
    if (!surface.hasAttribute("data-mxga-surface-hidden")) {
      const previousAria = surface.getAttribute("aria-hidden");
      if (previousAria !== null) {
        surface.setAttribute("data-mxga-previous-aria-hidden", previousAria);
      }
    }
    surface.setAttribute("data-mxga-surface-hidden", "");
    surface.setAttribute("aria-hidden", "true");
    surface.style.removeProperty("opacity"); // migrate rows hidden by older builds
    surface.style.removeProperty("pointer-events");
    surface.style.removeProperty("user-select");
    surface.style.setProperty("display", "none", "important");
  } else {
    // Profile headers are ordinary flow layout, not virtual-list rows.
    surface.style.display = "none";
  }
  return true;
}

/** Mirror hideAccountSurface for every supported account surface, including
 * profile headers where there is no enclosing tweet/article. */
export function showAccountSurface(node: Element | null): boolean {
  const surface =
    node?.closest<HTMLElement>('[data-testid="cellInnerDiv"]') ??
    node?.closest<HTMLElement>("article") ??
    profileHeaderSurface(node);
  if (!surface) return false;
  surface.style.removeProperty("display");
  if (surface.hasAttribute("data-mxga-surface-hidden")) {
    surface.style.removeProperty("opacity");
    surface.style.removeProperty("pointer-events");
    surface.style.removeProperty("user-select");
    const previousAria = surface.getAttribute("data-mxga-previous-aria-hidden");
    if (previousAria === null) surface.removeAttribute("aria-hidden");
    else surface.setAttribute("aria-hidden", previousAria);
    surface.removeAttribute("data-mxga-previous-aria-hidden");
    surface.removeAttribute("data-mxga-surface-hidden");
  }
  return true;
}
