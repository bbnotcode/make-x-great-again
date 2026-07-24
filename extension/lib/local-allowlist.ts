// User-owned false-positive overrides. Unlike the remotely synced official
// whitelist, this list is created locally when the user clicks 恢复显示 and
// never leaves the browser.
export const LOCAL_ALLOWLIST_KEY = "xss:local-allowlist:v1";

export interface LocalAllowlistData {
  ids: string[];
  handles: string[];
}

let ids = new Set<string>();
let handles = new Set<string>();
let warmed = false;

function normalizeHandle(handle?: string): string {
  return String(handle ?? "").trim().replace(/^@+/, "").toLowerCase();
}

function applyData(data?: Partial<LocalAllowlistData> | null): void {
  ids = new Set((data?.ids ?? []).filter((id) => /^\d+$/.test(id)));
  handles = new Set((data?.handles ?? []).map(normalizeHandle).filter(Boolean));
}

export function matchesLocalAllowlist(
  data: Partial<LocalAllowlistData> | null | undefined,
  userId?: string,
  handle?: string,
): boolean {
  const normalized = normalizeHandle(handle);
  return (
    (!!userId && (data?.ids ?? []).includes(userId)) ||
    (!!normalized && (data?.handles ?? []).map(normalizeHandle).includes(normalized))
  );
}

export async function warmLocalAllowlist(): Promise<void> {
  if (warmed) return;
  try {
    const got = await chrome.storage.local.get(LOCAL_ALLOWLIST_KEY);
    applyData(got[LOCAL_ALLOWLIST_KEY] as LocalAllowlistData | undefined);
  } catch {
    applyData();
  }
  warmed = true;
}

export function isLocallyAllowed(userId?: string, handle?: string): boolean {
  return (
    (!!userId && ids.has(userId)) ||
    (!!normalizeHandle(handle) && handles.has(normalizeHandle(handle)))
  );
}

export async function addLocalAllow(userId?: string, handle?: string): Promise<void> {
  await warmLocalAllowlist();
  if (userId && /^\d+$/.test(userId)) ids.add(userId);
  const normalized = normalizeHandle(handle);
  if (normalized) handles.add(normalized);
  try {
    await chrome.storage.local.set({
      [LOCAL_ALLOWLIST_KEY]: { ids: [...ids], handles: [...handles] },
    });
  } catch {
    /* in-memory protection still applies in this extension context */
  }
}

try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[LOCAL_ALLOWLIST_KEY]) return;
    applyData(changes[LOCAL_ALLOWLIST_KEY].newValue as LocalAllowlistData | undefined);
    warmed = true;
  });
} catch {
  /* not an extension context (tests) */
}
