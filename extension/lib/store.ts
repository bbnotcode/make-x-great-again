// Single typed accessor over chrome.storage.local. Backward-safe: a legacy
// string[] blocklist auto-migrates to records on first read. All local, no
// PII beyond the public numeric id (governance unchanged).
import { removeBlocked } from "./blocklist";
import { addLocalAllow } from "./local-allowlist";
import type { Verdict } from "./types";

// "manual"    → user clicked 隐藏 on a badge / bubble
// "auto"      → per-category action policy fired on a public-blacklist hit
// "regex"     → a user-authored regex matched and triggered X-native mute
// "list_hit"  → public-blacklist match (step 2 of content.ts)
// "cache_hit" → local cache says this account is spam (step 1 of content.ts)
// (Legacy sources from the auto-block era are kept for old stored records.)
export type BlockSource =
  | "manual"
  | "auto"
  | "regex"
  | "block_all"
  | "list_hit"
  | "cache_hit";

export interface BlockRecord {
  id: string; // userId, or h:<handle> fallback
  handle: string;
  displayName?: string;
  avatarUrl?: string;
  verdict?: Verdict;
  reason?: string;
  ruleVersion?: string;
  evidenceHash?: string;
  /** The tweet/reply that triggered the action — audit trail so the user
   *  can revisit the scene (https://x.com/<handle>/status/<tweetId>).
   *  Absent when the action happened without a tweet context (profile
   *  header, cross-page batch after DOM recycling). */
  tweetId?: string;
  /** Snapshot of the triggering text — survives tweet deletion. */
  tweetText?: string;
  source: BlockSource;
  ts: number;
}

/** An X mute/block that was committed locally (row hidden + id recorded) but
 *  whose PACED X-action hasn't settled yet. Tracked in its OWN storage key —
 *  NOT on the block record — because getBlocklist()'s legacy migration
 *  synthesizes bare records from the fast-path id set and would strip a field
 *  living on the record. A leftover entry after a page load means the in-queue
 *  died before the X call fired: the account got only a local hide, must not
 *  be shown as 已处理, and must be resumed. */
export interface PendingXAction {
  id: string;
  handle: string;
  action: "mute" | "block";
  /** Regex and explicitly clicked quick actions are independent of the
   * user's default manual action mode. Legacy entries without a source are
   * automatic category actions. */
  source?: "auto" | "bio_rule" | "regex" | "quick";
  ts: number;
  status?: "queued" | "running" | "failed";
  attempts?: number;
  updatedAt?: number;
  lastError?: string;
  priority?: 0 | 1 | 2;
  /** Earliest time a transiently failed action may run again. */
  nextAttemptAt?: number;
}

export interface QueueControl {
  paused: boolean;
  updatedAt: number;
  reason?: string;
}

/** Permalink of the triggering tweet, when recorded. */
export function tweetUrl(r: Pick<BlockRecord, "handle" | "tweetId">): string | null {
  return r.tweetId
    ? `https://x.com/${encodeURIComponent(r.handle)}/status/${r.tweetId}`
    : null;
}

export interface Stats {
  detections: number; // total LLM classifications performed
  cacheHits: number; // LLM calls saved by the L2 cache
  blocks: number;
  byLabel: Record<string, number>;
}

const K_BLOCK = "xss:blocklist:v2";
const K_BLOCK_LEGACY = "xss:blocked";
const K_STATS = "xss:stats";
const K_PENDING = "xss:pending-actions";
export const K_QUEUE_CONTROL = "xss:queue-control:v1";
export const MAX_PENDING_ACTIONS = 200;
export const QUEUE_BURST_LIMIT = 80;
export const QUEUE_BURST_WINDOW_MS = 5 * 60 * 1000;

export function pendingPriority(source: PendingXAction["source"]): 0 | 1 | 2 {
  return source === "quick" ? 0 : source === "regex" ? 1 : 2;
}

export function isIndependentPendingSource(source: PendingXAction["source"]): boolean {
  return source === "quick" || source === "regex" || source === "bio_rule";
}

// Every record mutation is a read-modify-write. A busy reply scan can commit
// dozens at once, so serialize them or late storage writes can overwrite rows
// written by an adjacent task.
let recordLock: Promise<unknown> = Promise.resolve();
function withRecordLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = recordLock.then(fn, fn);
  recordLock = run.catch(() => {});
  return run;
}

async function get<T>(key: string, fallback: T): Promise<T> {
  try {
    const g = await chrome.storage.local.get(key);
    return (g[key] as T) ?? fallback;
  } catch {
    return fallback;
  }
}
async function set(key: string, val: unknown): Promise<void> {
  try {
    await chrome.storage.local.set({ [key]: val });
  } catch {
    /* non-fatal */
  }
}

