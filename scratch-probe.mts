import { readFileSync } from "node:fs";
const c = JSON.parse(readFileSync("data/ballot/nj-morris-2026-contacts.json", "utf8"));
console.log("keys:", Object.keys(c).join(", "));
const arr = c.contacts ?? c.rows ?? c;
console.log("rows:", Array.isArray(arr) ? arr.length : Object.keys(arr).length);
const first = Array.isArray(arr) ? arr[0] : Object.values(arr)[0];
console.log("sample:", JSON.stringify(first, null, 1).slice(0, 900));
const urls = new Set<string>();
for (const r of (Array.isArray(arr) ? arr : Object.values(arr)) as any[]) {
  const u = r?.provenance?.sourceUrl ?? r?.sourceUrl; if (u) urls.add(u);
}
console.log("\ndistinct source urls:", urls.size);
for (const u of urls) console.log("  " + u);
