/**
 * `vault-restore` — make evidence held only in another vault readable by the
 * runtime vault, through the store's own verified `put`. (2026-09-22.)
 *
 * DRY RUN BY DEFAULT. Without `--execute` it reads the control plane in one
 * READ ONLY transaction, lists and heads both vaults, and writes nothing but the
 * plan file it is asked for.
 *
 *   node --env-file=<.env.local> --experimental-strip-types --import ./scripts/register-test-loader.mjs \
 *     scripts/vault-restore.mts --source=<vault root> --target=<vault root> [--plan-out=<file>]
 *
 *   ... --execute --expect-digest=<sha256-…> [--receipt-out=<file>]
 *
 * `--execute` re-plans and refuses unless the copy set still has the digest the
 * reviewer approved. Both roots are explicit: a tool that picked its own vault is
 * a tool two operators could run against different stores.
 *
 * Both modes finish by reading every record the plan touched back through the
 * runtime's own resolvers against the target (`CycleVault.readHeld`,
 * `workerVaultResolver`, `researchVaultResolver`), so a dry run shows the failure
 * the copy is for and an execution shows it gone.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { neon } from "@neondatabase/serverless";

import { DurableEvidenceStore, SIDECAR_SUFFIX, keyToRelativePath } from "../lib/control-plane/evidence/durable-store.ts";
import { contentHash } from "../lib/control-plane/ids.ts";
import type { EvidenceStore, ObjectMeta } from "../lib/control-plane/evidence/store.ts";
import {
  executeVaultRestore,
  planVaultRestore,
  type HeldRecord,
  type RestorePlan,
} from "../lib/control-plane/evidence/vault-restore.ts";
import { cycleVault } from "../lib/control-plane/scheduler/vault.ts";
import { workerVaultResolver } from "../lib/control-plane/workers/vault.ts";
import { researchVaultResolver } from "../lib/control-plane/workers/vault-object.ts";
import type { ArtifactRecord, ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import { floored, floorLine } from "../lib/ops/denominator-floor.ts";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
const sourceArg = arg("source");
const targetArg = arg("target");
if (!sourceArg || !targetArg) throw new Error("VAULT_RESTORE_EXPLICIT_ROOTS_REQUIRED: pass --source=<vault root> and --target=<vault root>");
const execute = process.argv.includes("--execute");
const expectDigest = arg("expect-digest");
if (execute && !expectDigest) throw new Error("VAULT_RESTORE_APPROVED_DIGEST_REQUIRED: --execute needs --expect-digest=<the reviewed plan's digest>");
const url = process.env.WTP_CONTROL_PLANE_DATABASE_URL;
if (!url) throw new Error("WTP_CONTROL_PLANE_DATABASE_URL is not set in this process; pass --env-file=<.env.local>");

const source = new DurableEvidenceStore(resolve(sourceArg));
const target = new DurableEvidenceStore(resolve(targetArg));

/* ---------------------------------------------- the control plane, read only */

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
const records: HeldRecord[] = withProject.map((row) => ({
  artifactId: row.record.artifactId,
  workItemId: row.record.workItemId,
  attemptId: row.record.attemptId,
  contentHash: row.record.contentHash,
  canonicalUrl: row.record.canonicalUrl,
  tier: row.record.tier,
  byteLength: row.record.byteLength,
  project: row.project!,
  logKey: row.log_key,
  recordId: row.record_id,
}));

/* ------------------------------------------------------------------ plan */

const plan: RestorePlan = await planVaultRestore(source, target, records);
const targetKeys = new Set(await target.list("project/"));

const pathOf = (store: DurableEvidenceStore, key: string) => join(store.root, keyToRelativePath(key));
/** Will the target sidecar be byte-identical? It is when the source sidecar is exactly what `put` writes. */
function sidecarReproducible(key: string): boolean {
  const raw = readFileSync(`${pathOf(source, key)}${SIDECAR_SUFFIX}`, "utf8");
  return raw === `${JSON.stringify(JSON.parse(raw), null, 2)}\n`;
}

const report = (p: RestorePlan) => ({
  digest: p.digest,
  source: source.root,
  target: target.root,
  totals: {
    records: artifactRows.length,
    recordsWithoutWorkItem: artifactRows.length - withProject.length,
    heldInTarget: p.heldInTarget.length,
    toCopy: { objects: p.copies.length, records: p.copies.reduce((n, c) => n + c.records.length, 0), bytes: p.copies.reduce((n, c) => n + c.byteLength, 0) },
    heldInNeither: p.heldInNeither.length,
    conflicts: p.conflicts.length,
    unreferencedSourceObjects: p.unreferencedSourceKeys.length,
    targetKeysAlreadyPresent: p.copies.filter((c) => targetKeys.has(c.key)).length,
    sidecarsReproducedByteForByte: p.copies.filter((c) => sidecarReproducible(c.key)).length,
  },
  copies: p.copies.map((c) => ({
    key: c.key,
    sha256: c.contentHash,
    bytes: c.byteLength,
    sourcePath: pathOf(source, c.key),
    targetPath: pathOf(target, c.key),
    targetKeyExists: targetKeys.has(c.key),
    sidecarReproducible: sidecarReproducible(c.key),
    records: c.records.map((r) => ({ logKey: r.logKey, recordId: r.recordId, artifactId: r.artifactId, workItemId: r.workItemId, attemptId: r.attemptId, canonicalUrl: r.canonicalUrl, tier: r.tier })),
  })),
  conflicts: p.conflicts.map((c) => ({ key: c.key, recordIds: c.records.map((r) => r.recordId) })),
  heldInNeither: p.heldInNeither.map((r) => ({ recordId: r.recordId, artifactId: r.artifactId, workItemId: r.workItemId, tier: r.tier, canonicalUrl: r.canonicalUrl })),
  unreferencedSourceKeys: p.unreferencedSourceKeys,
});

