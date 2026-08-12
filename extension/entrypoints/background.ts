// Background service worker: owns the remote blocklist sync (download-only —
// a public artifact GET; nothing about the user is ever uploaded) and serves
// local health/stats lookups for the popup.
import { syncIfStale, syncList } from "../lib/list-sync";
import type { BgRequest, BgResponse } from "../lib/types";

// ---- GitHub Device Flow (v0.4's login interaction, restored for the
// whitelist self-service). Public device-flow client id — NOT a secret
// (device flow has no client secret by design). The fetches live in the
// background because github.com's device endpoints don't serve CORS; the
// options page requests the optional github.com host permission first.
const GH_CLIENT_ID = "Ov23liP2AbdNePTyKUEA";

async function ghStart() {
  const r = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ client_id: GH_CLIENT_ID, scope: "read:user" }),
  });
  return (await r.json()) as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    interval: number;
  };
}

async function ghPoll(deviceCode: string) {
  const r = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_id: GH_CLIENT_ID,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });
  const j = (await r.json()) as { access_token?: string; error?: string };
  if (!j.access_token) return { pending: j.error ?? "pending" };
  const { setGh } = await import("../lib/auth");
  const u = await fetch("https://api.github.com/user", {
    headers: { authorization: `Bearer ${j.access_token}`, accept: "application/vnd.github+json" },
  });
  const user = (await u.json()) as { login?: string };
  await setGh(j.access_token, user.login ?? "github");
  return { login: user.login ?? "github" };
}

const SYNC_ALARM = "xss:list-sync";
const CACHE_CLEANUP_ALARM = "xss:cache-cleanup";
// 6h cadence matches the server's mirror cron; the artifact itself only
// changes when the confirmed set changes, and version-match syncs are a
// single small meta GET.
const SYNC_PERIOD_MIN = 360;

