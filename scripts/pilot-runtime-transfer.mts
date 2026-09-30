/** Copy the held vault and portrait files to Blobs; keep the local originals. */
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { getStore } from "@netlify/blobs";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { netlifyEvidenceStoreFromEnv } from "../lib/control-plane/evidence/netlify-store.ts";

const root = resolve(process.argv.find(arg => arg.startsWith("--root="))?.slice(7) ?? process.cwd());
const vault = netlifyEvidenceStoreFromEnv();
if (!vault) throw new Error("Set WTP_VAULT_PROVIDER=netlify and the host Blobs credentials before transfer");
const source = new DurableEvidenceStore(join(root, "data/control-plane/vault"), { remote: null });
let evidenceCount = 0;
for (const key of await source.list("")) {
  const held = await source.get(key);
  if (!held) throw new Error(`Held vault object disappeared: ${key}`);
  await vault.put(key, held.bytes, held.meta);
  evidenceCount++;
}
const portraits = getStore({ name: "meanwhile-portraits", siteID: process.env.WTP_BLOBS_SITE_ID!, token: process.env.WTP_BLOBS_TOKEN!, consistency: "strong" });
let portraitCount = 0;
async function copyPortraits(directory: string): Promise<void> {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) { await copyPortraits(path); continue; }
    if (!/\.(?:avif|webp|png|jpe?g)$/i.test(entry.name)) continue;
    const key = relative(join(root, "public"), path).replaceAll("\\", "/");
    await portraits.set(key, new Uint8Array(await readFile(path)).buffer);
    portraitCount++;
  }
}
for (const family of ["candidates", "officials"]) await copyPortraits(join(root, "public", family));
console.log(`Transferred ${evidenceCount} vault objects and ${portraitCount} portraits. Local originals remain.`);
