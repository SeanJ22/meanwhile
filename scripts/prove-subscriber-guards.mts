/**
 * **PROVE THE NEW GUARDS FAIL AGAINST THE CODE THEY WERE WRITTEN FOR.**
 * (`WGH-22` class audit, 2026-08-31.)
 *
 * A test written beside a fix encodes the same reasoning as the fix and cannot
 * disagree with it. A green new test file is therefore not a verified fix — it
 * is a green new test file. The only thing that makes a guard evidence is
 * watching it go RED against the defect, so this script reintroduces each
 * defect textually, runs the guard, restores the file from the copy it took
 * BEFORE touching anything, and reports the verdict.
 *
 * The restore is from an in-memory copy rather than from git, because the
 * working tree holds uncommitted work and `git checkout` would take it.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

interface Reintroduction {
  /** What the guard is supposed to catch. */
  defect: string;
  file: string;
  /** Current text. */
  fixed: string;
  /** The pre-fix text. */
  broken: string;
  /** The guard that must go red. */
  testFile: string;
}

const REINTRODUCTIONS: Reintroduction[] = [
  {
    defect: "an inert subscribe over a store that moves",
    file: "components/reactions/reaction-control.tsx",
    fixed: "  const stored = useSyncExternalStore(\n    subscribeReactions,",
    broken:
      "  const emptySubscribe = () => () => {};\n" +
      "  const stored = useSyncExternalStore(\n    emptySubscribe,",
    testFile: "tests/storage-subscriber-audit.test.ts",
  },
  {
    defect: "the publish inside the write's own try block",
    file: "lib/ballot/picks.ts",
    fixed:
      "  commitStorageWrite(\n" +
      "    () => window.localStorage.setItem(PICKS_STORAGE_KEY, JSON.stringify(file)),\n" +
      "    () => publishStorageEvent(PICKS_EVENT),\n" +
      "  );",
    broken:
      "  try {\n" +
      "    window.localStorage.setItem(PICKS_STORAGE_KEY, JSON.stringify(file));\n" +
      "    window.dispatchEvent(new Event(PICKS_EVENT));\n" +
      "  } catch {\n" +
      "    /* No storage. */\n" +
      "  }",
    testFile: "tests/storage-subscriber-audit.test.ts",
  },
  {
    defect: "a listener set the store's writers cannot reach",
    file: "lib/geo/session-address.ts",
    fixed: "  publishToListeners(listeners);",
    broken: "  /* nothing */",
    testFile: "tests/session-address-publish.test.ts",
  },
];

/** Run one guard file. Returns true when it PASSED. */
function guardPasses(testFile: string): boolean {
  try {
    execFileSync(
      process.execPath,
      ["--import", "./scripts/register-test-loader.mjs", "--test", testFile],
      { cwd: ROOT, stdio: "pipe", maxBuffer: 64 * 1024 * 1024 },
    );
    return true;
  } catch {
    return false;
  }
}

function main(): void {
  const lines: string[] = [];
  let proven = 0;

  for (const item of REINTRODUCTIONS) {
    const full = path.join(ROOT, item.file);
    const original = readFileSync(full, "utf8");
    if (!original.includes(item.fixed)) {
      lines.push(`UNANCHORED  ${item.file}: the fixed text is not in the file`);
      continue;
    }
    // A no-op replace reports success, so the anchor is checked above and the
    // result is checked below rather than assumed from "no error".
    const broken = original.replace(item.fixed, item.broken);
    if (broken === original) {
      lines.push(`UNANCHORED  ${item.file}: the replace changed nothing`);
      continue;
    }
    writeFileSync(full, broken, "utf8");
    let passedWithDefect: boolean;
    try {
      passedWithDefect = guardPasses(item.testFile);
    } finally {
      writeFileSync(full, original, "utf8");
    }
    if (passedWithDefect) {
      lines.push(`NOT PROVEN  ${item.defect} -> ${item.testFile} stayed GREEN`);
    } else {
      proven += 1;
      lines.push(`PROVEN      ${item.defect} -> ${item.testFile} went RED`);
    }
  }

  lines.push("");
  lines.push(`${proven} of ${REINTRODUCTIONS.length} defect(s) proven caught`);
  process.stdout.write(`${lines.join("\n")}\n`);
  if (proven !== REINTRODUCTIONS.length) process.exitCode = 1;
}

main();
