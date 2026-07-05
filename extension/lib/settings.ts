// User-facing settings (chrome.storage.local, single object). Read at
// content-script start + live-updated via storage.onChanged. No PII.
import type { SpamCategory } from "./category";

/** How a confirmed spam account is handled when the user takes action:
 *  - "local": hide its posts only in this extension (display:none). Zero
 *    network — X never knows. Reversible from the options page. (default)
 *  - "mute":  X-native one-way mute. ta still exists for you, you just stop
 *    seeing them; ta is not notified; follow relationship is kept.
 *  - "block": X-native block. Mutual — breaks the follow relationship and
 *    hides you from each other. Strongest. */
export type ActionMode = "local" | "mute" | "block";

/** What happens automatically when an account on the public blacklist shows
 *  up in the timeline, per spam category:
 *  - "badge": only mark it (current shipped behavior) — user acts manually
 *  - "hide":  auto-hide locally (reversible from 隐藏记录)
 *  - "mute":  auto-hide + X-native mute (needs x.com permission)
 *  - "block": auto-hide + X-native block (needs x.com permission) */
export type CategoryAction = "badge" | "hide" | "mute" | "block";

export type CategoryActions = Record<SpamCategory, CategoryAction>;

export interface Settings {
  enabled: boolean; // master: passive detection on/off
  bubble: boolean; // show the corner bubble
  bubblePos: "tr" | "br"; // top-right / bottom-right
  actionMode: ActionMode; // what "隐藏" does to a flagged account
  categoryActions: CategoryActions; // per-category automatic action on list hits
  edgeBase: string; // advanced: override the public-list site base URL (links only)
}

export const DEFAULT_CATEGORY_ACTIONS: CategoryActions = {
  // All "badge" by default — identical to the shipped behavior (hits are
  // marked, nothing happens without the user). Users escalate per category.
  porn: "badge",
  crypto: "badge",
  gambling: "badge",
  resource: "badge",
  marketing: "badge",
  other: "badge",
};

export const DEFAULTS: Settings = {
  enabled: true,
  bubble: true,
  bubblePos: "tr",
  actionMode: "local",
  categoryActions: { ...DEFAULT_CATEGORY_ACTIONS },
  edgeBase: "",
};

const KEY = "xss:settings";

/** Shallow merge + nested categoryActions merge (a stored partial object
 *  from an older version must not wipe the new keys). */
function withDefaults(partial: Partial<Settings> | undefined): Settings {
  return {
    ...DEFAULTS,
    ...(partial ?? {}),
    categoryActions: {
      ...DEFAULT_CATEGORY_ACTIONS,
      ...(partial?.categoryActions ?? {}),
    },
  };
}

export async function getSettings(): Promise<Settings> {
  try {
    const g = await chrome.storage.local.get(KEY);
    return withDefaults(g[KEY] as Partial<Settings>);
  } catch {
    return withDefaults(undefined);
  }
}

export async function setSetting<K extends keyof Settings>(
  k: K,
  v: Settings[K],
): Promise<void> {
  try {
    const s = await getSettings();
    await chrome.storage.local.set({ [KEY]: { ...s, [k]: v } });
  } catch {
    /* non-fatal */
  }
}

/** Update the action for one spam category. */
export async function setCategoryAction(
  cat: keyof CategoryActions,
  action: CategoryAction,
): Promise<void> {
  const s = await getSettings();
  await setSetting("categoryActions", { ...s.categoryActions, [cat]: action });
}

/** Fires whenever settings change (any tab/page). Returns an unsubscribe. */
export function onSettingsChange(cb: (s: Settings) => void): () => void {
  const h = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ) => {
    if (area === "local" && changes[KEY]) {
      cb(withDefaults(changes[KEY].newValue as Partial<Settings>));
    }
  };
  chrome.storage.onChanged.addListener(h);
  return () => chrome.storage.onChanged.removeListener(h);
}
