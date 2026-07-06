// Remote blocklist sync — replaces the old bundled blacklist-data.json.
//
// The extension package ships NO list. The background service worker
// downloads the compact "lite" artifact (schema v2, ~4.8MB raw / ~1.5MB on
// the wire) from the official public source and caches it in
// chrome.storage.local; content scripts read the cache and hot-swap via
// storage.onChanged. Privacy stance is unchanged: this is a read-only GET of
// a public artifact — nothing about the user or their browsing is uploaded.
import { BRAND } from "./brand";
import { getSettings } from "./settings";

/** Lite artifact row: [x_user_id ("" when handle-only), handle, "<label><category>"] */
export type LiteRow = [string, string, string];

export interface StoredList {
  version: string;
  fetchedAt: number; // epoch ms of the successful download
  count: number;
  entries: LiteRow[];
}

export const LIST_KEY = "xss:list:v2";

// Refuse to overwrite a good cached list with a suspiciously tiny one — a
// half-deployed or corrupted artifact must not wipe local protection.
const MIN_SANE_ENTRIES = 1000;

interface ListMeta {
  version?: string;
  artifacts?: { lite?: string } | null;
}

interface LiteArtifact {
  schema?: number;
  version?: string;
  count?: number;
  entries?: unknown;
}

export async function getStoredList(): Promise<StoredList | null> {
  try {
    const got = await chrome.storage.local.get(LIST_KEY);
    const v = got[LIST_KEY] as StoredList | undefined;
    return v && Array.isArray(v.entries) ? v : null;
  } catch {
    return null;
  }
}

async function edgeBase(): Promise<string> {
  const s = await getSettings();
  return (s.edgeBase || BRAND.edgeBase).replace(/\/+$/, "");
}

let syncing: Promise<{ updated: boolean; version?: string; error?: string }> | null = null;

/** Download the latest lite artifact if the published version changed.
 *  Serialized: concurrent callers share one in-flight sync. */
export function syncList(force = false) {
  if (!syncing) {
    syncing = doSync(force).finally(() => {
      syncing = null;
    });
  }
  return syncing;
}

async function doSync(force: boolean): Promise<{ updated: boolean; version?: string; error?: string }> {
  try {
    const base = await edgeBase();
    const metaRes = await fetch(`${base}/v1/list/meta`, { cache: "no-cache" });
    if (!metaRes.ok) return { updated: false, error: `meta ${metaRes.status}` };
    const meta = (await metaRes.json()) as ListMeta;
    const litePath = meta.artifacts?.lite;
    if (!litePath) return { updated: false, error: "no lite artifact advertised" };

    const stored = await getStoredList();
    if (!force && stored && meta.version && stored.version === meta.version) {
      return { updated: false, version: stored.version };
    }

    const liteRes = await fetch(`${base}${litePath}`);
    if (!liteRes.ok) return { updated: false, error: `lite ${liteRes.status}` };
    const lite = (await liteRes.json()) as LiteArtifact;
    if (lite.schema !== 2 || !Array.isArray(lite.entries)) {
      return { updated: false, error: "unexpected lite schema" };
    }
    const entries = lite.entries as LiteRow[];
    if (entries.length < MIN_SANE_ENTRIES) {
      return { updated: false, error: `implausibly small list (${entries.length})` };
    }

    const next: StoredList = {
      version: lite.version ?? meta.version ?? `n${entries.length}`,
      fetchedAt: Date.now(),
      count: entries.length,
      entries,
    };
    await chrome.storage.local.set({ [LIST_KEY]: next });
    return { updated: true, version: next.version };
  } catch (e) {
    return { updated: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const STALE_MS = 24 * 3600_000;

/** Sync only when the cache is missing or older than a day (startup path —
 *  cheap no-op on every browser launch in between). */
export async function syncIfStale(): Promise<void> {
  const stored = await getStoredList();
  if (!stored || Date.now() - stored.fetchedAt > STALE_MS) await syncList();
}
