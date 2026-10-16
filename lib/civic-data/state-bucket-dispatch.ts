import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CONTROL_PLANE_READS_DIR_ENV, databaseIdentity } from "../control-plane/repository/incremental-reads.ts";
import { routineProcessSlots, type WorkerMemoryRelease, type WorkerProcessSlots } from "../control-plane/workers/worker-slots.ts";
import { sanitizedErrorDiagnostic } from "../ops/error-diagnostic.ts";
import { runBoundedChildPass, ROUTINE_CHILD_TIMEOUT_MS, type BoundedChildLauncher } from "./bounded-child-pass.ts";
import { admittedRuntimeChildEnvironment } from "./runtime-authority.ts";
import type { StateBootstrapQuery, StateBootstrapUnit } from "./state-bucket-bootstrap.ts";

type Unit = StateBootstrapUnit;
type Plan = { readonly units: readonly Unit[]; readonly unassigned: readonly unknown[]; readonly missingOrigins?: readonly string[] };
const slots = routineProcessSlots();

function result(output: string, prefix: string): Record<string, unknown> {
  const lines = output.split(/\r?\n/).filter(line => line.startsWith(prefix));
  if (lines.length !== 1) throw new Error("STATE_BUCKET_CHILD_RECEIPT_MISSING");
  return JSON.parse(lines[0].slice(prefix.length)) as Record<string, unknown>;
}

export async function restoreStateBuckets(input: {
  readonly query: StateBootstrapQuery;
  readonly env: NodeJS.ProcessEnv;
  readonly launch?: BoundedChildLauncher;
  readonly slots?: WorkerProcessSlots;
}): Promise<{ readonly published: number; readonly unchanged: number; readonly failures: readonly string[] }> {
  const connection = input.env.DATABASE_URL;
  if (!connection) throw new Error("STATE_BUCKET_DATABASE_UNAVAILABLE");
  const cwd = input.env.WTP_RUNTIME_AUTHORITY_REPO ?? process.cwd();
  const directory = join(input.env[CONTROL_PLANE_READS_DIR_ENV] ?? join(tmpdir(), "meanwhile-held"),
    databaseIdentity(connection), "state-buckets");
  const script = resolve(cwd, "scripts/restore-state-buckets.mts");
  const releases = new Map<string, WorkerMemoryRelease>();
  const failures: string[] = [];
  let published = 0, unchanged = 0;
  const options = {
    cwd, env: input.env, maxBufferBytes: 64 * 1024, discardOutputAfterSettlement: true,
    onStarting: async (command: { readonly id: string; onStarted?: (pid: number) => void }) => {
      const release = await (input.slots ?? slots).acquire(`${command.id}/restore-state-buckets.mts`, Date.now() + ROUTINE_CHILD_TIMEOUT_MS);
      releases.set(command.id, release);
      command.onStarted = pid => release.observe?.(pid);
    },
  };
  const release = (id: string) => { releases.get(id)?.(); releases.delete(id); };
  try {
    let manifestPath: string | null = null;
    let prepareFailure: string | null = null;
    await runBoundedChildPass([{
      id: "state-bucket-prepare", executable: process.execPath,
      args: ["--experimental-strip-types", script, `--prepare=${directory}`],
      env: admittedRuntimeChildEnvironment({ parentEnv: input.env, capability: "MANUAL_CONTRACT", contract: "registry-runtime-bindings", parentPid: process.pid }),
    }], { ...options, onSettled: run => {
      try {
        if (run.status !== 0 || run.termination !== "EXITED") throw new Error(run.errorMessage ?? (run.stderr.trim() || "STATE_BUCKET_PREPARE_FAILED"));
        const receipt = result(run.stdout, "STATE_BUCKET_PREPARED=");
        if (typeof receipt.manifestPath !== "string" || resolve(receipt.manifestPath) !== join(directory, "manifest.json")) throw new Error("STATE_BUCKET_PLAN_PATH_INVALID");
        manifestPath = receipt.manifestPath;
      } catch (error) { prepareFailure = sanitizedErrorDiagnostic(error); }
      finally { release(run.id); }
    } }, input.launch);
    if (prepareFailure) throw new Error(prepareFailure);
    if (!manifestPath) throw new Error("STATE_BUCKET_PLAN_UNAVAILABLE");
    const plan = JSON.parse(await readFile(manifestPath, "utf8")) as Plan;
    if (!Array.isArray(plan.units) || !Array.isArray(plan.unassigned)) throw new Error("STATE_BUCKET_PLAN_INVALID");
    if (plan.unassigned.length) throw new Error(`STATE_BUCKET_UNASSIGNED:${JSON.stringify(plan.unassigned)}`);
    for (const origin of plan.missingOrigins ?? []) failures.push(`STATE_BUCKET_ORIGIN_MISSING:${origin}`);
    const due: Unit[] = [];
    for (const unit of plan.units) {
      const rows = await input.query(`SELECT p.current_version_id,e.detail FROM civic_data_promotions p
        LEFT JOIN civic_data_candidate_events e ON e.candidate_id=p.current_version_id AND e.sequence=1
        WHERE p.record_class=$1 AND p.scope=$2`, [unit.recordClass, unit.scope]);
      if (rows.length) {
        const detail = rows[0].detail;
        if (typeof detail !== "string" || !detail.startsWith("STATE_BUCKET_RESTORE_V1 ")) { unchanged++; continue; }
        const trace = JSON.parse(detail.slice("STATE_BUCKET_RESTORE_V1 ".length)) as { inputHash?: string };
        if (trace.inputHash === unit.inputHash) { unchanged++; continue; }
      }
      due.push(unit);
    }
    await runBoundedChildPass(due.map(unit => ({
      id: `${unit.contractId}:state-restore`, executable: process.execPath,
      args: ["--experimental-strip-types", script, `--unit=${unit.inputFile}`, `--sha256=${unit.fileSha256}`, `--contract=${unit.contractId}`],
      env: admittedRuntimeChildEnvironment({ parentEnv: input.env,
        capability: unit.family === "candidate-campaign-sites-derived" ? "ROUTINE_CONTRACT" : "MANUAL_CONTRACT",
        contract: unit.contractId, parentPid: process.pid }),
    })), { ...options, onSettled: (run, index) => {
      const unit = due[index];
      try {
        if (run.status !== 0 || run.termination !== "EXITED") throw new Error(run.errorMessage ?? (run.stderr.trim() || "STATE_BUCKET_PUBLICATION_FAILED"));
        const receipt = result(run.stdout, "STATE_BUCKET_RESULT=");
        if (receipt.family !== unit.family || receipt.state !== unit.state || typeof receipt.versionId !== "string") throw new Error("STATE_BUCKET_RECEIPT_INVALID");
        if (receipt.status === "PUBLISHED") published++;
        else if (receipt.status === "UNCHANGED" || receipt.status === "CURRENT") unchanged++;
        else throw new Error(`STATE_BUCKET_NOT_PUBLISHED:${receipt.status}`);
      } catch (error) { failures.push(`${unit.family}:${unit.state} ${sanitizedErrorDiagnostic(error)}`); }
      finally { release(run.id); }
    } }, input.launch);
  } finally { for (const free of releases.values()) free(); }
  return { published, unchanged, failures };
}
