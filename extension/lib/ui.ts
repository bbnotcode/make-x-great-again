// Design system + components, all rendered inside a Shadow DOM so X's CSS
// cannot bleed in and ours cannot leak out. Vanilla DOM — no framework
// weight injected into the page. Tokens per docs/UX.md.
import { BRAND } from "./brand";
import type { Label, Verdict } from "./types";

export const STYLE = `
:host { all: initial; }
* { box-sizing: border-box; font-family: system-ui,-apple-system,"Segoe UI",sans-serif; }
/* :host is REQUIRED here: badges/popovers each live in their own shadow
 * root, where :root/.xss match nothing — without :host every var() below
 * fails and the badge degrades to unstyled black text (the v0.5 regression). */
:host, :root, .xss {
  /* dark default (X dark mode) */
  --surface: rgba(13,17,23,.92); --border: rgba(255,255,255,.10);
  --shadow: 0 8px 28px rgba(0,0,0,.45); --text: #E6EDF3; --muted: #8B949E;
  --brand: #0EA5E9; --danger: #EF4444; --warn: #F59E0B; --neutral: #8B949E;
  --safe: #16A34A;
}
@media (prefers-color-scheme: light) {
  :host, :root, .xss {
    --surface: rgba(255,255,255,.96); --border: rgba(15,23,42,.12);
    --shadow: 0 8px 28px rgba(15,23,42,.18); --text: #0F172A; --muted: #475569;
    --brand: #0369A1; --danger: #DC2626; --warn: #B45309; --neutral: #475569;
    --safe: #15803D;
  }
}
.xss-bubble {
  position: fixed; right: 16px; top: 16px; z-index: 2147483000;
  color: var(--text); -webkit-font-smoothing: antialiased;
}
.xss-bubble.br { top: auto; bottom: 16px; }
.pill, .card {
  background: var(--surface); border: 1px solid var(--border);
  box-shadow: var(--shadow); backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px); border-radius: 14px;
}
.pill {
  display: inline-flex; align-items: center; gap: 8px; padding: 6px 10px;
  border-radius: 999px; cursor: pointer; transition: opacity .14s ease, transform .14s ease;
  min-width: 0; min-height: 36px;
}
.pill:hover { opacity: .94; transform: translateY(-1px); }
.scan-pill {
  display: grid; grid-template-columns: 22px auto auto;
  align-items: center; gap: 7px; width: auto;
}
.scan-radar {
  --accent: var(--brand); --angle: 360deg;
  width: 22px; height: 22px; position: relative; display: grid; place-items: center;
  border-radius: 999px; flex: none;
  background: conic-gradient(var(--accent) var(--angle), color-mix(in srgb, var(--accent) 12%, transparent) 0deg);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 18%, transparent);
}
.scan-radar.danger { --accent: var(--danger); }
.scan-core {
  position: absolute; inset: 4px; display: grid; place-items: center;
  border-radius: inherit; background: var(--surface);
}
.scan-sweep {
  position: absolute; inset: 2px; border-radius: inherit; opacity: 0;
  background: conic-gradient(from -30deg, transparent 0 64%, color-mix(in srgb, var(--accent) 58%, transparent) 76%, transparent 92%);
}
.scan-radar.busy .scan-sweep {
  opacity: .95; animation: xradar 1.15s linear infinite;
}
.scan-radar.busy {
  animation: xbreath 1.6s ease-in-out infinite;
}
.scan-title {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  max-width: 46px; font-size: 12.5px; font-weight: 750; color: var(--text);
}
.scan-meta {
  flex: none; font-size: 11px; font-weight: 650; color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.card { width: 312px; padding: 14px; display: none; margin-top: 10px; }
.card.open { display: block; animation: in .18s ease-out; }
@keyframes in { from { opacity: 0; transform: translateY(8px); } }
.hd { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; }
.hd .x { margin-left: auto; cursor: pointer; color: var(--muted); display: flex; }
.hd .x:hover { color: var(--text); }
.sub {
  display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px; margin: 10px 0 12px;
  font-size: 11px; color: var(--muted);
}
.metric {
  min-width: 0; height: 30px; display: flex; align-items: center; justify-content: center;
  gap: 4px; padding: 0 5px; border-radius: 8px;
  background: color-mix(in srgb, var(--muted) 7%, transparent);
  font-variant-numeric: tabular-nums;
  white-space: nowrap; overflow: hidden;
}
.metric b { color: var(--text); font-size: 12px; font-weight: 760; line-height: 1; }
.metric em { font-style: normal; overflow: hidden; text-overflow: ellipsis; }
.metric i { width: 6px; height: 6px; border-radius: 50%; display: inline-block; flex: none; }
/* The 已处理 chip doubles as a tab: done rows leave the live queue and are
 * only listed when this chip is toggled on. */
.metric.tab { cursor: pointer; user-select: none; transition: background .14s ease, box-shadow .14s ease; }
.metric.tab:hover { background: color-mix(in srgb, var(--muted) 16%, transparent); }
.metric.tab.on {
  background: color-mix(in srgb, var(--safe) 13%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--safe) 40%, transparent);
}
.queue-empty {
  display: flex; align-items: center; justify-content: center; gap: 6px;
  padding: 16px 10px; border-radius: 10px;
  font-size: 11.5px; color: var(--muted);
  background: color-mix(in srgb, var(--safe) 6%, transparent);
}
.btn {
  width: 100%; border: 0; border-radius: 10px; padding: 9px 12px;
  font-size: 13px; font-weight: 600; cursor: pointer; color: #fff;
  background: var(--danger); transition: filter .14s ease;
}
.btn:hover { filter: brightness(1.08); }
.btn:disabled { opacity: .55; cursor: default; }

/* Per-row action button — same color language as bulk btn, smaller scale. */
.xss-act {
  flex: none; border: 0; border-radius: 8px; padding: 5px 10px;
  font-size: 11.5px; font-weight: 600; cursor: pointer; color: #fff;
  background: var(--danger); transition: filter .14s ease, background .14s;
  white-space: nowrap;
}
.xss-act:hover { filter: brightness(1.08); }
.xss-act:disabled { cursor: default; }
.xss-act.done {
  background: var(--safe); color: #fff; opacity: .9;
}
.xss-act.queue {
  background: transparent; color: var(--brand);
  border: 1px solid var(--brand);
}
.xss-act.queue.busy { animation: xpulse 1.2s ease-in-out infinite; }
.xss-act.retry {
  background: transparent; color: var(--warn);
  border: 1px solid var(--warn);
}

/* Per-row select checkbox — themed, replaces native browser styling. */
.xss-row-cb {
  width: 15px; height: 15px; flex: none; cursor: pointer;
  appearance: none; -webkit-appearance: none;
  border: 1.5px solid var(--border); border-radius: 4px;
  background: transparent; transition: border-color .12s, background .12s;
  position: relative; margin-top: 6px;
}
.xss-row-cb:hover { border-color: var(--danger); }
.xss-row-cb:checked {
  background: var(--danger); border-color: var(--danger);
}
.xss-row-cb:checked::after {
  content: ""; position: absolute; left: 3px; top: 0;
  width: 5px; height: 9px; border: solid #fff;
  border-width: 0 1.5px 1.5px 0; transform: rotate(45deg);
}
.xss-row-cb:disabled { opacity: .35; cursor: default; }

/* 自动处理 master switch (card header area) — themed mini toggle. */
.auto-row {
  display: flex; align-items: center; gap: 7px; margin-top: 9px;
  font-size: 11.5px; font-weight: 600; color: var(--text);
}
.auto-row .auto-hint {
  margin-left: auto; font-size: 10.5px; font-weight: 500;
  color: var(--muted); white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis;
}
.xss-sw {
  position: relative; width: 30px; height: 18px; flex: none; padding: 0;
  border-radius: 999px; cursor: pointer;
  border: 1px solid var(--border);
  background: color-mix(in srgb, var(--muted) 28%, transparent);
  transition: background .16s ease, border-color .16s ease;
}
.xss-sw::after {
  content: ""; position: absolute; top: 2px; left: 2px;
  width: 12px; height: 12px; border-radius: 50%; background: #fff;
  box-shadow: 0 1px 3px rgba(0,0,0,.35);
  transition: transform .16s ease;
}
.xss-sw[aria-checked="true"] { background: var(--brand); border-color: var(--brand); }
.xss-sw[aria-checked="true"]::after { transform: translateX(12px); }
@media (prefers-reduced-motion: reduce) {
  .xss-sw, .xss-sw::after { transition: none; }
}
.row { display: flex; gap: 14px; margin-top: 10px; font-size: 12px; }
.lnk { color: var(--muted); cursor: pointer; }
.lnk:hover { color: var(--text); }
.block-progress {
  margin: -2px 0 13px;
}
.progress-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 6px; font-size: 11px; color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.progress-head b {
  color: var(--text); font-size: 11px; font-weight: 750;
}
.progress-track {
  height: 9px; display: flex; overflow: hidden; border-radius: 999px;
  background: color-mix(in srgb, var(--muted) 12%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text) 8%, transparent);
}
.progress-seg {
  height: 100%; min-width: 0; transition: width .22s ease;
}
.progress-seg + .progress-seg {
  box-shadow: inset 1px 0 0 color-mix(in srgb, var(--surface) 70%, transparent);
}
.progress-seg.done { background: linear-gradient(90deg, color-mix(in srgb, var(--safe) 78%, #fff), var(--safe)); }
.progress-seg.active {
  background:
    repeating-linear-gradient(115deg, rgba(255,255,255,.22) 0 6px, transparent 6px 12px),
    linear-gradient(90deg, color-mix(in srgb, var(--danger) 72%, #fff), var(--danger));
  animation: pbarshift .9s linear infinite;
}
.progress-seg.queued { background: linear-gradient(90deg, color-mix(in srgb, var(--brand) 76%, #fff), var(--brand)); }
.progress-seg.failed { background: linear-gradient(90deg, color-mix(in srgb, var(--warn) 76%, #fff), var(--warn)); }
.progress-seg.idle { background: color-mix(in srgb, var(--muted) 24%, transparent); }
.queue-table {
  max-height: 226px; overflow: auto; margin: 0 -4px 10px; padding: 0 4px;
  scrollbar-width: thin;
}
.qrow {
  display: flex; align-items: flex-start; gap: 8px; padding: 6px 4px;
  border-radius: 10px; transform-origin: top center;
  transition: background .14s ease, opacity .14s ease;
}
.qrow.new { animation: qrowin .24s cubic-bezier(.2,.7,.2,1); }
.qrow.active { background: color-mix(in srgb, var(--danger) 8%, transparent); }
.qrow.queued { background: color-mix(in srgb, var(--brand) 7%, transparent); }
.qrow.failed { background: color-mix(in srgb, var(--warn) 8%, transparent); }
.qrow.done { background: color-mix(in srgb, var(--safe) 8%, transparent); }
.qavatar {
  width: 26px; height: 26px; border-radius: 50%; flex: none; object-fit: cover;
  transition: filter .18s ease, opacity .18s ease;
}
.qavatar.blank { background: var(--border); }
.qbody { min-width: 0; flex: 1; }
.qname {
  font-weight: 650; font-size: 12px; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap;
}
.qmeta { font-size: 11px; }
.qsnip {
  font-size: 11px; color: var(--muted); overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap;
}
.qnote { font-size: 11px; }
.qrow.done .qavatar {
  filter: grayscale(1); opacity: .38;
}
.qrow.done .qname,
.qrow.done .qsnip {
  text-decoration: line-through; opacity: .52;
}
svg { display: block; }
.xss-badge {
  --badge-color: var(--muted);
  display: inline-flex; align-items: center; gap: 4px; margin-left: 6px;
  padding: 2.5px 8px; border-radius: 999px; font-size: 11px; font-weight: 750;
  line-height: 1; white-space: nowrap;
  vertical-align: middle; cursor: default; color: var(--badge-color);
  border: 1px solid color-mix(in srgb, var(--badge-color) 42%, transparent);
  background: color-mix(in srgb, var(--badge-color) 12%, transparent);
  box-shadow: 0 1px 4px rgba(15,23,42,.08);
}
.xss-badge svg { flex: none; }
.xss-badge.ghost {
  color: var(--muted); cursor: pointer;
  border-color: var(--border); background: transparent; box-shadow: none;
}
.xss-badge.ghost:hover { color: var(--text); }
.pop {
  position: fixed; z-index: 2147482001; width: 260px; padding: 12px;
  max-width: calc(100vw - 16px);
  font-size: 12px; color: var(--text);
}
.pop h4 { margin: 0 0 6px; font-size: 12px; font-weight: 700; }
.pop ul { margin: 6px 0; padding-left: 16px; color: var(--muted); }
.pop li { margin: 3px 0; }
.acts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.acts button {
  border: 1px solid var(--border); background: transparent; color: var(--text);
  border-radius: 8px; padding: 4px 9px; font-size: 11px; cursor: pointer;
}
.acts button:hover { background: rgba(255,255,255,.06); }

/* ---- animated badge states (transform/opacity only) ---- */
.xss-badge.fresh { animation: xrise .22s ease-out; }
.xss-badge.known { animation: xpop .18s ease-out; }
.xss-badge .ntag {
  margin-left: 4px; padding: 0 5px; border-radius: 999px; font-size: 9px;
  font-weight: 700; color: var(--warn); border: 1px solid var(--warn);
  letter-spacing: .3px;
}
.xss-badge.analyzing {
  color: var(--muted); position: relative; overflow: hidden;
}
.xss-badge.analyzing::after {
  content: ""; position: absolute; inset: 0;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,.18), transparent);
  transform: translateX(-100%); animation: xshim 1.1s ease-in-out infinite;
}
.xss-spin { animation: xspin .8s linear infinite; transform-origin: 50% 50%; }
.xss-badge.pending {
  color: var(--muted); cursor: default;
  animation: xpulse 1.6s ease-in-out infinite;
}
@keyframes xrise { from { opacity: 0; transform: translateY(4px); } }
@keyframes xpop  { from { opacity: 0; transform: scale(.9); } }
@keyframes xspin { to { transform: rotate(360deg); } }
@keyframes xshim { to { transform: translateX(100%); } }
@keyframes xpulse { 0%,100% { opacity: .55; } 50% { opacity: .95; } }
@keyframes xradar { to { transform: rotate(360deg); } }
@keyframes xbreath { 0%,100% { filter: saturate(1); } 50% { filter: saturate(1.35); } }
@keyframes qrowin {
  from { opacity: 0; transform: translateY(-7px) scale(.985); }
}
@keyframes pbarshift {
  to { background-position: 22px 0, 0 0; }
}

/* New-hit motion: one compact radar lap, slow at first then faster. */
.pill.hit-pulse .scan-radar {
  animation: xhitspin .82s cubic-bezier(.62, 0, 1, .62) 1, xhitglow .9s ease-out 1;
}
@keyframes xhitspin {
  0% { transform: rotate(0deg) scale(1); }
  42% { transform: rotate(72deg) scale(1.08); }
  100% { transform: rotate(360deg) scale(1); }
}
@keyframes xhitglow {
  0% { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 18%, transparent), 0 0 0 0 color-mix(in srgb, var(--accent) 0%, transparent); }
  32% { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 24%, transparent), 0 0 0 5px color-mix(in srgb, var(--accent) 18%, transparent); }
  100% { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 18%, transparent), 0 0 0 0 color-mix(in srgb, var(--accent) 0%, transparent); }
}

@media (prefers-reduced-motion: reduce) {
  .card.open { animation: fade .18s ease-out; }
  @keyframes fade { from { opacity: 0; } }
  .xss-badge.fresh, .xss-badge.known { animation: fade .18s ease-out; }
  .xss-badge.analyzing::after, .xss-spin { animation: none; }
  .xss-badge.pending { animation: none; opacity: .7; }
  .scan-radar.busy,
  .scan-radar.busy .scan-sweep,
  .qrow.new,
  .xss-act.queue.busy,
  .progress-seg.active { animation: none; }
  .pill.hit-pulse .scan-radar { animation: none; }
}
`;

