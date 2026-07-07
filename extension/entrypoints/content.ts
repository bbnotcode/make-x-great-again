import { addBlocked, isBlockedSync, warm as warmBlocklist } from "../lib/blocklist";
import { BRAND } from "../lib/brand";
import { type Cached, cacheGet, signalsHash } from "../lib/cache";
import { extractFromArticle, extractProfile, extractThreadTopic } from "../lib/detect";
import { CATEGORY_ZH } from "../lib/category";
import { LIST_KEY, WL_KEY } from "../lib/list-sync";
import { type IndexEntry, isWhitelisted, lookupLocal, warmLocalIndex } from "../lib/local-index";
import { matchLocalRules } from "../lib/local-rules";
import {
  type ActionMode,
  type Settings,
  getSettings,
  onSettingsChange,
  setSetting,
} from "../lib/settings";
import { bumpStat } from "../lib/stats";
import { addBlockRecord, bumpStats } from "../lib/store";
import type { Signals, Verdict } from "../lib/types";
import { performXAction, retryDelayForAttempt } from "../lib/x-action";
import {
  type BadgeSource,
  type Finding,
  STYLE,
  createBadge,
  createBubble,
} from "../lib/ui";

/** "误判申诉" — opens the GitHub appeal issue template. Zero remote requests
 *  from the extension itself; the user files the appeal on GitHub. */
function openAppeal(): void {
  window.open(BRAND.appealNewIssue, "_blank", "noopener");
}

function articleOf(node: Element | null): HTMLElement | null {
  return (node?.closest("article") as HTMLElement) ?? null;
}

/** User-facing verb for the configured action mode. */
function actionVerb(mode: ActionMode): string {
  return mode === "block" ? "拉黑" : mode === "mute" ? "静音" : "隐藏";
}

/** How many spam categories currently escalate beyond "badge" — shown as the
 *  hint next to the bubble's 自动处理 switch. */
function autoCategoryCount(s: Settings): number {
  return Object.values(s.categoryActions).filter((a) => a !== "badge").length;
}

/** Fire X's native mute/block (best-effort, paced) with one retry. The local
 *  hide/record is applied separately and always — the X call rides on top.
 *  Returns false only when the native X action definitively failed (used by
 *  the bubble's batch panel to surface a per-row 重试 state). */
async function applyXAction(mode: ActionMode, sig: Signals): Promise<boolean> {
  if (mode === "local") return true;
  const attempt = await performXAction(mode, sig.userId, sig.handle);
  if (attempt.ok) return true;
  const delay = retryDelayForAttempt(attempt, 1);
  if (delay > 0) {
    await new Promise((r) => setTimeout(r, delay));
    const second = await performXAction(mode, sig.userId, sig.handle); // one best-effort retry
    return second.ok;
  }
  return false;
}

/** Cheap author handle from the User-Name link href — no fiber walk, no
 *  innerText. Used both as the scan() skip key and to re-verify a captured
 *  anchor before a delayed hide fires (X recycles article nodes). */
function handleFromArticle(art: HTMLElement): string | undefined {
  const nameBlock = art.querySelector<HTMLElement>('[data-testid="User-Name"]');
  if (!nameBlock) return undefined;
  for (const a of nameBlock.querySelectorAll<HTMLAnchorElement>('a[href^="/"]')) {
    const s = (a.getAttribute("href") ?? "").split("/").filter(Boolean);
    if (s.length === 1 && /^[A-Za-z0-9_]{1,15}$/.test(s[0] ?? "")) return s[0];
  }
  return undefined;
}

/** Where a scanned account was seen. Auto actions are scoped by this:
 *  - "reply"   — a NON-focal article on a status page: someone replying under
 *                a tweet. This is where the spam wave lives → auto-actable.
 *  - "feed"    — the account's own post in a timeline / search / the focal
 *                tweet itself. Detect + badge only under the default scope.
 *  - "profile" — the profile header on the account's own page. Badge only. */
type ScanContext = "reply" | "feed" | "profile";

/** Status id of the tweet the current page is focused on, or null when not
 *  on a /user/status/<id> page. */
