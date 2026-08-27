import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  LIMIT_REACHED_FLOOR_PERCENT,
  SESSION_STATUSES,
  classifySessionStop,
  type StopAccounting,
} from "../lib/workstate/types.ts";
import { proveResume } from "../lib/workstate/frontier.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * THE STOPPING-LEGITIMACY TEST.
 *
 * Two independent questions at session close: **was the state preserved?** and
 * **was there a legitimate reason to stop?** The three-state model this
 * replaces could only express the first, so a session that preserved everything
 * and stopped at 56% with work remaining reported a status that read as
 * success.
 *
 * **Preservation quality is not permission to stop.**
 */

function accounting(over: Partial<StopAccounting> = {}): StopAccounting {
  return {
    contextUsedPercent: 56,
    contextRemainingPercent: 44,
    stopReason: "unspecified",
    executableOwedWorkRemaining: 12,
    externalStop: false,
    statePersisted: true,
    productiveUntilBoundary: true,
    ...over,
  };
}

test("56% used, work remaining, no external stop -> EARLY_HANDOFF_WITH_CAPACITY", () => {
  // The brief's exact case, and the one the preceding descent session hit.
  const v = classifySessionStop(accounting());
  assert.equal(v.status, "EARLY_HANDOFF_WITH_CAPACITY");
  assert.match(v.reason, /44% of context remained/);
  assert.match(v.reason, /12 executable item/);
});

test("a session may not award itself CLEAN_HANDOFF_LIMIT_REACHED at 56%", () => {
  // The model does not award itself a status; the state does. A claim that the
  // accounting does not support is REFUSED, and the refusal names the claim.
  const v = classifySessionStop(accounting(), "CLEAN_HANDOFF_LIMIT_REACHED");
  assert.equal(v.status, "EARLY_HANDOFF_WITH_CAPACITY");
  assert.equal(v.refused, "CLEAN_HANDOFF_LIMIT_REACHED");
});

test("88% used, work remaining, state persisted, productive to the boundary -> CLEAN_HANDOFF_LIMIT_REACHED", () => {
  const v = classifySessionStop(
    accounting({
      contextUsedPercent: 88,
      contextRemainingPercent: 12,
      stopReason: "context boundary reached mid-item",
    }),
  );
  assert.equal(v.status, "CLEAN_HANDOFF_LIMIT_REACHED");
  assert.match(v.reason, /88%/);
});

test("the 80% figure is a FLOOR for one status, and not a target", () => {
  assert.equal(LIMIT_REACHED_FLOOR_PERCENT, 80);
  // Just under the floor is still early, however tidy the handoff.
  assert.equal(
    classifySessionStop(accounting({ contextUsedPercent: 79, contextRemainingPercent: 21 })).status,
    "EARLY_HANDOFF_WITH_CAPACITY",
  );
  assert.equal(
    classifySessionStop(accounting({ contextUsedPercent: 80, contextRemainingPercent: 20 })).status,
    "CLEAN_HANDOFF_LIMIT_REACHED",
  );
});

test("a platform signal qualifies without the percentage", () => {
  // "the environment reports an imminent context limit, compaction event, or
  // hard stop" is the other qualifying condition, and it does not require 80%.
  const v = classifySessionStop(
    accounting({ contextUsedPercent: 40, contextRemainingPercent: 60, platformSignalledLimit: true }),
  );
  assert.equal(v.status, "CLEAN_HANDOFF_LIMIT_REACHED");
  assert.match(v.reason, /imminent limit/);
});

test("reaching the floor without working to it is still EARLY_HANDOFF_WITH_CAPACITY", () => {
  // This is the anti-gaming rule made structural. Burning context and then
  // stopping is not the same as working until the boundary, and the status
  // model can tell them apart.
  const v = classifySessionStop(
    accounting({ contextUsedPercent: 91, contextRemainingPercent: 9, productiveUntilBoundary: false }),
  );
  assert.equal(v.status, "EARLY_HANDOFF_WITH_CAPACITY");
  assert.match(v.reason, /did not continue productive authorized work/);
});

