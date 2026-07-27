// Read-only relationship verification against X itself. Timeline tweet DOM
// often omits whether the viewer follows the author, so passive DOM detection
// alone cannot safely enforce "followed accounts always win".

const FALLBACK_X_BEARER =
  "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
const CACHE_KEY = "xss:follow-cache:v1";
const FOLLOWING_TTL_MS = 24 * 60 * 60 * 1000;
const NOT_FOLLOWING_TTL_MS = 15 * 60 * 1000;
const MAX_CACHE_ROWS = 2_000;

interface FollowCacheRow {
  following: boolean;
  ts: number;
}

type FollowCache = Record<string, FollowCacheRow>;

let cache: FollowCache | null = null;
let cachePromise: Promise<FollowCache> | null = null;
const inFlight = new Map<string, Promise<boolean | null>>();

function normalizeHandle(value: string): string {
  return value.trim().replace(/^@+/, "").toLowerCase();
}

function apiOrigin(): string {
  return location.hostname.endsWith("twitter.com")
    ? "https://twitter.com"
    : "https://x.com";
}

function ct0(): string {
  return document.cookie.match(/(?:^|;\s*)ct0=([^;]+)/)?.[1] ?? "";
}

async function getCache(): Promise<FollowCache> {
  if (cache) return cache;
  if (!cachePromise) {
    cachePromise = chrome.storage.local
      .get(CACHE_KEY)
      .then((value) => {
        const stored = value[CACHE_KEY];
        cache =
          stored && typeof stored === "object" && !Array.isArray(stored)
            ? (stored as FollowCache)
            : {};
        return cache;
      })
      .catch(() => {
        cache = {};
        return cache;
      });
  }
  return cachePromise;
}

async function remember(handle: string, following: boolean): Promise<void> {
  const key = normalizeHandle(handle);
  if (!key) return;
  const rows = await getCache();
  rows[key] = { following, ts: Date.now() };
  const keys = Object.keys(rows);
  if (keys.length > MAX_CACHE_ROWS) {
    keys
      .sort((a, b) => (rows[a]?.ts ?? 0) - (rows[b]?.ts ?? 0))
      .slice(0, keys.length - MAX_CACHE_ROWS)
      .forEach((old) => delete rows[old]);
  }
  try {
    await chrome.storage.local.set({ [CACHE_KEY]: rows });
  } catch {
    /* in-memory result still protects this page */
  }
}

/** Persist an authoritative relationship control rendered by X. */
export function rememberVisibleRelationship(handle: string, following: boolean): void {
  void remember(handle, following);
}

export function parseFollowingLookup(value: unknown, targetHandle: string): boolean | null {
  if (!Array.isArray(value)) return null;
  const target = normalizeHandle(targetHandle);
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    if (normalizeHandle(String(row.screen_name ?? "")) !== target) continue;
    if (!Array.isArray(row.connections)) return null;
    return row.connections.some((item) => item === "following");
  }
  return null;
}

async function fetchFollowing(targetHandle: string): Promise<boolean | null> {
  const csrf = ct0();
  if (!csrf) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const query = new URLSearchParams({ screen_name: targetHandle });
    const response = await fetch(
      `${apiOrigin()}/i/api/1.1/friendships/lookup.json?${query.toString()}`,
      {
        method: "GET",
        credentials: "include",
        signal: controller.signal,
        headers: {
          authorization: FALLBACK_X_BEARER,
          "x-csrf-token": csrf,
          "x-twitter-auth-type": "OAuth2Session",
          "x-twitter-active-user": "yes",
        },
      },
    );
    if (!response.ok) return null;
    return parseFollowingLookup(await response.json(), targetHandle);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Return true/false when X or a fresh cache gives an authoritative answer;
 * null means the read-only lookup was unavailable and callers should retain
 * their existing non-destructive fallback behavior. */
export async function verifyXFollowing(targetHandle: string): Promise<boolean | null> {
  const key = normalizeHandle(targetHandle);
  if (!key) return null;
  const rows = await getCache();
  const row = rows[key];
  if (row) {
    const ttl = row.following ? FOLLOWING_TTL_MS : NOT_FOLLOWING_TTL_MS;
    if (Date.now() - row.ts < ttl) return row.following;
  }
  const pending = inFlight.get(key);
  if (pending) return pending;
  const request = fetchFollowing(key)
    .then(async (following) => {
      if (following !== null) await remember(key, following);
      return following;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}

