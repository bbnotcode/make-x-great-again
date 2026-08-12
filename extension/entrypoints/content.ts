import { hideAccountSurface, showAccountSurface } from "../lib/account-surface";
import {
  type FollowVerification,
  automaticActionDisposition,
  autoEligible,
  capAutoTierAction,
  capUnverifiedFollowingAction,
  viewerProtected,
} from "../lib/auto-policy";
import { addBlocked, isBlockedSync, warm as warmBlocklist } from "../lib/blocklist";
import { BRAND } from "../lib/brand";
import { BIO_RULE_MODEL, type Cached, cacheGet, cacheSet, signalsHash } from "../lib/cache";
import { BIO_RULE_VERSION, bioEvidenceHash, matchStrongPornBio } from "../lib/bio-rules";
import {
  extractFromArticle,
  extractProfile,
  extractThreadTopic,
  visibleViewerRelationships,
  viewerHandle,
} from "../lib/detect";
import { CATEGORY_ZH } from "../lib/category";
import { LIST_KEY, WL_KEY } from "../lib/list-sync";
import { LOCAL_ALLOWLIST_KEY } from "../lib/local-allowlist";
import {
  type IndexEntry,
  isWhitelisted,
  warmLocalProtections,
} from "../lib/local-index";
import { matchLocalRules } from "../lib/local-rules";
import { compileRegexRules, matchRegexText } from "../lib/regex-filter";
import {
  type QuickActionResult,
  type QuickXAction,
  mountQuickActions,
} from "../lib/quick-actions";
import {
  rememberVisibleRelationship,
  verifyXFollowing,
} from "../lib/follow-verifier";
import {
  type ActionMode,
  type CategoryAction,
  type Settings,
  getSettings,
  onSettingsChange,
  setSetting,
} from "../lib/settings";
import { bumpStat } from "../lib/stats";
import {
  K_QUEUE_CONTROL,
  addBlockRecord,
  addPendingAction,
  bumpStats,
  cancelAutomaticBlock,
  clearPendingAction,
  commitAutomaticDecision,
  getBlocklist,
  getPendingActions,
  getQueueControl,
  isIndependentPendingSource,
  pauseQueue,
  setQueuePaused,
  updateBlockRecord,
  updatePendingAction,
} from "../lib/store";
import type { Signals, Verdict } from "../lib/types";
import {
  type BadgeSource,
  type Finding,
  STYLE,
  createActingBadge,
  createBadge,
  createBubble,
} from "../lib/ui";

/** "误判申诉" — opens the GitHub appeal issue template, PRE-FILLED with the
 *  account's handle / user id / title so the user only writes the reason and
 *  submits. Zero remote requests from the extension itself; the appeal is
 *  filed on GitHub (the template field ids are handle / userid). */
function openAppeal(appeal?: { handle: string; userId?: string }): void {
  let url = BRAND.appealNewIssue;
  if (appeal?.handle) {
    const p = new URLSearchParams();
    p.set("handle", `@${appeal.handle}`);
    if (appeal.userId) p.set("userid", appeal.userId);
    p.set("title", `[Appeal] @${appeal.handle} wrongly listed`);
    url += `&${p.toString()}`;
  }
  window.open(url, "_blank", "noopener");
}

const PENDING_RESUME_LOCK = "mxga-pending-resume";
const queueSucceededIds = new Set<string>();
const queueFailedIds = new Set<string>();
const queueProtectedIds = new Set<string>();

/** Chrome leaves an old content-script world alive when an unpacked extension
 * is reloaded. Its DOM observers/timers can still run, but every extension API
 * call then throws "Extension context invalidated" until the page is rebuilt.
 * Detect two consecutive invalid checks, wait for Chrome to finish loading the
 * new worker, and refresh this X tab once. sessionStorage prevents loops. */
function installContextReloadRecovery(): void {
  const RECOVERY_KEY = "mxga:context-reload-recovery";
  let misses = 0;
  const timer = window.setInterval(() => {
    try {
      chrome.runtime.getManifest();
      misses = 0;
      return;
    } catch {
      misses++;
    }
    if (misses < 2) return;
    window.clearInterval(timer);
    try {
      const last = Number(sessionStorage.getItem(RECOVERY_KEY) || 0);
      if (Date.now() - last < 15_000) return;
      sessionStorage.setItem(RECOVERY_KEY, String(Date.now()));
    } catch {
      /* sessionStorage blocked — a single timer still guarantees one reload */
    }
    // Let Chrome finish starting the replacement extension context first.
    window.setTimeout(() => location.reload(), 800);
  }, 750);
}

/** Report an unlisted account to the public review queue. GitHub-authed
 *  contribution: the token gates who can report (server enforces a 90-day
 *  account-age floor, 10/hour rate limit, one-vote-per-target dedup, reporter
 *  bans, and — auto-publish being off — every report just queues for a
 *  maintainer to confirm). The extension only surfaces the outcome; it never
 *  auto-lists anything. Returns a short line for the popover to show inline. */
async function reportSpam(sig: Signals): Promise<{ ok: boolean; message: string }> {
  // The POST runs in the BACKGROUND (see BgRequest "report"): a content-script
  // fetch to the edge Worker is bound by x.com's CORS/CSP; the SW shares the
  // extension origin the whitelist-apply flow already reports from.
  let resp:
    | { ok: boolean; error?: string; data?: { status: number; body: ReportBody } }
    | undefined;
  try {
    resp = await chrome.runtime.sendMessage({ type: "report", sig });
  } catch {
    return { ok: false, message: "网络错误，举报未提交" };
  }
  if (!resp || !resp.ok) {
    if (resp?.error === "no_token") {
      try {
        chrome.runtime.sendMessage({ type: "open_options" });
      } catch {
        /* best-effort */
      }
      return { ok: false, message: "举报需先在设置页用 GitHub 授权（已为你打开设置）" };
    }
    return { ok: false, message: "网络错误，举报未提交" };
  }
  const { status, body } = resp.data ?? { status: 0, body: {} as ReportBody };
  if (status >= 200 && status < 300 && body.ok) {
    if (body.duplicate) return { ok: true, message: "你已举报过该账号，感谢" };
    if (body.status === "whitelisted")
      return { ok: true, message: "该账号已被官方列入白名单，举报已忽略" };
    if (body.status === "viewer_ignored")
      return { ok: true, message: "这是你自己的账号，举报已忽略" };
    return { ok: true, message: "已举报，进入人工审核队列，感谢贡献" };
  }
  switch (status) {
    case 401:
      try {
        chrome.runtime.sendMessage({ type: "open_options" });
      } catch {
        /* best-effort */
      }
      return { ok: false, message: "GitHub 授权已失效，请在设置页重新授权" };
    case 403:
      return { ok: false, message: "你的举报权限已被限制" };
    case 429:
      return { ok: false, message: "举报过于频繁，请稍后再试" };
    case 503:
      return { ok: false, message: "服务暂未就绪，请稍后再试" };
    default:
      return { ok: false, message: "举报失败，请稍后重试" };
  }
}

interface ReportBody {
  ok?: boolean;
  status?: string;
  duplicate?: boolean;
  error?: string;
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

/** Sleep without polling storage. Any queue-control or pending-list change
 * wakes the waiter immediately; the post-registration read closes the small
 * check→listen race between tabs. */
async function waitForQueueChange(pendingId: string): Promise<void> {
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      chrome.storage.onChanged.removeListener(onChanged);
      resolve();
    };
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (
        area === "local" &&
        (changes[K_QUEUE_CONTROL] || changes["xss:pending-actions"])
      )
        finish();
    };
    chrome.storage.onChanged.addListener(onChanged);
    void Promise.all([getQueueControl(), getPendingActions()]).then(
      ([control, tasks]) => {
        if (!control.paused || !tasks.some((item) => item.id === pendingId)) finish();
      },
      finish,
    );
  });
}

/** Fire X's native mute/block (best-effort, paced) with one retry. The local
 *  hide/record is applied separately and always — the X call rides on top.
 *  Returns false only when the native X action definitively failed (used by
 *  the bubble's batch panel to surface a per-row 重试 state). */