test("ANTI-GAMING — the rule is written where a session reads it, not only in a brief", () => {
  // A rule against burning context to qualify for a tidier label cannot be
  // fully enforced by a type. What CAN be enforced is that it is stated in
  // current law and in the code a session touches at close.
  const types = readFileSync(join(ROOT, "lib/workstate/types.ts"), "utf8");
  assert.match(types, /never a target/i);
  assert.match(types, /Consuming context in order\s+\*? ?to cross it is a defect|is a defect/i);
  const claude = readFileSync(join(ROOT, "CLAUDE.md"), "utf8");
  assert.match(claude, /EARLY_HANDOFF_WITH_CAPACITY/);
  assert.match(claude.replace(/\s+/g, " "), /floor for that status, never a target/i);
});

test("an external stop qualifies only when it is real", () => {
  const external = classifySessionStop(
    accounting({ externalStop: true, stopReason: "the author instructed the session to stop" }),
  );
  assert.equal(external.status, "CLEAN_HANDOFF_EXTERNAL_STOP");

  // One blocked item does not qualify while other authorized work exists —
  // that is represented by `executableOwedWorkRemaining` staying above zero and
  // `externalStop` staying false. Skip forward instead.
  assert.equal(
    classifySessionStop(accounting({ externalStop: false, executableOwedWorkRemaining: 1 })).status,
    "EARLY_HANDOFF_WITH_CAPACITY",
  );
});

test("COMPLETE is derived from owed work, never claimed", () => {
  assert.equal(
    classifySessionStop(accounting({ executableOwedWorkRemaining: 0 })).status,
    "COMPLETE",
  );
  // Claiming COMPLETE while work remains is refused.
  const v = classifySessionStop(accounting({ executableOwedWorkRemaining: 3 }), "COMPLETE");
  assert.equal(v.status, "EARLY_HANDOFF_WITH_CAPACITY");
  assert.equal(v.refused, "COMPLETE");
});

test("missing canonical state outranks everything -> FAILED_CLOSEOUT", () => {
  const v = classifySessionStop(
    accounting({ statePersisted: false, contextUsedPercent: 95, contextRemainingPercent: 5 }),
  );
  assert.equal(v.status, "FAILED_CLOSEOUT");
});

test("the old permissive CLEAN_HANDOFF status no longer exists", () => {
  assert.ok(!(SESSION_STATUSES as readonly string[]).includes("CLEAN_HANDOFF"));
  assert.equal(SESSION_STATUSES.length, 5);
});

/* ===================================================================== */
/* THE SHORT-FREEZE CUTOVER TEST                                          */
/* ===================================================================== */

/**
 * A design that freezes the descent until all historical governance work is
 * finished FAILS this test unless a named Stage 1 safety requirement genuinely
 * remains unresolved.
 */

