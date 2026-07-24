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
  const surface =
    node?.closest<HTMLElement>('[data-testid="cellInnerDiv"]') ??
    node?.closest<HTMLElement>("article") ??
    profileHeaderSurface(node);
  if (!surface) return false;
  surface.style.display = "none";
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
  return true;
}
