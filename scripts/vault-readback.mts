/** Read committed vault objects and asset-index entries; print only. No writes. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";

const value = (key: string) => process.argv.find((a) => a.startsWith(`${key}=`))?.slice(key.length + 1);
const rootArg = value("--vault-root");
if (!rootArg) throw new Error("Pass --vault-root=<standing runner's canonical vault>; a worktree is not the live vault");
const vaultRoot = resolve(rootArg);
if (!existsSync(vaultRoot)) throw new Error("The specified canonical vault is absent; refusing an empty inventory");
const observed_at = new Date().toISOString();
const store = new DurableEvidenceStore(vaultRoot);
const keys = await store.list("");
if (!keys.length) throw new Error("Canonical vault returned no objects; failed readback floor");
const objects = [];
for (const key of keys) {
  const held = await store.get(key);
  if (!held) throw new Error(`Listed vault object has no readable committed body: ${key}`);
  objects.push({ key, meta: held.meta, verified: true });
}
const assets = JSON.parse(readFileSync("data/assets/manifest.json", "utf8")) as {
  store: string; writtenAt: string; rows: {path: string; sha256: string; bytes: number; storedAt: string}[];
};
const assetRoot = resolve(value("--asset-root") ?? assets.store);
if (!existsSync(assetRoot)) throw new Error("The canonical asset store is absent");
const assetInventory = assets.rows.map((row) => {
  const key = `${row.sha256.slice(0, 2)}/${row.sha256}${extname(row.path).toLowerCase()}`;
  const file = join(assetRoot, key);
  const bytes = existsSync(file) ? readFileSync(file) : null;
  const verified = bytes !== null && bytes.length === row.bytes && createHash("sha256").update(bytes).digest("hex") === row.sha256;
  return { originalPath: row.path, key, sha256: row.sha256, byteLength: row.bytes, storedAt: row.storedAt, exists: bytes !== null, verified };
});
console.log(JSON.stringify({
  formatVersion: 1, observed_at,
  source: { store: "DurableEvidenceStore", identity: vaultRoot, schemaVersion: 1, instrument: "scripts/vault-readback.mts" },
  observation_completed_at: new Date().toISOString(),
  consistency: "Committed object keys enumerated once; each listed body verified against its sidecar. Concurrent later acquisitions belong to the next observation.",
  objects,
  assetSource: { store: "content-addressed asset store", identity: assetRoot, schemaVersion: 1, instrument: "scripts/vault-readback.mts", observed_at, index: "data/assets/manifest.json", index_written_at: assets.writtenAt },
  assetInventory,
}, null, 2));
