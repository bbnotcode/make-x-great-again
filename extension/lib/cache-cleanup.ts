import { CACHE_PREFIX, type Cached, cacheExpired } from "./cache";
import {
  FOLLOW_CACHE_KEY,
  FOLLOWING_TTL_MS,
  NOT_FOLLOWING_TTL_MS,
} from "./follow-verifier";

export const CACHE_CLEANUP_META_KEY = "xss:cache-cleanup:v1";
export const CACHE_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface CacheCleanupReport {
  ts: number;
  removedDetection: number;
  removedFollow: number;
}

interface FollowRow {
  following?: unknown;
  ts?: unknown;
}

export function planCacheCleanup(
  stored: Record<string, unknown>,
  now = Date.now(),
): { removeKeys: string[]; followCache: Record<string, FollowRow>; report: CacheCleanupReport } {
  const removeKeys: string[] = [];
  for (const [key, value] of Object.entries(stored)) {
    if (!key.startsWith(CACHE_PREFIX)) continue;
    if (!value || typeof value !== "object" || cacheExpired(value as Cached, now)) {
      removeKeys.push(key);
    }
  }

  const rawFollow = stored[FOLLOW_CACHE_KEY];
  const followCache: Record<string, FollowRow> = {};
  let totalFollow = 0;
  if (rawFollow && typeof rawFollow === "object" && !Array.isArray(rawFollow)) {
    for (const [handle, raw] of Object.entries(rawFollow as Record<string, unknown>)) {
      totalFollow++;
      if (!raw || typeof raw !== "object") continue;
      const row = raw as FollowRow;
      const ts = Number(row.ts);
      const ttl = row.following === true ? FOLLOWING_TTL_MS : NOT_FOLLOWING_TTL_MS;
      if (!Number.isFinite(ts) || now - ts > ttl) continue;
      followCache[handle] = row;
    }
  }

  return {
    removeKeys,
    followCache,
    report: {
      ts: now,
      removedDetection: removeKeys.length,
      removedFollow: totalFollow - Object.keys(followCache).length,
    },
  };
}

export async function cleanupCaches(now = Date.now()): Promise<CacheCleanupReport> {
  const stored = (await chrome.storage.local.get(null)) as Record<string, unknown>;
  const plan = planCacheCleanup(stored, now);
  if (plan.removeKeys.length) await chrome.storage.local.remove(plan.removeKeys);
  await chrome.storage.local.set({
    [FOLLOW_CACHE_KEY]: plan.followCache,
    [CACHE_CLEANUP_META_KEY]: plan.report,
  });
  return plan.report;
}

export async function cleanupCachesIfDue(now = Date.now()): Promise<CacheCleanupReport | null> {
  const stored = await chrome.storage.local.get(CACHE_CLEANUP_META_KEY);
  const previous = stored[CACHE_CLEANUP_META_KEY] as Partial<CacheCleanupReport> | undefined;
  if (previous?.ts && now - previous.ts < CACHE_CLEANUP_INTERVAL_MS) return null;
  return cleanupCaches(now);
}
