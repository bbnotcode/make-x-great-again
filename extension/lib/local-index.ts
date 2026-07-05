// Local public-member index — shipped with the extension, loaded at startup.
// Provides O(1) lookup by numeric userId and handle. No remote requests.
import { CATEGORY_ZH, type SpamCategory, isSpamCategory } from "./category";
import type { Label, Verdict } from "./types";

const LABELS: ReadonlySet<string> = new Set<Label>([
  "spam",
  "porn_bot",
  "likely_spam",
  "uncertain",
  "legit",
]);

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

// Bundled row formats:
//   v2 (current): [userId, handle, label, category]      — compact, categorized
//   v1 (legacy):  [userId, handle, label, confidence, reasons[]]
// v1 rows carry no category; only the label-level mapping applies
// (porn_bot → porn) — no local keyword guessing by design.
type BundledRow =
  | [string, string, string, string]
  | [string, string, string, number, string[]];

// ---- In-memory lookup structures ----
let userIdMap: Map<string, IndexEntry> | null = null;
let handleMap: Map<string, IndexEntry> | null = null;
let warmed = false;

function fallbackCategory(label: string): SpamCategory {
  return label === "porn_bot" ? "porn" : "other";
}

/** Warm the local index at startup (asynchronous, loads blacklist-data.json). */
export async function warmLocalIndex(): Promise<void> {
  if (warmed) return;
  try {
    const url = chrome.runtime.getURL("blacklist-data.json");
    const res = await fetch(url);
    const list = (await res.json()) as BundledRow[];

    userIdMap = new Map();
    handleMap = new Map();

    const updatedAt = new Date().toISOString();
    for (const row of list) {
      const [userId, handle, label] = row;
      if (!LABELS.has(label)) continue; // unknown label → skip entry
      const isV2 = typeof row[3] === "string";
      const category: SpamCategory = isV2
        ? isSpamCategory(row[3])
          ? row[3]
          : fallbackCategory(label)
        : fallbackCategory(label);
      const verdict: Verdict = isV2
        ? {
            label: label as Label,
            confidence: 1,
            reasons: [`公共黑名单收录 · ${CATEGORY_ZH[category]}`],
          }
        : {
            label: label as Label,
            confidence: (row[3] as number | undefined) ?? 1,
            reasons: (row[4] as string[] | undefined) ?? [],
          };
      const entry: IndexEntry = {
        userId,
        handle,
        verdict,
        category,
        source: "curated",
        updatedAt,
      };
      if (userId) userIdMap.set(userId, entry);
      if (handle) handleMap.set(handle.toLowerCase(), entry);
    }
    warmed = true;
  } catch (e) {
    console.error("Failed to load local blacklist index:", e);
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
