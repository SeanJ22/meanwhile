import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GeneratedArtifact } from "../../lib/ops/generated-register.ts";

/** Caller holds the tree lock. A command may write several registered outputs. */
export function proveGeneratedArtifacts(
  root: string,
  artifacts: readonly GeneratedArtifact[],
  run: (command: string) => void,
): void {
  const pure = artifacts.filter((artifact) => artifact.pure);
  // Capture EVERY original before any command can repair a stale sibling.
  const originals = new Map(pure.map(({ path }) => [path, readFileSync(join(root, path))]));
  const restore = () => {
    for (const [path, bytes] of originals) {
      const full = join(root, path);
      // Do not rewrite identical siblings while other suite files read them.
      if (!existsSync(full) || !readFileSync(full).equals(bytes)) writeFileSync(full, bytes);
    }
  };
  const groups = new Map<string, GeneratedArtifact[]>();
  for (const artifact of pure.filter(({ checkCommand }) => !checkCommand)) {
    const group = groups.get(artifact.command) ?? [];
    group.push(artifact);
    groups.set(artifact.command, group);
  }

  try {
    // Read-only whole-output checkers retain their distinct command identities.
    for (const command of new Set(pure.flatMap(({ checkCommand }) => checkCommand ? [checkCommand] : []))) {
      run(command);
    }
    for (const [command, group] of groups) {
      try {
        run(command);
        const mismatches = group.filter(({ path }) => !readFileSync(join(root, path)).equals(originals.get(path)!));
        if (mismatches.length === 0) continue;

        // Reproduce once from the entire original output set, never repaired siblings.
        restore();
        run(command);
        for (const { path } of mismatches) {
          const second = readFileSync(join(root, path));
          const committed = originals.get(path)!;
          if (second.equals(committed)) {
            throw new Error(
              `${path} differed from \`${command}\` on the first derivation and matched on the second. ` +
              "CONCURRENCY OBSERVATION: the mismatch did not reproduce with the original bytes restored. " +
              "The run still fails; a retry is never a passing result.",
            );
          }
          assert.deepEqual(
            second,
            committed,
            `${path} differs from what \`${command}\` produces, and the difference REPRODUCED on a second derivation. ` +
            "RULING 92: fix the GENERATOR and regenerate — never hand-correct the artifact.",
          );
        }
      } finally {
        // A command may rewrite outputs owned by another command too.
        restore();
      }
    }
  } finally {
    // Also restore after a checker failure or a generator that throws midway.
    restore();
  }
}
