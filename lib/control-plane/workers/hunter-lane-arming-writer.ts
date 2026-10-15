import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { HunterLaneArming } from "./hunter-lane-arming.ts";

/** Atomic replacement prevents a lane from reading a partial budget snapshot. */
export function writeLaneArming(path: string, arming: HunterLaneArming): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(arming));
  renameSync(temporary, path);
}