function focalStatusId(): string | null {
  const m = location.pathname.match(/^\/[^/]+\/status\/(\d+)/);
  return m?.[1] ?? null;
}

/** Status id of an article, read from its timestamp permalink. Null when the
 *  article carries no <time> link (fail-safe → treated as non-reply). */
function articleStatusId(art: HTMLElement): string | null {
  for (const a of art.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]')) {
    if (!a.querySelector("time")) continue;
    const m = (a.getAttribute("href") ?? "").match(/\/status\/(\d+)/);
    if (m?.[1]) return m[1];
  }
  return null;
}

function hideTweet(node: Element | null) {
  const cell =
    node?.closest('[data-testid="cellInnerDiv"]') ?? node?.closest("article");
  if (cell instanceof HTMLElement) cell.style.display = "none";
}

/** Each inline badge gets its own shadow host so X CSS can't touch it. */
function mountBadge(anchor: HTMLElement, build: () => HTMLElement) {
  const host = document.createElement("span");
  host.className = "xss-mount";
  // The profile header's UserName block is a flex container with the default
  // align-items:stretch — an unpinned host (and the badge inside it, via the
  // host's own default stretch) inflates to the full two-line row height and
  // renders as a giant capsule. Pin both axes to content size.
  host.style.cssText =
    "display:inline-flex;align-items:center;align-self:center;vertical-align:middle;flex:none;";
  const sr = host.attachShadow({ mode: "open" });
  const st = document.createElement("style");
  st.textContent = STYLE;
  sr.append(st, build());
  anchor.appendChild(host);
}

function clearMounts(anchor: HTMLElement) {
  anchor
    .querySelectorAll(":scope > .xss-mount, :scope > .xss-pending")
    .forEach((n) => n.remove());
}

// ---- 5-second preview undo queue (PENDING_MS) ----
const PENDING_MS = 5000;

interface PendingAction {
  key: string;
  sig: Signals;
  anchor: HTMLElement;
  timer: ReturnType<typeof setTimeout>;
  ts: number;
  /** Per-action override of settings.actionMode — the popover's secondary
   *  隐藏 button schedules a local-only hide even when the mode is block. */
  mode?: ActionMode;
}

