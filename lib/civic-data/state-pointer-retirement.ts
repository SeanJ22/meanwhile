import { randomBytes } from "node:crypto";
import { STATE_RETIREMENT_KEY_ENV } from "./state-retirement-proof.ts";
import { readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { REGISTRY_STATES, STATE_BALLOT_FAMILIES, stateBallotContractId } from "./state-scopes.ts";
import { stateRegistryRuntimeContractId } from "./state-scopes.ts";
import { databaseIdentity } from "../control-plane/repository/incremental-reads.ts";
import { routineProcessSlots, type WorkerMemoryRelease, type WorkerProcessSlots } from "../control-plane/workers/worker-slots.ts";
import { sanitizedErrorDiagnostic } from "../ops/error-diagnostic.ts";
import { runBoundedChildPass, ROUTINE_CHILD_TIMEOUT_MS, type BoundedChildLauncher } from "./bounded-child-pass.ts";
import { admittedRuntimeChildEnvironment } from "./runtime-authority.ts";
import { requiredManualProductionContract } from "./manual-contracts.ts";
import { requiredRoutineContract } from "./contracts.ts";
import { temporaryPath } from "./temporary-path.ts";
import type { StateRetirementOrigin, StateRetirementUnit } from "./state-retirement-inputs.ts";

type Query = (text: string, params: readonly unknown[]) => Promise<readonly Record<string, unknown>[]>;
const retired = [
  ["ballot-contests", "BALLOT_CANDIDACY", "US:state-election-ballots"],
  ["ballot-contests", "BALLOT_CANDIDACY", "US-AZ:2026-general:supported-ballot"],
  ["ballot-contests", "BALLOT_CANDIDACY", "US-NH:merrimack:2026-general"],
  ["ballot-contests", "BALLOT_FILING", "US-NJ:county:morris:2026-general"],
  ["candidate-profiles", "CANDIDATE_PROFILE", "US-AZ+US-NH+US-NJ:2026-supported-candidates"],
  ["candidate-corpus", "CANDIDATE_PUBLICATION", "US-AZ+US-NH+US-NJ:2026-supported-candidates"],
  ["voting-sites", "VOTING_SITE", "US-AZ+US-NH+US-NJ:2026-general:supported-jurisdictions"],
  ["candidate-campaign-sites-derived", "CURATED_READER_RECORD", "US:candidate-campaign-sites-derived"],
  ["registry-runtime", "REGISTRY_RUNTIME_BINDING", "US:reader-registry-runtime-bindings"],
] as const;

function childReceipt(stdout: string, prefix: string): Record<string, unknown> {
  const lines = stdout.split(/\r?\n/).filter(line => line.startsWith(prefix));
  if (lines.length !== 1) throw new Error("STATE_RETIREMENT_CHILD_RECEIPT_INVALID");
  return JSON.parse(lines[0].slice(prefix.length)) as Record<string, unknown>;
}

/** Retirement is the routine pass's long tail: it stops at `deadlineMs`, the units it reconciled stay published, and the next pass continues. */
export async function reconcileNationalStatePointers(input: {
  readonly query: Query; readonly env: NodeJS.ProcessEnv;
  readonly launch?: BoundedChildLauncher; readonly slots?: WorkerProcessSlots;
  readonly deadlineMs?: number;
}): Promise<readonly StateRetirementOrigin[]> {
  const deadlineMs = input.deadlineMs ?? Number.POSITIVE_INFINITY;
  const late = () => new Error("PASS_TIME_BUDGET: state retirement reached the pass deadline; the next pass continues it");
  const keys = retired.map(([, recordClass, scope]) => `${recordClass}:${scope}`);
  const rows = await input.query(`SELECT p.key,p.current_version_id,p.promoted_at,c.normalized_hash
    FROM civic_data_promotions p JOIN civic_data_candidates c ON c.id=p.current_version_id
    WHERE p.key=ANY($1::text[])`, [keys]);
  if (!rows.length) return [];
  const origins = rows.map(row => {
    const descriptor = retired.find(([, recordClass, scope]) => row.key === `${recordClass}:${scope}`);
    if (!descriptor || !/^[a-f0-9]{64}$/.test(String(row.normalized_hash))) throw new Error("STATE_RETIREMENT_ORIGIN_INVALID");
    return { family: descriptor[0], recordClass: descriptor[1], scope: descriptor[2], versionId: String(row.current_version_id),
      promotedAt: new Date(row.promoted_at as string | Date).toISOString(), hash: String(row.normalized_hash) };
  });
  const childEnv = { ...input.env, [STATE_RETIREMENT_KEY_ENV]: randomBytes(32).toString("hex") };
  const connection = input.env.DATABASE_URL;
  if (!connection) throw new Error("STATE_RETIREMENT_DATABASE_UNAVAILABLE");
  const directory = join(tmpdir(), "meanwhile-held", databaseIdentity(connection), "state-retirement", `${process.pid}-${Date.now()}`);
  await mkdir(temporaryPath(directory), { recursive: true, mode: 0o700 });
  const originsFile = join(directory, "origins.json");
  await writeFile(temporaryPath(originsFile), JSON.stringify(origins), { mode: 0o600 });
  const cwd = input.env.WTP_RUNTIME_AUTHORITY_REPO ?? process.cwd(), script = resolve(cwd, "scripts/retire-state-authorities.mts");
  const releases = new Map<string, WorkerMemoryRelease>(), failures: string[] = [];
  const slots = input.slots ?? routineProcessSlots();
  const options = { cwd, env: childEnv, maxBufferBytes: 64 * 1024, discardOutputAfterSettlement: true,
    ...(Number.isFinite(deadlineMs) ? { deadlineMs } : {}),
    onStarting: async (command: { id: string; onStarted?: (pid: number) => void }) => {
      if (Date.now() >= deadlineMs) throw late();
      const release = await slots.acquire(`${command.id}/retire-state-authorities.mts`, Math.min(Date.now() + ROUTINE_CHILD_TIMEOUT_MS, deadlineMs));
      releases.set(command.id, release); command.onStarted = pid => release.observe?.(pid);
    } };
  const release = (id: string) => { releases.get(id)?.(); releases.delete(id); };
  let cut = false;
  // A child ended by the deadline, or never started for it, is owed to the next pass rather than failed.
  const settledLate = (run: { errorMessage: string | null }) => {
    const isLate = /^PASS_TIME_BUDGET:/.test(run.errorMessage ?? "");
    if (isLate) cut = true;
    return isLate;
  };
  try {
    if (Date.now() >= deadlineMs) throw late();
    let manifestPath: string | null = null;
    await runBoundedChildPass([{ id: "state-retirement:prepare", executable: process.execPath,
      args: ["--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs", script, `--prepare=${directory}`, `--origins=${originsFile}`],
      env: admittedRuntimeChildEnvironment({ parentEnv: childEnv, capability: "ROUTINE_SUPERVISOR", contract: null, parentPid: process.pid }) }],
    { ...options, onSettled: run => {
      try {
        if (settledLate(run)) return;
        if (run.status !== 0 || run.termination !== "EXITED") throw new Error(run.errorMessage ?? (run.stderr.trim() || "STATE_RETIREMENT_PREPARE_FAILED"));
        const receipt = childReceipt(run.stdout, "STATE_RETIREMENT_PREPARED=");
        if (receipt.manifestPath !== join(directory, "manifest.json")) throw new Error("STATE_RETIREMENT_PLAN_PATH_INVALID");
        manifestPath = receipt.manifestPath as string;
      } catch (error) { failures.push(sanitizedErrorDiagnostic(error)); }
      finally { release(run.id); }
    } }, input.launch);
    if (cut && !failures.length) throw late();
    if (failures.length || !manifestPath) throw new Error(failures.join(" | ") || "STATE_RETIREMENT_PLAN_UNAVAILABLE");
    const plan = JSON.parse(await readFile(temporaryPath(manifestPath), "utf8")) as { units: StateRetirementUnit[]; unassigned: unknown[] };
    if (!Array.isArray(plan.units) || !Array.isArray(plan.unassigned) || plan.unassigned.length)
      throw new Error("STATE_RETIREMENT_UNASSIGNED_MEMBERS");
    const pending = new Map<string, StateRetirementUnit[]>();
    for (const unit of plan.units) {
      const queue = pending.get(unit.contractId) ?? []; queue.push(unit); pending.set(unit.contractId, queue);
    }
    while (pending.size && !cut) {
      if (Date.now() >= deadlineMs) { cut = true; break; }
      const units = [...pending.values()].map(queue => queue.shift()!);
      for (const [key, queue] of pending) if (!queue.length) pending.delete(key);
      await runBoundedChildPass(units.map(unit => ({ id: `${unit.contractId}:retirement:${unit.originVersionId}`, executable: process.execPath,
        args: ["--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs", script, `--unit=${unit.inputFile}`, `--sha256=${unit.fileSha256}`, `--contract=${unit.contractId}`, `--seal=${unit.seal}`],
        env: admittedRuntimeChildEnvironment({ parentEnv: childEnv, capability: unit.family === "candidate-campaign-sites-derived" ? "ROUTINE_CONTRACT" : "MANUAL_CONTRACT",
          contract: unit.contractId, parentPid: process.pid }),
      })), { ...options, onSettled: (run, index) => {
        const unit = units[index];
        try {
          if (settledLate(run)) return;
          if (run.status !== 0 || run.termination !== "EXITED") throw new Error(run.errorMessage ?? (run.stderr.trim() || "STATE_RETIREMENT_UNIT_FAILED"));
          const receipt = childReceipt(run.stdout, "STATE_RETIREMENT_UNIT=");
          if (receipt.family !== unit.family || receipt.state !== unit.state || !["PUBLISHED", "CURRENT"].includes(String(receipt.status)))
            throw new Error("STATE_RETIREMENT_UNIT_NOT_RECONCILED");
        } catch (error) { failures.push(`${unit.family}:${unit.state} ${sanitizedErrorDiagnostic(error)}`); }
        finally { release(run.id); }
      } }, input.launch);
    }
    if (failures.length) throw new Error(failures.join(" | "));
    if (cut) throw late();
    return origins;
  } finally { for (const free of releases.values()) free(); await rm(temporaryPath(directory), { recursive: true, force: true }); }
}

export async function retireNationalStatePointers(query: Query, origins: readonly StateRetirementOrigin[]): Promise<number> {
  if (!origins.length) return 0;
  for (const state of REGISTRY_STATES) {
    const descriptors = [
      { family: "registry-runtime" as const, contract: requiredManualProductionContract(stateRegistryRuntimeContractId(state)) },
      ...STATE_BALLOT_FAMILIES.map(family => ({
        family: family === "candidate-corpus" ? "candidate-publications" as const : family,
        contract: family === "candidate-campaign-sites-derived"
          ? requiredRoutineContract(stateBallotContractId(family, state))
          : requiredManualProductionContract(stateBallotContractId(family, state)),
      })),
    ];
    const rows = await query(`SELECT key,source_id,current_version_id,last_known_good_version_id,
      validation_receipt->>'decision' AS decision FROM civic_data_promotions WHERE key=ANY($1::text[])`,
    [descriptors.map(({ contract }) => `${contract.recordClass}:${contract.scope}`)]);
    const byKey = new Map(rows.map(row => [row.key, row]));
    for (const { family, contract } of descriptors) {
      const key = `${contract.recordClass}:${contract.scope}`, row = byKey.get(key);
      if (!row || row.source_id !== contract.sourceId || row.decision !== "GOOD"
        || !row.current_version_id || row.current_version_id !== row.last_known_good_version_id) throw new Error(`STATE_RETIREMENT_REPLACEMENT_MISSING:${family}:${state}`);
    }
  }
  const expected = origins.map(origin => ({ key: `${origin.recordClass}:${origin.scope}`, current_version_id: origin.versionId }));
  const deleted = await query(`WITH expected AS MATERIALIZED (
      SELECT * FROM jsonb_to_recordset($1::jsonb) AS old(key text,current_version_id text)
    ), locked AS MATERIALIZED (
      SELECT p.key,p.current_version_id FROM civic_data_promotions p JOIN expected e ON p.key=e.key FOR UPDATE OF p
    ), ready AS (
      SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM expected e LEFT JOIN locked p ON p.key=e.key
        WHERE p.current_version_id IS DISTINCT FROM e.current_version_id)
    ) DELETE FROM civic_data_promotions p USING expected e,ready
      WHERE p.key=e.key AND p.current_version_id=e.current_version_id RETURNING p.key`, [JSON.stringify(expected)]);
  if (deleted.length !== origins.length) throw new Error("STATE_RETIREMENT_ORIGIN_MOVED");
  return deleted.length;
}
