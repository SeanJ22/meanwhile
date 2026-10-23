import { join } from "node:path";
import { DurableEvidenceStore } from "../evidence/durable-store.ts";
import { VAULT_DIR } from "../scheduler/vault.ts";
import type { AutonomousCoordinatorRuntime } from "./coordinator.ts";
import { isHeldMeetingTask, productionHeldMeetingExecutor } from "./held-meeting-followup.ts";
import { isHeldSubjectDetailsTask } from "./held-subject-worker.ts";
import { productionHeldSubjectDetailsExecutor } from "./held-subject-runtime.ts";

/** Held sources use their native reader or per-fact publisher on the same leased queue. */
export function withHeldDiggerRuntime(runtime: AutonomousCoordinatorRuntime, input: {
  readonly root: string; readonly vaultRoot?: string; readonly environment?: NodeJS.ProcessEnv;
}): AutonomousCoordinatorRuntime {
  const vault = new DurableEvidenceStore(input.vaultRoot ?? join(input.root, ...VAULT_DIR));
  const now = runtime.now ?? (() => new Date().toISOString());
  return { ...runtime,
    beginTask: async (task, item) => {
      if (isHeldMeetingTask(task) || isHeldSubjectDetailsTask(task)) return;
      await runtime.beginTask?.(task, item);
    },
    roleExecutor: (task, holder) => {
      if (isHeldMeetingTask(task)) return productionHeldMeetingExecutor({ root: input.root, repos: runtime.repos,
        vault, now, environment: input.environment }, task, holder);
      if (isHeldSubjectDetailsTask(task)) return productionHeldSubjectDetailsExecutor({ repos: runtime.repos,
        vault, now, environment: input.environment }, task, holder);
      if (!runtime.roleExecutor) throw new Error("AUTONOMOUS_ROLE_RUNTIME_UNAVAILABLE");
      return runtime.roleExecutor(task, holder);
    },
  };
}
