/** DB-47: compare actual applied migrations with exact previously published code. */
import { createHash } from "node:crypto";
import type { ActionReceipt } from "../control-plane/gateway/contract.ts";
import { appendReceipt, findReceipt } from "../control-plane/gateway/receipts.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";

export interface RollbackMigration { readonly when: number; readonly tag: string; readonly hash: string; readonly phase: "expand" | "contract" }
export interface AppliedRollbackMigration { readonly when: number; readonly hash: string }
export interface RollbackDeploy { readonly id: string; readonly sha: string; readonly publishedAt: string }
export interface RollbackChoice extends RollbackDeploy { readonly allowed: boolean; readonly why: string }
export interface RollbackView {
  readonly current: RollbackDeploy | null; readonly version: string | null;
  readonly choices: readonly RollbackChoice[]; readonly says: string;
}
export interface RollbackAdapter {
  read(): Promise<RollbackView>;
  confirm(current: RollbackDeploy, target: RollbackDeploy): Promise<boolean>;
  restore(deployId: string): Promise<"accepted" | "denied" | "unknown">;
  published(): Promise<RollbackDeploy | null>;
}
export const rollbackId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value);
export const rollbackSha = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function rollbackUnavailable(says: string): RollbackView { return { current: null, version: null, choices: [], says }; }

/** Unknown applied rows and changed migration bytes cannot certify old code. */
export function rollbackCompatibility(applied: readonly AppliedRollbackMigration[], current: readonly RollbackMigration[], target: readonly RollbackMigration[]): string | null {
  const actual = new Map(applied.map(row => [row.when, row.hash]));
  const known = new Map(current.map(row => [row.when, row]));
  const older = new Map(target.map(row => [row.when, row]));
  if (actual.size !== applied.length || known.size !== current.length || older.size !== target.length ||
      [...current, ...target].some(row => !Number.isSafeInteger(row.when) || !/^[a-f0-9]{64}$/.test(row.hash) || !["expand", "contract"].includes(row.phase)) ||
      applied.some(row => !Number.isSafeInteger(row.when) || !/^[a-f0-9]{64}$/.test(row.hash))) return "The migration record is incomplete or contradictory.";
  for (const row of applied) {
    const declared = known.get(row.when);
    if (!declared || declared.hash !== row.hash) return "An applied migration cannot be matched to the current code.";
    if (declared.phase === "contract") {
      const previous = older.get(row.when);
      if (!previous || previous.hash !== row.hash || previous.tag !== declared.tag || previous.phase !== "contract")
        return `This release predates the applied contract migration ${declared.tag}.`;
    }
  }
  for (const row of target) {
    if (actual.get(row.when) !== row.hash) return `The migration needed by this release (${row.tag}) is absent or changed.`;
  }
  return null;
}

export function rollbackView(input: { readonly current: RollbackDeploy; readonly applied: readonly AppliedRollbackMigration[];
  readonly catalog: readonly RollbackMigration[]; readonly candidates: readonly { readonly deploy: RollbackDeploy; readonly catalog: readonly RollbackMigration[] | null }[] }): RollbackView {
  const choices = input.candidates.map(({ deploy, catalog }): RollbackChoice => {
    const why = catalog === null ? "This release's migration record could not be read." : rollbackCompatibility(input.applied, input.catalog, catalog);
    return { ...deploy, allowed: why === null, why: why ?? "Compatible with the migrations already applied." };
  });
  return { current: input.current, version: hash({ current: input.current, applied: [...input.applied].sort((a,b) => a.when-b.when), choices }), choices,
    says: choices.some(row => row.allowed) ? "Restore a compatible earlier release. The runner follows through its existing release handoff."
      : "No compatible earlier release was found in the production history read." };
}

export interface RollbackExecution { readonly state: "DONE" | "REFUSED" | "UNKNOWN" | "CLAIMED"; readonly says: string; readonly recorded?: boolean }
/**
 * The ordinary gateway receipt is the durable rollback request. An atomic append
 * wins its one execution claim. A lost HTTP response never triggers another POST.
 * A caller supplies only the receipt id; authority comes from its stored record.
 */
export async function executeQueuedRollback(repos: ControlPlaneRepositories, receiptId: string, adapter: RollbackAdapter, now: () => string): Promise<RollbackExecution> {
  const at = now();
  const request = await findReceipt(repos, receiptId);
  if (!request || request.type !== "release.rollback" || request.outcome !== "QUEUED" || request.caller !== "OWNER_SESSION" ||
      request.authority !== "OWNER_DECISION_REQUIRED" || !rollbackId(request.subject) || !rollbackId(request.change?.before) || !rollbackSha(request.change?.after))
    return { state: "REFUSED", says: "No recorded owner request authorizes this restore." };
  const resultId = `${receiptId}:rollback-result`;
  const previous = await findReceipt(repos, resultId);
  if (previous) return { state: previous.outcome === "DONE" ? "DONE" : previous.outcome === "REFUSED" ? "REFUSED" : "UNKNOWN", says: previous.says, recorded: true };
  const claim: ActionReceipt = { ...request, receiptId: `${receiptId}:rollback-claim`, type: "release.rollback.claim", outcome: "IN_PROGRESS",
    startedAt: at, completedAt: null, says: "The requested restore has been claimed once.", openedWork: [], readBackAt: "/admin?view=queue" };
  const claimed = await appendReceipt(repos, claim, at);
  if (!claimed.ok || !claimed.appended) return { state: "CLAIMED", says: "This request already has a restore claim, or its claim could not be recorded. It will not be submitted twice." };
  let state: RollbackExecution["state"] = "REFUSED", says = "The release or its migration record changed. Refresh before requesting a restore.";
  let submitted = false;
  try {
    const view = await adapter.read();
    const choice = view.choices.find(row => row.id === request.subject && row.sha === request.change!.after && row.allowed);
    if (view.current?.id === request.change.before && choice && view.version) {
      // Immutable code evidence can be reused; the applied journal must be fresh.
      const compatible = await adapter.confirm(view.current, choice);
      const before = compatible ? await adapter.published() : null;
      if (before?.id === view.current.id && before.sha === view.current.sha) {
        submitted = true;
        const response = await adapter.restore(choice.id);
        const observed = await adapter.published().catch(() => null);
        if (observed?.id === choice.id && observed.sha === choice.sha) {
          state = "DONE"; says = "The earlier release is published. The runner follows through its existing release handoff.";
        } else if (response === "denied") {
          says = "The existing release credential refused the restore. No successful restore was observed.";
        } else {
          state = "UNKNOWN"; says = "The restore was asked for, but the published release could not be confirmed. This request will not be submitted again.";
        }
      }
    }
  } catch {
    state = submitted ? "UNKNOWN" : "REFUSED";
    says = submitted ? "The restore's outcome could not be confirmed. Inspect the recorded claim and published release before making a new request."
      : "Compatibility could not be read. No restore was submitted.";
  }
  const completedAt = now();
  const result: ActionReceipt = { ...request, receiptId: resultId, type: "release.rollback.result", startedAt: at, completedAt,
    outcome: state === "DONE" ? "DONE" : state === "REFUSED" ? "REFUSED" : "IN_PROGRESS", refusal: state === "REFUSED" ? "DOWNSTREAM_REFUSED" : null,
    says, openedWork: [], readBackAt: "/admin?view=queue" };
  const wrote = await appendReceipt(repos, result, completedAt);
  return { state, says: wrote.ok ? says : `${says} Its result could not be recorded; the execution claim remains.`, recorded: wrote.ok };
}
