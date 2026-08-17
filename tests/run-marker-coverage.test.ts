import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * C05 COVERAGE: every script that drives a browser at production declares
 * itself (2026-08-17, g6).
 *
 * The marker went into `walk:all`, `measure:panels` and `perf` first, and the
 * gap showed up the way gaps do — as **one `ORGANIC` row at 09:44:58Z**, zip
 * 85701, written by `pnpm overlaps` loading the app without the header. One
 * row of our own robot, sitting in the store we sell, labelled as a reader.
 *
 * That is the second time in one day the same mistake landed rows: the deploy
 * verification did it with `curl` a few hours earlier. Twice is a class, not an
 * incident, so it gets a guard rather than a third reminder.
 *
 * **The rule:** a script that imports Playwright AND navigates to the app must
 * import `syntheticRunHeaders`. Scripts that never reach the app — a contact
 * sheet built from local images, a contrast audit that reads tokens — are not
 * in scope, and the test proves they are out of scope by looking for the
 * navigation rather than by trusting a list.
 */

const RETIRED_SESSION_WALKS = new Set([
  // One-off session walks, kept for their record rather than run. They are
  // named here so the exemption is a stated list and not a silent pass — if
  // one of these is ever run again it will write unmarked rows, and the fix is
  // to mark it, not to widen this set.
  "tester-drive.mts",
  "tester-walk-0814b.mts",
  "tester-walk-0814c.mts",
  "tester-walk-0814d.mts",
  "tester-walk-0814e.mts",
  "tester-walk-0815.mts",
  "tester-walk-0815b.mts",
  "tester-walk-0815c.mts",
  "tester-walk-0815d.mts",
  "tester-walk-0815e.mts",
  "tester-walk-0817.mts",
  "tester-walk-0818.mts",
  "tester-walk-0819.mts",
  "funding-shots.mts",
  "meeting-card-check.mts",
  "phone-states.mts",
  "popup-states.mts",
  "reaction-states.mts",
  "settle-gate.mts",
  "shading-check.mts",
  "shoot-0816g2.mts",
  "shot-hobbs.mts",
  "wiring-shots.mts",
]);

test("every live browser script declares itself to the search log", async () => {
  const dir = join(process.cwd(), "scripts");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".mts"));
  assert.ok(files.length > 20, `expected the scripts directory, found ${files.length}`);

  const offenders: string[] = [];
  const outOfScope: string[] = [];
  const exempted: string[] = [];
  let covered = 0;

  for (const file of files) {
    const src = await readFile(join(dir, file), "utf8");
    if (!/from "playwright"/.test(src)) continue;

    // In scope only if it actually navigates to the app. A script that opens
    // a browser over local files writes no production rows.
    const navigates = /page\.goto\s*\(\s*`?\$?\{?BASE/.test(src) || /goto\(BASE/.test(src);
    if (!navigates) {
      outOfScope.push(file);
      continue;
    }

    if (RETIRED_SESSION_WALKS.has(file)) {
      exempted.push(file);
      continue;
    }
    if (/syntheticRunHeaders/.test(src)) covered += 1;
    else offenders.push(file);
  }

  // The denominator, stated: a guard that reports "0 offenders" while
  // inspecting nothing is the empty success this repo has a rule about.
  assert.ok(
    covered >= 8,
    `expected the live browser scripts to be covered, only ${covered} were ` +
      `(out of scope: ${outOfScope.length}, exempted: ${exempted.length})`,
  );

  assert.deepEqual(
    offenders,
    [],
    "these scripts drive a browser at production without declaring themselves (C05) — " +
      "import syntheticRunHeaders from lib/db/run-marker.ts and pass RUN_HEADERS as " +
      "extraHTTPHeaders, or their rows land labelled as a reader's",
  );
});