export async function getBlocklist(): Promise<BlockRecord[]> {
  const v2 = await get<BlockRecord[] | null>(K_BLOCK, null);
  if (v2) return v2;
  // migrate legacy string[] of ids
  const legacy = await get<string[]>(K_BLOCK_LEGACY, []);
  const migrated: BlockRecord[] = legacy.map((id) => ({
    id,
    handle: id.startsWith("h:") ? id.slice(2) : id,
    source: "manual",
    ts: Date.now(),
  }));
  if (migrated.length) await set(K_BLOCK, migrated);
  return migrated;
}

export async function addBlockRecord(rec: BlockRecord): Promise<void> {
  return withRecordLock(async () => {
    const list = await getBlocklist();
    if (list.some((r) => r.id === rec.id)) return;
    list.push(rec);
    await set(K_BLOCK, list);
  });
}

export async function updateBlockRecord(
  id: string,
  patch: Partial<Omit<BlockRecord, "id">>,
): Promise<void> {
  return withRecordLock(async () => {
    const list = await getBlocklist();
    const i = list.findIndex((r) => r.id === id);
    const rec = list[i];
    if (!rec) return;
    const merged: BlockRecord = { ...rec, ...patch };
    // A patch value of undefined means "clear this field" (e.g. settling
    // pendingAction) — drop the key rather than persisting an undefined.
    for (const k of Object.keys(patch) as (keyof typeof patch)[]) {
      if (patch[k] === undefined) delete merged[k];
    }
    list[i] = merged;
    await set(K_BLOCK, list);
  });
}

// Serialize read-modify-write on the pending-actions key. A page can enqueue
// many auto-actions in one scan tick; unserialized void writes would race on
// getPending→set and drop entries (a dropped entry = an account wrongly shown
// as done instead of resumed). One in-context chain keeps them consistent.
let pendingLock: Promise<unknown> = Promise.resolve();
let decisionLock: Promise<unknown> = Promise.resolve();
function withPendingLock<T>(fn: () => Promise<T>): Promise<T> {
  const globallyLocked = async () => {
    const locks = (
      globalThis.navigator as Navigator & {
        locks?: { request<T>(name: string, callback: () => Promise<T>): Promise<T> };
      }
    )?.locks;
    return locks ? locks.request("mxga-pending-storage", fn) : fn();
  };
  const run = pendingLock.then(globallyLocked, globallyLocked);
  pendingLock = run.catch(() => {});
  return run;
}

export async function getPendingActions(): Promise<PendingXAction[]> {
  const rows = await get<PendingXAction[]>(K_PENDING, []);
  return rows
    .map((row) => ({
      ...row,
      status: row.status ?? "queued",
      attempts: row.attempts ?? 0,
      priority: row.priority ?? pendingPriority(row.source),
    }))
    .sort((a, b) => (a.priority ?? 2) - (b.priority ?? 2) || a.ts - b.ts);
}

/** Record an X action that's been committed locally but not yet fired. */
export async function addPendingAction(p: PendingXAction): Promise<string | false> {
  return withPendingLock(async () => {
    const list = await getPendingActions();
    const handle = p.handle.trim().replace(/^@/, "").toLowerCase();
    const existing = list.findIndex(
      (x) => x.id === p.id || x.handle.trim().replace(/^@/, "").toLowerCase() === handle,
    );
    if (existing >= 0) {
      const row = list[existing];
      if (!row) return false;
      if (row.status !== "failed") {
        // A later explicit click may upgrade an already queued automatic task.
        // Keep the original id so the context currently executing it does not
        // lose ownership, but adopt the higher-priority action and fresh handle.
        if (pendingPriority(p.source) < pendingPriority(row.source)) {
          list[existing] = {
            ...row,
            handle: p.handle,
            action: p.action,
            source: p.source,
            priority: pendingPriority(p.source),
            updatedAt: Date.now(),
          };
          await set(K_PENDING, list);
        }
        return row.id;
      }
      const refreshed: PendingXAction = {
        ...row,
        ...p,
        id: row.id,
        status: "queued",
        priority: p.priority ?? pendingPriority(p.source),
        updatedAt: Date.now(),
      };
      delete refreshed.lastError;
      delete refreshed.nextAttemptAt;
      list[existing] = refreshed;
      await set(K_PENDING, list);
      return refreshed.id;
    }
    if (list.length >= MAX_PENDING_ACTIONS) {
      await set(K_QUEUE_CONTROL, {
        paused: true,
        updatedAt: Date.now(),
        reason: `队列达到 ${MAX_PENDING_ACTIONS} 条容量上限`,
      });
      return false;
    }
    const now = Date.now();
    list.push({
      ...p,
      status: p.status ?? "queued",
      attempts: p.attempts ?? 0,
      priority: p.priority ?? pendingPriority(p.source),
      updatedAt: now,
    });
    await set(K_PENDING, list);
    if (
      p.source !== "quick" &&
      list.filter((row) => row.source !== "quick" && now - row.ts <= QUEUE_BURST_WINDOW_MS)
        .length >= QUEUE_BURST_LIMIT
    ) {
      await set(K_QUEUE_CONTROL, {
        paused: true,
        updatedAt: now,
        reason: `5 分钟内自动任务达到 ${QUEUE_BURST_LIMIT} 条，已触发安全熔断`,
      });
    }
    return p.id;
  });
}

