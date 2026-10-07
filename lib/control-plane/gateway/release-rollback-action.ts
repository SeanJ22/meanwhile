import type { RegisteredAction } from "./registry.ts";
import { rollbackId, rollbackSha, type RollbackView } from "../../ops/release-rollback.ts";

export function releaseRollbackAction(read: () => Promise<RollbackView>): RegisteredAction {
  return {
    definition: { type: "release.rollback", label: "Restore an earlier release", authority: "OWNER_DECISION_REQUIRED", subjectKind: "production release",
      does: "Queues restoration of a previously published release compatible with the applied migrations.", doesNot: "Changes no data, migration, budget or pause.",
      requiresStateVersion: false, refusals: ["INVALID_INPUT", "STALE_STATE", "DOWNSTREAM_REFUSED"] },
    validate(input) {
      if (!rollbackId(input.deployId) || !rollbackSha(input.sha) || typeof input.expectedVersion !== "string" || !/^[a-f0-9]{64}$/.test(input.expectedVersion))
        return { ok: false, why: "Choose an available earlier release and refresh its current reading." };
      return { ok: true, value: { deployId: input.deployId, sha: input.sha, expectedVersion: input.expectedVersion } };
    },
    async execute(_deps, context, input) {
      const view = await read();
      if (!view.current || !view.version) return { ok: false, refusal: "DOWNSTREAM_REFUSED", says: view.says };
      if (view.version !== input.expectedVersion) return { ok: false, refusal: "STALE_STATE", says: "The release or applied migrations changed. Refresh before sending." };
      const choice = view.choices.find(row => row.id === input.deployId && row.sha === input.sha && row.allowed);
      if (!choice) return { ok: false, refusal: "DOWNSTREAM_REFUSED", says: "This release is not available for a compatible restore." };
      // The normal gateway persists this queued receipt; no API side effect occurs in Admin.
      return { ok: true, outcome: "QUEUED", subject: choice.id, says: "The compatible restore is queued. Its outcome will appear on the queue.",
        change: { before: view.current.id, after: choice.sha }, openedWork: [{ kind: "release-rollback", id: context.receiptId, title: "Restore an earlier release" }], readBackAt: "/admin?view=queue" };
    },
  };
}
