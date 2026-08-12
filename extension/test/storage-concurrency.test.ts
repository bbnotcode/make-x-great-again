import assert from "node:assert/strict";
import { test } from "node:test";

const values: Record<string, unknown> = {};
let crossTabLockRequests = 0;

Object.defineProperty(globalThis, "chrome", { configurable: true, value: {
  storage: {
    local: {
      async get(key: string) {
        return { [key]: values[key] };
      },
      async set(patch: Record<string, unknown>) {
        // Yield so concurrent read-modify-write implementations reliably
        // overlap in this regression test.
        await new Promise((resolve) => setTimeout(resolve, 1));
        Object.assign(values, structuredClone(patch));
      },
    },
    onChanged: { addListener() {}, removeListener() {} },
  },
} });
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    locks: {
      async request<T>(_name: string, callback: () => Promise<T>): Promise<T> {
        crossTabLockRequests++;
        return callback();
      },
    },
  },
});

const {
  addBlockRecord,
  addPendingAction,
  clearPendingActions,
  getBlocklist,
  getPendingActions,
  getQueueControl,
  MAX_PENDING_ACTIONS,
  QUEUE_BURST_LIMIT,
  setQueuePaused,
  updatePendingAction,
} = await import("../lib/store");
const { addBlocked } = await import("../lib/blocklist");

test("parallel scan commits do not overwrite block records", async () => {
  await Promise.all(
    Array.from({ length: 40 }, (_, i) =>
      addBlockRecord({
        id: String(i + 1),
        handle: `spam_${i + 1}`,
        source: "auto",
        ts: i,
      }),
    ),
  );
  assert.equal((await getBlocklist()).length, 40);
});

test("parallel fast-path commits preserve every detected identity", async () => {
  await Promise.all(Array.from({ length: 40 }, (_, i) => addBlocked(`h:spam_${i + 1}`)));
  const stored = values["xss:blocked"] as string[];
  assert.equal(stored.length, 40);
  assert.equal(new Set(stored).size, 40);
});

test("parallel native-action snapshots preserve the complete recovery queue", async () => {
  crossTabLockRequests = 0;
  await Promise.all(
    Array.from({ length: 40 }, (_, i) =>
      addPendingAction({
        id: `pending_${i + 1}`,
        handle: `spam_${i + 1}`,
        action: "block",
        source: "auto",
        ts: i,
      }),
    ),
  );
  const pending = await getPendingActions();
  assert.equal(pending.length, 40);
  assert.equal(new Set(pending.map((row) => row.id)).size, 40);
  assert.ok(crossTabLockRequests >= 40, "every queue mutation must use the cross-tab lock");
});

test("queue deduplicates handle and numeric-id sightings of the same account", async () => {
  values["xss:pending-actions"] = [];
  const canonical = await addPendingAction({
    id: "h:same_user",
    handle: "Same_User",
    action: "block",
    source: "auto",
    ts: 1,
  });
  assert.equal(canonical, "h:same_user");
  const upgraded = await addPendingAction({
    id: "123456",
    handle: "@same_user",
    action: "mute",
    source: "quick",
    ts: 2,
  });
  assert.equal(upgraded, "h:same_user");
  const rows = await getPendingActions();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.source, "quick");
  assert.equal(rows[0]?.action, "mute");
});

test("legacy queue rows gain defaults and failed rows can be retried with a new action", async () => {
  values["xss:pending-actions"] = [
    { id: "legacy", handle: "legacy_user", action: "mute", source: "quick", ts: 1 },
  ];
  let [legacy] = await getPendingActions();
  assert.equal(legacy?.status, "queued");
  assert.equal(legacy?.attempts, 0);

  await updatePendingAction("legacy", { status: "failed", attempts: 1, lastError: "network" });
  await addPendingAction({
    id: "legacy",
    handle: "legacy_user",
    action: "block",
    source: "quick",
    ts: 2,
  });
  [legacy] = await getPendingActions();
  assert.equal(legacy?.status, "queued");
  assert.equal(legacy?.action, "block");
  assert.equal(legacy?.lastError, undefined);
});

test("pause state persists and clearing keeps only the in-flight task", async () => {
  await setQueuePaused(true);
  assert.equal((await getQueueControl()).paused, true);
  values["xss:pending-actions"] = [
    { id: "run", handle: "a", action: "mute", ts: 1, status: "running" },
    { id: "wait", handle: "b", action: "block", ts: 2, status: "queued" },
    { id: "fail", handle: "c", action: "mute", ts: 3, status: "failed" },
  ];
  await clearPendingActions();
  assert.deepEqual((await getPendingActions()).map((row) => row.id), ["run"]);
});

test("recovery order is manual first, then regex, then automatic", async () => {
  values["xss:pending-actions"] = [
    { id: "auto", handle: "a", action: "block", source: "auto", ts: 1 },
    { id: "regex", handle: "b", action: "mute", source: "regex", ts: 2 },
    { id: "manual", handle: "c", action: "mute", source: "quick", ts: 3 },
  ];
  assert.deepEqual((await getPendingActions()).map((row) => row.id), [
    "manual",
    "regex",
    "auto",
  ]);
});

test("queue capacity rejects overflow and activates the safety pause", async () => {
  values["xss:pending-actions"] = Array.from({ length: MAX_PENDING_ACTIONS }, (_, i) => ({
    id: `full_${i}`,
    handle: `full_${i}`,
    action: "block",
    source: "auto",
    ts: i,
    status: "queued",
  }));
  await setQueuePaused(false);
  const accepted = await addPendingAction({
    id: "overflow",
    handle: "overflow",
    action: "block",
    source: "auto",
    ts: Date.now(),
  });
  assert.equal(accepted, false);
  assert.equal((await getQueueControl()).paused, true);
  assert.match((await getQueueControl()).reason ?? "", /200/);
  assert.equal((await getPendingActions()).length, MAX_PENDING_ACTIONS);
});

test("an abnormal automatic burst pauses before continuing bulk mutations", async () => {
  const now = Date.now();
  values["xss:pending-actions"] = Array.from({ length: QUEUE_BURST_LIMIT - 1 }, (_, i) => ({
    id: `burst_${i}`,
    handle: `burst_${i}`,
    action: "block",
    source: "auto",
    ts: now,
    status: "queued",
  }));
  await setQueuePaused(false);
  assert.equal(
    await addPendingAction({
      id: "burst_trip",
      handle: "burst_trip",
      action: "block",
      source: "auto",
      ts: now,
    }),
    "burst_trip",
  );
  assert.equal((await getQueueControl()).paused, true);
  assert.match((await getQueueControl()).reason ?? "", /80/);
});
