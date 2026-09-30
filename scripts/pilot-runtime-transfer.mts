/** Copy the held vault and portrait files to Blobs; keep the local originals. */
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getStore } from "@netlify/blobs";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { netlifyEvidenceStoreFromEnv } from "../lib/control-plane/evidence/netlify-store.ts";
import type { EvidenceStore } from "../lib/control-plane/evidence/store.ts";

/** A damaged source entry does not hold back unrelated retained originals. */
export async function copyVaultObjects(source: Pick<EvidenceStore, "list" | "get">,
  destination: Pick<EvidenceStore, "put">, onSourceFailure: (key: string, error: unknown) => void,
): Promise<{ transferred: number; failed: number }> {
  let transferred = 0, failed = 0;
  for (const key of await source.list("")) {
    let held;
    try {
      held = await source.get(key);
      if (!held) throw new Error("Held vault object disappeared");
    } catch (error) {
      failed++;
      onSourceFailure(key, error);
      continue;
    }
    // Destination failures (including credentials) stop the operation rather
    // than repeating the same failing request for every remaining source key.
    await destination.put(key, held.bytes, held.meta);
    transferred++;
  }
  return { transferred, failed };
}

async function main(): Promise<void> {
  const root = resolve(process.argv.find(arg => arg.startsWith("--root="))?.slice(7) ?? process.cwd());
  const vault = netlifyEvidenceStoreFromEnv();
  if (!vault) throw new Error("Set WTP_VAULT_PROVIDER=netlify and the host Blobs credentials before transfer");
  const source = new DurableEvidenceStore(join(root, "data/control-plane/vault"), { remote: null });
  const evidence = await copyVaultObjects(source, vault, (key, error) => {
    console.error(`Source vault entry could not be read: ${key} (${error instanceof Error ? error.name : "UNKNOWN"})`);
  });
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
  console.log(`Transferred ${evidence.transferred} vault objects and ${portraitCount} portraits; ${evidence.failed} source vault entries failed. Local originals remain.`);
  if (evidence.failed) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
