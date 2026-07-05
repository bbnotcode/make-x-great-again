import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const liteSrcPath = path.resolve(__dirname, "../data/blacklist/v2-lite.json");
const legacySrcPath = path.resolve(__dirname, "../data/blacklist/v1.json");
const destPath = path.resolve(__dirname, "../extension/public/blacklist-data.json");

// Must mirror the Label union in extension/lib/types.ts.
const SUPPORTED_LABELS = new Set(["spam", "porn_bot", "likely_spam", "uncertain", "legit"]);
// Must mirror SpamCategory in extension/lib/category.ts.
const SUPPORTED_CATEGORIES = new Set([
  "porn",
  "crypto",
  "gambling",
  "resource",
  "marketing",
  "other",
]);

/**
 * Preferred source: data/blacklist/v2-lite.json (schema 2) — the FULL
 * confirmed set with per-entry category, no 50K cap, no audit payload.
 * Output row shape (extension/lib/local-index.ts "v2"):
 *   [x_user_id, handle, verdict_label, category]
 *
 * Fallback: data/blacklist/v1.json (audit mirror, capped at 50K) for builds
 * before the first v2-lite sync lands. Output keeps the same v2 row shape;
 * category comes from the entry when present, else label mapping
 * (porn_bot → porn, else "other") — no keyword guessing.
 */
let rows;
if (fs.existsSync(liteSrcPath)) {
  console.log("Reading lite blacklist from:", liteSrcPath);
  const parsed = JSON.parse(fs.readFileSync(liteSrcPath, "utf-8"));
  if (parsed?.schema !== 2 || !Array.isArray(parsed.entries)) {
    console.error("ERROR: expected { schema: 2, entries: [...] } in", liteSrcPath);
    process.exit(1);
  }
  const labels = parsed.labels ?? { p: "porn_bot", s: "spam" };
  const categories = parsed.categories ?? {};
  rows = parsed.entries.map((e) => {
    if (!Array.isArray(e) || e.length < 3) return null;
    const [id, handle, code] = e;
    const label = labels[String(code)[0]] ?? "spam";
    const category = categories[String(code)[1]] ?? "other";
    return { id, handle, label, category, publishedAt: 0 };
  });
} else {
  console.log("v2-lite not found; falling back to legacy audit mirror:", legacySrcPath);
  const parsed = JSON.parse(fs.readFileSync(legacySrcPath, "utf-8"));
  if (!parsed || !Array.isArray(parsed.list)) {
    console.error("ERROR: expected a top-level { list: [...] } in", legacySrcPath);
    process.exit(1);
  }
  rows = parsed.list.map((item) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return null;
    const label = item.verdict_label || "spam";
    const category =
      typeof item.category === "string" && SUPPORTED_CATEGORIES.has(item.category)
        ? item.category
        : label === "porn_bot"
          ? "porn"
          : "other";
    return {
      id: item.x_user_id,
      handle: typeof item.handle === "string" ? item.handle : "",
      label,
      category,
      publishedAt: typeof item.published_at === "number" ? item.published_at : 0,
    };
  });
}

console.log("Found raw entries count:", rows.length);

let droppedBadShape = 0;
let droppedNoNumericId = 0; // handle-only entries are a handle-reuse trap
let droppedBadLabel = 0;
let droppedBadCategory = 0;
let dedupedById = 0;

/** @type {Map<string, { row: [string, string, string, string], publishedAt: number }>} */
const byId = new Map();

for (const item of rows) {
  if (!item) {
    droppedBadShape++;
    continue;
  }
  const rawId = item.id;
  const id = typeof rawId === "string" ? rawId : typeof rawId === "number" ? String(rawId) : null;
  if (!id || !/^\d+$/.test(id)) {
    droppedNoNumericId++;
    continue;
  }
  if (typeof item.label !== "string" || !SUPPORTED_LABELS.has(item.label)) {
    droppedBadLabel++;
    continue;
  }
  const category = SUPPORTED_CATEGORIES.has(item.category) ? item.category : "other";
  if (category !== item.category) droppedBadCategory++;

  const prev = byId.get(id);
  if (prev) {
    dedupedById++;
    if (item.publishedAt < prev.publishedAt) continue; // keep the latest
  }
  byId.set(id, {
    row: [id, item.handle, item.label, category],
    publishedAt: item.publishedAt,
  });
}

const compacted = [...byId.values()].map((v) => v.row);

console.log("Writing compacted blacklist to:", destPath);
fs.mkdirSync(path.dirname(destPath), { recursive: true });
fs.writeFileSync(destPath, JSON.stringify(compacted), "utf-8");

console.log(
  `Summary: kept=${compacted.length} dropped_no_numeric_id=${droppedNoNumericId} ` +
    `dropped_unsupported_label=${droppedBadLabel} coerced_category=${droppedBadCategory} ` +
    `dropped_bad_shape=${droppedBadShape} deduped_by_id=${dedupedById}`,
);
console.log(
  "Done! Compacted blacklist size:",
  (fs.statSync(destPath).size / 1024 / 1024).toFixed(2),
  "MB",
);
