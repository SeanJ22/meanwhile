import { resolve } from "node:path";
import { stateRegistryRuntimeContractId } from "./state-scopes.ts";
import { stateBallotContractId, type StateBallotFamily } from "./state-scopes.ts";
import { routineProcessSlots, type WorkerProcessSlots, type WorkerMemoryRelease } from "../control-plane/workers/worker-slots.ts";
import type { ReaderManifest, StateAuthorityFamily } from "../meetings/edge-artifacts.ts";
import type { ReaderArtifactStore } from "../meetings/edge-store.ts";
import type { PublishedStateAuthority, PublishStateAuthorities } from "../meetings/edge-serving.ts";
import { sanitizedErrorDiagnostic } from "../ops/error-diagnostic.ts";
import { runBoundedChildPass, ROUTINE_CHILD_TIMEOUT_MS, type BoundedChildLauncher } from "./bounded-child-pass.ts";
import { admittedRuntimeChildEnvironment } from "./runtime-authority.ts";
import { promotedFamilyVersion, promotedPointerVersion, readPromotedStateEdgeFamilies, selectedStateEdgePointers } from "./promoted-edge-publication.ts";
import type { RoutineDataStore } from "./store.ts";

type StateUnit = ReturnType<typeof selectedStateEdgePointers>[number];
type StateStore = Pick<RoutineDataStore, "readPromotionIdentities">;
const RESULT_PREFIX = "STATE_AUTHORITY_ARTIFACT=";
const slots = routineProcessSlots();

export interface StateArtifactChildren {
  readonly launch?: BoundedChildLauncher;
  readonly slots?: WorkerProcessSlots;
}

function contractId(unit: Pick<StateUnit, "family" | "state">) {
  if (unit.family === "registry-runtime") return stateRegistryRuntimeContractId(unit.state);
  if (unit.family === "ballot-navigation") return "ballot-navigation";
  return stateBallotContractId((unit.family === "candidate-publications" ? "candidate-corpus" : unit.family) as StateBallotFamily, unit.state);
}

function childEnvironment(env: Readonly<Record<string, string | undefined>>): NodeJS.ProcessEnv {
  const mode = env.NODE_ENV;
  return { ...env, NODE_ENV: mode === "production" || mode === "test" ? mode : "development" };
}

async function identityVersion(store: StateStore, unit: StateUnit): Promise<{ version: string; present: boolean }> {
  const rows = (await Promise.all([...new Set(unit.pointers.map(row => row.recordClass))].map(recordClass =>
    store.readPromotionIdentities(recordClass, unit.pointers.filter(row => row.recordClass === recordClass).map(row => row.scope))))).flat();
  return { present: rows.length > 0, version: promotedFamilyVersion(unit.pointers.map(pointer =>
    promotedPointerVersion(pointer.recordClass, pointer.scope, rows.find(row => row.recordClass === pointer.recordClass && row.scope === pointer.scope) ?? null))) };
}

export async function prepareStateArtifactChild(store: RoutineDataStore, artifacts: ReaderArtifactStore,
  state: string, family: StateAuthorityFamily, expectedVersion: string, now: string): Promise<PublishedStateAuthority> {
  const unit = selectedStateEdgePointers(null).find(row => row.state === state && row.family === family);
  if (!unit) throw new Error("STATE_ARTIFACT_UNIT_INVALID");
  if ((await identityVersion(store, unit)).version !== expectedVersion) throw new Error("STATE_ARTIFACT_POINTER_MOVED");
  const result = await readPromotedStateEdgeFamilies({ store, servedManifest: null, selected: [unit], artifactStore: artifacts,
    now, readServedFamily: async () => null });
  const entry = result.stateAuthorities[family]?.[state];
  if (result.skipped.length || !entry || !("artifact" in entry) || entry.versionId !== expectedVersion ||
    (await identityVersion(store, unit)).version !== expectedVersion) throw new Error(`STATE_ARTIFACT_NOT_CURRENT:${result.skipped.join(" | ")}`);
  return entry;
}

export function stateArtifactResultLine(state: string, family: StateAuthorityFamily, entry: PublishedStateAuthority): string {
  return RESULT_PREFIX + JSON.stringify({ state, family, versionId: entry.versionId, artifact: entry.artifact });
}

