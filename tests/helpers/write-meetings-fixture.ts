import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { validateSnapshot, type MeetingsSnapshot } from "../../lib/meetings/snapshot.ts";

/** Test-only round-trip writer. It can never target the repository bootstrap. */
export function writeMeetingsFixture(snapshot: MeetingsSnapshot, root: string): string {
  const path = resolve(root, "data", "meetings-snapshot.json");
  const repositoryBootstrap = resolve(process.cwd(), "data", "meetings-snapshot.json");
  if (path === repositoryBootstrap) {
    throw new Error("the test fixture writer refuses the repository meetings bootstrap");
  }
  validateSnapshot(snapshot);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(snapshot, null, 1)}\n`, "utf8");
  renameSync(temporary, path);
  return join(root, "data", "meetings-snapshot.json");
}
