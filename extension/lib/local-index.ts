// Local public-member index — backed by the remotely-synced list cache in
// chrome.storage.local (see list-sync.ts). Provides O(1) lookup by numeric
// userId and handle, and hot-swaps when the background sync stores a newer
// list (no page reload needed).
import { CATEGORY_ZH, type SpamCategory, categoryFromCode } from "./category";
import { LIST_KEY, type StoredList, getStoredList } from "./list-sync";
import type { Label, Verdict } from "./types";

const CODE_TO_LABEL: Record<string, Label> = { p: "porn_bot", s: "spam" };

export interface IndexEntry {
  userId: string;
  handle: string;
  verdict: Verdict;
  /** Server-assigned spam category (LLM / maintainer-curated). Drives the
   *  per-category action policy in settings.categoryActions. */
  category: SpamCategory;
  source: "curated" | "community";
  updatedAt: string; // ISO date
}

// ---- In-memory lookup structures ----
let userIdMap: Map<string, IndexEntry> | null = null;
let handleMap: Map<string, IndexEntry> | null = null;
let warmed = false;

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
    const entry: IndexEntry = {
      userId,
      handle,
      verdict: {
        label,
        confidence: 1,
        reasons: [`公共黑名单收录 · ${CATEGORY_ZH[category]}`],
      },
      category,
      source: "curated",
      updatedAt,
    };
    if (userId) nextById.set(userId, entry);
    if (handle) nextByHandle.set(handle.toLowerCase(), entry);
  }
  userIdMap = nextById;
  handleMap = nextByHandle;
}

// Hot-swap: when the background sync writes a newer list, every open context
// rebuilds its maps without a reload.
try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[LIST_KEY]?.newValue) {
      buildMaps(changes[LIST_KEY].newValue as StoredList);
    }
  });
} catch {
  /* not an extension context (tests) — non-fatal */
}

/** Warm the local index from the synced cache. When the cache is empty
 *  (fresh install, first run), asks the background to sync; lookups return
 *  null until the download lands and the onChanged hook swaps the maps in. */
export async function warmLocalIndex(): Promise<void> {
  if (warmed) return;
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

/** Lookup by userId first, fall back to handle. */
export function lookupLocal(userId?: string, handle?: string): IndexEntry | null {
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