function childResult(output: string, unit: StateUnit, version: string): PublishedStateAuthority {
  const lines = output.split(/\r?\n/).filter(line => line.startsWith(RESULT_PREFIX));
  if (lines.length !== 1) throw new Error("STATE_ARTIFACT_RECEIPT_COUNT_INVALID");
  const row = JSON.parse(lines[0].slice(RESULT_PREFIX.length)) as PublishedStateAuthority & { state: string; family: string };
  if (row.state !== unit.state || row.family !== unit.family || row.versionId !== version || row.artifact?.version !== version ||
    !/^[a-f0-9]{64}$/.test(row.artifact.sha) || row.artifact.key !== `reader/artifacts/${row.artifact.sha}.json.gz` ||
    Object.keys(row).some(key => !["state", "family", "versionId", "artifact"].includes(key)) ||
    Object.keys(row.artifact).some(key => !["key", "version", "sha"].includes(key))) throw new Error("STATE_ARTIFACT_RECEIPT_INVALID");
  return { versionId: row.versionId, artifact: row.artifact };
}

export async function dispatchStateArtifacts(input: {
  readonly store: StateStore;
  readonly currentStore: StateStore;
  readonly servedManifest: Pick<ReaderManifest, "stateAuthorities"> | null;
  readonly selected: readonly StateUnit[];
  readonly now: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly children?: StateArtifactChildren;
}): Promise<{ stateAuthorities: PublishStateAuthorities; skipped: string[] }> {
  const stateAuthorities: Partial<Record<StateAuthorityFamily, Record<string, PublishedStateAuthority>>> = {};
  const skipped: string[] = [];
  const changed: { unit: StateUnit; version: string; prior: string | null }[] = [];
  for (const unit of input.selected) {
    try {
      const current = await identityVersion(input.store, unit);
      const prior = input.servedManifest?.stateAuthorities?.[unit.family]?.[unit.state]?.version ?? null;
      if (current.version !== prior && (current.present || prior !== null)) changed.push({ unit, version: current.version, prior });
    } catch (error) { skipped.push(`${unit.state}:${unit.family} ${sanitizedErrorDiagnostic(error)}`); }
  }
  const releases = new Map<string, WorkerMemoryRelease>();
  const cwd = input.env.WTP_RUNTIME_AUTHORITY_REPO ?? process.cwd();
  const env = childEnvironment(input.env);
  const commands = changed.map(({ unit, version }) => ({
    id: `${unit.family === "ballot-navigation" ? `${contractId(unit)}:${unit.state}` : contractId(unit)}:reader-artifact`, executable: process.execPath,
    args: ["--experimental-strip-types", resolve(cwd, "scripts/publish-state-authority.mts"), `--state=${unit.state}`,
      `--family=${unit.family}`, `--version=${version}`, `--observed-at=${input.now}`],
    env: admittedRuntimeChildEnvironment({ parentEnv: env,
      capability: unit.family === "candidate-campaign-sites-derived" ? "ROUTINE_CONTRACT" : "MANUAL_CONTRACT", contract: contractId(unit), parentPid: process.pid }),
  }));
  try { await runBoundedChildPass(commands, {
    cwd, env, maxBufferBytes: 64 * 1024, discardOutputAfterSettlement: true,
    onStarting: async command => {
      const release = await (input.children?.slots ?? slots).acquire(`${command.id}/publish-state-authority.mts`, Date.now() + ROUTINE_CHILD_TIMEOUT_MS);
      releases.set(command.id, release);
      (command as { onStarted?: (pid: number) => void }).onStarted = pid => release.observe?.(pid);
    },
    onSettled: async (run, index) => {
      const { unit, version, prior } = changed[index];
      try {
        if (run.status !== 0 || run.termination !== "EXITED") throw new Error(run.errorMessage ?? (run.stderr.trim() || "STATE_ARTIFACT_CHILD_FAILED"));
        const entry = childResult(run.stdout, unit, version);
        if ((await identityVersion(input.currentStore, unit)).version !== version) throw new Error("STATE_ARTIFACT_POINTER_MOVED");
        (stateAuthorities[unit.family] ??= {})[unit.state] = { ...entry, expectedPreviousVersion: prior };
      } catch (error) { skipped.push(`${unit.state}:${unit.family} ${sanitizedErrorDiagnostic(error)}`); }
      finally { releases.get(run.id)?.(); releases.delete(run.id); }
    },
  }, input.children?.launch); }
  finally { for (const release of releases.values()) release(); releases.clear(); }
  return { stateAuthorities, skipped };
}
