// Local public-member index — backed by the remotely-synced list cache in
// chrome.storage.local (see list-sync.ts). Provides O(1) lookup by numeric
// userId and handle, and hot-swaps when the background sync stores a newer
// list (no page reload needed).
import { CATEGORY_ZH, type SpamCategory, categoryFromCode } from "./category";
import {
  LIST_KEY,
  type StoredList,
  type StoredWhitelist,
  WL_KEY,
  getStoredList,
  getStoredWhitelist,
} from "./list-sync";
import { setLocalRules } from "./local-rules";
import type { Label, Verdict } from "./types";

const CODE_TO_LABEL: Record<string, Label> = { p: "porn_bot", s: "spam" };

export interface IndexEntry {
  userId: string;
  handle: string;
  verdict: Verdict;
  /** Server-assigned spam category (LLM / maintainer-curated). Drives the
   *  per-category action policy in settings.categoryActions. */
  category: SpamCategory;
  /** Publish provenance from the lite artifact's 3rd code char:
   *  'confirmed' = a human (maintainer) reviewed this entry ('h');
   *  'auto'      = AI/rule/mention auto-publish, or an old artifact without
   *                the tier char. Auto mute/block MUST only fire on
   *                'confirmed' — auto entries are badge-only. */
  tier: "confirmed" | "auto";
  source: "curated" | "community";
  updatedAt: string; // ISO date
}

// ---- In-memory lookup structures ----
let userIdMap: Map<string, IndexEntry> | null = null;
let handleMap: Map<string, IndexEntry> | null = null;
// Official whitelist — accounts here are never returned by lookupLocal,
// whatever the blacklist says. Safety valve for false positives / appeals.
let wlIds = new Set<string>();
let wlHandles = new Set<string>();
let warmed = false;

function buildWhitelist(wl: StoredWhitelist): void {
  const ids = new Set<string>();
  const handles = new Set<string>();
  for (const [uid, handle] of wl.entries) {
    if (uid) ids.add(uid);
    if (handle) handles.add(handle.toLowerCase());
  }
  wlIds = ids;
  wlHandles = handles;
}

function buildMaps(list: StoredList): void {
  const nextById = new Map<string, IndexEntry>();
  const nextByHandle = new Map<string, IndexEntry>();
  const updatedAt = new Date(list.fetchedAt).toISOString();
  for (const row of list.entries) {
    if (!Array.isArray(row) || row.length < 3) continue;
    const [userId, handle, code] = row;
    const label = CODE_TO_LABEL[String(code)[0] ?? ""];
    if (!label) continue;
    const category = categoryFromCode(String(code)[1]);
    const tier = String(code)[2] === "h" ? "confirmed" : "auto";
    const entry: IndexEntry = {
      userId,
      handle,
      verdict: {
        label,
        confidence: 1,
        reasons: [
          `公共黑名单收录 · ${CATEGORY_ZH[category]}${tier === "confirmed" ? " · 人工确认" : " · 自动收录"}`,
        ],
      },
      category,
      tier,
      source: "curated",
      updatedAt,
    };
    if (userId) nextById.set(userId, entry);
    if (handle) nextByHandle.set(handle.toLowerCase(), entry);
  }
  userIdMap = nextById;
  handleMap = nextByHandle;
  setLocalRules(list.rules);
}

// Hot-swap: when the background sync writes a newer list, every open context
// rebuilds its maps without a reload.
try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[LIST_KEY]?.newValue) buildMaps(changes[LIST_KEY].newValue as StoredList);
    if (changes[WL_KEY]?.newValue) buildWhitelist(changes[WL_KEY].newValue as StoredWhitelist);
  });
} catch {
  /* not an extension context (tests) — non-fatal */
}

/** Warm the local index from the synced cache. When the cache is empty
 *  (fresh install, first run), asks the background to sync; lookups return
 *  null until the download lands and the onChanged hook swaps the maps in. */
export async function warmLocalIndex(): Promise<void> {
  if (warmed) return;
  const wl = await getStoredWhitelist();
  if (wl) buildWhitelist(wl);
  const stored = await getStoredList();
  if (stored) {
    buildMaps(stored);
    warmed = true;
    return;
  }
  userIdMap ??= new Map();
  handleMap ??= new Map();
  try {
    // Fire-and-forget: background owns the download (content scripts must not
    // each fetch a 5MB artifact). Response arrives via storage.onChanged.
    void chrome.runtime.sendMessage({ type: "list-sync" });
  } catch {
    /* background unavailable (tests) — stay empty */
  }
}

/** Synchronous lookup by numeric userId. Returns null if not found. */
export function lookupByUserId(userId: string): IndexEntry | null {
  return userIdMap?.get(userId) ?? null;
}

/** Synchronous lookup by handle (case-insensitive). Returns null if not found. */
export function lookupByHandle(handle: string): IndexEntry | null {
  return handleMap?.get(handle.toLowerCase()) ?? null;
}

/** Official-whitelist membership — shared guard for every local detection
 *  path (list lookup AND local keyword rules). */
export function isWhitelisted(userId?: string, handle?: string): boolean {
  if (userId && wlIds.has(userId)) return true;
  if (handle && wlHandles.has(handle.toLowerCase())) return true;
  return false;
}

/** Lookup by userId first, fall back to handle. Whitelisted accounts are
 *  never reported as hits. */
export function lookupLocal(userId?: string, handle?: string): IndexEntry | null {
  if (userId && wlIds.has(userId)) return null;
  if (handle && wlHandles.has(handle.toLowerCase())) return null;
  if (userId) {
    const byId = lookupByUserId(userId);
    if (byId) return byId;
  }
  if (handle) {
    return lookupByHandle(handle);
  }
  return null;
}

/** Total entries in the loaded index. */
export function indexSize(): number {
  return userIdMap ? userIdMap.size : 0;
}