export default defineBackground(() => {
  const ensureAlarm = () => {
    try {
      chrome.alarms.create(SYNC_ALARM, {
        periodInMinutes: SYNC_PERIOD_MIN,
        delayInMinutes: 1,
      });
      chrome.alarms.create(CACHE_CLEANUP_ALARM, {
        periodInMinutes: 24 * 60,
        delayInMinutes: 10,
      });
    } catch {
      /* non-fatal */
    }
  };

  chrome.runtime.onInstalled.addListener(() => {
    ensureAlarm();
    void syncList(true); // fresh install / update → fetch immediately
    void import("../lib/cache-cleanup").then(({ cleanupCachesIfDue }) => cleanupCachesIfDue());
  });
  chrome.runtime.onStartup.addListener(() => {
    ensureAlarm();
    void syncIfStale();
    void import("../lib/cache-cleanup").then(({ cleanupCachesIfDue }) => cleanupCachesIfDue());
  });
  chrome.alarms.onAlarm.addListener((a) => {
    if (a.name === SYNC_ALARM) void syncList();
    if (a.name === CACHE_CLEANUP_ALARM) {
      void import("../lib/cache-cleanup").then(({ cleanupCaches }) => cleanupCaches());
    }
  });

  chrome.runtime.onMessage.addListener(
    (msg: BgRequest, _s: chrome.runtime.MessageSender, sendResponse: (r: BgResponse) => void) => {
      (async () => {
        try {
          if (msg.type === "health") {
            const { indexSize, warmLocalIndex } = await import("../lib/local-index");
            const { getStoredList } = await import("../lib/list-sync");
            // Browser-data cleanup may remove extension storage without an
            // install/startup event. Recover synchronously when the popup or
            // content script first asks for health instead of reporting a
            // misleading healthy zero-entry index.
            if (!(await getStoredList())) await syncList(true);
            await warmLocalIndex();
            const stored = await getStoredList();
            sendResponse({
              ok: true,
              data: {
                records: stored?.count ?? indexSize(),
                listVersion: stored?.version ?? null,
                listFetchedAt: stored?.fetchedAt ?? null,
              },
            });
          } else if (msg.type === "list-lookup-batch") {
            if (!Array.isArray(msg.identities) || msg.identities.length > 100) {
              sendResponse({ ok: false, error: "invalid lookup batch" });
              return;
            }
            const { lookupLocal, warmLocalIndex } = await import("../lib/local-index");
            const { getStoredList } = await import("../lib/list-sync");
            if (!(await getStoredList())) await syncList(true);
            await warmLocalIndex();
            sendResponse({
              ok: true,
              data: msg.identities.map((identity) =>
                lookupLocal(identity.userId, identity.handle),
              ),
            });
          } else if (msg.type === "diagnostics") {
            const { getBlocklist, getPendingActions } = await import("../lib/store");
            const { indexSize, warmLocalIndex } = await import("../lib/local-index");
            const { getStoredList, getStoredWhitelist } = await import("../lib/list-sync");
            await warmLocalIndex();
            const [list, whitelist, records, pending, stored] = await Promise.all([
              getStoredList(),
              getStoredWhitelist(),
              getBlocklist(),
              getPendingActions(),
              chrome.storage.local.get(null),
            ]);
            const followCache = stored["xss:follow-cache:v1"];
            const cleanup = stored["xss:cache-cleanup:v1"] as
              | { ts?: number; removedDetection?: number; removedFollow?: number }
              | undefined;
            const detectionCacheKeys = Object.keys(stored).filter((key) =>
              key.startsWith("xss:v1:"),
            );
            const [totalBytes, listBytes, cacheBytes, recordsBytes] = await Promise.all([
              chrome.storage.local.getBytesInUse(null),
              chrome.storage.local.getBytesInUse(["xss:list:v2", "xss:whitelist:v1"]),
              chrome.storage.local.getBytesInUse([
                "xss:follow-cache:v1",
                "xss:cache-cleanup:v1",
                ...detectionCacheKeys,
              ]),
              chrome.storage.local.getBytesInUse([
                "xss:blocklist:v2",
                "xss:blocked",
                "xss:pending-actions",
              ]),
            ]);
            sendResponse({
              ok: true,
              data: {
                extensionVersion: chrome.runtime.getManifest().version,
                indexOwner: "background",
                indexEntries: indexSize(),
                listVersion: list?.version ?? null,
                listFetchedAt: list?.fetchedAt ?? null,
                whitelistEntries: whitelist?.count ?? 0,
                rules: list?.rules?.length ?? 0,
                processedRecords: records.length,
                pendingActions: pending.length,
                followCacheEntries:
                  followCache && typeof followCache === "object"
                    ? Object.keys(followCache as Record<string, unknown>).length
                    : 0,
                cacheCleanup: cleanup ?? null,
                storageBytes: {
                  total: totalBytes,
                  list: listBytes,
                  cache: cacheBytes,
                  records: recordsBytes,
                  other: Math.max(0, totalBytes - listBytes - cacheBytes - recordsBytes),
                },
              },
            });
          } else if (msg.type === "queue-status") {
            const { getPendingActions, getQueueControl } = await import("../lib/store");
            const [tasks, control] = await Promise.all([getPendingActions(), getQueueControl()]);
            sendResponse({ ok: true, data: { ...control, tasks } });
          } else if (msg.type === "queue-command") {
            const {
              clearPendingAction,
              clearPendingActions,
              clearPendingActionsBySource,
              getPendingActions,
              getQueueControl,
              setQueuePaused,
              updatePendingAction,
            } = await import("../lib/store");
            if (msg.command === "pause") await setQueuePaused(true);
            else if (msg.command === "resume") await setQueuePaused(false);
            else if (msg.command === "clear") await clearPendingActions();
            else if (msg.command === "clear-source" && msg.source) {
              await clearPendingActionsBySource(msg.source);
            }
            else if ((msg.command === "cancel" || msg.command === "retry") && msg.id) {
              if (msg.command === "cancel") {
                const row = (await getPendingActions()).find((item) => item.id === msg.id);
                if (row?.status === "running") {
                  sendResponse({ ok: false, error: "正在执行的任务无法中断" });
                  return;
                }
                await clearPendingAction(msg.id);
              }
              else {
                await updatePendingAction(msg.id, {
                  status: "queued",
                  lastError: undefined,
                  nextAttemptAt: undefined,
                });
              }
            } else {
              sendResponse({ ok: false, error: "invalid queue command" });
              return;
            }
            const [tasks, control] = await Promise.all([getPendingActions(), getQueueControl()]);
            sendResponse({ ok: true, data: { ...control, tasks } });
          } else if (msg.type === "cache-cleanup") {
            const { cleanupCaches } = await import("../lib/cache-cleanup");
            sendResponse({ ok: true, data: await cleanupCaches() });
          } else if (msg.type === "list-sync") {
            sendResponse({ ok: true, data: await syncList(!!msg.force) });
          } else if (msg.type === "stats") {
            const { getStats } = await import("../lib/stats");
            sendResponse({ ok: true, data: await getStats() });
          } else if (msg.type === "records") {
            sendResponse({ ok: true, data: { records: [] } });
          } else if (msg.type === "gh_start") {
            sendResponse({ ok: true, data: await ghStart() });
          } else if (msg.type === "gh_poll") {
            sendResponse({ ok: true, data: await ghPoll(msg.deviceCode) });
          } else if (msg.type === "open_options") {
            chrome.runtime.openOptionsPage();
            sendResponse({ ok: true });
          } else if (msg.type === "report") {
            // Authenticated POST /v1/report from the SHARED extension origin
            // (same path the whitelist-apply flow uses), not the content
            // script — x.com's CORS/CSP would otherwise block it.
            const { getGhToken } = await import("../lib/auth");
            const { edgeBase } = await import("../lib/list-sync");
            const token = await getGhToken();
            if (!token) {
              sendResponse({ ok: false, error: "no_token" });
            } else {
              const base = await edgeBase();
              const res = await fetch(`${base}/v1/report`, {
                method: "POST",
                headers: {
                  authorization: `Bearer ${token}`,
                  "content-type": "application/json",
                },
                body: JSON.stringify(msg.sig),
              });
              let body: unknown = {};
              try {
                body = await res.json();
              } catch {
                /* non-JSON error page */
              }
              sendResponse({ ok: true, data: { status: res.status, body } });
            }
          } else {
            sendResponse({ ok: false, error: "unknown message" });
          }
        } catch (e) {
          sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
        }
      })();
      return true; // async response
    },
  );
});
