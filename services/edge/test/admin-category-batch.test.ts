import assert from "node:assert/strict";
import { test } from "node:test";

// Batch-categorize coverage: the admin can stamp a spam category either at
// decide time (decide / decide-batch carry an optional `category`) or on
// already-listed rows via the dedicated /v1/admin/category-batch endpoint.
// Uses a statement-capturing D1 double — these endpoints only build UPDATE /
// INSERT statements and hand them to DB.batch, so asserting on the captured
// (sql, args) pairs pins the exact write behavior.

declare global {
  interface D1PreparedStatement {
    bind(...args: unknown[]): D1PreparedStatement;
    run(): Promise<{ results?: unknown[]; meta: { changes?: number; last_row_id?: number } }>;
    first<T>(): Promise<T | null>;
    all<T>(): Promise<{ results?: T[]; meta?: { changes?: number } }>;
  }

  interface D1Database {
    prepare(sql: string): D1PreparedStatement;
    batch(
      stmts: D1PreparedStatement[],
    ): Promise<{ results?: unknown[]; meta: { changes?: number } }[]>;
    dump(): Promise<Uint8Array>;
    exec(sql: string): Promise<{ meta: { changes?: number } }>;
  }
}

const edgeModuleUrl = new URL("../src/index.ts", import.meta.url).href;
const worker = (await import(edgeModuleUrl)).default as {
  fetch(req: Request, env: Record<string, unknown>): Promise<Response>;
};

class CapturedStmt implements D1PreparedStatement {
  args: unknown[] = [];
  constructor(readonly sql: string) {}
  bind(...args: unknown[]): D1PreparedStatement {
    this.args = args;
    return this;
  }
  async run() {
    return { meta: {} };
  }
  async first<T>(): Promise<T | null> {
    return null;
  }
  async all<T>(): Promise<{ results?: T[] }> {
    return { results: [] };
  }
}

class CaptureDB implements D1Database {
  batches: CapturedStmt[] = [];
  prepare(sql: string): D1PreparedStatement {
    return new CapturedStmt(sql);
  }
  async batch(stmts: D1PreparedStatement[]) {
    this.batches.push(...(stmts as CapturedStmt[]));
    return [];
  }
  async dump(): Promise<Uint8Array> {
    return new Uint8Array();
  }
  async exec(): Promise<{ meta: { changes?: number } }> {
    return { meta: {} };
  }
}

function makeEnv() {
  const db = new CaptureDB();
  return { db, env: { DB: db, ADMIN_TOKEN: "admin" } as Record<string, unknown> };
}

function post(path: string, body: unknown): Request {
  return new Request(`https://edge.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-token": "admin" },
    body: JSON.stringify(body),
  });
}

test("decide-batch approve stamps the chosen category via COALESCE", async () => {
  const { db, env } = makeEnv();
  const res = await worker.fetch(
    post("/v1/admin/decide-batch", {
      action: "approve",
      category: "gambling",
      items: [{ handle: "Spam_A", xUserId: "111" }, { handle: "spam_b" }],
    }),
    env,
  );
  assert.equal(res.status, 200);
  const j = (await res.json()) as { ok: boolean; processed: number };
  assert.equal(j.ok, true);
  assert.equal(j.processed, 2);

  const updates = db.batches.filter(
    (s) => s.sql.includes("UPDATE accounts") && s.sql.includes("category=COALESCE(?, category)"),
  );
  assert.equal(updates.length, 2);
  for (const u of updates) assert.ok(u.args.includes("gambling"));

  const logs = db.batches.filter((s) => s.sql.includes("INSERT INTO review_log"));
  assert.equal(logs.length, 2);
  for (const l of logs) assert.ok(l.args.includes("panel_batch category=gambling"));
});

test("decide-batch without category keeps existing category (binds NULL into COALESCE)", async () => {
  const { db, env } = makeEnv();
  const res = await worker.fetch(
    post("/v1/admin/decide-batch", {
      action: "approve",
      items: [{ handle: "spam_c", xUserId: "333" }],
    }),
    env,
  );
  assert.equal(res.status, 200);
  const update = db.batches.find((s) => s.sql.includes("category=COALESCE(?, category)"));
  assert.ok(update);
  // bind order: status, published_at, published_tier, category, handle, uid
  assert.equal(update.args[3], null);
});

test("decide-batch rejects an unknown category", async () => {
  const { env } = makeEnv();
  const res = await worker.fetch(
    post("/v1/admin/decide-batch", {
      action: "approve",
      category: "illegal-not-a-category",
      items: [{ handle: "spam_d" }],
    }),
    env,
  );
  assert.equal(res.status, 400);
});

test("single decide carries category and logs it", async () => {
  const { db, env } = makeEnv();
  const res = await worker.fetch(
    post("/v1/admin/decide", {
      handle: "spam_e",
      xUserId: "555",
      action: "approve",
      category: "porn",
    }),
    env,
  );
  assert.equal(res.status, 200);
  const update = db.batches.find((s) => s.sql.includes("category=COALESCE(?, category)"));
  assert.ok(update);
  assert.ok(update.args.includes("porn"));
  const log = db.batches.find((s) => s.sql.includes("INSERT INTO review_log"));
  assert.ok(log);
  assert.ok(log.args.includes("panel category=porn"));
});

test("whitelist decide clears category", async () => {
  const { db, env } = makeEnv();
  const res = await worker.fetch(
    post("/v1/admin/decide", { handle: "good_a", xUserId: "777", action: "whitelist" }),
    env,
  );
  assert.equal(res.status, 200);
  const update = db.batches.find((s) => s.sql.includes("status='whitelisted'"));
  assert.ok(update);
  assert.ok(update.sql.includes("category=NULL"));
});

test("category-batch sets category without touching status", async () => {
  const { db, env } = makeEnv();
  const res = await worker.fetch(
    post("/v1/admin/category-batch", {
      category: "crypto",
      items: [{ handle: "Listed_A", xUserId: "999" }, { handle: "listed_b" }],
    }),
    env,
  );
  assert.equal(res.status, 200);
  const j = (await res.json()) as { ok: boolean; category: string; processed: number };
  assert.equal(j.ok, true);
  assert.equal(j.category, "crypto");
  assert.equal(j.processed, 2);

  const updates = db.batches.filter((s) => s.sql.includes("UPDATE accounts SET category=?"));
  assert.equal(updates.length, 2);
  for (const u of updates) {
    assert.equal(u.args[0], "crypto");
    assert.ok(!u.sql.includes("status"));
    assert.ok(!u.sql.includes("published_at"));
  }
  // handle is normalized to lowercase in the WHERE binds
  assert.equal(updates[0].args[1], "listed_a");

  const logs = db.batches.filter((s) => s.sql.includes("INSERT INTO review_log"));
  assert.equal(logs.length, 2);
  for (const l of logs) {
    assert.ok(l.args.includes("categorize"));
    assert.ok(l.args.includes("panel_batch category=crypto"));
  }
});

test("category-batch rejects an unknown category and requires auth", async () => {
  const { env } = makeEnv();
  const bad = await worker.fetch(
    post("/v1/admin/category-batch", { category: "nope", items: [{ handle: "x" }] }),
    env,
  );
  assert.equal(bad.status, 400);

  const noAuth = await worker.fetch(
    new Request("https://edge.test/v1/admin/category-batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ category: "porn", items: [{ handle: "x" }] }),
    }),
    env,
  );
  assert.equal(noAuth.status, 403);
});