/** Atomically commit every durable part of an automatic decision. Chrome's
 * multi-key storage.set is the closest available transaction boundary: a
 * crash cannot leave an account hidden without its audit/recovery row. */
export async function commitAutomaticDecision(input: {
  record: BlockRecord;
  blockedIds: string[];
  pending?: PendingXAction;
}): Promise<string | false | undefined> {
  const run = async () => {
    const stored = await chrome.storage.local.get([K_BLOCK, K_BLOCK_LEGACY, K_PENDING]);
    const records: BlockRecord[] = Array.isArray(stored[K_BLOCK])
      ? ([...stored[K_BLOCK]] as BlockRecord[])
      : ((stored[K_BLOCK_LEGACY] as string[] | undefined) ?? []).map((id) => ({
          id, handle: id.startsWith("h:") ? id.slice(2) : id, source: "manual" as const, ts: Date.now(),
        }));
    if (!records.some((row) => row.id === input.record.id)) records.push(input.record);
    const blocked = new Set<string>((stored[K_BLOCK_LEGACY] as string[] | undefined) ?? []);
    for (const id of input.blockedIds) blocked.add(id);
    const pending = ((stored[K_PENDING] as PendingXAction[] | undefined) ?? []).map((row) => ({
      ...row, status: row.status ?? "queued" as const, attempts: row.attempts ?? 0,
      priority: row.priority ?? pendingPriority(row.source),
    }));
    let pendingId: string | false | undefined;
    if (input.pending) {
      const handle = input.pending.handle.trim().replace(/^@/, "").toLowerCase();
      const existing = pending.find((row) => row.id === input.pending?.id || row.handle.trim().replace(/^@/, "").toLowerCase() === handle);
      if (existing) pendingId = existing.id;
      else if (pending.length >= MAX_PENDING_ACTIONS) pendingId = false;
      else {
        const now = Date.now();
        pending.push({ ...input.pending, status: "queued", attempts: 0, priority: pendingPriority(input.pending.source), updatedAt: now });
        pendingId = input.pending.id;
      }
    }
    const values: Record<string, unknown> = {
      [K_BLOCK]: records,
      [K_BLOCK_LEGACY]: [...blocked],
      [K_PENDING]: pending,
    };
    if (pendingId === false) values[K_QUEUE_CONTROL] = {
      paused: true, updatedAt: Date.now(), reason: `队列达到 ${MAX_PENDING_ACTIONS} 条容量上限`,
    };
    await chrome.storage.local.set(values);
    return pendingId;
  };
  const globallyLocked = async () => {
    const locks = (globalThis.navigator as Navigator & { locks?: { request<T>(name: string, cb: () => Promise<T>): Promise<T> } })?.locks;
    return locks ? locks.request("mxga-decision-storage", run) : run();
  };
  const result = decisionLock.then(globallyLocked, globallyLocked);
  decisionLock = result.catch(() => {});
  return result;
}

export async function updatePendingAction(
  id: string,
  patch: Partial<Omit<PendingXAction, "id">>,
): Promise<void> {
  return withPendingLock(async () => {
    const list = await getPendingActions();
    const index = list.findIndex((row) => row.id === id);
    if (index < 0) return;
    const current = list[index];
    if (!current) return;
    const merged: PendingXAction = { ...current, ...patch, updatedAt: Date.now() };
    for (const key of Object.keys(patch) as (keyof typeof patch)[]) {
      if (patch[key] === undefined) delete merged[key];
    }
    list[index] = merged;
    await set(K_PENDING, list);
  });
}

export async function clearPendingActions(): Promise<void> {
  return withPendingLock(async () => {
    const list = await getPendingActions();
    await set(
      K_PENDING,
      list.filter((row) => row.status === "running"),
    );
  });
}

export async function clearPendingActionsBySource(source: PendingXAction["source"]): Promise<void> {
  return withPendingLock(async () => {
    const list = await getPendingActions();
    await set(K_PENDING, list.filter((row) => row.status === "running" || row.source !== source));
  });
}

