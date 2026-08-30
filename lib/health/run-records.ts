/**
 * Run-record placement for the health harnesses (WS-CONTRACT).
 *
 * One implementation, shared by `scripts/reader-suite.mts` and
 * `scripts/control-set.mts` (RULING 103: the shared code path, not two
 * copies). Records are named `<day>-<NN>.json` where NN counts the day's
 * runs, so a day's records sort in the order they happened and no run
 * overwrites another.
 */

import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

export function nextRunRecordPath(dir: string, day: string): string {
  mkdirSync(dir, { recursive: true });
  // Max existing suffix + 1, not a count: a count collides with — and would
  // silently overwrite — a surviving record after any earlier one is removed.
  let max = 0;
  for (const name of readdirSync(dir)) {
    const match = name.match(new RegExp(`^${day}-(\\d+)\\.json$`));
    if (match) max = Math.max(max, Number(match[1]));
  }
  return join(dir, `${day}-${String(max + 1).padStart(2, "0")}.json`);
}
