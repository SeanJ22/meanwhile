import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { neon } from "@neondatabase/serverless";

import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { contentHash } from "../lib/control-plane/ids.ts";
import type { EvidenceStore, ObjectMeta } from "../lib/control-plane/evidence/store.ts";
import { cycleVault } from "../lib/control-plane/scheduler/vault.ts";
import { workerVaultResolver } from "../lib/control-plane/workers/vault.ts";
import { researchVaultResolver } from "../lib/control-plane/workers/vault-object.ts";
import type { ArtifactRecord, ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
const targetArg = arg("target");
if (!targetArg) throw new Error("VAULT_RESTORE_EXPLICIT_ROOT_REQUIRED: pass --target=<vault root>");
const url = process.env.WTP_CONTROL_PLANE_DATABASE_URL;
if (!url) throw new Error("WTP_CONTROL_PLANE_DATABASE_URL is not set in this process; pass --env-file=<.env.local>");

const target = new DurableEvidenceStore(resolve(targetArg));

const sql = neon(url);
const [artifactRows, attemptRows] = (await sql.transaction(
  [
    sql.query(`SELECT a.log_key, a.record_id, a.record, w.value->>'project' AS project
                 FROM cp_log_artifacts a LEFT JOIN cp_work_items w ON w.id = a.record->>'workItemId'
                ORDER BY a.log_key ASC, a.position ASC`),
    sql.query(`SELECT id, value FROM cp_attempts WHERE id IN (SELECT record->>'attemptId' FROM cp_log_artifacts)`),
  ],
  { readOnly: true },
)) as [{ log_key: string; record_id: string; record: ArtifactRecord; project: string | null }[], { id: string; value: unknown }[]];

const artifactRecords = artifactRows.map((row) => row.record);
const withProject = artifactRows.filter((row) => row.project !== null);
const records = withProject.map((row) => ({
  artifactId: row.record.artifactId,
  workItemId: row.record.workItemId,
  attemptId: row.record.attemptId,
  contentHash: row.record.contentHash,
  byteLength: row.record.byteLength,
  logKey: row.log_key,
  recordId: row.record_id,
}));

/** A read-only cache over list/head, so the O(keys) resolver scans stay cheap; every `get` still re-hashes. */
function cachedReads(store: DurableEvidenceStore): EvidenceStore {
  const heads = new Map<string, Promise<ObjectMeta | null>>();
  let listing: Promise<string[]> | null = null;
  return {
    put: () => Promise.reject(new Error("VAULT_RESTORE_VERIFY_IS_READ_ONLY")),
    get: (key) => store.get(key),
    stream: (key) => store.stream(key),
    head: (key) => {
      if (!heads.has(key)) heads.set(key, store.head(key));
      return heads.get(key)!;
    },
    list: async (prefix) => (await (listing ??= store.list("project/"))).filter((k) => k.startsWith(prefix)),
  };
}
const attempts = new Map(attemptRows.map((row) => [row.id, row.value]));
const repos = {
  artifacts: { readAll: async () => artifactRecords },
  attempts: {
    mustRead: async (id: string) => {
      if (!attempts.has(id)) throw new Error(`attempt ${id} is not in the control plane`);
      return { id, revision: 0, value: attempts.get(id) };
    },
  },
} as unknown as ControlPlaneRepositories;
const cached = cachedReads(target);
const vault = cycleVault(target.root);
const worker = workerVaultResolver(repos, cached, "freshness");
const research = researchVaultResolver(repos, cached, "freshness");

const verdict = (error: unknown) => (error instanceof Error ? `${error.name === "Error" ? "" : `${error.name}: `}${error.message}` : String(error)).slice(0, 160);
const readback: { logKey: string; recordId: string; artifactId: string; readHeld: string; workerVaultResolver: string; researchVaultResolver: string }[] = [];
for (const record of records) {
  const row = artifactRecords.find((r) => r.attemptId === record.attemptId && r.artifactId === record.artifactId && r.workItemId === record.workItemId)!;
  let held: string;
  try {
    const body = await vault.readHeld(row);
    held = body === null ? "NOT_FOUND" : contentHash(body) === record.contentHash ? "READ" : "READ_TEXT_NOT_BYTE_EXACT";
  } catch (error) {
    held = `THREW ${verdict(error)}`;
  }
  let workerRead: string;
  try {
    await worker(record.artifactId);
    workerRead = "READ";
  } catch (error) {
    workerRead = verdict(error);
  }
  let researchRead: string;
  try {
    const got = await research(record.artifactId);
    researchRead = contentHash(got.bytes) === record.contentHash && got.bytes.byteLength === record.byteLength ? "READ" : "READ_WRONG_BYTES";
  } catch (error) {
    researchRead = verdict(error);
  }
  readback.push({ logKey: record.logKey, recordId: record.recordId, artifactId: record.artifactId, readHeld: held, workerVaultResolver: workerRead, researchVaultResolver: researchRead });
}
const tallyBy = (field: "readHeld" | "workerVaultResolver" | "researchVaultResolver") =>
  readback.reduce((m, r) => ((m[r[field]] = (m[r[field]] ?? 0) + 1), m), {} as Record<string, number>);
console.log(`  runtime resolvers against ${target.root}, over the ${records.length} record(s) held with a work item:`);
for (const field of ["readHeld", "workerVaultResolver", "researchVaultResolver"] as const) console.log(`    ${field}: ${JSON.stringify(tallyBy(field))}`);

const receiptOut = arg("receipt-out");
if (receiptOut) {
  writeFileSync(resolve(receiptOut), `${JSON.stringify({ finishedAt: new Date().toISOString(), records: records.length, readback }, null, 2)}\n`);
}
