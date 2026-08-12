// Read-only relationship verification against X itself. Timeline tweet DOM
// often omits whether the viewer follows the author, so passive DOM detection
// alone cannot safely enforce "followed accounts always win".

import { isXPageHealthyForExtensionApi } from "./x-health";

const FALLBACK_X_BEARER =
  "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
export const FOLLOW_CACHE_KEY = "xss:follow-cache:v1";
export const FOLLOWING_TTL_MS = 24 * 60 * 60 * 1000;
export const NOT_FOLLOWING_TTL_MS = 15 * 60 * 1000;
const MAX_CACHE_ROWS = 2_000;
const LOOKUP_BATCH_MAX = 50;
const LOOKUP_BATCH_DELAY_MS = 80;
const LOOKUP_MIN_INTERVAL_MS = 750;
const FORCE_REFRESH_GRACE_MS = 60_000;

interface FollowCacheRow {
  following: boolean;
  ts: number;
}

type FollowCache = Record<string, FollowCacheRow>;

let cache: FollowCache | null = null;
let cachePromise: Promise<FollowCache> | null = null;
const inFlight = new Map<string, Promise<boolean | null>>();
const lookupQueue = new Map<string, Array<(value: boolean | null) => void>>();
let lookupTimer: ReturnType<typeof setTimeout> | undefined;
let lookupDraining = false;
let nextLookupAt = 0;
let unavailableUntil = 0;

try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[FOLLOW_CACHE_KEY]) return;
    const value = changes[FOLLOW_CACHE_KEY].newValue;
    cache = value && typeof value === "object" && !Array.isArray(value)
      ? (value as FollowCache)
      : {};
    cachePromise = Promise.resolve(cache);
  });
} catch {
  /* tests / non-extension context */
}

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
      .get(FOLLOW_CACHE_KEY)
      .then((value) => {
        const stored = value[FOLLOW_CACHE_KEY];
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
    await chrome.storage.local.set({ [FOLLOW_CACHE_KEY]: rows });
  } catch {
    /* in-memory result still protects this page */
  }
}

/** Persist an authoritative relationship control rendered by X. */
export function rememberVisibleRelationship(handle: string, following: boolean): void {
  void remember(handle, following);
}

export function parseFollowingLookup(value: unknown, targetHandle: string): boolean | null {
  return parseFollowingLookupBatch(value).get(normalizeHandle(targetHandle)) ?? null;
}

export function parseFollowingLookupBatch(value: unknown): Map<string, boolean> {
  const result = new Map<string, boolean>();
  if (!Array.isArray(value)) return result;
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const handle = normalizeHandle(String(row.screen_name ?? ""));
    if (!handle || !Array.isArray(row.connections)) continue;
    result.set(handle, row.connections.some((item) => item === "following"));
  }
  return result;
}

function parseRetryAfter(value: string | null): number {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : 0;
}

async function fetchFollowingBatch(handles: string[]): Promise<Map<string, boolean> | null> {
  const csrf = ct0();
  if (!csrf) {
    unavailableUntil = Date.now() + 30_000;
    return null;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const query = new URLSearchParams({ screen_name: handles.join(",") });
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
    if (!response.ok) {
      unavailableUntil =
        Date.now() +
        (response.status === 429
          ? Math.max(5 * 60_000, parseRetryAfter(response.headers.get("retry-after")))
          : response.status >= 500
            ? 30_000
            : 60_000);
      return null;
    }
    return parseFollowingLookupBatch(await response.json());
  } catch {
    unavailableUntil = Date.now() + 15_000;
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function scheduleLookup(delay = LOOKUP_BATCH_DELAY_MS): void {
  if (lookupTimer || lookupDraining) return;
  lookupTimer = setTimeout(() => {
    lookupTimer = undefined;
    void drainLookupQueue();
  }, Math.max(0, delay));
}

async function drainLookupQueue(): Promise<void> {
  if (lookupDraining || !lookupQueue.size) return;
  const now = Date.now();
  if (unavailableUntil > now) {
    // Do not leave classification/action tasks hanging for minutes while X is
    // rate-limited or unavailable. Resolve as unknown and let the normal
    // non-destructive fallback/cache path handle this scan.
    for (const waiters of lookupQueue.values()) {
      for (const resolve of waiters) resolve(null);
    }
    lookupQueue.clear();
    return;
  }
  if (nextLookupAt > now) {
    scheduleLookup(nextLookupAt - now);
    return;
  }
  lookupDraining = true;
  const handles = [...lookupQueue.keys()].slice(0, LOOKUP_BATCH_MAX);
  const waiters = new Map(handles.map((handle) => [handle, lookupQueue.get(handle) ?? []]));
  for (const handle of handles) lookupQueue.delete(handle);
  try {
    const result = await fetchFollowingBatch(handles);
    nextLookupAt = Date.now() + LOOKUP_MIN_INTERVAL_MS;
    for (const handle of handles) {
      const following = result?.get(handle) ?? null;
      for (const resolve of waiters.get(handle) ?? []) resolve(following);
    }
  } finally {
    lookupDraining = false;
    if (lookupQueue.size) scheduleLookup();
  }
}

function enqueueFollowingLookup(handle: string): Promise<boolean | null> {
  if (Date.now() < unavailableUntil || !isXPageHealthyForExtensionApi()) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const waiters = lookupQueue.get(handle);
    if (waiters) waiters.push(resolve);
    else lookupQueue.set(handle, [resolve]);
    scheduleLookup();
  });
}

/** Return true/false when X or a fresh cache gives an authoritative answer;
 * null means the read-only lookup was unavailable and callers should retain
 * their existing non-destructive fallback behavior. */
export async function verifyXFollowing(
  targetHandle: string,
  options: { forceRefresh?: boolean } = {},
): Promise<boolean | null> {
  const key = normalizeHandle(targetHandle);
  if (!key) return null;
  const rows = await getCache();
  const row = rows[key];
  if (row) {
    const ttl = row.following ? FOLLOWING_TTL_MS : NOT_FOLLOWING_TTL_MS;
    const age = Date.now() - row.ts;
    if (age < ttl && (!options.forceRefresh || age < FORCE_REFRESH_GRACE_MS)) {
      return row.following;
    }
  }
  const pending = inFlight.get(key);
  if (pending) return pending;
  const request = enqueueFollowingLookup(key)
    .then(async (following) => {
      if (following !== null) await remember(key, following);
      return following;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}