async function applyXAction(
  mode: ActionMode,
  sig: Signals,
  pendingId?: string,
): Promise<boolean> {
  if (mode === "local") return true;
  const execute = async () => {
    // Load the mutation client only after the user explicitly chooses a native
    // X action and grants the optional host permission.
    const { classifyXActionFailure, performXAction, retryDelayForAttempt } = await import(
      "../lib/x-action"
    );
    let lastAttempt: Awaited<ReturnType<typeof performXAction>> | undefined;
    let attempts = 0;
    for (let tries = 1; tries <= 3; tries++) {
      attempts = tries;
      const attempt = await performXAction(mode, sig.userId, sig.handle);
      lastAttempt = attempt;
      if (attempt.ok) return { ok: true as const, attempts: tries };
      const delay = retryDelayForAttempt(attempt, tries);
      if (!delay || tries === 3) break;
      await new Promise((r) => setTimeout(r, delay));
    }
    const failure = classifyXActionFailure(lastAttempt ?? { ok: false, retryable: true });
    return { ok: false as const, attempts, failure };
  };
  if (!pendingId) return execute().then((result) => result.ok);
  const runOnce = async () => {
    while ((await getQueueControl()).paused) {
      // Cancellation must take effect even while the whole queue is paused.
      // Previously this loop waited forever until the user resumed, leaving
      // a cancelled quick-action button stuck in the queued state.
      if (!(await getPendingActions()).some((item) => item.id === pendingId)) return false;
      await waitForQueueChange(pendingId);
    }
    const row = (await getPendingActions()).find((item) => item.id === pendingId);
    if (!row) return false; // cancelled while waiting (or already settled elsewhere)
    await updatePendingAction(pendingId, {
      status: "running",
      attempts: row.attempts ?? 0,
      lastError: undefined,
      nextAttemptAt: undefined,
    });
    let result: Awaited<ReturnType<typeof execute>>;
    try {
      result = await execute();
    } catch (error) {
      queueFailedIds.add(pendingId);
      await updatePendingAction(pendingId, {
        status: "failed",
        attempts: (row.attempts ?? 0) + 1,
        lastError: `扩展内部异常：${error instanceof Error ? error.message : String(error)}`,
      });
      return false;
    }
    if (result.ok) {
      queueSucceededIds.add(pendingId);
      queueFailedIds.delete(pendingId);
      await clearPendingAction(pendingId);
    }
    else {
      const attempts = (row.attempts ?? 0) + result.attempts;
      const retryable =
        (result.failure.kind === "network" || result.failure.kind === "server") &&
        attempts < 9;
      const nextAttemptAt = retryable
        ? Date.now() + Math.min(30 * 60_000, 15_000 * 2 ** Math.floor(attempts / 3))
        : undefined;
      await updatePendingAction(pendingId, {
        status: retryable ? "queued" : "failed",
        attempts,
        nextAttemptAt,
        lastError: retryable
          ? `${result.failure.message}（将在后台自动重试）`
          : `${result.failure.message}（本轮尝试 ${result.attempts} 次）`,
      });
      if (!retryable) queueFailedIds.add(pendingId);
      if (result.failure.shouldPauseQueue) {
        await pauseQueue(`${result.failure.message}；请检查后再继续队列`);
      }
    }
    return result.ok;
  };
  const locks = (
    navigator as Navigator & {
      locks?: { request<T>(name: string, callback: () => Promise<T>): Promise<T> };
    }
  ).locks;
  return locks
    ? locks.request(`mxga-pending-account:${pendingId}`, runOnce)
    : runOnce();
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

/** X virtualizes long timelines, but can retain a buffer of detached-looking
 * rows well outside the viewport. Full fallback scans only need a generous
 * two-screen margin; MutationObserver still handles newly inserted rows. */
function isNearViewport(el: HTMLElement, margin = Math.max(900, innerHeight * 2)): boolean {
  const rect = el.getBoundingClientRect();
  return rect.bottom >= -margin && rect.top <= innerHeight + margin;
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

function showTweet(node: Element | null) {
  const cell =
    node?.closest('[data-testid="cellInnerDiv"]') ?? node?.closest("article");
  if (cell instanceof HTMLElement) {
    showAccountSurface(cell);
    cell.removeAttribute(REGEX_HIDDEN_ATTR);
    cell.removeAttribute("data-mxga-regex-rule");
  }
}

const REGEX_HIDDEN_ATTR = "data-mxga-regex-hidden";

function regexCell(art: HTMLElement): HTMLElement {
  return (
    (art.closest('[data-testid="cellInnerDiv"]') as HTMLElement | null) ?? art
  );
}

function restoreRegexHidden(): void {
  for (const cell of document.querySelectorAll<HTMLElement>(`[${REGEX_HIDDEN_ATTR}]`)) {
    showAccountSurface(cell);
    cell.removeAttribute(REGEX_HIDDEN_ATTR);
    cell.removeAttribute("data-mxga-regex-rule");
  }
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
  /** Triggering tweet, captured while the DOM anchor is still alive —
   *  lands in the 处理记录 audit trail. */
  tweetId?: string;
  tweetText?: string;
}

export default defineContentScript({
  matches: ["https://x.com/*", "https://twitter.com/*"],
  cssInjectionMode: "ui",
  async main(ctx) {
    installContextReloadRecovery();
    let bubbleApi: ReturnType<typeof createBubble> | null = null;
    async function syncQueueBubble(): Promise<void> {
      const [tasks, control] = await Promise.all([getPendingActions(), getQueueControl()]);
      const now = Date.now();
      const nextRetryAt = tasks
        .map((task) => task.nextAttemptAt)
        .filter((at): at is number => typeof at === "number" && at > now)
        .sort((a, b) => a - b)[0];
      const active = tasks.filter((task) => task.status !== "failed").length;
      // Failed rows remain persisted so the user can inspect/retry them, but
      // they are not active work. Counting every stored row made the pill
      // spin forever as “后台处理 1” after a failed request/cache reset.
      bubbleApi?.setQueueStatus(active, control.paused, control.reason, {
        quick: tasks.filter((task) => task.source === "quick").length,
        regex: tasks.filter((task) => task.source === "regex").length,
        bio: tasks.filter((task) => task.source === "bio_rule").length,
        auto: tasks.filter((task) => !["quick", "regex", "bio_rule"].includes(task.source ?? "auto")).length,
        running: tasks.filter((task) => task.status === "running").length,
        failed: tasks.filter((task) => task.status === "failed").length,
        retrying: tasks.filter((task) => (task.nextAttemptAt ?? 0) > now).length,
        succeeded: queueSucceededIds.size,
        protectedSkipped: queueProtectedIds.size,
        estimatedMs: active * 1_900 + Math.max(0, (nextRetryAt ?? now) - now),
        ...(nextRetryAt ? { nextRetryAt } : {}),
      });
    }

    function recordProtectedSkip(key: string) {
      queueProtectedIds.add(key);
      void syncQueueBubble();
    }
    let dismissed = false;
    const anchorByKey = new Map<string, HTMLElement>();
    const nodeHandle = new WeakMap<HTMLElement, string>(); // virtualization-safe
    let findings: Finding[] = [];
    const pendingActions = new Map<string, PendingAction>();
    const inFlight = new Set<string>(); // keys currently in process()
    const hitPublicSeen = new Set<string>(); // hitPublic stat: once per account
    const followedKeys = new Set<string>();
    const learnedBioHandles = new Set<string>();

    async function handleStrongBio(sig: Signals, anchor: HTMLElement): Promise<boolean> {
      if (!settings.botDetectionEnabled) return false;
      const hit = matchStrongPornBio(sig.bio);
      if (!hit) return false;
      const key = keyOf(sig);
      if (isWhitelisted(sig.userId, sig.handle)) return true;
      if ((await protectDetectedFollow(sig, anchor, key)) === "following") return true;
      const verdict: Verdict = { label: hit.label, confidence: 0.99, reasons: hit.reasons };
      const evidenceHash = bioEvidenceHash(sig.bio);
      const cached: Cached = {
        verdict,
        signalsHash: signalsHash(sig),
        model: BIO_RULE_MODEL,
        ts: Date.now(),
        handle: sig.handle,
        ...(sig.displayName ? { displayName: sig.displayName } : {}),
        ...(sig.avatarUrl ? { avatarUrl: sig.avatarUrl } : {}),
      };
      await Promise.all([
        cacheSet(key, cached),
        ...(key !== `h:${sig.handle}` ? [cacheSet(`h:${sig.handle}`, cached)] : []),
      ]);
      learnedBioHandles.add(sig.handle.toLowerCase());
      pushFinding(sig, verdict, "bio-rule", {
        categoryZh: "色情引流简介",
        ...(articleStatusId(articleOf(anchor)!) ? { tweetId: articleStatusId(articleOf(anchor)!) ?? undefined } : {}),
      });
      let action = settings.autoProcess ? settings.botDetectionAction : "badge";
      // A handle can be renamed or later re-registered. Irreversible block
      // requires the immutable X user id; without it, safely degrade to mute.
      const downgradedBlock = action === "block" && !sig.userId;
      if (downgradedBlock) action = "mute";
      if (action === "badge") {
        badgeFor(anchor, key, sig, verdict, `个人简介：${hit.rule} · 已在本机记住此账号`, "bio-rule");
      } else {
        // enqueueAuto persists the blocked record AND unfinished native task
        // before its visual queue starts. Leaving this post immediately can
        // therefore never cancel or lose a mute/block promised here.
        enqueueAuto({
          key,
          sig,
          action,
          verb: action === "hide" ? "隐藏" : actionVerb(action),
          anchor,
          verdict,
          categoryZh: downgradedBlock ? "色情引流简介 · 无数字 ID，拉黑已降级为静音" : "色情引流简介",
          badgeSource: "bio-rule",
          pendingSource: "bio_rule",
          ruleVersion: BIO_RULE_VERSION,
          evidenceHash,
          ...(articleStatusId(articleOf(anchor)!)
            ? { tweetId: articleStatusId(articleOf(anchor)!) ?? undefined }
            : {}),
        });
      }
      return true;
    }

    /** X creates this card only after a natural user hover. Read it passively,
     * associate it by the profile link, then enrich every visible reply by
     * that account. No synthetic pointer events and no network requests. */
    function learnVisibleHoverCards(root: ParentNode = document): void {
      const candidates = new Set<HTMLElement>();
      const addCandidate = (el: HTMLElement) => {
        // X currently renders hover cards in a portal without a stable
        // UserDescription/HoverCard test id. Inspect only newly-added,
        // reasonably-sized floating subtrees whose text matches our exact
        // template; ordinary timeline articles are explicitly excluded.
        if (el.closest('article[data-testid="tweet"], [data-testid="primaryColumn"]')) return;
        let candidate: HTMLElement | null = el;
        // A mutation is often the bio <span>, while the owner profile link is
        // several wrappers above it. Walk only this short portal branch until
        // both the fixed template and an owner-style /handle link coexist.
        for (let depth = 0; candidate && depth < 8; depth++, candidate = candidate.parentElement) {
          if (candidate.closest('article[data-testid="tweet"], [data-testid="primaryColumn"]')) break;
          const text = candidate.innerText?.trim() ?? "";
          const hasProfileLink = [...candidate.querySelectorAll<HTMLAnchorElement>('a[href^="/"]')]
            .some((a) => /^\/[A-Za-z0-9_]{1,15}$/.test((a.getAttribute("href") ?? "").split(/[?#]/)[0] ?? ""));
          if (text.length >= 20 && text.length <= 1200 && hasProfileLink && matchStrongPornBio(text)) {
            candidates.add(candidate);
            break;
          }
        }
      };
      if (root instanceof HTMLElement) {
        addCandidate(root);
        for (const el of root.querySelectorAll<HTMLElement>('[data-testid="UserDescription"], [role="dialog"], [data-testid="HoverCard"]')) addCandidate(el);
      } else {
        for (const el of root.querySelectorAll<HTMLElement>('[data-testid="UserDescription"], [role="dialog"], [data-testid="HoverCard"]')) addCandidate(el);
      }
      for (const card of candidates) {
        const bio = card.innerText.trim();
        const visibleAuthors = new Set(
          [...document.querySelectorAll<HTMLElement>('article[data-testid="tweet"]')]
            .map((article) => handleFromArticle(article)?.toLowerCase())
            .filter((handle): handle is string => !!handle),
        );
        const linkedAuthors = new Set(
          [...card.querySelectorAll<HTMLAnchorElement>('a[href^="/"]')]
            .map((a) => (a.getAttribute("href") ?? "").split(/[?#]/)[0] ?? "")
            .filter((path) => /^\/[A-Za-z0-9_]{1,15}$/.test(path))
            .map((path) => path.slice(1).toLowerCase())
            .filter((handle) => visibleAuthors.has(handle)),
        );
        // A bio may advertise another @account. Only one profile-link handle
        // may also be a visible reply author; ambiguity means no auto action.
        if (linkedAuthors.size !== 1) continue;
        const handle = [...linkedAuthors][0];
        if (!handle || learnedBioHandles.has(handle)) continue;
        for (const article of document.querySelectorAll<HTMLElement>('article[data-testid="tweet"]')) {
          if (handleFromArticle(article)?.toLowerCase() !== handle.toLowerCase()) continue;
          const anchor = article.querySelector<HTMLElement>('[data-testid="User-Name"]');
          const sig = extractFromArticle(article);
          if (anchor && sig) void handleStrongBio({ ...sig, bio }, anchor);
        }
      }
    }

    function followedKeyForHandle(handle: string): string {
      return `h:${handle.trim().replace(/^@+/, "").toLowerCase()}`;
    }

    function rememberFollowed(sig: Signals) {
      if (!sig.viewerFollowing) return;
      followedKeys.add(followedKeyForHandle(sig.handle));
      if (sig.userId) followedKeys.add(sig.userId);
    }

    function isFollowProtected(sig: Signals): boolean {
      rememberFollowed(sig);
      return (
        viewerProtected(sig) ||
        followedKeys.has(followedKeyForHandle(sig.handle)) ||
        (!!sig.userId && followedKeys.has(sig.userId))
      );
    }

    /** Relationship controls often live outside the tweet article. Refresh
     * them before extracting posts so one profile-level "正在关注" protects
     * every article by that author on the page. */
    function refreshVisibleRelationships() {
      for (const rel of visibleViewerRelationships()) {
        const keys = [
          rel.userId,
          ...(rel.handle ? [followedKeyForHandle(rel.handle)] : []),
        ];
        for (const key of keys) {
          if (rel.following) followedKeys.add(key);
          else followedKeys.delete(key);
        }
        if (rel.handle) rememberVisibleRelationship(rel.handle, rel.following);
      }
    }

    let settings = await getSettings();
    let regexRules = compileRegexRules(settings.regexRules).compiled;
    if (!settings.enabled) return; // master off → don't init (applies next load)
    // Build marker — confirms which content-script build is live in this tab
    // (reloading the unpacked extension does NOT refresh already-open tabs).
    console.info("[MXGA] content script ready · build 2026-07-27 (quick-native-actions)");
    const unsubscribeSettings = onSettingsChange((s) => {
      const modeChanged = s.actionMode !== settings.actionMode;
      const bioActionChanged = s.botDetectionAction !== settings.botDetectionAction;
      const previewChanged = s.previewMode !== settings.previewMode;
      const regexChanged =
        s.regexEnabled !== settings.regexEnabled ||
        s.regexScope !== settings.regexScope ||
        s.regexRules.join("\n") !== settings.regexRules.join("\n");
      settings = s;
      if (bioActionChanged) {
        void getPendingActions().then((tasks) => {
          if (tasks.some((task) => task.source === "bio_rule" && task.status !== "failed")) {
            return pauseQueue("简介处理方式已改变；为避免按旧设置执行，队列已暂停，请检查后继续");
          }
        }).then(() => syncQueueBubble());
      }
      if (regexChanged) {
        regexRules = compileRegexRules(s.regexRules).compiled;
        restoreRegexHidden();
      }
      // Keep the bubble's 自动处理 switch + hint in sync (options page or
      // another tab may have flipped it).
      bubbleApi?.setAutoProcess(s.autoProcess, autoCategoryCount(s), s.autoScope === "all");
      bubbleApi?.setAutoExpand(s.autoExpand);
      if (modeChanged) {
        // Mounted badges rendered the OLD verb into their buttons, but a
        // click executes the CURRENT actionMode — a button reading 隐藏 must
        // never actually 拉黑. Sync the bubble's label and drop every
        // non-pending badge so the next scan re-renders with the real verb.
        bubbleApi?.setVerb(actionVerb(s.actionMode));
        for (const host of document.querySelectorAll<HTMLElement>(".xss-mount")) {
          if (host.shadowRoot?.querySelector(".xss-badge.pending")) continue;
          host.remove();
        }
        scan();
      }
      if (previewChanged) {
        for (const host of document.querySelectorAll<HTMLElement>(".xss-mount")) {
          if (host.shadowRoot?.querySelector(".xss-badge.pending")) continue;
          host.remove();
        }
        scan();
      }
      if (regexChanged) scan();
    });

    // Warm local data structures
    await warmBlocklist();
    await warmLocalProtections();

    // Handles from the audit records let the mutation fast-path recognize an
    // account without walking X's React fiber for its numeric user id.
    let blockedHandles = new Set(
      (await getBlocklist()).map((record) => record.handle.toLowerCase()),
    );

    const keyOf = (s: Signals) => s.userId || `h:${s.handle}`;
    const listLookupCache = new Map<string, IndexEntry | null>();
    const LIST_LOOKUP_CACHE_MAX = 1_000;
    const LIST_LOOKUP_BATCH_MAX = 100;
    type LookupResult = IndexEntry | null | undefined;
    const pendingListLookups = new Map<
      string,
      { sig: Signals; resolve: Array<(entry: LookupResult) => void> }
    >();
    let listLookupTimer: ReturnType<typeof setTimeout> | undefined;

    function rememberListLookup(cacheKey: string, entry: IndexEntry | null): void {
      listLookupCache.set(cacheKey, entry);
      if (listLookupCache.size <= LIST_LOOKUP_CACHE_MAX) return;
      const oldest = listLookupCache.keys().next().value as string | undefined;
      if (oldest) listLookupCache.delete(oldest);
    }

    function scheduleListLookupBatch(): void {
      if (listLookupTimer) return;
      listLookupTimer = setTimeout(() => void flushListLookupBatch(), 30);
    }

    async function flushListLookupBatch(): Promise<void> {
      listLookupTimer = undefined;
      const batch = [...pendingListLookups.entries()].slice(0, LIST_LOOKUP_BATCH_MAX);
      for (const [cacheKey] of batch) pendingListLookups.delete(cacheKey);
      if (!batch.length) return;
      let results: Array<IndexEntry | null> | undefined;
      try {
        const response = (await chrome.runtime.sendMessage({
          type: "list-lookup-batch",
          identities: batch.map(([, item]) => ({
            ...(item.sig.userId ? { userId: item.sig.userId } : {}),
            handle: item.sig.handle,
          })),
        })) as { ok?: boolean; data?: Array<IndexEntry | null> } | undefined;
        if (response?.ok && Array.isArray(response.data) && response.data.length === batch.length) {
          results = response.data;
        }
      } catch {
        // The periodic recovery scan retries after the background wakes.
      }
      batch.forEach(([cacheKey, item], index) => {
        const entry = results?.[index];
        if (entry !== undefined) rememberListLookup(cacheKey, entry);
        for (const resolve of item.resolve) resolve(entry);
      });
      if (pendingListLookups.size) scheduleListLookupBatch();
    }

    function lookupPublicList(sig: Signals): Promise<LookupResult> {
      if (isWhitelisted(sig.userId, sig.handle)) return Promise.resolve(null);
      const cacheKey = `${sig.userId ?? ""}|${sig.handle.toLowerCase()}`;
      if (listLookupCache.has(cacheKey)) {
        return Promise.resolve(listLookupCache.get(cacheKey) ?? null);
      }
      return new Promise((resolve) => {
        const pending = pendingListLookups.get(cacheKey);
        if (pending) pending.resolve.push(resolve);
        else pendingListLookups.set(cacheKey, { sig, resolve: [resolve] });
        scheduleListLookupBatch();
      });
    }
    const regexMuteInFlight = new Set<string>();
    const regexDecisionInFlight = new Set<string>();
    const quickActionInFlight = new Set<string>();

    /** Explicit post-header shortcut. Unlike automatic list/rule handling,
     * this intentionally does not apply followed-account protection: the user
     * made a direct, account-specific choice. The logged-in viewer is still
     * protected from accidental self-action. */
    async function runQuickAction(
      action: QuickXAction,
      sig: Signals,
      article: HTMLElement,
    ): Promise<QuickActionResult> {
      const viewer = viewerHandle()?.toLowerCase();
      if (viewer && viewer === sig.handle.toLowerCase()) {
        return { ok: false, message: "不能对自己的账号执行此操作" };
      }
      const key = keyOf(sig);
      const flightKey = `${action}:${key}`;
      if (quickActionInFlight.has(flightKey)) {
        return { ok: false, message: "此操作正在处理中" };
      }
      quickActionInFlight.add(flightKey);
      try {
        const accepted = await addPendingAction({
          id: key,
          handle: sig.handle,
          action,
          source: "quick",
          ts: Date.now(),
        });
        if (!accepted) {
          quickActionInFlight.delete(flightKey);
          return { ok: false, message: "队列已达 200 条并自动暂停，请先处理队列" };
        }
        // Queue first, acknowledge immediately. performXAction's global Web
        // Lock puts this request behind only the currently-running action;
        // the automatic loop cannot request its next item until that action
        // settles, so an explicitly clicked task naturally jumps ahead of the
        // remaining automatic backlog without interrupting an in-flight call.
        const completion = finishQuickAction(action, sig, article, accepted, flightKey);
        return {
          ok: true,
          message: action === "block" ? "已加入拉黑队列" : "已加入静音队列",
          completion,
        };
      } catch {
        quickActionInFlight.delete(flightKey);
        return { ok: false, message: "加入队列失败，请稍后重试" };
      }
    }

    async function finishQuickAction(
      action: QuickXAction,
      sig: Signals,
      article: HTMLElement,
      key: string,
      flightKey: string,
    ): Promise<{ ok: boolean; message: string }> {
      try {
        const ok = await applyXAction(action, sig, key).catch(() => false);
        if (!ok) {
          return {
            ok: false,
            message: `X 原生${action === "block" ? "拉黑" : "静音"}失败，请重试`,
          };
        }
        await Promise.all([
          addBlocked(key),
          ...(sig.userId ? [addBlocked(sig.userId)] : []),
          addBlockRecord({
            id: key,
            handle: sig.handle,
            ...(sig.displayName ? { displayName: sig.displayName } : {}),
            ...(sig.avatarUrl ? { avatarUrl: sig.avatarUrl } : {}),
            ...(articleStatusId(article)
              ? { tweetId: articleStatusId(article) ?? undefined }
              : {}),
            ...(sig.triggeringComment ? { tweetText: sig.triggeringComment } : {}),
            reason: `帖子快捷按钮 · X 原生${action === "block" ? "拉黑" : "静音"}成功`,
            source: "manual",
            ts: Date.now(),
          }),
        ]);
        void bumpStats({ blocks: 1 });
        void bumpStat("blocked");
        hideAccountSurface(article);
        return {
          ok: true,
          message: action === "block" ? "X 原生拉黑成功" : "X 原生静音成功",
        };
      } catch {
        return { ok: false, message: "后台操作失败，请重试" };
      } finally {
        // applyXAction settles the durable pending marker whether X succeeds
        // or fails. The next click is then a fresh explicit request.
        quickActionInFlight.delete(flightKey);
      }
    }

    /** A regex hit is hidden immediately, then the author is muted through
     *  X's own endpoint using the existing globally paced action queue. The
     *  local block record is written first so a tab close or failed X call
     *  never loses the audit/recovery trail. */
    async function muteRegexHit(
      sig: Signals,
      rule: string,
      tweetId: string | undefined,
      allowNative: boolean,
    ): Promise<void> {
      const key = keyOf(sig);
      if (
        regexMuteInFlight.has(key) ||
        isBlockedSync(key) ||
        (sig.userId && isBlockedSync(sig.userId)) ||
        isBlockedSync(`h:${sig.handle}`)
      ) {
        return;
      }
      regexMuteInFlight.add(key);
      const tweetText = sig.triggeringComment || sig.recentTweets[0];
      try {
        await addBlocked(key);
        if (sig.userId) await addBlocked(sig.userId);
        await addBlockRecord({
          id: key,
          handle: sig.handle,
          ...(sig.displayName ? { displayName: sig.displayName } : {}),
          ...(sig.avatarUrl ? { avatarUrl: sig.avatarUrl } : {}),
          ...(tweetId ? { tweetId } : {}),
          ...(tweetText ? { tweetText } : {}),
          reason: allowNative
            ? `正则命中 · X 原生静音处理中 · ${rule.slice(0, 80)}`
            : `正则命中 · 关注关系无法确认，仅本地隐藏 · ${rule.slice(0, 80)}`,
          source: "regex",
          ts: Date.now(),
        });
        void bumpStats({ blocks: 1 });
        void bumpStat("blocked");
        if (!allowNative) return;
        // Persist before entering the shared paced queue. If this page closes
        // while the queue waits on another tab/cooldown, the next page load
        // can resume the promised native mute instead of leaving it local-only.
        const accepted = await addPendingAction({
          id: key,
          handle: sig.handle,
          action: "mute",
          source: "regex",
          ts: Date.now(),
        });
        if (!accepted) {
          await updateBlockRecord(key, {
            reason: `正则命中 · 队列容量保护，仅本地隐藏 · ${rule.slice(0, 80)}`,
          });
          return;
        }
        const ok = await applyXAction("mute", sig, accepted).catch(() => false);
        await updateBlockRecord(key, {
          reason: ok
            ? `正则命中 · X 原生静音成功 · ${rule.slice(0, 80)}`
            : `正则命中 · X 静音失败，仅本地隐藏 · ${rule.slice(0, 80)}`,
        });
      } finally {
        regexMuteInFlight.delete(key);
      }
    }

    async function protectDetectedFollow(
      sig: Signals,
      anchor: HTMLElement,
      key: string,
    ): Promise<FollowVerification> {
      if (isFollowProtected(sig)) {
        recordProtectedSkip(key);
        showAccountSurface(anchor);
        showTweet(articleOf(anchor));
        markViewerProtected(anchor, key);
        return "following";
      }
      const following = await verifyXFollowing(sig.handle);
      if (following === null) return "unknown";
      if (!following) return "not_following";
      recordProtectedSkip(key);
      sig.viewerFollowing = true;
      rememberFollowed(sig);
      showAccountSurface(anchor);
      showTweet(articleOf(anchor));
      markViewerProtected(anchor, key);
      return "following";
    }

    async function handleRegexCandidate(
      art: HTMLElement,
      anchor: HTMLElement,
      cell: HTMLElement,
      sig: Signals,
      rule: string,
    ): Promise<void> {
      const key = keyOf(sig);
      if (regexDecisionInFlight.has(key)) return;
      regexDecisionInFlight.add(key);
      try {
        if (isWhitelisted(sig.userId, sig.handle)) {
          showAccountSurface(cell);
          cell.removeAttribute(REGEX_HIDDEN_ATTR);
          cell.removeAttribute("data-mxga-regex-rule");
          return;
        }
        const relationship = await protectDetectedFollow(sig, anchor, key);
        if (relationship === "following") return;
        if (settings.previewMode) {
          showAccountSurface(cell);
          cell.removeAttribute(REGEX_HIDDEN_ATTR);
          cell.removeAttribute("data-mxga-regex-rule");
          const verdict: Verdict = {
            label: "spam",
            confidence: 1,
            reasons: ["命中用户正则表达式"],
          };
          badgeFor(
            anchor,
            key,
            sig,
            verdict,
            relationship === "unknown"
              ? "安全预览：正则命中；关注关系无法确认，实际运行时仅本地隐藏"
              : "安全预览：正则命中；原计划本地隐藏并使用 X 静音",
          );
          pushFinding(sig, verdict, "regex-preview", {
            ...(articleStatusId(art) ? { tweetId: articleStatusId(art) ?? undefined } : {}),
          });
          return;
        }
        cell.setAttribute(REGEX_HIDDEN_ATTR, "");
        cell.setAttribute("data-mxga-regex-rule", rule.slice(0, 120));
        hideAccountSurface(cell);
        await muteRegexHit(
          sig,
          rule,
          articleStatusId(art) ?? undefined,
          relationship === "not_following",
        );
      } finally {
        regexDecisionInFlight.delete(key);
      }
    }

    /** Schedule a hide action with a 5-second undo window. `mode` overrides
     *  settings.actionMode for this one action (popover 隐藏 → "local"). */
    function scheduleHide(key: string, sig: Signals, anchor: HTMLElement, mode?: ActionMode) {
      if (pendingActions.has(key)) return; // already pending
      // Tag the row so executeHide can still find it if X recycles the node.
      const art = articleOf(anchor);
      art?.setAttribute("data-xss-key", key);
      const tweetId = art ? articleStatusId(art) : null;
      const tweetText = sig.triggeringComment || sig.recentTweets[0];
      const timer = setTimeout(() => {
        try {
          void executeHide(key, sig).catch(() => {});
        } finally {
          pendingActions.delete(key);
          // The undo window has settled even if X recycled the target or a
          // synchronous DOM lookup failed. Never leave a permanent "5秒后"
          // badge claiming an action is still pending.
          clearMounts(anchor);
        }
      }, PENDING_MS);
      pendingActions.set(key, {
        key,
        sig,
        anchor,
        timer,
        ts: Date.now(),
        ...(mode ? { mode } : {}),
        ...(tweetId ? { tweetId } : {}),
        ...(tweetText ? { tweetText } : {}),
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
    async function executeHide(key: string, sig: Signals): Promise<boolean> {
      const pend = pendingActions.get(key);
      const mode = pend?.mode ?? settings.actionMode;
      // Triggering-tweet audit trail: prefer what scheduleHide captured live,
      // else the finding (bubble batch path — pending already cleared).
      const fin = findings.find((x) => (x.userId || `h:${x.handle}`) === key);
      const tweetId = pend?.tweetId ?? fin?.tweetId;
      const tweetText = pend?.tweetText ?? fin?.snippet;
      const record: Parameters<typeof addBlockRecord>[0] = {
        id: key,
        handle: sig.handle,
        ...(sig.displayName ? { displayName: sig.displayName } : {}),
        ...(sig.avatarUrl ? { avatarUrl: sig.avatarUrl } : {}),
        ...(tweetId ? { tweetId } : {}),
        ...(tweetText ? { tweetText } : {}),
        source: "manual",
        ts: Date.now(),
      };
      await Promise.all([
        addBlocked(key),
        ...(sig.userId ? [addBlocked(sig.userId)] : []),
        addBlockRecord(record),
      ]);
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
      // Profile badges are not inside an article. Their captured UserName
      // anchor is still the authoritative target; hideAccountSurface resolves
      // it to the profile header. Article anchors retain the author/recycling
      // guard before falling back to the tagged row.
      const target =
        sameAuthor || (!!anchor && !art)
          ? anchor
          : document.querySelector(`[data-xss-key="${CSS.escape(key)}"]`);
      if (target) hideAccountSurface(target);
      // If this account is a live bubble finding (a listed hit the user chose
      // to handle from the badge popover rather than the batch panel), drive
      // its row to "done" so it stops offering an actionable button and joins
      // the 已处理 record — otherwise the row stalls at "待处理" forever and is
      // dropped on the next SPA navigation.
      bubbleApi?.markManual(key, actionVerb(mode));
      // Track the not-yet-fired X action so a mid-batch navigation/reload can
      // resume it rather than leave the account locally-hidden-only (same
      // guarantee as the auto queue). Local mode makes no X call — skip.
      if (mode === "mute" || mode === "block") {
        const accepted = await addPendingAction({
          id: key,
          handle: sig.handle,
          action: mode,
          source: "quick",
          ts: Date.now(),
        });
        if (!accepted) return false;
        return applyXAction(mode, sig, accepted).then((ok) => {
          if (!ok) {
            void updateBlockRecord(key, {
              reason: `手动${actionVerb(mode)}（X 动作失败，仅本地隐藏）`,
            });
          }
          return ok;
        });
      }
      // Mirror the auto path: when the native X action fails, the 处理记录
      // row must say so — the user clicked 拉黑/静音 and only got a local
      // hide, and the record is the one place that can state it honestly.
      return applyXAction(mode, sig, key).then((ok) => {
        if (!ok) {
          void updateBlockRecord(key, {
            reason: `手动${actionVerb(mode)}（X 动作失败，仅本地隐藏）`,
          });
        }
        return ok;
      });
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

    // ---- Visible auto-processing queue (the v0.4 爽感 path) ----
    // Auto hits do NOT vanish silently: each account is queued and worked
    // ONE AT A TIME — in-place pulsing "拉黑中" badge on the tweet, live
    // queued→processing→done row states in the bubble (which auto-opens),
    // then an animated collapse of the cell. The decision itself is recorded
    // up-front, so only the theater is deferred, never the protection.
    const AUTO_MIN_ACT_MS = 900; // every item is visibly "worked" this long
    const AUTO_SETTLE_MS = 240; // beat between items (v0.4: 180ms)
    // Roster-first: the page scan surfaces hits one by one, so the sweep
    // waits out a short gather window — the bubble fills with 排队中 rows
    // FIRST, then the cleanup walks through them. Capped so a trickle of
    // late hits can't stall the start forever.
    const AUTO_GATHER_MS = 1600;
    const AUTO_GATHER_MAX_MS = 4000;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    interface AutoItem {
      key: string;
      sig: Signals;
      action: CategoryAction;
      verb: string;
      anchor: HTMLElement;
      verdict: Verdict;
      categoryZh: string;
      badgeSource: BadgeSource;
      pendingSource?: "auto" | "bio_rule";
      ruleVersion?: string;
      evidenceHash?: string;
      persisted: Promise<string | false | undefined>;
      tweetId?: string;
    }
    const autoQueue: AutoItem[] = [];
    // Keys owned by the queue — step 0's insta-hide must spare the cell the
    // animation is (about to be) playing on.
    const autoActing = new Set<string>();
    let autoDraining = false;
    function mountActing(anchor: HTMLElement, verb: string, queued: boolean) {
      clearMounts(anchor);
      mountBadge(anchor, () => createActingBadge(verb, queued));
    }

    /** X recycles article nodes: trust the captured anchor only while it
     *  still renders this account, else fall back to the tagged row. */
    function autoTarget(it: AutoItem): HTMLElement | null {
      const art = articleOf(it.anchor);
      const same =
        !!art && handleFromArticle(art)?.toLowerCase() === it.sig.handle.toLowerCase();
      if (same) return it.anchor;
      return document.querySelector<HTMLElement>(
        `[data-xss-key="${CSS.escape(it.key)}"]`,
      );
    }

    function enqueueAuto(it: Omit<AutoItem, "persisted">) {
      if (
        autoActing.has(it.key) ||
        isFollowProtected(it.sig) ||
        isWhitelisted(it.sig.userId, it.sig.handle)
      )
        return;
      autoActing.add(it.key);
      // Record FIRST — the protection survives navigation even if the
      // animation never gets to play.
      // The 处理记录 row too: the id lands in xss:blocked above, and a record
      // is the only UI path back (恢复显示). Writing it after the paced X
      // action left a window (tab close mid-queue) that produced permanently
      // hidden accounts with no recover entry. The X-failure annotation is
      // patched in later by the drain loop.
      const tweetText = it.sig.triggeringComment || it.sig.recentTweets[0];
      const record: Parameters<typeof addBlockRecord>[0] = {
        id: it.key,
        handle: it.sig.handle,
        ...(it.sig.displayName ? { displayName: it.sig.displayName } : {}),
        ...(it.sig.avatarUrl ? { avatarUrl: it.sig.avatarUrl } : {}),
        ...(it.tweetId ? { tweetId: it.tweetId } : {}),
        ...(tweetText ? { tweetText } : {}),
        verdict: it.verdict,
        reason: `${it.categoryZh} · 自动${it.verb}`,
        ...(it.ruleVersion ? { ruleVersion: it.ruleVersion } : {}),
        ...(it.evidenceHash ? { evidenceHash: it.evidenceHash } : {}),
        source: "auto",
        ts: Date.now(),
      };
      // Track the not-yet-fired X action separately (see PendingXAction): a
      // mid-queue reload can then tell a queued account apart from a completed
      // one — resuming it instead of falsely counting it as 已处理. Local-only
      // hides need no X call, so nothing to track.
      const pending =
        it.action === "mute" || it.action === "block"
          ? {
          id: it.key,
          handle: it.sig.handle,
          action: it.action,
          source: it.pendingSource ?? "auto",
          ts: Date.now(),
            } as const
          : undefined;
      // Snapshot the detected account before the paced queue can mutate X.
      // The promises keep running across SPA navigation; if the tab closes,
      // xss:pending-actions lets the next X page resume unfinished work.
      const persisted = commitAutomaticDecision({
        record,
        blockedIds: [it.key, ...(it.sig.userId ? [it.sig.userId] : [])],
        ...(pending ? { pending } : {}),
      });
      void bumpStats({ blocks: 1 });
      void bumpStat("blocked");
      anchorByKey.set(it.key, it.anchor);
      articleOf(it.anchor)?.setAttribute("data-xss-key", it.key);
      mountActing(it.anchor, it.verb, true);
      bubbleApi?.markAuto(it.key, "queued", it.verb);
      autoQueue.push({ ...it, persisted });
      scheduleDrain();
    }

    let drainTimer: ReturnType<typeof setTimeout> | undefined;
    let gatherStart = 0;
    /** Debounced sweep start: every new hit extends the gather window by
     *  AUTO_GATHER_MS, bounded by AUTO_GATHER_MAX_MS from the first hit. */
    function scheduleDrain() {
      if (autoDraining) return; // mid-sweep hits just join the tail
      const now = Date.now();
      if (!gatherStart) gatherStart = now;
      const delay = Math.min(
        AUTO_GATHER_MS,
        Math.max(0, gatherStart + AUTO_GATHER_MAX_MS - now),
      );
      clearTimeout(drainTimer);
      drainTimer = setTimeout(() => void drainAuto(), delay);
    }

    async function drainAuto() {
      if (autoDraining) return;
      autoDraining = true;
      gatherStart = 0;
      try {
        await drainAutoLoop();
      } finally {
        autoDraining = false;
      }
      // A hit that landed exactly as the loop exited would otherwise sit
      // until the next enqueue — sweep it into a fresh (short) round.
      if (autoQueue.length) scheduleDrain();
    }

    async function drainAutoLoop() {
      while (autoQueue.length) {
        const it = autoQueue.shift();
        if (!it) break;
        // One broken item (dead DOM node, render error) must not strand the
        // rest of the queue — fail it and move on.
        try {
          const pendingId = await it.persisted;
          const queueAdmitted = pendingId !== false;
          // Protection state can change after enqueue while the gather window
          // or earlier paced actions are running. Recheck at the last safe
          // point before any native X mutation or local hide.
          refreshVisibleRelationships();
          if (isFollowProtected(it.sig) || isWhitelisted(it.sig.userId, it.sig.handle)) {
            const protectedTarget = autoTarget(it) ?? it.anchor;
            await cancelAutomaticBlock(it.key, it.sig.handle);
            showAccountSurface(protectedTarget);
            showTweet(articleOf(protectedTarget));
            markViewerProtected(protectedTarget, it.key);
            continue;
          }
          if (settings.previewMode) {
            const target = autoTarget(it) ?? it.anchor;
            await cancelAutomaticBlock(it.key, it.sig.handle);
            showAccountSurface(target);
            showTweet(articleOf(target));
            badgeFor(
              it.anchor,
              it.key,
              it.sig,
              it.verdict,
              `安全预览：原计划自动${it.verb}，本次未执行`,
              it.badgeSource,
            );
            bubbleApi?.markAuto(it.key, "done", "预览（未执行）");
            continue;
          }
          let effectiveAction = queueAdmitted ? it.action : "hide";
          let effectiveVerb = queueAdmitted ? it.verb : "隐藏";
          if (!queueAdmitted) {
            await updateBlockRecord(it.key, {
              reason: `${it.categoryZh} · 队列容量保护，仅本地隐藏`,
            });
          }
          if (it.action === "mute" || it.action === "block") {
            const latestFollowing = await verifyXFollowing(it.sig.handle, {
              forceRefresh: true,
            });
            if (latestFollowing === true) {
              recordProtectedSkip(it.key);
              it.sig.viewerFollowing = true;
              rememberFollowed(it.sig);
              const protectedTarget = autoTarget(it) ?? it.anchor;
              await cancelAutomaticBlock(it.key, it.sig.handle);
              showAccountSurface(protectedTarget);
              showTweet(articleOf(protectedTarget));
              markViewerProtected(protectedTarget, it.key);
              continue;
            }
            if (latestFollowing === null) {
              effectiveAction = "hide";
              effectiveVerb = "隐藏";
              if (pendingId) await clearPendingAction(pendingId);
              await updateBlockRecord(it.key, {
                reason: `${it.categoryZh} · 关注关系无法确认，仅本地隐藏`,
              });
            }
          }
          const t0 = Date.now();
          const acting = autoTarget(it);
          if (acting) mountActing(acting, effectiveVerb, false);
          bubbleApi?.markAuto(it.key, "processing", effectiveVerb);
          const xOk =
            effectiveAction === "mute" || effectiveAction === "block"
              ? await applyXAction(effectiveAction, it.sig, pendingId || it.key)
              : true;
          if (!xOk)
            console.warn(
              `[MXGA] 自动${effectiveVerb}：X 原生动作失败`,
              it.sig.handle,
              it.sig.userId,
            );
          // Even the instant local-hide mode dwells long enough to be SEEN.
          const dwell = AUTO_MIN_ACT_MS - (Date.now() - t0);
          if (dwell > 0) await sleep(dwell);
          // Hide the real tweet INSTANTLY — the processing theater (fade /
          // shrink / fly-into-chip) belongs to the corner bubble; animating
          // the page's own DOM competes with X's scroll/virtualizer and reads
          // as jank on the timeline.
          hideAccountSurface(autoTarget(it));
          // The action has now SETTLED (attempted) — drop its pending marker so
          // it stops being a resume candidate; only items whose queue died
          // before this point stay pending. On X failure, annotate the record.
          if (effectiveAction === "mute" || effectiveAction === "block") {
            if (!xOk) {
              void updateBlockRecord(it.key, {
                reason: `${it.categoryZh} · 自动${effectiveVerb}（X 动作失败，仅本地隐藏）`,
              });
            }
          }
          bubbleApi?.markAuto(it.key, xOk ? "done" : "failed", effectiveVerb);
        } catch (e) {
          console.warn(`[MXGA] 自动${it.verb}处理异常`, it.sig.handle, e);
          try {
            bubbleApi?.markAuto(it.key, "failed", it.verb);
          } catch {
            /* bubble unavailable — the record above still stands */
          }
        } finally {
          autoActing.delete(it.key);
        }
        await sleep(AUTO_SETTLE_MS);
      }
    }

    /** Resume mute/block actions whose paced queue died with a previous page
     *  (mid-queue navigation / reload / tab close). Their local hide + record
     *  persisted, but the X-action never fired — re-run it best-effort (the
     *  x-action lock paces these across tabs), then settle the pending marker
     *  so it stops being a resume candidate. Runs once per load; each entry is
     *  attempted at most once, then cleared regardless of outcome. */
    let resumeRunning = false;
    let retryWakeTimer: ReturnType<typeof setTimeout> | undefined;
    let retryWakeAt = 0;

    function scheduleRetryWake(nextAttemptAt: number) {
      if (!Number.isFinite(nextAttemptAt)) return;
      if (retryWakeTimer && retryWakeAt <= nextAttemptAt) return;
      clearTimeout(retryWakeTimer);
      retryWakeAt = nextAttemptAt;
      retryWakeTimer = setTimeout(
        () => {
          retryWakeTimer = undefined;
          retryWakeAt = 0;
          void resumeInterrupted();
        },
        Math.max(0, nextAttemptAt - Date.now()),
      );
    }

    async function resumeInterrupted() {
      if (resumeRunning) return;
      resumeRunning = true;
      const run = async () => {
        // Read only after obtaining the cross-tab lock. A second X tab that
        // queued behind this one then sees the already-settled list instead
        // of replaying the same snapshot.
        const pending = await getPendingActions();
      // The user switched the default action mode to local — settle automatic
      // markers. Regex and explicitly clicked quick actions remain resumable
      // because neither derives its action from the default mode.
      if (settings.actionMode === "local") {
        for (const p of pending) {
          if (!isIndependentPendingSource(p.source)) void clearPendingAction(p.id);
        }
      }
      for (const p of pending) {
        if (p.status === "failed") continue;
        if (p.nextAttemptAt && p.nextAttemptAt > Date.now()) {
          scheduleRetryWake(p.nextAttemptAt);
          continue;
        }
        // A live queue in another context may have settled this row while we
        // waited for the paced X-action lock.
        if (!(await getPendingActions()).some((row) => row.id === p.id)) continue;
        if (settings.previewMode && p.source !== "quick") {
          await cancelAutomaticBlock(p.id, p.handle);
          continue;
        }
        if (
          settings.actionMode === "local" && !isIndependentPendingSource(p.source)
        )
          continue;
        if (p.action !== "mute" && p.action !== "block") {
          void clearPendingAction(p.id);
          continue;
        }
        const sig = {
          handle: p.handle,
          ...(/^\d+$/.test(p.id) ? { userId: p.id } : {}),
        } as Signals;
        if (
          p.source !== "quick" &&
          (isFollowProtected(sig) || isWhitelisted(sig.userId, sig.handle))
        ) {
          await cancelAutomaticBlock(p.id, p.handle);
          continue;
        }
        if (p.source !== "quick") {
          const following = await verifyXFollowing(p.handle, { forceRefresh: true });
          if (following === true) {
            recordProtectedSkip(p.id);
            await cancelAutomaticBlock(p.id, p.handle);
            continue;
          }
          if (following === null) {
            await clearPendingAction(p.id);
            await updateBlockRecord(p.id, {
              reason: `自动${p.action === "block" ? "拉黑" : "静音"}（恢复时无法确认关注关系，仅本地隐藏）`,
            });
            continue;
          }
        }
        const ok = await applyXAction(p.action, sig, p.id).catch(() => false);
        if (p.source === "regex") {
          void updateBlockRecord(p.id, {
            reason: ok
              ? "正则命中 · X 原生静音成功（恢复队列）"
              : "正则命中 · X 静音失败，仅本地隐藏（恢复队列）",
          });
        } else if (p.source === "quick" && ok) {
          await addBlocked(p.id);
          await addBlockRecord({
            id: p.id,
            handle: p.handle,
            reason: `帖子快捷按钮 · X 原生${p.action === "block" ? "拉黑" : "静音"}成功（恢复队列）`,
            source: "manual",
            ts: Date.now(),
          });
        } else if (!ok && p.source !== "quick") {
          void updateBlockRecord(p.id, {
            reason: `自动${p.action === "block" ? "拉黑" : "静音"}（X 动作失败，仅本地隐藏）`,
          });
        }
      }
      };
      try {
        const locks = (
          navigator as Navigator & {
            locks?: { request<T>(name: string, callback: () => Promise<T>): Promise<T> };
          }
        ).locks;
        if (locks) await locks.request(PENDING_RESUME_LOCK, run);
        else await run();
      } finally {
        resumeRunning = false;
      }
    }

    function pushFinding(
      sig: Signals,
      v: Verdict,
      source: string,
      meta?: { categoryZh?: string; tweetId?: string; tier?: "confirmed" | "auto" },
    ) {
      if (!["spam", "porn_bot", "likely_spam"].includes(v.label)) return;
      const id = keyOf(sig);
      // Dedupe by key AND by handle: the same account can be scanned once
      // WITH a uid (article fiber walk) and once without (profile header),
      // producing two different keys — the bubble then listed it twice.
      const h = sig.handle.toLowerCase();
      if (
        findings.some(
          (f) => (f.userId || `h:${f.handle}`) === id || f.handle.toLowerCase() === h,
        )
      )
        return;
      const snippet = sig.triggeringComment || sig.recentTweets[0] || sig.bio;
      findings.push({
        handle: sig.handle,
        verdict: v,
        source,
        ...(meta?.categoryZh ? { categoryZh: meta.categoryZh } : {}),
        ...(meta?.tweetId ? { tweetId: meta.tweetId } : {}),
        ...(meta?.tier ? { tier: meta.tier } : {}),
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
      // Anchors are kept ONLY for hit accounts (executeHide's fallback and
      // onReviewEach are the sole consumers, and both operate on findings).
      // Registering every scanned account used to pin each author's
      // unmounted article subtree for the whole page lifetime; the neutral
      // ghost badge's manual flow captures its own anchor via scheduleHide.
      if (v) anchorByKey.set(key, anchor);
      clearMounts(anchor);
      mountBadge(anchor, () =>
        createBadge(
          v,
          {
            // The popover exposes the full ladder; the clicked mode overrides
            // settings.actionMode for this one account (default = configured).
            onAct: (mode) => scheduleHide(key, sig, anchor, mode),
            onAppeal: () =>
              openAppeal({ handle: sig.handle, ...(sig.userId ? { userId: sig.userId } : {}) }),
            onReport: () => reportSpam(sig),
          },
          note,
          source,
          settings.actionMode,
        ),
      );
    }

    /** Leave a non-visual mount so the virtualization-aware scanner knows the
     * followed account was handled without rendering any MXGA badge. */
    function markViewerProtected(anchor: HTMLElement, key: string) {
      anchorByKey.delete(key);
      findings = findings.filter((item) => (item.userId || `h:${item.handle}`) !== key);
      if (!dismissed) bubbleApi?.update(findings);
      clearMounts(anchor);
      const marker = document.createElement("span");
      marker.className = "xss-mount";
      marker.hidden = true;
      marker.setAttribute("data-mxga-follow-protected", "");
      anchor.appendChild(marker);
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
      relationship: FollowVerification = "unknown",
    ) {
      // This renderer is reserved for public-list/official-rule entries.
      // Template inference uses its own conservative badge/local-hide path.
      const policySource = badgeSource === "rule" ? "rule" : "list";
      if (!hitPublicSeen.has(key)) {
        hitPublicSeen.add(key);
        void bumpStat("hitPublic");
      }
      // Triggering tweet for the audit trail (null on profile headers).
      const hitArt = articleOf(anchor);
      const hitTweetId = hitArt ? articleStatusId(hitArt) : null;
      // Auto-action decision chain (each gate independent, no cross-talk):
      //   1. ELIGIBILITY — autoEligible() in lib/auto-policy.ts: list hits
      //      per autoScope; rule hits reply-section-only; cache/fresh never.
      //      autoTierMode "badge" gates out everything not human-confirmed
      //      (auto-tier list entries AND rule hits — both are 自动收录).
      //   2. TIER CAP — capAutoTierAction(): under autoTierMode "hide",
      //      anything not human-confirmed is capped at the local hide.
      //      entry.tier (人工确认/自动收录) stays visible in the popover;
      //      /v1/check keeps the human-tier filter for legacy clients.
      //   3. MASTER SWITCH — settings.autoProcess (bubble + settings page).
      //   4. POLICY — per-category action (badge/hide/mute/block).
      // (Auto actions stay reversible from the 处理记录 tab, and mute/block
      // ride the user's own X session like the manual path.)
      const eligible = autoEligible({
        source: policySource,
        tier: entry.tier,
        inReply: ctx === "reply",
        autoScope: settings.autoScope,
        autoTierMode: settings.autoTierMode,
      });
      // Auto-published (non-human) list entries are capped by autoTierMode:
      // under the default "hide" they may auto-hide locally but never fire
      // the irreversible X mute/block with the user's session.
      const tierCappedAction = eligible
        ? capAutoTierAction(settings.categoryActions[entry.category] ?? "badge", {
            source: policySource,
            tier: entry.tier,
            autoTierMode: settings.autoTierMode,
          })
        : "badge";
      const action = capUnverifiedFollowingAction(tierCappedAction, relationship);
      const plannedVerb = action === "mute" ? "静音" : action === "block" ? "拉黑" : "隐藏";
      const previewNote = settings.previewMode && settings.autoProcess && action !== "badge"
        ? relationship === "unknown" && (tierCappedAction === "mute" || tierCappedAction === "block")
          ? `安全预览：原计划自动${tierCappedAction === "mute" ? "静音" : "拉黑"}；关注关系无法确认时将降级为本地隐藏`
          : `安全预览：原计划自动${plannedVerb}，本次未执行`
        : undefined;
      const disposition = automaticActionDisposition(action, settings);
      // 自动处理 master switch off → everything degrades to mark-only,
      // regardless of the per-category policy.
      if (disposition !== "execute") {
        badgeFor(anchor, key, sig, entry.verdict, previewNote, badgeSource);
        pushFinding(sig, entry.verdict, badgeSource === "rule" ? "local-rule" : "local-index", {
          categoryZh: CATEGORY_ZH[entry.category],
          ...(hitTweetId ? { tweetId: hitTweetId } : {}),
          ...(badgeSource === "list" ? { tier: entry.tier } : {}),
        });
        return;
      }
      // Auto-processed accounts still show up in the bubble panel — as
      // display-only rows driven through markAuto (checkbox disabled,
      // button is a status chip). Chips + radar pill counts follow.
      pushFinding(sig, entry.verdict, badgeSource === "rule" ? "local-rule" : "local-index", {
        categoryZh: CATEGORY_ZH[entry.category],
        ...(hitTweetId ? { tweetId: hitTweetId } : {}),
        ...(badgeSource === "list" ? { tier: entry.tier } : {}),
      });
      const verb = plannedVerb;
      // The visible queue owns everything from here: records up-front, then
      // in-place badge → paced X action → animated collapse → bubble row
      // states. The 处理记录 line is written after the X action settles so it
      // can state honestly whether the native mute/block actually landed.
      enqueueAuto({
        key,
        sig,
        action,
        verb,
        anchor,
        verdict: entry.verdict,
        categoryZh: CATEGORY_ZH[entry.category],
        badgeSource,
        ...(hitTweetId ? { tweetId: hitTweetId } : {}),
      });
    }

    async function process(sig: Signals, anchor: HTMLElement, ctx: ScanContext = "feed") {
      const key = keyOf(sig);
      if (inFlight.has(key)) return; // a concurrent scan is already on it
      inFlight.add(key);
      try {
        // 0. The viewer's own follow choice and explicit 恢复显示 override
        //    win over every MXGA signal.
        //    Run this before the local blocked fast-path so a previously
        //    hidden followed account becomes visible again. A neutral mount
        //    also prevents repeat scans without exposing list membership.
        if (isFollowProtected(sig) || isWhitelisted(sig.userId, sig.handle)) {
          showAccountSurface(anchor);
          showTweet(articleOf(anchor));
          markViewerProtected(anchor, key);
          return;
        }

        // Strong bio templates are deterministic and outrank fuzzy scoring.
        // Often X already carries the bio in React memory; otherwise the same
        // path runs when a naturally-opened hover card supplies it.
        if (sig.bio && (await handleStrongBio(sig, anchor))) return;

        // 1. Already blocked → hide, never render again. Exception: the cell
        //    the visible auto queue is working on (it was recorded up-front)
        //    — its animation owns the hide; OTHER cells by the same account
        //    still vanish instantly.
        // Check every id form the account may have been recorded under: the
        // same account can surface with a uid (fiber walk) or handle-only
        // (profile header), and a hit stored under one form must short-circuit
        // the other — otherwise it gets auto-processed twice and 恢复显示
        // (which deletes one id) never actually un-hides it.
        if (
          isBlockedSync(key) ||
          (sig.userId && isBlockedSync(sig.userId)) ||
          isBlockedSync(`h:${sig.handle}`)
        ) {
          if (
            autoActing.has(key) &&
            articleOf(anchor)?.getAttribute("data-xss-key") === key
          )
            return;
          hideAccountSurface(anchor);
          return;
        }

        // 2. Check pending undo queue — skip if already scheduled.
        if (pendingActions.has(key)) return;

        // 3. Local public index lookup (no remote requests, <50ms). Ranked
        //    ABOVE the legacy cache: a stale "legit" entry from v0.4 must not
        //    mask a since-human-confirmed list hit, and a stale "spam" entry
        //    must not demote it to mark-only (cache never auto-acts).
        const entry = await lookupPublicList(sig);
        if (entry === undefined) return;
        if (entry) {
          const relationship = await protectDetectedFollow(sig, anchor, key);
          if (relationship === "following") return;
          renderLocalIndex(anchor, key, sig, entry, "list", ctx, relationship);
          return;
        }

        // 5. v0.4-era persistent cache, read-only since v0.5 (spam reused
        //    as-is; legit/uncertain only if signals unchanged so new evidence
        //    can still re-trigger).
        const cached = await cacheGet(key);
        if (cached) {
          const spammy = ["spam", "porn_bot", "likely_spam"].includes(cached.verdict.label);
          if (spammy || cached.signalsHash === signalsHash(sig)) {
            if (
              spammy &&
              (await protectDetectedFollow(sig, anchor, key)) === "following"
            )
              return;
            renderCached(anchor, key, sig, cached);
            void bumpStats({ cacheHits: 1 });
            return;
          }
        }

        // 5.5 Maintainer-curated keyword rules, shipped with the synced list.
        // Catches first-seen template accounts (brand-new porn-bot throwaways
        // not yet on the public list) with zero upload. Whitelist already won
        // at step 2.
        const ruleHit = matchLocalRules(sig);
        if (ruleHit) {
          const relationship = await protectDetectedFollow(sig, anchor, key);
          if (relationship === "following") return;
          renderLocalIndex(
            anchor,
            key,
            sig,
            {
              userId: sig.userId ?? "",
              handle: sig.handle,
              verdict: {
                label: ruleHit.label,
                // The matched pattern never surfaces in the UI: spammers read
                // their own block screenshots, and a leaked keyword is a
                // free evasion recipe. Category only.
                confidence: 0.95,
                reasons: [`命中官方规则 · ${CATEGORY_ZH[ruleHit.category]}`],
              },
              category: ruleHit.category,
              tier: "auto", // rule hits are auto tier — reply-scope gated
              source: "community",
              updatedAt: new Date().toISOString(),
            },
            "rule",
            ctx,
            relationship,
          );
          return;
        }

        // 7. Local public list did not match. Just show neutral/unhit state.
        badgeFor(
          anchor,
          key,
          sig,
          null,
          undefined,
          settings.botDetectionEnabled && ctx === "reply" ? "bot-scan" : "fresh",
        );
      } finally {
        inFlight.delete(key);
      }
    }

    // Persist the logged-in viewer's own handle for the options page's
    // whitelist self-service flow (apply for YOUR account only).
    let lastViewer: string | undefined;
    function captureViewer() {
      const v = viewerHandle();
      if (v && v !== lastViewer) {
        lastViewer = v;
        try {
          void chrome.storage.local.set({ "xss:viewer": { handle: v, ts: Date.now() } });
        } catch {
          /* non-fatal */
        }
      }
    }

    function scanProfile(): void {
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
    }

    function scanArticle(
      art: HTMLElement,
      topic: string | null | undefined,
      focal: string | null,
    ): void {
      const handle = handleFromArticle(art);
      const nameBlock = art.querySelector<HTMLElement>('[data-testid="User-Name"]');
      if (!handle || !nameBlock) return;
      const hasMount = !!nameBlock.querySelector(":scope > .xss-mount");
      const hasQuickActions =
        art.querySelector<HTMLElement>("[data-mxga-quick-actions]")?.dataset.mxgaHandle ===
        handle.toLowerCase();
      if (nodeHandle.get(art) === handle && hasMount && hasQuickActions) return;
      if (nodeHandle.get(art) !== handle) {
        // Restore a recycled virtual row before signal extraction. Hidden
        // elements have no innerText, so waiting until after extraction can
        // leave the new author's row permanently collapsed.
        showAccountSurface(art);
        clearMounts(nameBlock);
      }
      const info = extractFromArticle(art);
      if (!info) return;
      if (topic && !info.threadTopic) info.threadTopic = topic;
      nodeHandle.set(art, handle);
      const sid = focal ? articleStatusId(art) : null;
      const scanContext: ScanContext = focal && sid && sid !== focal ? "reply" : "feed";
      const cell = regexCell(art);
      const regexApplies =
        settings.regexEnabled &&
        regexRules.length > 0 &&
        !isFollowProtected(info) &&
        !isWhitelisted(info.userId, info.handle) &&
        (settings.regexScope === "all" || scanContext === "reply");
      const regexHit = regexApplies
        ? matchRegexText(info.triggeringComment ?? "", regexRules)
        : null;
      if (regexHit) {
        void handleRegexCandidate(art, nameBlock, cell, info, regexHit.source);
        return;
      }
      if (cell.hasAttribute(REGEX_HIDDEN_ATTR)) {
        showAccountSurface(cell);
        cell.removeAttribute(REGEX_HIDDEN_ATTR);
        cell.removeAttribute("data-mxga-regex-rule");
      }
      void process(info, nameBlock, scanContext);
    }

    function scan() {
      if (document.hidden) return;
      captureViewer();
      refreshVisibleRelationships();
      scanProfile();
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
        if (!isNearViewport(art)) continue;
        scanArticle(art, topic, focal);
      }
    }

    /** Hide accounts that this user has already processed in the same
     * MutationObserver turn that X inserts/recycles their article. The full
     * scan intentionally waits for the DOM to settle, but that 600 ms delay
     * otherwise lets a known-hidden reply paint briefly while scrolling. */
    function concealKnownBlockedRows(root: ParentNode | HTMLElement = document): void {
      const articles: HTMLElement[] = [];
      if (root instanceof HTMLElement && root.matches('article[data-testid="tweet"]')) {
        articles.push(root);
      }
      articles.push(
        ...root.querySelectorAll<HTMLElement>('article[data-testid="tweet"]'),
      );
      for (const article of articles) {
        const handle = handleFromArticle(article)?.toLowerCase();
        if (!handle) continue;
        const handleKey = `h:${handle}`;
        if (!blockedHandles.has(handle) && !isBlockedSync(handleKey)) continue;
        // The viewer's explicit follow/allow decisions still outrank the
        // local processed list, including in this pre-paint fast-path.
        if (followedKeys.has(handleKey) || isWhitelisted(undefined, handle)) continue;
        hideAccountSurface(article);
      }
    }

    /** Quick controls are layout UI, so mount them in the same mutation turn
     * that reveals a virtualized X article. Waiting for the full 600 ms spam
     * scan made Grok/More visibly jump when the user navigated back. Signals
     * are extracted only if the user clicks, keeping this immediate pass
     * cheap and recycling-safe. */
    function mountVisibleQuickActions() {
      if (document.hidden) return;
      for (const art of document.querySelectorAll<HTMLElement>(
        'article[data-testid="tweet"]',
      )) {
        if (!isNearViewport(art, 600)) continue;
        const handle = handleFromArticle(art);
        if (!handle) continue;
        mountQuickActions(art, handle, (action) => {
          const current = extractFromArticle(art);
          if (!current || current.handle.toLowerCase() !== handle.toLowerCase()) {
            return Promise.resolve({ ok: false, message: "帖子已刷新，请重新操作" });
          }
          return runQuickAction(action, current, art);
        });
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
          onAppeal(appeal) {
            openAppeal(appeal);
          },
          onToggleAuto(v: boolean) {
            // Persist; the onSettingsChange listener updates `settings` (and
            // echoes the new state back into the bubble, a no-op here).
            void setSetting("autoProcess", v);
          },
          onToggleQueue(paused: boolean) {
            void setQueuePaused(paused).then(() => syncQueueBubble());
          },
        }, settings.bubblePos, actionVerb(settings.actionMode), {
          autoProcess: settings.autoProcess,
          autoCategoryCount: autoCategoryCount(settings),
          autoScopeAll: settings.autoScope === "all",
          autoExpand: settings.autoExpand,
        });
        container.appendChild(bubble.el);
        if (!settings.bubble) bubble.el.style.display = "none";
        bubbleApi = bubble;
        void syncQueueBubble();
        // The bubble's 已处理 list is SESSION-scoped: it persists across SPA
        // navigation (the content script and its in-memory archive live on),
        // but a full reload / freshly-opened X must start clean — resurrecting
        // the whole all-time history here read as "记录没清掉". The permanent
        // audit trail lives in the options 处理记录 page, not the corner bubble.
        //
        // We still read the pending-actions key: an X mute/block whose paced
        // queue died mid-flight (navigation / reload / tab close) never fired,
        // so resume it best-effort. This is protection follow-through, NOT
        // history display — resumed accounts are not seeded into 已处理.
        refreshVisibleRelationships();
        void resumeInterrupted();
        return bubble;
      },
    });
    ui.mount();

    // SPA navigation: flush pending hides (the user already chose to hide;
    // the block is recorded even if the row's DOM is gone), then drop all
    // per-page state so detached DOM nodes can be garbage-collected.
    ctx.addEventListener(window, "wxt:locationchange", () => {
      // Automatic account actions are deliberately NOT cancelled here. They
      // were snapshotted at detection time and no longer depend on tweet DOM,
      // so the user can return immediately and keep browsing while the paced
      // X-native queue finishes in this tab.
      for (const [key, p] of pendingActions) {
        clearTimeout(p.timer);
        void executeHide(key, p.sig);
      }
      pendingActions.clear();
      anchorByKey.clear();
      findings = [];
      // Collapse the card and archive this page's processed rows — the
      // bubble follows the user across SPA navigations, so a stale open
      // panel over a new page reads as broken; the session's records stay
      // viewable in the 已处理 tab until a hard reload.
      bubbleApi?.pageReset();
    });

    const pendingArticleScans = new Set<HTMLElement>();
    let incrementalTimer: ReturnType<typeof setTimeout> | undefined;

    function queueArticleScans(root: HTMLElement): void {
      if (document.hidden) return;
      const owner = root.closest<HTMLElement>('article[data-testid="tweet"]');
      if (owner) pendingArticleScans.add(owner);
      if (root.matches('article[data-testid="tweet"]')) pendingArticleScans.add(root);
      for (const article of root.querySelectorAll<HTMLElement>('article[data-testid="tweet"]')) {
        pendingArticleScans.add(article);
      }
      // Do not debounce indefinitely while X is continuously mutating the
      // timeline. The first mutation starts a short, bounded batch window.
      if (incrementalTimer) return;
      incrementalTimer = setTimeout(() => {
        incrementalTimer = undefined;
        captureViewer();
        refreshVisibleRelationships();
        scanProfile();
        const topic = extractThreadTopic();
        const focal = focalStatusId();
        const batch = [...pendingArticleScans];
        pendingArticleScans.clear();
        for (const article of batch) {
          if (article.isConnected && isNearViewport(article)) scanArticle(article, topic, focal);
        }
      }, 80);
    }

    let storageListener:
      | ((changes: Record<string, chrome.storage.StorageChange>, area: string) => void)
      | undefined;
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          concealKnownBlockedRows(node);
          queueArticleScans(node);
          learnVisibleHoverCards(node);
        }
      }
      mountVisibleQuickActions();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    learnVisibleHoverCards();
    ctx.onInvalidated(() => {
      observer.disconnect();
      clearTimeout(incrementalTimer);
      pendingArticleScans.clear();
      clearTimeout(listLookupTimer);
      listLookupTimer = undefined;
      for (const pending of pendingListLookups.values()) {
        for (const resolve of pending.resolve) resolve(undefined);
      }
      pendingListLookups.clear();
      clearTimeout(retryWakeTimer);
      unsubscribeSettings();
      if (storageListener) chrome.storage.onChanged.removeListener(storageListener);
    });
    // Periodic tick so newly virtualized rows are revisited even when the
    // user stops scrolling (no new DOM mutations). ctx-bound: stops when
    // the content script is invalidated.
    ctx.setInterval(() => {
      if (!document.hidden) scan();
    }, 4000);
    ctx.addEventListener(document, "visibilitychange", () => {
      if (!document.hidden) {
        scan();
        mountVisibleQuickActions();
        void resumeInterrupted();
      }
    });
    // List / whitelist hot-swap (background sync or 立即更新): the lookup
    // maps already rebuilt via local-index's own onChanged hook, but rows
    // rendered with the OLD data keep their badge (scan skips mounted
    // nodes). Drop every neutral badge so the next scan re-evaluates the
    // page against the fresh list. Pending/hidden rows are untouched.
    try {
      storageListener = (changes, area) => {
        if (area === "local") {
          const control = changes[K_QUEUE_CONTROL]?.newValue as { paused?: boolean } | undefined;
          const pendingChange = changes["xss:pending-actions"];
          const before = Array.isArray(pendingChange?.oldValue) ? pendingChange.oldValue : [];
          const after = Array.isArray(pendingChange?.newValue) ? pendingChange.newValue : [];
          const retried = after.some(
            (row: { id?: string; status?: string }) =>
              row.status === "queued" &&
              before.some(
                (old: { id?: string; status?: string }) =>
                  old.id === row.id && old.status === "failed",
              ),
          );
          const dueRetry = after.some(
            (row: { status?: string; nextAttemptAt?: number }) =>
              row.status === "queued" &&
              typeof row.nextAttemptAt === "number" &&
              row.nextAttemptAt <= Date.now(),
          );
          if (control?.paused === false || retried || dueRetry) void resumeInterrupted();
          const nextRetry = after
            .filter(
              (row: { status?: string; nextAttemptAt?: number }) =>
                row.status === "queued" &&
                typeof row.nextAttemptAt === "number" &&
                row.nextAttemptAt > Date.now(),
            )
            .sort(
              (a: { nextAttemptAt?: number }, b: { nextAttemptAt?: number }) =>
                (a.nextAttemptAt ?? 0) - (b.nextAttemptAt ?? 0),
            )[0] as { nextAttemptAt?: number } | undefined;
          if (nextRetry?.nextAttemptAt) scheduleRetryWake(nextRetry.nextAttemptAt);
          if (changes[K_QUEUE_CONTROL] || pendingChange) void syncQueueBubble();
        }
        if (area === "local" && (changes["xss:blocklist:v2"] || changes["xss:blocked"])) {
          void getBlocklist().then((records) => {
            blockedHandles = new Set(records.map((record) => record.handle.toLowerCase()));
            concealKnownBlockedRows();
          });
        }
        if (
          area !== "local" ||
          (!changes[LIST_KEY] && !changes[WL_KEY] && !changes[LOCAL_ALLOWLIST_KEY])
        )
          return;
        listLookupCache.clear();
        for (const host of document.querySelectorAll<HTMLElement>(".xss-mount")) {
          // Badges live in the host's shadow root; keep pending-undo flows.
          if (host.shadowRoot?.querySelector(".xss-badge.pending")) continue;
          host.remove();
        }
        scan();
      };
      chrome.storage.onChanged.addListener(storageListener);
    } catch {
      /* non-fatal */
    }
    ctx.addEventListener(window, "online", () => void resumeInterrupted());
    mountVisibleQuickActions();
    scan();
  },
});
