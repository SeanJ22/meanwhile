/** Authorized GET-only copy of exact recorded artifacts; the credential never reaches workers. */
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { netlifyEvidenceStoreFromEnv } from "../lib/control-plane/evidence/netlify-store.ts";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { extensionFor, datePath } from "../lib/control-plane/evidence/store.ts";
import { contentHash } from "../lib/control-plane/ids.ts";
import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";

const arg = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = resolve(arg("store") ?? ".scratch/rh01/production-replay-control");
const access = JSON.parse(await readFile("/tmp/rh01-capture-access.json", "utf8")) as { siteId: string; token: string };
if (!access.siteId || !access.token || /[*•]/.test(access.token)) throw Error("RH01_CAPTURE_ACCESS_MASKED: the connector did not supply a usable capture credential");
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  if (method.toUpperCase() !== "GET") throw Error("RH01 saved-capture access permits GET only");
  return originalFetch(input, init);
};
const remote = netlifyEvidenceStoreFromEnv({ NODE_ENV: process.env.NODE_ENV, WTP_VAULT_PROVIDER: "netlify", WTP_BLOBS_SITE_ID: access.siteId, WTP_BLOBS_TOKEN: access.token })!;
const local = new DurableEvidenceStore(join(root, "vault"), { remote: null });
const repos = await createFileRepositories(root);
const manifest = JSON.parse(await readFile(join(root, "rh01-replay.json"), "utf8"));
const workIds = [...new Set(manifest.tasks.map((row: { workItemId: string }) => row.workItemId))] as string[];
const outcomes = [];
for (const id of workIds) {
  const item = (await repos.workItems.mustRead(id)).value;
  const sources = new Set<string>([item.autonomousPlan?.contract.schemaVersion === 2 ? item.autonomousPlan.contract.sourceScope.sourceId : "legistar"]);
  for (const source of item.autonomousPlan?.sources ?? []) sources.add(source.sourceId);
  for (const record of await repos.artifacts.read(id)) {
    if (record.tier === "RESTRICTED_RAW") { outcomes.push({ artifactId: record.artifactId, status: "RESTRICTED_UNSUPPORTED" }); continue; }
    try { sources.add(new URL(record.canonicalUrl).hostname); } catch { /* exact recorded source ids remain */ }
    let copied = false;
    for (const source of sources) {
      if (!source) continue;
      const key = `project/${item.project}/source/${source}/${datePath(record.recordedAt)}/${id}/${record.contentHash}.${extensionFor(record.contentType)}`;
      const saved = await remote.get(key);
      if (!saved) continue;
      const custom = saved.meta.custom;
      if (contentHash(saved.bytes) !== record.contentHash || saved.bytes.byteLength !== record.byteLength ||
          custom?.attemptId !== record.attemptId || custom?.workItemId !== record.workItemId ||
          custom?.canonicalUrl !== record.canonicalUrl || custom?.tier !== record.tier) throw Error("RH01 exact saved capture metadata does not match its actual production record");
      await local.put(key, saved.bytes, saved.meta);
      outcomes.push({ artifactId: record.artifactId, status: "COPIED_VERIFIED", bytes: saved.bytes.byteLength, key }); copied = true; break;
    }
    if (!copied) outcomes.push({ artifactId: record.artifactId, status: "NOT_AT_RECORDED_KEYS" });
    await writeFile(join(root, "rh01-capture-copy.json"), JSON.stringify({ getOnly: true, outcomes }, null, 2) + "\n");
  }
}
console.log(JSON.stringify({ getOnly: true, copied: outcomes.filter(row => row.status === "COPIED_VERIFIED").length,
  unavailable: outcomes.filter(row => row.status !== "COPIED_VERIFIED").length, report: join(root, "rh01-capture-copy.json") }));
