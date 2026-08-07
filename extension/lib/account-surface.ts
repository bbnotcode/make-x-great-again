function profileHeaderSurface(node: Element | null): HTMLElement | null {
  const userName = node?.closest<HTMLElement>('[data-testid="UserName"]');
  if (!userName) return null;

  const primaryColumn = userName.closest('[data-testid="primaryColumn"]');
  for (let el = userName.parentElement; el && el !== primaryColumn; el = el.parentElement) {
    if (el.querySelector('a[href$="/header_photo"]')) return el;
  }
  return null;
}

export function hideAccountSurface(node: Element | null): boolean {
  const timelineSurface =
    node?.closest<HTMLElement>('[data-testid="cellInnerDiv"]') ??
    node?.closest<HTMLElement>("article");
  const surface = timelineSurface ?? profileHeaderSurface(node);
  if (!surface) return false;
  if (timelineSurface) {
    // X's timeline is an absolutely-positioned virtual list. display:none
    // makes ResizeObserver report a zero-height row; hiding many replies then
    // collapses the list's estimated height and clamps scrollY (often to the
    // top). Keep the measured box in the virtualizer while making its content
    // inert and invisible.
    if (!surface.hasAttribute("data-mxga-surface-hidden")) {
      const previousAria = surface.getAttribute("aria-hidden");
      if (previousAria !== null) {
        surface.setAttribute("data-mxga-previous-aria-hidden", previousAria);
      }
    }
    surface.setAttribute("data-mxga-surface-hidden", "");
    surface.setAttribute("aria-hidden", "true");
    surface.style.removeProperty("display"); // migrate rows hidden by older builds
    surface.style.setProperty("opacity", "0", "important");
    surface.style.setProperty("pointer-events", "none", "important");
    surface.style.setProperty("user-select", "none", "important");
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
