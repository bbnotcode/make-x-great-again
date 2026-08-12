/** Avoid adding extension traffic while X itself is offline or showing its
 * fatal timeline error surface. Queued native actions remain durable and can
 * continue after the page recovers/reloads. */
export function isXPageHealthyForExtensionApi(): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  if (typeof document === "undefined") return true;
  const primary = document.querySelector('[data-testid="primaryColumn"]');
  const text = primary?.textContent ?? "";
  return !(
    text.includes("出错了。请尝试重新加载") ||
    text.includes("出了点问题。请尝试重新加载") ||
    /Something went wrong[.\s]*Try reloading/i.test(text)
  );
}