export default defineContentScript({
  matches: ["https://x.com/*", "https://twitter.com/*"],
  cssInjectionMode: "ui",
  async main(ctx) {
    let bubbleApi: ReturnType<typeof createBubble> | null = null;
    let dismissed = false;
    const anchorByKey = new Map<string, HTMLElement>();
    const nodeHandle = new WeakMap<HTMLElement, string>(); // virtualization-safe
    let findings: Finding[] = [];
    const pendingActions = new Map<string, PendingAction>();
    const inFlight = new Set<string>(); // keys currently in process()
    const hitPublicSeen = new Set<string>(); // hitPublic stat: once per account

    let settings = await getSettings();
    if (!settings.enabled) return; // master off → don't init (applies next load)
    onSettingsChange((s) => {
      settings = s;
      // Keep the bubble's 自动处理 switch + hint in sync (options page or
      // another tab may have flipped it).
      bubbleApi?.setAutoProcess(s.autoProcess, autoCategoryCount(s), s.autoScope === "all");
    });

    // Warm local data structures
    await warmBlocklist();
    await warmLocalIndex();

    const keyOf = (s: Signals) => s.userId || `h:${s.handle}`;

    /** Schedule a hide action with a 5-second undo window. `mode` overrides
     *  settings.actionMode for this one action (popover 隐藏 → "local"). */
    function scheduleHide(key: string, sig: Signals, anchor: HTMLElement, mode?: ActionMode) {
      if (pendingActions.has(key)) return; // already pending
      // Tag the row so executeHide can still find it if X recycles the node.
      articleOf(anchor)?.setAttribute("data-xss-key", key);
      const timer = setTimeout(() => {
        void executeHide(key, sig);
        pendingActions.delete(key);
      }, PENDING_MS);
      pendingActions.set(key, {
        key,
        sig,
        anchor,
        timer,
        ts: Date.now(),
        ...(mode ? { mode } : {}),
      });
      // Update UI to show pending state
      badgeForPending(anchor, sig, mode);
    }

    /** Cancel a pending hide action (user clicked undo). */
    function cancelPending(key: string) {
      const pending = pendingActions.get(key);
      if (!pending) return;
      clearTimeout(pending.timer);
      pendingActions.delete(key);
      articleOf(pending.anchor)?.removeAttribute("data-xss-key");
      // Restore the badge to its previous state
      clearMounts(pending.anchor);
    }

    /** Execute the action (after the preview window expires, or immediately
     *  from the bubble's batch panel). The local record + visual hide always
     *  happen (so the row stays gone across navigation); if the user opted
     *  into "mute"/"block", X's native action rides on top via the user's
     *  own session (best-effort, paced). Everything up to the X call runs
     *  synchronously; the returned promise resolves once the native action
     *  settled (true = local-only mode or X action succeeded). */
    function executeHide(key: string, sig: Signals): Promise<boolean> {
      const mode = pendingActions.get(key)?.mode ?? settings.actionMode;
      void addBlocked(key);
      if (sig.userId) void addBlocked(sig.userId);
      void addBlockRecord({
        id: key,
        handle: sig.handle,
        ...(sig.displayName ? { displayName: sig.displayName } : {}),
        ...(sig.avatarUrl ? { avatarUrl: sig.avatarUrl } : {}),
        source: "manual",
        ts: Date.now(),
      });
      void bumpStats({ blocks: 1 });
      void bumpStat("blocked");
      // X recycles article nodes: only hide via the captured anchor if it
      // still belongs to this account; otherwise use the tagged row, else
      // abort the DOM hide (the block itself is already recorded).
      const anchor =
        pendingActions.get(key)?.anchor ?? anchorByKey.get(key) ?? null;
      const art = articleOf(anchor);
      const sameAuthor =
        !!art && handleFromArticle(art)?.toLowerCase() === sig.handle.toLowerCase();
      const target = sameAuthor
        ? anchor
        : document.querySelector(`[data-xss-key="${CSS.escape(key)}"]`);
      if (target) hideTweet(target);
      return applyXAction(mode, sig);
    }

    function badgeForPending(anchor: HTMLElement, sig: Signals, mode?: ActionMode) {
      clearMounts(anchor);
      const verb = actionVerb(mode ?? settings.actionMode);
      mountBadge(anchor, () => {
        const el = document.createElement("span");
        el.className = "xss-badge pending";
        el.innerHTML = `<span style="color:var(--warn)">⏳ 5秒后${verb}</span>
          <button data-undo style="margin-left:6px;padding:1px 6px;border:1px solid var(--warn);background:transparent;color:var(--warn);border-radius:4px;font-size:10px;cursor:pointer">撤销</button>`;
        el.querySelector("[data-undo]")?.addEventListener("click", (e) => {
          e.stopPropagation();
          cancelPending(keyOf(sig));
        });
        return el;
      });
    }

    function pushFinding(sig: Signals, v: Verdict, source: string) {
      if (!["spam", "porn_bot", "likely_spam"].includes(v.label)) return;
      const id = keyOf(sig);
      if (findings.some((f) => (f.userId || `h:${f.handle}`) === id)) return;
      const snippet = sig.triggeringComment || sig.recentTweets[0] || sig.bio;
      findings.push({
        handle: sig.handle,
        verdict: v,
        source,
        ...(sig.userId ? { userId: sig.userId } : {}),
        ...(sig.avatarUrl ? { avatarUrl: sig.avatarUrl } : {}),
        ...(sig.displayName ? { displayName: sig.displayName } : {}),
        ...(snippet ? { snippet } : {}),
      });
      if (!dismissed) bubbleApi?.update(findings);
    }

    function badgeFor(
      anchor: HTMLElement,
      key: string,
      sig: Signals,
      v: Verdict | null,
      note?: string,
      source: BadgeSource = "fresh",
    ) {
      clearMounts(anchor);
      mountBadge(anchor, () =>
        createBadge(
          v,
          {
            onHide: () => scheduleHide(key, sig, anchor),
            onHideLocal: () => scheduleHide(key, sig, anchor, "local"),
            onAppeal: openAppeal,
          },
          note,
          source,
          actionVerb(settings.actionMode),
        ),
      );
    }

    function renderCached(anchor: HTMLElement, key: string, sig: Signals, c: Cached) {
      badgeFor(anchor, key, sig, c.verdict, undefined, "cache");
      pushFinding(sig, c.verdict, "cache");
    }

    function renderLocalIndex(
      anchor: HTMLElement,
      key: string,
      sig: Signals,
      entry: IndexEntry,
      badgeSource: BadgeSource = "list",
      ctx: ScanContext = "feed",
    ) {
      if (!hitPublicSeen.has(key)) {
        hitPublicSeen.add(key);
        void bumpStat("hitPublic");
      }
      // Per-category action policy — but ONLY for list entries a human
      // actually reviewed (entry.tier === "confirmed"). Everything else —
      // local keyword-rule hits, AI/rule/mention auto-published list entries,
      // old artifacts without tier info — is a SUSPICION, not a confirmation,
      // and degrades to mark-only. This is the product red line: 只有人工确认
      // 的线上黑名单条目才允许自动隐藏/静音/拉黑，疑似账号绝不自动处理。
      // (Auto actions stay reversible from the 隐藏记录 tab, and mute/block
      // ride the user's own X session like the manual path.)
      const humanConfirmedListHit = badgeSource === "list" && entry.tier === "confirmed";
      // Scope gate: the spam wave lives in reply sections under tweets. An
      // account's OWN feed post or its profile page is not that pattern —
      // by default those only detect + badge, never auto-act (误伤保护).
      // settings.autoScope === "all" opts into auto-acting everywhere.
      const scopeAllows = settings.autoScope === "all" || ctx === "reply";
      const action =
        humanConfirmedListHit && scopeAllows
          ? (settings.categoryActions[entry.category] ?? "badge")
          : "badge";
      // 自动处理 master switch off → everything degrades to mark-only,
      // regardless of the per-category policy.
      if (action === "badge" || !settings.autoProcess) {
        badgeFor(anchor, key, sig, entry.verdict, undefined, badgeSource);
        pushFinding(sig, entry.verdict, badgeSource === "rule" ? "local-rule" : "local-index");
        return;
      }
      void addBlocked(key);
      if (sig.userId) void addBlocked(sig.userId);
      void bumpStats({ blocks: 1 });
      void bumpStat("blocked");
      hideTweet(anchor);
      // Auto-processed accounts still show up in the bubble panel — as
      // display-only rows driven through markAuto (checkbox disabled,
      // button is a status chip). Chips + radar pill counts follow.
      pushFinding(sig, entry.verdict, badgeSource === "rule" ? "local-rule" : "local-index");
      bubbleApi?.markAuto(key, "processing");
      // Record AFTER the X action settles so the 隐藏记录 row can state
      // honestly whether the native mute/block actually landed — a silent
      // fire-and-forget here is how "自动拉黑" degrades into hide-only
      // without anyone noticing.
      const verb = action === "mute" ? "静音" : action === "block" ? "拉黑" : "隐藏";
      void (async () => {
        const xOk =
          action === "mute" || action === "block" ? await applyXAction(action, sig) : true;
        if (!xOk) console.warn(`[MXGA] 自动${verb}：X 原生动作失败`, sig.handle, sig.userId);
        void addBlockRecord({
          id: key,
          handle: sig.handle,
          ...(sig.displayName ? { displayName: sig.displayName } : {}),
          ...(sig.avatarUrl ? { avatarUrl: sig.avatarUrl } : {}),
          verdict: entry.verdict,
          reason: `${CATEGORY_ZH[entry.category]} · 自动${verb}${xOk ? "" : "（X 动作失败，仅本地隐藏）"}`,
          source: "auto",
          ts: Date.now(),
        });
        bubbleApi?.markAuto(key, xOk ? "done" : "failed");
      })();
    }

    async function process(sig: Signals, anchor: HTMLElement, ctx: ScanContext = "feed") {
      const key = keyOf(sig);
      if (inFlight.has(key)) return; // a concurrent scan is already on it
      inFlight.add(key);
      try {
        anchorByKey.set(key, anchor);

        // 0. Already blocked → hide, never render again.
        if (isBlockedSync(key) || (sig.userId && isBlockedSync(sig.userId))) {
          hideTweet(anchor);
          return;
        }

        // 1. Check pending undo queue — skip if already scheduled.
        if (pendingActions.has(key)) return;

        // 2. Persistent cache (spam reused as-is; legit/uncertain only if signals
        //    unchanged so new evidence can still re-trigger).
        const cached = await cacheGet(key);
        if (cached) {
          const spammy = ["spam", "porn_bot", "likely_spam"].includes(cached.verdict.label);
          if (spammy || cached.signalsHash === signalsHash(sig)) {
            renderCached(anchor, key, sig, cached);
            void bumpStats({ cacheHits: 1 });
            return;
          }
        }

        // 3. Local public index lookup (no remote requests, <50ms).
        const entry = lookupLocal(sig.userId, sig.handle);
        if (entry) {
          renderLocalIndex(anchor, key, sig, entry, "list", ctx);
          return;
        }

        // 3.5 Maintainer-curated keyword rules, shipped with the synced list.
        // Catches first-seen template accounts (brand-new porn-bot throwaways
        // not yet on the public list) with zero upload. Whitelist wins.
        const ruleHit = matchLocalRules(sig);
        if (ruleHit && !isWhitelisted(sig.userId, sig.handle)) {
          renderLocalIndex(
            anchor,
            key,
            sig,
            {
              userId: sig.userId ?? "",
              handle: sig.handle,
              verdict: {
                label: ruleHit.label,
                confidence: 0.95,
                reasons: [`命中官方规则「${ruleHit.pattern}」 · ${CATEGORY_ZH[ruleHit.category]}`],
              },
              category: ruleHit.category,
              tier: "auto", // a rule match is a suspicion — never auto-acted on
              source: "community",
              updatedAt: new Date().toISOString(),
            },
            "rule",
            ctx,
          );
          return;
        }

        // 4. Local public list did not match. Just show neutral/unhit state.
        badgeFor(anchor, key, sig, null);
      } finally {
        inFlight.delete(key);
      }
    }

    function scan() {
      const p = extractProfile();
      if (p) {
        const el = document.querySelector<HTMLElement>('[data-testid="UserName"]');
        if (el) {
          // Same skip rule as articles: untouched account + live mount → done.
          const hasMount = !!el.querySelector(":scope > .xss-mount");
          if (nodeHandle.get(el) !== p.handle || !hasMount) {
            if (nodeHandle.get(el) !== p.handle) clearMounts(el);
            nodeHandle.set(el, p.handle);
            void process(p, el, "profile");
          }
        }
      }
      // Account-keyed, NOT node-tagged: X virtualizes the list and recycles
      // <article> nodes, so a permanent per-node flag would skip recycled
      // (new) spam. Re-evaluate a node when its account changed or our badge
      // is missing; account-level cache/in-flight keep it cheap. Cheap key
      // first (link href only) — full extraction (fiber walk, innerText)
      // runs only for nodes that actually need (re-)processing.
      const topic = extractThreadTopic();
      // Reply detection: on a /user/status/<id> page every article whose own
      // permalink id differs from the focal id is a conversation reply — the
      // context where auto actions are allowed by default. Everything else
      // (home/list/search feeds, the focal tweet itself) is "feed".
      const focal = focalStatusId();
      for (const art of document.querySelectorAll<HTMLElement>(
        'article[data-testid="tweet"]',
      )) {
        const handle = handleFromArticle(art);
        const nameBlock = art.querySelector<HTMLElement>('[data-testid="User-Name"]');
        if (!handle || !nameBlock) continue;
        const hasMount = !!nameBlock.querySelector(":scope > .xss-mount");
        if (nodeHandle.get(art) === handle && hasMount) continue;
        const info = extractFromArticle(art);
        if (!info) continue;
        if (topic && !info.threadTopic) info.threadTopic = topic;
        if (nodeHandle.get(art) !== handle) clearMounts(nameBlock); // recycled node
        nodeHandle.set(art, handle);
        const sid = focal ? articleStatusId(art) : null;
        const ctx: ScanContext = focal && sid && sid !== focal ? "reply" : "feed";
        void process(info, nameBlock, ctx);
      }
    }

    const ui = await createShadowRootUi(ctx, {
      name: "xss-bubble",
      position: "overlay",
      anchor: "body",
      onMount(container) {
        const st = document.createElement("style");
        st.textContent = STYLE;
        container.appendChild(st);
        const bubble = createBubble({
          onProcess(keys: string[], onProgress: (key: string, ok: boolean) => void) {
            // Batch panel: the user explicitly confirmed, so act immediately
            // (no 5s undo window). Sequential await keeps the native X
            // mute/block calls on x-action's global pacing; the bubble's
            // chips/progress/rows advance on every onProgress callback.
            void (async () => {
              for (const key of keys) {
                const f = findings.find(
                  (x) => (x.userId || `h:${x.handle}`) === key,
                );
                if (!f) {
                  onProgress(key, false);
                  continue;
                }
                const sig: Signals = {
                  isProfile: false,
                  handle: f.handle,
                  displayName: f.displayName ?? "",
                  bio: "",
                  hasDefaultAvatar: false,
                  recentTweets: [],
                  ...(f.userId ? { userId: f.userId } : {}),
                  ...(f.avatarUrl ? { avatarUrl: f.avatarUrl } : {}),
                };
                // Take over any pending 5s-undo for this account — the batch
                // action supersedes the preview window.
                const pending = pendingActions.get(key);
                if (pending) {
                  clearTimeout(pending.timer);
                  pendingActions.delete(key);
                }
                const ok = await executeHide(key, sig).catch(() => false);
                onProgress(key, ok);
              }
            })();
          },
          onReviewEach() {
            const first = findings[0];
            if (first) {
              anchorByKey
                .get(first.userId || `h:${first.handle}`)
                ?.scrollIntoView({ behavior: "smooth", block: "center" });
            }
          },
          onDismiss() {
            dismissed = true;
          },
          onToggleAuto(v: boolean) {
            // Persist; the onSettingsChange listener updates `settings` (and
            // echoes the new state back into the bubble, a no-op here).
            void setSetting("autoProcess", v);
          },
        }, settings.bubblePos, actionVerb(settings.actionMode), {
          autoProcess: settings.autoProcess,
          autoCategoryCount: autoCategoryCount(settings),
          autoScopeAll: settings.autoScope === "all",
        });
        container.appendChild(bubble.el);
        if (!settings.bubble) bubble.el.style.display = "none";
        bubbleApi = bubble;
        return bubble;
      },
    });
    ui.mount();

    // SPA navigation: flush pending hides (the user already chose to hide;
    // the block is recorded even if the row's DOM is gone), then drop all
    // per-page state so detached DOM nodes can be garbage-collected.
    ctx.addEventListener(window, "wxt:locationchange", () => {
      for (const [key, p] of pendingActions) {
        clearTimeout(p.timer);
        void executeHide(key, p.sig);
      }
      pendingActions.clear();
      anchorByKey.clear();
      findings = [];
      bubbleApi?.update(findings);
    });

    let debounce: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver(() => {
      clearTimeout(debounce);
      debounce = setTimeout(scan, 600);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    ctx.onInvalidated(() => {
      observer.disconnect();
      clearTimeout(debounce);
    });
    // Periodic tick so newly virtualized rows are revisited even when the
    // user stops scrolling (no new DOM mutations). ctx-bound: stops when
    // the content script is invalidated.
    ctx.setInterval(scan, 4000);
    // List / whitelist hot-swap (background sync or 立即更新): the lookup
    // maps already rebuilt via local-index's own onChanged hook, but rows
    // rendered with the OLD data keep their badge (scan skips mounted
    // nodes). Drop every neutral badge so the next scan re-evaluates the
    // page against the fresh list. Pending/hidden rows are untouched.
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local" || (!changes[LIST_KEY] && !changes[WL_KEY])) return;
        for (const host of document.querySelectorAll<HTMLElement>(".xss-mount")) {
          // Badges live in the host's shadow root; keep pending-undo flows.
          if (host.shadowRoot?.querySelector(".xss-badge.pending")) continue;
          host.remove();
        }
        scan();
      });
    } catch {
      /* non-fatal */
    }
    scan();
  },
});