const planned = report(plan);
const planOut = arg("plan-out");
if (planOut) writeFileSync(resolve(planOut), `${JSON.stringify(planned, null, 2)}\n`);

console.log(`vault-restore ${execute ? "EXECUTE" : "DRY RUN"}: ${source.root} -> ${target.root}`);
console.log(`  plan digest ${plan.digest}`);
console.log(`  ${floorLine(floored("records the target vault already holds", "cp_log_artifacts", records.length, plan.heldInTarget.length))}`);
console.log(`  ${floorLine(floored("records only the source vault holds", "cp_log_artifacts", records.length, planned.totals.toCopy.records))}`);
console.log(`  ${floorLine(floored("records neither vault holds", "cp_log_artifacts", records.length, plan.heldInNeither.length))}`);
console.log(`  objects to copy ${planned.totals.toCopy.objects}, ${planned.totals.toCopy.bytes} bytes; target keys already present ${planned.totals.targetKeysAlreadyPresent}; conflicts ${plan.conflicts.length}`);
console.log(`  ${floorLine(floored("sidecars put will reproduce byte for byte", "planned copies", plan.copies.length, planned.totals.sidecarsReproducedByteForByte, "nothing to copy"))}`);
console.log(`  source objects no record names (never copied): ${plan.unreferencedSourceKeys.length}`);

/* ---------------------------------------------------------------- execute */

let outcomes: Awaited<ReturnType<typeof executeVaultRestore>> = [];
const restoredRecords = plan.copies.flatMap((c) => c.records);
if (execute) {
  if (plan.digest !== expectDigest) {
    throw new Error(`VAULT_RESTORE_PLAN_NOT_APPROVED: the live plan's digest is ${plan.digest} and the approved one is ${expectDigest}. Re-review; nothing was written.`);
  }
  if (plan.conflicts.length > 0 || planned.totals.targetKeysAlreadyPresent > 0) {
    throw new Error("VAULT_RESTORE_TARGET_OCCUPIED: the plan names a key the target already uses; nothing was written");
  }
  outcomes = await executeVaultRestore(plan, source, target);
  const tally = (s: string) => outcomes.filter((o) => o.status === s).length;
  console.log(`  ${floorLine(floored("objects copied", "the approved plan", plan.copies.length, tally("COPIED")))}; already present ${tally("ALREADY_PRESENT")}; refused ${tally("REFUSED")}`);
  console.log(`  ${floorLine(floored("copied sidecars byte-identical to the source", "copied objects", tally("COPIED"), outcomes.filter((o) => o.status === "COPIED" && o.sidecarBytesIdentical).length, "nothing was copied"))}`);
  for (const o of outcomes) if (o.status === "REFUSED") console.log(`  REFUSED ${o.key}: ${o.reason}`);
}

/* ------------------------------- read back through the runtime's resolvers */

/** A read-only cache over list/head, so the O(keys) resolver scans stay cheap; every `get` still re-hashes. */
function cachedReads(store: DurableEvidenceStore): EvidenceStore {
  const heads = new Map<string, Promise<ObjectMeta | null>>();
  let listing: Promise<string[]> | null = null;
  return {
    put: () => Promise.reject(new Error("VAULT_RESTORE_VERIFY_IS_READ_ONLY")),
    get: (key) => store.get(key),
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
const readback: { recordId: string; artifactId: string; readHeld: string; workerVaultResolver: string; researchVaultResolver: string }[] = [];
for (const record of restoredRecords) {
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
  readback.push({ recordId: record.recordId, artifactId: record.artifactId, readHeld: held, workerVaultResolver: workerRead, researchVaultResolver: researchRead });
}
const tallyBy = (field: "readHeld" | "workerVaultResolver" | "researchVaultResolver") =>
  readback.reduce((m, r) => ((m[r[field]] = (m[r[field]] ?? 0) + 1), m), {} as Record<string, number>);
console.log(`  runtime resolvers against the target, over the ${restoredRecords.length} record(s) the plan names:`);
for (const field of ["readHeld", "workerVaultResolver", "researchVaultResolver"] as const) console.log(`    ${field}: ${JSON.stringify(tallyBy(field))}`);

const receiptOut = arg("receipt-out");
if (receiptOut) {
  writeFileSync(resolve(receiptOut), `${JSON.stringify({ mode: execute ? "EXECUTE" : "DRY_RUN", finishedAt: new Date().toISOString(), plan: planned.totals, digest: plan.digest, outcomes, readback }, null, 2)}\n`);
}
if (outcomes.some((o) => o.status === "REFUSED")) process.exitCode = 1;