test("the frontier was migrated ONCE, and does not need remigrating for Stage 2", () => {
  // The migration reads the legacy artifacts and writes canonical state. Stage
  // 2 work — provenance classification, supersession normalization, remaining
  // policy decomposition — touches the GOVERNANCE ledger and never the
  // workstream store, so no second frontier migration can be required.
  const migrate = readFileSync(join(ROOT, "scripts/workstream-migrate.mts"), "utf8");
  const compile = readFileSync(join(ROOT, "scripts/governance-compile.mts"), "utf8");
  assert.ok(
    !compile.includes("data/workstate") && !compile.includes("workstream"),
    "the governance compiler must not touch the frontier — otherwise Stage 2 would remigrate it",
  );
  assert.match(migrate, /states\//, "the migration reads the legacy artifacts");
});

test("the active frontier does not mutate during its own migration", () => {
  // The legacy descent artifacts are the migration's INPUT and are never
  // written by it. If the migration could write them, a re-run would read its
  // own output and the frontier would drift under the cutover.
  const migrate = readFileSync(join(ROOT, "scripts/workstream-migrate.mts"), "utf8");
  const writes = [...migrate.matchAll(/writeFileSync\(\s*join\(([^)]*)\)/g)].map((m) => m[1]);
  for (const w of writes) {
    assert.ok(
      !/\bstates\b/.test(w),
      `the migration writes into the legacy descent artifacts (${w}) — the input would move under it`,
    );
  }
});

test("descent resumes against canonical state rather than rebuilding from seeds", () => {
  const descent = readFileSync(join(ROOT, "scripts/descent.mts"), "utf8");
  assert.match(descent, /resumeFrom\(/, "descent must read the canonical frontier");
  assert.match(descent, /recordDiscovery\(/, "every discovery must be persisted as it is found");
  assert.match(descent, /saveWorkstream\(/, "state must be written, not only counted");

  // And the resume path itself cannot reach seeds or the network, with
  // comments stripped so the guard does not fire on its own documentation.
  const frontier = readFileSync(join(ROOT, "lib/workstate/frontier.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

  // The property is that the resume path cannot READ the seed list — it must
  // neither import the module nor call its accessor. It is allowed to NAME the
  // file in a refusal message, which is how a user is told where to add seeds
  // for a jurisdiction that has none; a guard that banned the filename would be
  // firing on the error text rather than on the dependency.
  assert.ok(!/\bimport\b[^\n]*descent-seeds/.test(frontier), "the resume path may not import the seed module");
  assert.ok(!/\bseedsFor\s*\(/.test(frontier), "the resume path may not read the seed list");
  assert.ok(!/\bfetch\(/.test(frontier), "the resume path may not make network calls");

  // And the seed COUNT it is handed must be a parameter — a number the caller
  // supplies — so a test can pass zero and see what the command would do.
  // `[\s\S]` rather than the `s` flag — the build targets ES2017, where dotAll
  // is a compile error rather than a runtime one.
  assert.match(
    frontier,
    /planDescentStart\([\s\S]*?seedCount: number/,
    "the seed count is an injected parameter",
  );
});

test("every state resumes with outstanding work read from disk", () => {
  for (const s of ["nj", "az", "nh"]) {
    if (!existsSync(join(ROOT, "data", "workstate", `${s}.json`))) continue;
    const p = proveResume(ROOT, s);
    assert.ok(p, `${s}: must be resumable`);
    assert.equal(p.seedsConsulted, false);
    assert.ok(p.edgesPersisted > 0, `${s}: edges are persisted individually`);
    assert.ok(p.outstandingEligible > 0, `${s}: outstanding work is readable from canonical state`);
    assert.ok(p.cursor.includes(s), `${s}: the cursor is derived, not narrated`);
  }
});

test("Stage 1 does not wait on Stage 2 historical normalization", () => {
  // The gate's criteria are the SAFETY list, not the whole redesign. If a
  // criterion here mentioned full provenance classification or complete
  // supersession normalization, the freeze would outlast its reason.
  const gate = readFileSync(join(ROOT, "scripts/stage1-cutover.mts"), "utf8");
  const criteriaBlock = gate.slice(gate.indexOf("const CRITERIA"), gate.indexOf("floored(\"stage1"));
  for (const stage2 of [
    "full historical provenance",
    "complete supersession",
    "every remaining domain policy",
    "final shrinking",
  ]) {
    assert.ok(
      !criteriaBlock.includes(stage2),
      `Stage 1 must not gate on Stage 2 work: found "${stage2}" in the criteria`,
    );
  }
  // And it must still gate on the safety list.
  for (const required of [
    "canonical ruling ledger",
    "canonical active frontier",
    "exact resume without seed rediscovery",
    "permission/transport separation",
    "candidate/body separation",
  ]) {
    assert.ok(criteriaBlock.includes(required), `Stage 1 must gate on: ${required}`);
  }
});
