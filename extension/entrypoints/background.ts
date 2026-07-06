// Background service worker: owns the remote blocklist sync (download-only —
// a public artifact GET; nothing about the user is ever uploaded) and serves
// local health/stats lookups for the popup.
import { syncIfStale, syncList } from "../lib/list-sync";
import type { BgRequest, BgResponse } from "../lib/types";

const SYNC_ALARM = "xss:list-sync";
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
    } catch {
      /* non-fatal */
    }
  };

  chrome.runtime.onInstalled.addListener(() => {
    ensureAlarm();
    void syncList(true); // fresh install / update → fetch immediately
  });
  chrome.runtime.onStartup.addListener(() => {
    ensureAlarm();
    void syncIfStale();
  });
  chrome.alarms.onAlarm.addListener((a) => {
    if (a.name === SYNC_ALARM) void syncList();
  });

  chrome.runtime.onMessage.addListener(
    (msg: BgRequest, _s: chrome.runtime.MessageSender, sendResponse: (r: BgResponse) => void) => {
      (async () => {
        try {
          if (msg.type === "health") {
            const { indexSize, warmLocalIndex } = await import("../lib/local-index");
            const { getStoredList } = await import("../lib/list-sync");
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
          } else if (msg.type === "list-sync") {
            sendResponse({ ok: true, data: await syncList() });
          } else if (msg.type === "stats") {
            const { getStats } = await import("../lib/stats");
            sendResponse({ ok: true, data: await getStats() });
          } else if (msg.type === "records") {
            sendResponse({ ok: true, data: { records: [] } });
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
