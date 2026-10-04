import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { plainCount, plainDuration, plainMeaning } from "../lib/control-plane/plain-words.ts";
import { filesThatWouldBeCommitted } from "../lib/ops/repo-files.ts";
import type { WorkerAttemptView, WorkerRoleView } from "../lib/control-plane/workers/readback.ts";

/* ========================================================================== */
/* THE 9.6.26 OWNER FEEDBACK ON THE MERGED ADMIN C — ACLOSE-6                 */
/* ========================================================================== */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

/* -------------------------------------------------------------------------- */
/* A — a control that looks actionable and does nothing                        */
/* -------------------------------------------------------------------------- */

/**
 * The owner clicked **Open** on *"What is blocked?"* and nothing happened. The
 * card's target was `#decisions`; no element in the application carried that
 * id. `#receipts` was dead the same way. Both were invisible because a fragment
 * with no indicated part is a no-op in every browser rather than an error.
 *
 * So the guard is not "the blocked card points at `#blocked`" — that would pass
 * again the moment someone renamed the section. It is: **every fragment the
 * console can send the owner to is an id something actually renders.**
 *
 * Admin redesign, 2026-09-23: the command centre strip and its cards were
 * removed (its projection, `lib/control-plane/command-centre.ts`, is no longer
 * drawn by any page), so the sweep now reads the fragment links the console
 * itself builds — on Fleet · Work, in the composer, from a readiness code to
 * the body it names on Fleet · Now, and on the pages that kept their content.
 */
const ADMIN_SOURCE_DIRS = ["app"] as const;

function adminFiles(): string[] {
  return filesThatWouldBeCommitted({ cwd: ROOT, paths: [...ADMIN_SOURCE_DIRS] }).filter((f) => /\.tsx?$/.test(f));
}

function adminSource(): string {
  return adminFiles().map((f) => readFileSync(join(ROOT, f), "utf8")).join("\n");
}

/** Every fragment an admin link names: the literal id, or the fixed prefix of a built one. */
function fragmentLinks(): { readonly from: string; readonly line: string; readonly id: string; readonly built: boolean }[] {
  const out: { from: string; line: string; id: string; built: boolean }[] = [];
  for (const f of adminFiles().filter((p) => p.startsWith("app/(admin)/"))) {
    for (const line of readFileSync(join(ROOT, f), "utf8").split("\n")) {
      if (!/\bhref=/.test(line)) continue;
      for (const m of line.matchAll(/#([a-z][\w-]*?)(\$\{|[`"'])/g)) out.push({ from: f, line: line.trim(), id: m[1], built: m[2] === "${" });
    }
  }
  return out;
}

test("every fragment the console sends the owner to is an id something renders", () => {
  const source = adminSource();
  const links = fragmentLinks();
  assert.ok(links.some((l) => l.id === "v6-main"), "the sweep found none of the console's fragment links, so it is not looking at them");
  const dead = links.filter((l) => (l.built ? !source.includes(`id={\`${l.id}\${`) : !source.includes(`id="${l.id}"`)));
  assert.deepEqual(
    dead.map((l) => `${l.from}: #${l.id}${l.built ? "…" : ""}`),
    [],
    "these links point at fragments no element renders, so they silently do nothing. " +
      "This is the exact defect the owner found on the merged Admin C — #decisions and #receipts were both dead.",
  );
});

// Admin redesign, 2026-09-23: the "What is blocked?" card and its #blocked region were removed with the command centre; Fleet · Now's three cards are counted from the lists drawn beneath them on the same page.
// Admin redesign, 2026-09-23: the command centre's banner and its per-card Open links were removed, so there is no second target to keep in step.

test("a fragment target clears the sticky header rather than landing under it", () => {
  const layout = readFileSync(join(ROOT, "app", "(admin)", "layout.tsx"), "utf8");
  assert.match(
    layout,
    /\.reveal-target[^}]*scroll-margin-top/,
    "arriving at an anchor that the sticky console header covers is arriving nowhere the owner can see",
  );
});

// Admin redesign, 2026-09-23: the reveal-on-arrival wrapper and the collapsible decision queue it opened were removed; Fleet · Work opens an assignment in place from its URL (?open=), and the suggested next steps are never collapsed.

/* -------------------------------------------------------------------------- */
/* B — the research detail did not explain itself in English                   */
/* -------------------------------------------------------------------------- */

test("a count agrees with its noun, and a duration is in seconds", () => {
  // "1 artifacts / 1" was on every attempt row.
  assert.equal(plainCount(1, "document kept", "documents kept"), "1 document kept");
  assert.equal(plainCount(2, "document kept", "documents kept"), "2 documents kept");
  assert.match(plainDuration(1552), /^1\.6 seconds$/);
  assert.match(plainDuration(839), /^0\.8 seconds$/);
});

function attempt(over: Partial<WorkerAttemptView> = {}): WorkerAttemptView {
  return {
    attemptId: "at-1",
    routeTaskId: "rt-1",
    workItemId: "wi-1",
    worker: { role: "PARSER", provider: "deterministic", version: "1", instance: "i-1" },
    outcome: "COMPLETED",
    startedAt: "2026-09-06T22:26:00.000Z",
    endedAt: "2026-09-06T22:26:02.000Z",
    duration: null,
    cost: null,
    artifacts: { value: 1, denominator: 1, contract: "artifacts kept", source: "the vault", observedAt: "2026-09-06T22:26:02.000Z", unit: "artifacts" },
    resultStatus: "MATCHED",
    resultId: "r-1",
    verdict: "FAILED",
    executionMode: "DETERMINISTIC",
    resultDetail: "raw",
    findings: [],
    workItemState: "OPEN",
    reopenedByResult: false,
    ...over,
  } as WorkerAttemptView;
}

/* -------------------------------------------------------------------------- */
/* D — state readiness told the owner to run a command                         */
/* -------------------------------------------------------------------------- */


test("the console is published before the first cycle, not only after one", () => {
  const runner = readFileSync(join(ROOT, "scripts", "pilot-runner.mts"), "utf8");
  const loopAt = runner.indexOf("while (cycle < CYCLES)");
  assert.ok(loopAt > 0);
  const before = runner.slice(0, loopAt);
  assert.match(
    before,
    /publishConsole\(\);/,
    "nothing republishes the console until a whole cycle has finished, so a runner that just came up on new code " +
      "leaves every readiness panel quarantined for up to a full cycle — which is exactly what the owner walked into",
  );
});
