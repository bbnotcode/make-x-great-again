import assert from "node:assert/strict";
import test from "node:test";
import { clearToken, getToken, setToken } from "../app/lib/adminApi";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, String(value));
  }
}

test("admin token is tab-scoped and legacy persistent copies are removed", () => {
  const local = new MemoryStorage();
  const session = new MemoryStorage();
  Object.defineProperties(globalThis, {
    localStorage: { configurable: true, value: local },
    sessionStorage: { configurable: true, value: session },
  });

  local.setItem("xss_admin", "legacy-admin-token");
  assert.equal(getToken(), "");
  assert.equal(local.getItem("xss_admin"), null);

  setToken("current-admin-token");
  assert.equal(getToken(), "current-admin-token");
  assert.equal(session.getItem("xss_admin"), "current-admin-token");
  assert.equal(local.getItem("xss_admin"), null);

  clearToken();
  assert.equal(getToken(), "");
  assert.equal(session.getItem("xss_admin"), null);
});
