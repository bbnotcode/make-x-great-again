export type QuickXAction = "mute" | "block";

export interface QuickActionResult {
  ok: boolean;
  message?: string;
  /** Present when the click was accepted into the durable queue. The first
   * result acknowledges enqueueing; completion reports the eventual X call. */
  completion?: Promise<Omit<QuickActionResult, "completion">>;
}

type QuickActionHandler = (action: QuickXAction) => Promise<QuickActionResult>;

const HOST_ATTR = "data-mxga-quick-actions";

function icon(action: QuickXAction): string {
  if (action === "mute") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 9v6h4l5 4V5L8 9H4Z"></path>
      <path d="m17 9 5 5m0-5-5 5"></path>
    </svg>`;
  }
  return `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2.8 20 6v5.5c0 4.8-3.2 8.1-8 9.7-4.8-1.6-8-4.9-8-9.7V6l8-3.2Z"></path>
    <path d="m9 9 6 6m0-6-6 6"></path>
  </svg>`;
}

function placementReference(article: HTMLElement): Element | null {
  return (
    article.querySelector('[data-testid="grok-actions"]') ??
    article.querySelector('button[aria-label*="Grok" i]') ??
    article.querySelector('[role="button"][aria-label*="Grok" i]') ??
    article.querySelector('[data-testid="caret"]')
  );
}

/** Mount two X-native account controls in the post header action cluster.
 *
 * X virtualizes/recycles article nodes, so the mounted handle is checked on
 * every scan. A recycled article gets a fresh handler instead of acting on
 * the account that previously occupied the same DOM node.
 */
export function mountQuickActions(
  article: HTMLElement,
  handle: string,
  onAction: QuickActionHandler,
): boolean {
  const normalized = handle.trim().replace(/^@+/, "").toLowerCase();
  const previous = article.querySelector<HTMLElement>(`:scope [${HOST_ATTR}]`);
  const reference = placementReference(article);
  const parent = reference?.parentElement;
  if (!reference || !parent) return false;
  if (previous?.dataset.mxgaHandle === normalized) {
    // X often renders More first and inserts Grok later. The first mount then
    // correctly lands before More, but must be moved again once Grok exists;
    // an idempotent early return left mixed Grok/MXGA ordering between rows.
    if (previous.parentElement !== parent || previous.nextElementSibling !== reference) {
      parent.insertBefore(previous, reference);
    }
    return true;
  }
  previous?.remove();

  const host = document.createElement("span");
  host.setAttribute(HOST_ATTR, "");
  host.dataset.mxgaHandle = normalized;
  host.style.cssText =
    "display:inline-flex;align-items:center;flex:none;vertical-align:middle;";
  const root = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    :host { display:inline-flex; color:rgb(83,100,113); }
    .wrap { display:inline-flex; align-items:center; gap:1px; }
    button {
      width:34px; height:34px; padding:0; border:0; border-radius:9999px;
      display:inline-grid; place-items:center; color:inherit;
      background:transparent; cursor:pointer; transition:background .15s,color .15s;
    }
    button:hover { color:rgb(29,155,240); background:rgba(29,155,240,.1); }
    button[data-action="block"]:hover { color:rgb(244,33,46); background:rgba(244,33,46,.1); }
    button:disabled { cursor:wait; opacity:.55; }
    button[data-state="success"] { color:rgb(0,186,124); }
    button[data-state="queued"] { color:rgb(255,173,31); }
    button[data-state="error"] { color:rgb(244,33,46); }
    svg { width:20px; height:20px; fill:none; stroke:currentColor; stroke-width:1.9;
      stroke-linecap:round; stroke-linejoin:round; }
    button[data-state="working"] svg { animation:mxga-spin .8s linear infinite; }
    @keyframes mxga-spin { to { transform:rotate(360deg); } }
  `;
  const wrap = document.createElement("span");
  wrap.className = "wrap";

  const labels: Record<QuickXAction, string> = {
    mute: "用 X 原生功能静音此账号",
    block: "用 X 原生功能拉黑此账号",
  };
  for (const action of ["mute", "block"] as const) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.action = action;
    button.setAttribute("aria-label", labels[action]);
    button.title = labels[action];
    button.innerHTML = icon(action);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void (async () => {
        const buttons = [...wrap.querySelectorAll<HTMLButtonElement>("button")];
        for (const item of buttons) item.disabled = true;
        button.dataset.state = "working";
        button.title = action === "mute" ? "正在静音…" : "正在拉黑…";
        const result: QuickActionResult = await onAction(action).catch(() => ({
          ok: false,
          message: "操作失败，请稍后重试",
        }));
        button.dataset.state = result.ok ? (result.completion ? "queued" : "success") : "error";
        button.title =
          result.message ??
          (result.ok
            ? action === "mute"
              ? "已用 X 原生功能静音"
              : "已用 X 原生功能拉黑"
            : "操作失败，请稍后重试");
        if (!result.ok) {
          for (const item of buttons) item.disabled = false;
        } else if (result.completion) {
          const completed = await result.completion.catch(() => ({
            ok: false,
            message: "后台操作失败，请重试",
          }));
          button.dataset.state = completed.ok ? "success" : "error";
          button.title =
            completed.message ??
            (completed.ok
              ? action === "mute"
                ? "已用 X 原生功能静音"
                : "已用 X 原生功能拉黑"
              : "后台操作失败，请重试");
          if (!completed.ok) {
            for (const item of buttons) item.disabled = false;
          }
        }
      })();
    });
    wrap.appendChild(button);
  }
  root.append(style, wrap);
  parent.insertBefore(host, reference);
  return true;
}
