import { addBlocked, isBlockedSync, warm as warmBlocklist } from "../lib/blocklist";
import { BRAND } from "../lib/brand";
import { type Cached, cacheGet, signalsHash } from "../lib/cache";
import { extractFromArticle, extractProfile, extractThreadTopic } from "../lib/detect";
import { CATEGORY_ZH } from "../lib/category";
import { type IndexEntry, isWhitelisted, lookupLocal, warmLocalIndex } from "../lib/local-index";
import { matchLocalRules } from "../lib/local-rules";
import { type ActionMode, getSettings, onSettingsChange } from "../lib/settings";
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

/** Fire X's native mute/block (best-effort, paced) with one retry. The local
 *  hide/record is applied separately and always — the X call rides on top. */
async function applyXAction(mode: ActionMode, sig: Signals): Promise<void> {
  if (mode === "local") return;
  const attempt = await performXAction(mode, sig.userId, sig.handle);
  if (!attempt.ok) {
    const delay = retryDelayForAttempt(attempt, 1);
    if (delay > 0) {
      await new Promise((r) => setTimeout(r, delay));
      await performXAction(mode, sig.userId, sig.handle); // one best-effort retry
    }
  }
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

function hideTweet(node: Element | null) {
  const cell =
    node?.closest('[data-testid="cellInnerDiv"]') ?? node?.closest("article");
  if (cell instanceof HTMLElement) cell.style.display = "none";
}

/** Each inline badge gets its own shadow host so X CSS can't touch it. */
function mountBadge(anchor: HTMLElement, build: () => HTMLElement) {
  const host = document.createElement("span");
  host.className = "xss-mount";
  host.style.display = "inline-flex";
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
    });

    // Warm local data structures
    await warmBlocklist();
    await warmLocalIndex();

    const keyOf = (s: Signals) => s.userId || `h:${s.handle}`;

    /** Schedule a hide action with a 5-second undo window. */
    function scheduleHide(key: string, sig: Signals, anchor: HTMLElement) {
      if (pendingActions.has(key)) return; // already pending
      // Tag the row so executeHide can still find it if X recycles the node.
      articleOf(anchor)?.setAttribute("data-xss-key", key);
      const timer = setTimeout(() => {
        executeHide(key, sig);
        pendingActions.delete(key);
      }, PENDING_MS);
      pendingActions.set(key, { key, sig, anchor, timer, ts: Date.now() });
      // Update UI to show pending state
      badgeForPending(anchor, sig);
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

    /** Execute the action after the preview window expires. The local record
     *  + visual hide always happen (so the row stays gone across navigation);
     *  if the user opted into "mute"/"block", X's native action rides on top
     *  via the user's own session (best-effort, paced). */
    function executeHide(key: string, sig: Signals) {
      const mode = settings.actionMode;
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
      void applyXAction(mode, sig);
      // X recycles article nodes: only hide via the captured anchor if it
      // still belongs to this account; otherwise use the tagged row, else
      // abort the DOM hide (the block itself is already recorded).
      const anchor = pendingActions.get(key)?.anchor ?? null;
      const art = articleOf(anchor);
      const sameAuthor =
        !!art && handleFromArticle(art)?.toLowerCase() === sig.handle.toLowerCase();
      const target = sameAuthor
        ? anchor
        : document.querySelector(`[data-xss-key="${CSS.escape(key)}"]`);
      if (target) hideTweet(target);
    }

    function badgeForPending(anchor: HTMLElement, sig: Signals) {
      clearMounts(anchor);
      const verb = actionVerb(settings.actionMode);
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
    ) {
      if (!hitPublicSeen.has(key)) {
        hitPublicSeen.add(key);
        void bumpStat("hitPublic");
      }
      // Per-category action policy: "badge" keeps the classic mark-only
      // behavior; hide/mute/block fire immediately (the account is on the
      // human-confirmed public list or hit a maintainer-curated rule — every
      // auto action is reversible from the 隐藏记录 tab, and mute/block
      // additionally ride the user's own X session like the manual path).
      const action = settings.categoryActions[entry.category] ?? "badge";
      if (action === "badge") {
        badgeFor(anchor, key, sig, entry.verdict, undefined, badgeSource);
        pushFinding(sig, entry.verdict, badgeSource === "rule" ? "local-rule" : "local-index");
        return;
      }
      void addBlocked(key);
      if (sig.userId) void addBlocked(sig.userId);
      void addBlockRecord({
        id: key,
        handle: sig.handle,
        ...(sig.displayName ? { displayName: sig.displayName } : {}),
        ...(sig.avatarUrl ? { avatarUrl: sig.avatarUrl } : {}),
        verdict: entry.verdict,
        source: "auto",
        ts: Date.now(),
      });
      void bumpStats({ blocks: 1 });
      void bumpStat("blocked");
      if (action === "mute" || action === "block") void applyXAction(action, sig);
      hideTweet(anchor);
    }

    async function process(sig: Signals, anchor: HTMLElement) {
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
          renderLocalIndex(anchor, key, sig, entry);
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
              source: "community",
              updatedAt: new Date().toISOString(),
            },
            "rule",
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
            void process(p, el);
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
        void process(info, nameBlock);
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
          onHideAll(keys: string[]) {
            // Schedule all hides with 5s undo window
            for (const key of keys) {
              const anchor = anchorByKey.get(key);
              if (anchor) {
                // Find the signals from findings
                const f = findings.find(
                  (x) => (x.userId || `h:${x.handle}`) === key,
                );
                if (f) {
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
                  scheduleHide(key, sig, anchor);
                }
              }
            }
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
        }, settings.bubblePos, actionVerb(settings.actionMode));
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
        executeHide(key, p.sig);
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
    scan();
  },
});