/** HTML-escape untrusted text before innerHTML interpolation (reasons and
 *  display names can embed attacker-controlled strings from page content or
 *  the bundled blacklist). */
const esc = (s: string) =>
  s.replace(/[<>&"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c] ?? c,
  );

/** Only render avatar URLs that are plainly X CDN images. */
const safeAvatarUrl = (url: string | undefined): string | undefined =>
  url && /^https:\/\/pbs\.twimg\.com\//.test(url) ? url : undefined;

// Lucide-style 24-viewBox stroke icons. No emoji (per design system).
const P: Record<string, string> = {
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  "shield-alert": "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM12 8v4M12 16h.01",
  "shield-x": "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9.5 9.5l5 5M14.5 9.5l-5 5",
  "shield-check": "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4",
  x: "M18 6 6 18M6 6l12 12",
};
export function icon(name: keyof typeof P | string, color = "currentColor", size = 16): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="${color}" stroke-width="1.75" stroke-linecap="round"
    stroke-linejoin="round" aria-hidden="true"><path d="${P[name] ?? P.shield}"/></svg>`;
}

export const LABEL: Record<Label, { zh: string; varName: string; ic: string }> = {
  spam: { zh: "垃圾", varName: "--danger", ic: "shield-x" },
  porn_bot: { zh: "色情bot", varName: "--danger", ic: "shield-x" },
  likely_spam: { zh: "疑似垃圾", varName: "--warn", ic: "shield-alert" },
  uncertain: { zh: "不确定", varName: "--neutral", ic: "shield" },
  legit: { zh: "正常", varName: "--safe", ic: "shield-check" },
};

export interface Finding {
  handle: string;
  userId?: string;
  avatarUrl?: string;
  displayName?: string;
  snippet?: string;
  source?: string;
  verdict: Verdict;
}

/** Row lifecycle inside the bubble's batch panel. A key absent from the
 *  state map is "pending" (untouched, selectable). */
type RowState = "queued" | "processing" | "done" | "failed";

export interface BubbleHandlers {
  /** Process the given account keys ONE BY ONE (the caller owns pacing /
   *  real X actions) and call onProgress(key, ok) as each one finishes.
   *  The bubble advances chips + progress bar + row states on every call. */
  onProcess: (keys: string[], onProgress: (key: string, ok: boolean) => void) => void;
  onReviewEach: () => void;
  onDismiss: () => void;
  /** 自动处理 master switch flipped from the card header. */
  onToggleAuto?: (v: boolean) => void;
}

export interface BubbleOpts {
  /** Initial 自动处理 switch state (settings.autoProcess). */
  autoProcess?: boolean;
  /** How many spam categories currently escalate beyond "badge". */
  autoCategoryCount?: number;
}

/** Collapsed pill ⇄ expanded card. Default resting state = pill.
 *  `verb` is the action label (隐藏 / 静音 / 拉黑) per settings.actionMode. */
export function createBubble(
  h: BubbleHandlers,
  pos: "tr" | "br" = "tr",
  verb = "隐藏",
  opts: BubbleOpts = {},
) {
  const root = document.createElement("div");
  root.className = `xss xss-bubble${pos === "br" ? " br" : ""}`;
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");

  const pill = document.createElement("button");
  pill.className = "pill";
  pill.setAttribute("aria-label", `${BRAND.acronym} 本页可疑账号`);

  const card = document.createElement("div");
  card.className = "card";

  root.append(pill, card);
  let open = false;
  let findings: Finding[] = [];
  let scanning = 0; // accounts currently being checked (visible progress)
  // Row states are keyed by account key, NOT stored on the Finding — the
  // caller replaces the findings array wholesale on update().
  const rowState = new Map<string, RowState>();
  // Unchecked keys. Default for a fresh finding = selected (checked).
  const deselected = new Set<string>();
  // Rows already rendered once — suppresses the slide-in replay on rerender.
  const seenRows = new Set<string>();
  // Rows driven by the AUTO path (per-category policy): the extension acts
  // on its own, so the checkbox and per-row button are display-only.
  const autoRows = new Set<string>();
  let autoOn = opts.autoProcess ?? true;
  let autoCats = opts.autoCategoryCount ?? 0;
  // Card list view: the live queue by default; "done" lists processed rows
  // behind the 已处理 chip so they don't pile up under the progress bar.
  let view: "queue" | "done" = "queue";

  // Must match content.ts keyOf(): userId first, `h:${handle}` fallback.
  const rowKey = (f: Finding) => f.userId || `h:${f.handle}`;
  const stateOf = (f: Finding): RowState | "pending" =>
    rowState.get(rowKey(f)) ?? "pending";
  const selectable = (f: Finding) => {
    if (autoRows.has(rowKey(f))) return false; // auto rows are not user-actionable
    const st = stateOf(f);
    return st === "pending" || st === "failed";
  };

  const sev = (f: Finding[]) =>
    f.some((x) => x.verdict.label === "spam" || x.verdict.label === "porn_bot")
      ? "--danger"
      : "--warn";

  function stats() {
    let done = 0;
    let processing = 0;
    let queued = 0;
    let failed = 0;
    let pending = 0;
    for (const f of findings) {
      switch (stateOf(f)) {
        case "done":
          done++;
          break;
        case "processing":
          processing++;
          break;
        case "queued":
          queued++;
          break;
        case "failed":
          failed++;
          break;
        default:
          pending++;
      }
    }
    return {
      found: findings.length,
      done,
      processing,
      queued,
      failed,
      pending,
      running: processing + queued,
    };
  }

  function progressWidth(count: number, total: number) {
    if (count <= 0 || total <= 0) return "0%";
    return `${Math.max(0, Math.min(100, (count / total) * 100)).toFixed(2)}%`;
  }

  function progressSegment(
    kind: "done" | "active" | "queued" | "failed" | "idle",
    count: number,
    total: number,
  ) {
    if (count <= 0) return "";
    return `<span class="progress-seg ${kind}" style="width:${progressWidth(count, total)}"></span>`;
  }

  function renderProgress(s: ReturnType<typeof stats>) {
    const total = Math.max(1, s.found);
    const donePct = Math.round((s.done / total) * 100);
    const remaining = s.processing + s.queued + s.pending;
    return `<div class="block-progress" aria-label="处理进度 ${donePct}%">
      <div class="progress-head">
        <span>${remaining > 0 ? `剩余 ${remaining}` : "处理完成"}</span>
        <b>${donePct}%</b>
      </div>
      <div class="progress-track">
        ${progressSegment("done", s.done, total)}
        ${progressSegment("active", s.processing, total)}
        ${progressSegment("queued", s.queued, total)}
        ${progressSegment("failed", s.failed, total)}
        ${progressSegment("idle", s.pending, total)}
      </div>
    </div>`;
  }

  function progressMarkup(opts: {
    iconName: string;
    iconColor: string;
    title: string;
    count?: string;
    percent: number;
    busy?: boolean;
    danger?: boolean;
  }) {
    const percent = Math.max(0, Math.min(100, opts.percent));
    const angle = Math.round(percent * 3.6);
    return `<span class="scan-pill">
      <span class="scan-radar ${opts.busy ? "busy" : ""} ${opts.danger ? "danger" : ""}" style="--angle:${angle}deg">
        <span class="scan-sweep"></span>
        <span class="scan-core">${icon(opts.iconName, opts.iconColor, 11)}</span>
      </span>
      <span class="scan-title">${opts.title}</span>
      ${opts.count ? `<span class="scan-meta">${opts.count}</span>` : ""}
    </span>`;
  }

  function renderPill() {
    if (findings.length) {
      const s = stats();
      if (s.running > 0) {
        pill.innerHTML = progressMarkup({
          iconName: "shield-x",
          iconColor: "var(--danger)",
          title: `${verb}中`,
          count: `${s.done}/${s.found}`,
          percent: Math.max(8, Math.round((s.done / Math.max(1, s.found)) * 100)),
          busy: true,
          danger: true,
        });
        return;
      }
      if (s.done > 0 && s.done + s.failed >= s.found) {
        pill.innerHTML = progressMarkup({
          iconName: "shield-check",
          iconColor: "var(--safe)",
          title: `已${verb}`,
          count: String(s.done),
          percent: 100,
        });
        return;
      }
      pill.innerHTML = progressMarkup({
        iconName: "shield-alert",
        iconColor: `var(${sev(findings)})`,
        title: "命中",
        count: String(findings.length),
        percent: 100,
        busy: scanning > 0,
        danger: true,
      });
      return;
    }
    if (scanning > 0) {
      // Visible processing feedback (esp. reply sections).
      pill.innerHTML = progressMarkup({
        iconName: "shield",
        iconColor: "var(--brand)",
        title: "检查中",
        count: String(scanning),
        percent: 0,
        busy: true,
      });
      return;
    }
    // Calm "guarding" state — confirms the extension is working even
    // when nothing suspicious is on the page (no alarm color).
    pill.innerHTML = progressMarkup({
      iconName: "shield-check",
      iconColor: "var(--brand)",
      title: "守护",
      percent: 100,
    });
  }

  /** Header-area 自动处理 switch + tiny hint showing how many categories the
   *  per-category policy currently escalates (options 页的分级策略). */
  function autoRowMarkup() {
    const hint = autoOn
      ? autoCats > 0
        ? `分级策略 · ${autoCats} 类自动`
        : "分级策略 · 全部仅标记"
      : "已暂停 · 仅标记";
    return `<div class="auto-row">
      <button class="xss-sw" data-auto role="switch" aria-checked="${autoOn}"
        aria-label="自动处理"></button>
      <span>自动处理</span>
      <span class="auto-hint">${hint}</span>
    </div>`;
  }
  function bindAutoRow() {
    card.querySelector("[data-auto]")?.addEventListener("click", () => {
      autoOn = !autoOn;
      h.onToggleAuto?.(autoOn); // persists to settings; content.ts reacts
      renderCard();
    });
  }

  function renderCard() {
    if (!findings.length) {
      card.innerHTML = `
        <div class="hd">${icon("shield-check", "var(--brand)", 16)}
          <span>${BRAND.acronym} 已启用</span>
          <span class="x" data-x>${icon("x", "currentColor", 14)}</span></div>
        ${autoRowMarkup()}
        <div class="sub" style="display:block;line-height:1.6">
          正在被动检查本页账号。发现可疑的垃圾/色情机器人时，会在这里提示并提供一键处理。</div>
        <div class="row"><span class="lnk" data-gov>为什么 / 治理</span></div>`;
      card.querySelector("[data-x]")?.addEventListener("click", collapse);
      card.querySelector("[data-gov]")?.addEventListener("click", () =>
        window.open(BRAND.governance, "_blank", "noopener"),
      );
      bindAutoRow();
      return;
    }
    const s = stats();
    const waiting = s.queued + s.pending; // 还没轮到 / 还没动手的
    const selectedPending = findings.filter(
      (f) => selectable(f) && !deselected.has(rowKey(f)),
    ).length;
    const selectableCount = findings.filter(selectable).length;
    const batchTouched = s.done + s.processing + s.queued + s.failed > 0;
    const doneRows = findings.filter((f) => stateOf(f) === "done");
    if (view === "done" && !doneRows.length) view = "queue";
    // Queue view: in-flight first, then untouched/failed. Done rows live in
    // the 已处理 tab only.
    const ordered =
      view === "done"
        ? doneRows
        : [
            ...findings.filter((f) => {
              const st = stateOf(f);
              return st === "processing" || st === "queued";
            }),
            ...findings.filter(selectable),
          ];
    card.innerHTML = `
      <div class="hd">${icon("shield-alert", "var(--brand)", 16)}
        <span>${selectableCount || s.running ? `本页发现 ${findings.length} 个可疑账号` : `本页已处理 ${s.done} 个账号`}</span>
        <span class="x" data-x>${icon("x", "currentColor", 14)}</span></div>
      ${autoRowMarkup()}
      <div class="sub">
        <span class="metric" title="本页命中的可疑账号">
          <i style="background:var(--danger)"></i><b>${s.found}</b><em>命中</em>
        </span>
        <span class="metric" title="正在处理">
          <i style="background:var(--warn)"></i><b>${s.processing}</b><em>正在</em>
        </span>
        <span class="metric" title="等待处理">
          <i style="background:var(--muted)"></i><b>${waiting}</b><em>待处理</em>
        </span>
        <span class="metric${doneRows.length ? " tab" : ""}${view === "done" ? " on" : ""}"
          ${doneRows.length ? `data-tab-done role="button" tabindex="0" aria-pressed="${view === "done"}"` : ""}
          title="${s.failed ? `失败 ${s.failed}，` : ""}已处理完成${doneRows.length ? " · 点击查看明细" : ""}">
          <i style="background:${s.failed ? "var(--warn)" : "var(--safe)"}"></i><b>${s.done}</b><em>已处理</em>
        </span>
      </div>
      ${batchTouched ? renderProgress(s) : ""}
      <div class="queue-table">
        ${ordered.length ? "" : `<div class="queue-empty">${icon("shield-check", "var(--safe)", 13)}<span>本页命中已全部处理 · 点「已处理」查看明细</span></div>`}
        ${ordered
          .map((f) => {
            const m = LABEL[f.verdict.label];
            const col = `var(${m.varName})`;
            const avUrl = safeAvatarUrl(f.avatarUrl);
            const av = avUrl
              ? `<img src="${esc(avUrl)}" class="qavatar" alt="">`
              : `<span class="qavatar blank"></span>`;
            const name = esc(f.displayName?.trim() || `@${f.handle}`);
            const snip = f.snippet
              ? esc(f.snippet.replace(/\s+/g, " ").trim()).slice(0, 60)
              : "";
            const id = rowKey(f);
            const isNew = !seenRows.has(id);
            seenRows.add(id);
            const st = stateOf(f);
            const rowCls = [
              "qrow",
              isNew ? "new" : "",
              st === "processing" ? "active" : st === "pending" ? "" : st,
            ]
              .filter(Boolean)
              .join(" ");
            const isAuto = autoRows.has(id);
            const canPick = selectable(f);
            const checked = canPick && !deselected.has(id);
            const actClass =
              st === "done"
                ? "xss-act done"
                : st === "processing"
                  ? "xss-act queue busy"
                  : st === "queued"
                    ? "xss-act queue"
                    : st === "failed"
                      ? "xss-act retry"
                      : "xss-act";
            // Auto rows: the button is a pure status chip, never an action.
            const actText = isAuto
              ? st === "done"
                ? "已处理"
                : st === "failed"
                  ? "失败"
                  : "处理中"
              : st === "done"
                ? `已${verb}`
                : st === "processing"
                  ? `${verb}中`
                  : st === "queued"
                    ? "待处理"
                    : st === "failed"
                      ? "重试"
                      : verb;
            const actDisabled =
              isAuto || st === "done" || st === "processing" || st === "queued";
            return `<div class="${rowCls}">
              <input type="checkbox" class="xss-row-cb" data-sel="${esc(id)}"
                aria-label="选中 @${esc(f.handle)}"
                ${checked ? "checked" : ""} ${canPick ? "" : "disabled"}>
              ${av}
              <div class="qbody">
                <div class="qname">${name}</div>
                <div class="qmeta" style="color:${col}">@${esc(f.handle)} · ${m.zh} ${(f.verdict.confidence * 100).toFixed(0)}%</div>
                ${snip ? `<div class="qsnip">${snip}</div>` : ""}
                ${st === "processing" ? `<div class="qnote" style="color:var(--danger)">${isAuto ? "自动处理中…" : `正在${verb}…`}</div>` : ""}
                ${st === "queued" ? `<div class="qnote" style="color:var(--brand)">排队等待处理</div>` : ""}
                ${st === "failed" ? `<div class="qnote" style="color:var(--warn)">${isAuto ? "自动处理失败" : "处理失败"} · <a href="https://x.com/${esc(f.handle)}" target="_blank" rel="noopener" style="color:var(--warn)">手动处理</a></div>` : ""}
                ${st === "done" ? `<div class="qnote" style="color:var(--safe)">✓ 已${isAuto ? "自动处理" : verb}</div>` : ""}
              </div>
              <button class="${actClass}" data-one="${esc(id)}"${actDisabled ? " disabled" : ""}>${actText}</button>
            </div>`;
          })
          .join("")}
      </div>
      ${
        s.running > 0
          ? `<button class="btn" disabled style="background:var(--brand)">${verb}中 · 正在 ${s.processing} · 待 ${s.queued}</button>`
          : selectableCount === 0
            ? `<button class="btn" disabled style="background:var(--safe)">✓ 已全部处理 (${s.done})</button>`
            : selectedPending === 0
              ? `<button class="btn" disabled style="opacity:.55">未选中任何账号 (剩余 ${selectableCount})</button>`
              : `<button class="btn" data-run>一键${verb}选中 ${selectedPending}${s.done ? ` · 已完成 ${s.done}` : ""}${selectedPending < selectableCount ? ` · 跳过 ${selectableCount - selectedPending}` : ""}</button>`
      }
      <div class="row"><span class="lnk" data-each>逐个查看处理</span>
        <span class="lnk" data-ign>忽略本页</span></div>`;
    bindAutoRow();
    card.querySelector("[data-x]")?.addEventListener("click", collapse);
    card.querySelector("[data-ign]")?.addEventListener("click", () => {
      h.onDismiss();
      root.remove();
    });
    card.querySelector("[data-each]")?.addEventListener("click", h.onReviewEach);
    const doneTab = card.querySelector<HTMLElement>("[data-tab-done]");
    const toggleDone = () => {
      view = view === "done" ? "queue" : "done";
      renderCard();
    };
    doneTab?.addEventListener("click", toggleDone);
    doneTab?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleDone();
      }
    });
    // Per-row select toggle — uncheck excludes from the bulk action so the
    // user can opt-out specific accounts before "一键处理".
    card.querySelectorAll<HTMLInputElement>("[data-sel]").forEach((cb) => {
      cb.addEventListener("change", () => {
        const id = cb.dataset.sel;
        if (!id) return;
        if (cb.checked) deselected.delete(id);
        else deselected.add(id);
        renderCard(); // re-render so the bulk button count updates immediately
      });
    });
    card.querySelectorAll<HTMLElement>("[data-one]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.one;
        const f = findings.find((x) => rowKey(x) === id);
        if (f && selectable(f)) startBatch([rowKey(f)]);
      });
    });
    const b = card.querySelector<HTMLButtonElement>("[data-run]");
    b?.addEventListener("click", () => {
      b.disabled = true;
      b.textContent = "处理中…";
      // Bulk only processes the SELECTED, untouched findings.
      const keys = findings
        .filter((f) => selectable(f) && !deselected.has(rowKey(f)))
        .map(rowKey);
      startBatch(keys);
    });
  }

  /** Kick off a batch: mark rows, then hand the keys to the caller. The
   *  caller processes them sequentially and reports back per key; each
   *  report advances chips, progress bar and row states in place. */
  function startBatch(keys: string[]) {
    if (!keys.length) return;
    keys.forEach((k, i) => {
      rowState.set(k, i === 0 ? "processing" : "queued");
      deselected.delete(k);
    });
    renderPill();
    if (open) renderCard();
    h.onProcess(keys, (key, ok) => {
      rowState.set(key, ok ? "done" : "failed");
      // Sequential batch: promote the next queued row to "processing".
      const next = keys.find((k) => rowState.get(k) === "queued");
      if (next) rowState.set(next, "processing");
      renderPill();
      if (open) renderCard();
    });
  }

  function expand() {
    open = true;
    card.classList.add("open");
    renderCard();
  }
  function collapse() {
    open = false;
    card.classList.remove("open");
  }
  pill.addEventListener("click", () => (open ? collapse() : expand()));
  root.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Escape") collapse();
  });

  // Always-visible calm pill from the start, so the user has feedback that
  // the extension is active. First run: auto-expand the intro once.
  renderPill();
  try {
    if (!localStorage.getItem("xss_onboarded")) {
      localStorage.setItem("xss_onboarded", "1");
      expand();
      setTimeout(() => {
        if (!findings.length) collapse();
      }, 6000);
    }
  } catch {
    /* localStorage may be blocked; non-fatal */
  }

  return {
    el: root,
    update(f: Finding[]) {
      const grew = f.length > findings.length;
      if (grew) view = "queue"; // new hits pull focus back to the live queue
      findings = f;
      // Prune state for rows that left the page (SPA navigation resets).
      const live = new Set(f.map(rowKey));
      for (const k of [...rowState.keys()]) if (!live.has(k)) rowState.delete(k);
      for (const k of [...deselected]) if (!live.has(k)) deselected.delete(k);
      for (const k of [...seenRows]) if (!live.has(k)) seenRows.delete(k);
      for (const k of [...autoRows]) if (!live.has(k)) autoRows.delete(k);
      root.style.display = "";
      renderPill();
      if (open) renderCard();
      if (grew) {
        // New finding: replay one compact radar lap without resizing the pill.
        pill.classList.remove("hit-pulse");
        void pill.offsetWidth; // restart the animation
        pill.classList.add("hit-pulse");
        setTimeout(() => pill.classList.remove("hit-pulse"), 950);
      }
    },
    setScanning(n: number) {
      scanning = Math.max(0, n);
      if (!open) renderPill();
    },
    /** AUTO path: content.ts pushed the finding, then drives its row state
     *  here as the X action progresses. Marks the row as auto-driven —
     *  checkbox disabled, per-row button becomes a status chip. Chips,
     *  progress bar and the radar pill all re-derive from rowState. */
    markAuto(key: string, st: "processing" | "done" | "failed") {
      autoRows.add(key);
      rowState.set(key, st);
      renderPill();
      if (open) renderCard();
    },
    /** Sync the header switch when settings change elsewhere (options page
     *  or another tab). Optionally refresh the category-count hint. */
    setAutoProcess(v: boolean, categoryCount?: number) {
      autoOn = v;
      if (categoryCount !== undefined) autoCats = categoryCount;
      if (open) renderCard();
    },
  };
}

export interface BadgeActions {
  onHide: () => void;
  onAppeal: () => void;
}

/** Inline pill on the author row; hover/focus → popover with reasons. */
/** source: 'fresh' = just classified (rise-in); 'list'/'cache' = already on
 *  record → instant calm "known" marker, no processing implied. */
export type BadgeSource = "fresh" | "list" | "cache" | "rule";

// Popover overlay — a singleton shadow host attached directly under
// <html>. Popovers must NOT live inside the badge's own shadow root: X's
// virtualized timeline wraps rows in transformed containers, and a
// position:fixed element inside a transformed ancestor is positioned
// relative to that ancestor, not the viewport — which made popovers drift
// wildly. At the documentElement level there is no transformed ancestor.
let overlayShadow: ShadowRoot | null = null;
function overlay(): ShadowRoot {
  if (overlayShadow?.host.isConnected) return overlayShadow;
  const host = document.createElement("div");
  host.setAttribute("data-xss-overlay", "");
  host.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;z-index:2147483001;";
  document.documentElement.appendChild(host);
  overlayShadow = host.attachShadow({ mode: "open" });
  const st = document.createElement("style");
  st.textContent = STYLE;
  overlayShadow.appendChild(st);
  return overlayShadow;
}

export function createBadge(
  v: Verdict | null,
  a: BadgeActions,
  note?: string,
  source: BadgeSource = "fresh",
  verb = "隐藏",
): HTMLElement {
  const el = document.createElement("span");
  el.tabIndex = 0;
  if (!v) {
    el.className = "xss-badge ghost";
    el.innerHTML = `${icon("shield", "currentColor", 13)}<span>检查</span>`;
    return el;
  }
  const meta = LABEL[v.label];
  const color = `var(${meta.varName})`;
  const known = source === "list" || source === "cache" || source === "rule";
  el.className = `xss-badge ${known ? "known" : "fresh"}`;
  // Tinted pill: bg/border derive from --badge-color via color-mix in STYLE.
  el.style.setProperty("--badge-color", color);
  const tip =
    source === "list"
      ? "命中公共名单"
      : source === "rule"
        ? "命中官方关键词规则（本机比对）"
        : source === "cache"
          ? "本地缓存命中"
          : "首次发现（本机首次判定，已记录待人工确认）";
  // No native title: the hover popover already carries the details, and the
  // OS tooltip floating next to it reads as visual noise.
  el.setAttribute("aria-label", `${meta.zh} ${(v.confidence * 100).toFixed(0)}% · ${tip}`);
  // Clean pill: icon + label only. 首发 tag marks fresh first-discoveries.
  const tag = known ? "" : `<span class="ntag">首发</span>`;
  el.innerHTML =
    `${icon(meta.ic, "currentColor", 12)}<span>${meta.zh} ${(v.confidence * 100).toFixed(0)}%</span>${tag}`;

  let pop: HTMLElement | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  const onScroll = () => {
    // A fixed popover detaches visually from its anchor the moment the page
    // scrolls — close it instead of letting it float over unrelated content.
    clearTimeout(hideTimer);
    pop?.remove();
    pop = null;
    window.removeEventListener("scroll", onScroll, true);
  };
  const hide = () => {
    if (pop?.matches(":hover")) {
      // Cursor is on the popover (e.g. blur fired mid-click) — stay open.
      scheduleHide();
      return;
    }
    pop?.remove();
    pop = null;
    window.removeEventListener("scroll", onScroll, true);
  };
  const scheduleHide = () => {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, 120);
  };
  const cancelHide = () => clearTimeout(hideTimer);
  const show = () => {
    cancelHide();
    if (pop) return;
    pop = document.createElement("div");
    pop.className = "xss pop card";
    pop.style.display = "block";
    const spammy = ["spam", "porn_bot", "likely_spam"].includes(v.label);
    pop.innerHTML = `
      <h4 style="color:${color}">${meta.zh} · ${(v.confidence * 100).toFixed(0)}%</h4>
      <ul>${v.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
      ${note ? `<div style="color:var(--muted)">${esc(note)}</div>` : ""}
      <div class="acts">
        ${spammy ? `<button data-h>${esc(verb)}</button>` : ""}
        <button data-a title="打开 GitHub 提交误判申诉 issue">误判申诉 ↗</button>
      </div>`;
    pop.querySelector("[data-h]")?.addEventListener("click", a.onHide);
    pop.querySelector("[data-a]")?.addEventListener("click", a.onAppeal);
    // Keep the popover open while the cursor is over it, so its buttons are
    // actually reachable.
    pop.addEventListener("mouseenter", cancelHide);
    pop.addEventListener("mouseleave", scheduleHide);
    // Mount in the top-level overlay (viewport-true fixed positioning),
    // then measure and place: clamp to the viewport's right edge, flip
    // above the badge when there is no room below.
    overlay().appendChild(pop);
    const r = el.getBoundingClientRect();
    const W = pop.offsetWidth || 260;
    const H = pop.offsetHeight || 120;
    const left = Math.min(Math.max(8, r.left), window.innerWidth - W - 8);
    const below = r.bottom + 6;
    const top = below + H > window.innerHeight - 8 ? Math.max(8, r.top - H - 6) : below;
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
  };
  el.addEventListener("mouseenter", show);
  el.addEventListener("focus", show);
  el.addEventListener("mouseleave", scheduleHide);
  el.addEventListener("blur", scheduleHide);
  return el;
}