export async function getQueueControl(): Promise<QueueControl> {
  return get<QueueControl>(K_QUEUE_CONTROL, { paused: false, updatedAt: 0 });
}

export async function setQueuePaused(paused: boolean): Promise<QueueControl> {
  const control = { paused, updatedAt: Date.now() };
  await set(K_QUEUE_CONTROL, control);
  return control;
}

export async function pauseQueue(reason: string): Promise<QueueControl> {
  const control = { paused: true, updatedAt: Date.now(), reason };
  await set(K_QUEUE_CONTROL, control);
  return control;
}

/** Settle a pending X action (fired or abandoned) — remove it. */
export async function clearPendingAction(id: string): Promise<void> {
  return withPendingLock(async () => {
    const list = await getPendingActions();
    const next = list.filter((x) => x.id !== id);
    if (next.length !== list.length) await set(K_PENDING, next);
  });
}

export async function removeBlock(id: string): Promise<void> {
  let handle: string | undefined;
  await withRecordLock(async () => {
    const list = await getBlocklist();
    const restored = list.find((r) => r.id === id);
    handle = restored?.handle;
    const sameAccount = (r: BlockRecord) =>
      r.id === id ||
      (!!handle && r.handle.toLowerCase() === handle.toLowerCase());
    await set(
      K_BLOCK,
      list.filter((r) => !sameAccount(r)),
    );
  });
  // 恢复显示 is an explicit false-positive decision. Remember it locally so
  // the public list, regex, cache and official rules cannot hide the account
  // again on another tweet.
  await addLocalAllow(/^\d+$/.test(id) ? id : undefined, handle);
  await clearPendingAction(id);
  // Also reconcile the fast-path id set (xss:blocked) that content.ts hides
  // by — otherwise un-hiding never takes effect on X pages.
  await removeBlocked(id);
  if (handle) await removeBlocked(`h:${handle.toLowerCase()}`);
}

/** Cancel an automatic action that became protected after it was queued.
 * Unlike removeBlock(), this must not create a permanent local allow entry:
 * following can later be undone, at which point normal filtering may resume. */
export async function cancelAutomaticBlock(id: string, handle?: string): Promise<void> {
  const normalized = handle?.toLowerCase();
  await withRecordLock(async () => {
    const list = await getBlocklist();
    await set(
      K_BLOCK,
      list.filter(
        (r) => r.id !== id && (!normalized || r.handle.toLowerCase() !== normalized),
      ),
    );
  });
  await clearPendingAction(id);
  await removeBlocked(id);
  if (normalized) await removeBlocked(`h:${normalized}`);
}

export async function blockedIdSet(): Promise<Set<string>> {
  return new Set((await getBlocklist()).map((r) => r.id));
}

export async function getStats(): Promise<Stats> {
  return get<Stats>(K_STATS, {
    detections: 0,
    cacheHits: 0,
    blocks: 0,
    byLabel: {},
  });
}

export async function bumpStats(patch: Partial<Stats> & { label?: string }): Promise<void> {
  const s = await getStats();
  s.detections += patch.detections ?? 0;
  s.cacheHits += patch.cacheHits ?? 0;
  s.blocks += patch.blocks ?? 0;
  if (patch.label) s.byLabel[patch.label] = (s.byLabel[patch.label] ?? 0) + 1;
  await set(K_STATS, s);
}

/** Clear all local extension data (privacy). */
export async function clearAllLocal(): Promise<void> {
  try {
    await chrome.storage.local.clear();
  } catch {
    /* non-fatal */
  }
}

export interface CacheRow {
  id: string;
  handle: string;
  displayName?: string;
  avatarUrl?: string;
  verdict: Verdict;
  model: string;
  ts: number;
}

/** All L2 cache entries (keys prefixed xss:v1:) for the cache browser. */
export async function getCacheRows(): Promise<CacheRow[]> {
  try {
    const all = await chrome.storage.local.get(null);
    const rows: CacheRow[] = [];
    for (const [k, v] of Object.entries(all)) {
      if (!k.startsWith("xss:v1:")) continue;
      const c = v as {
        verdict: Verdict;
        model: string;
        ts: number;
        handle?: string;
        displayName?: string;
        avatarUrl?: string;
      };
      if (!c?.verdict) continue;
      rows.push({
        id: k.slice("xss:v1:".length),
        handle: c.handle ?? k.slice("xss:v1:".length),
        verdict: c.verdict,
        model: c.model,
        ts: c.ts,
        ...(c.displayName ? { displayName: c.displayName } : {}),
        ...(c.avatarUrl ? { avatarUrl: c.avatarUrl } : {}),
      });
    }
    return rows.sort((a, b) => b.ts - a.ts);
  } catch {
    return [];
  }
}
