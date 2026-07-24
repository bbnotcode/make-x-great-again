import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "data/blacklist/v2-lite.json");
const destination = path.join(root, "extension/public/blacklist-data.json");

if (process.argv.includes("--clean")) {
  fs.rmSync(destination, { force: true });
  process.exit(0);
}

const artifact = JSON.parse(fs.readFileSync(source, "utf8"));
if (artifact?.schema !== 2 || !Array.isArray(artifact.entries) || artifact.entries.length < 1000) {
  throw new Error(`invalid Safari fallback list: ${source}`);
}

fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, JSON.stringify(artifact));
console.log(
  `Prepared Safari fallback list: ${artifact.entries.length} entries, ` +
    `${(fs.statSync(destination).size / 1024 / 1024).toFixed(2)} MB`,
);
