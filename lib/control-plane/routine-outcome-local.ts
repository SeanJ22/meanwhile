import { createHash } from "node:crypto";
import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RoutineCivicDataSupervisorDigestInput } from "./freshness-cycle-outcome.ts";

let saved = false;
export const routineOutcomeWasSaved = (): boolean => saved;
export function markRoutineOutcomeSaved(): void { saved = true; }

/** Save before a database attempt, so a reporting outage also leaves a durable diagnostic on the runner. */
export function saveRoutineOutcomeLocal(input: RoutineCivicDataSupervisorDigestInput,
  root = process.env.WTP_MIRROR ?? join(process.cwd(), ".mirror", "digests")): string {
  const dir = join(root, "runner-outcomes");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const key = createHash("sha256").update(input.outcome.cycleId).digest("hex");
  const target = join(dir, `${key}.json`), temp = `${target}.${process.pid}.tmp`;
  const descriptor = openSync(temp, "w", 0o600);
  try { writeFileSync(descriptor, JSON.stringify(input) + "\n"); fsyncSync(descriptor); }
  finally { closeSync(descriptor); }
  renameSync(temp, target);
  markRoutineOutcomeSaved();
  return target;
}
