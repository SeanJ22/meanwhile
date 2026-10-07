import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CompletionSnapshot } from "../lib/control-plane/completion.ts";
import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import { isScheduled, scheduleObligation, type FreshnessObligation, type ScheduledObligation } from "../lib/control-plane/scheduler/obligation.ts";

export async function eachStore(prefix: string): Promise<Array<readonly [string, ControlPlaneRepositories]>> {
  return [
    ["memory", createMemoryRepositories()],
    ["file", await createFileRepositories(mkdtempSync(join(tmpdir(), prefix)))],
  ];
}

export const T0 = "2026-08-28T00:00:00.000Z";
export const T1 = "2026-08-28T00:05:00.000Z";
export const T2 = "2026-08-28T00:30:00.000Z";

// Every clause at its refusing default: denominatorComplete null means "not established".
export function completionSnapshot(
  over: Partial<CompletionSnapshot> & Pick<CompletionSnapshot, "item">,
): CompletionSnapshot {
  return {
    routeTasks: [],
    validations: [],
    audits: [],
    contradictions: [],
    upstreamStates: new Map(),
    denominatorComplete: null,
    instrumentGreens: new Set<string>(),
    now: T2,
    ...over,
  };
}

export function scheduledFixture(obligation: FreshnessObligation, nowMs: number): ScheduledObligation {
  const row = scheduleObligation(obligation, nowMs);
  if (!isScheduled(row)) throw new Error("fixture obligation did not schedule");
  return row;
}
