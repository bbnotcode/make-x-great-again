// L2 — persistent account-verdict cache (chrome.storage.local).
// Verdict is account-level, not comment-level: once we've judged an account
// we must not re-spend an LLM call when it reappears in another tweet /
// reply / session. This is the dominant cost saver.
import type { Verdict } from "./types";

export const CACHE_PREFIX = "xss:v1:";
export const BIO_RULE_MODEL = "local-bio-rule-v2";
const DAY = 86_400_000;

// TTL by outcome: spam doesn't reform quickly; uncertain should re-evaluate
// sooner in case more signal appears.
export function cacheTtl(label: Verdict["label"]): number {
  if (label === "spam" || label === "porn_bot") return 30 * DAY;
  if (label === "likely_spam") return 14 * DAY;
  if (label === "legit") return 14 * DAY;
  return 3 * DAY; // uncertain
}

export interface Cached {
  verdict: Verdict;
  signalsHash: string;
  model: string;
  ts: number;
  handle?: string;
  displayName?: string;
  avatarUrl?: string;
}

/** Tiny stable hash of the signals that actually drive the verdict. */
export function signalsHash(parts: {
  handle: string;
  displayName: string;
  bio: string;
  recentTweets: string[];
  hasDefaultAvatar: boolean;
  accountAgeDays?: number;
}): string {
  const s = JSON.stringify([
    parts.handle,
    parts.displayName,
    parts.bio,
    parts.recentTweets,
    parts.hasDefaultAvatar,
    parts.accountAgeDays ?? null,
  ]);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export function cacheExpired(c: Cached, now = Date.now()): boolean {
  if (!c?.verdict || typeof c.verdict.label !== "string") return true;
  return !Number.isFinite(c.ts) || now - c.ts > cacheTtl(c.verdict.label);
}

const key = (id: string) => CACHE_PREFIX + id;

export async function cacheGet(id: string): Promise<Cached | null> {
  try {
    const k = key(id);
    const got = await chrome.storage.local.get(k);
    const c = got[k] as Cached | undefined;
    if (!c) return null;
    // Bio rules are intentionally versioned: weakening/removing a rule must
    // invalidate old local detections instead of preserving them for 30 days.
    if (c.model.startsWith("local-bio-rule-") && c.model !== BIO_RULE_MODEL) {
      void chrome.storage.local.remove(k);
      return null;
    }
    if (cacheExpired(c)) {
      void chrome.storage.local.remove(k);
      return null;
    }
    return c;
  } catch {
    return null; // storage unavailable → behave as cache miss
  }
}

export async function cacheSet(id: string, c: Cached): Promise<void> {
  try {
    await chrome.storage.local.set({ [key(id)]: c });
  } catch {
    /* non-fatal */
  }
}
