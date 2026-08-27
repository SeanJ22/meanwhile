import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  NON_REASONS,
  SESSION_STATUSES,
  classifySessionStop,
  disqualifyingNonReason,
  type StopAccounting,
} from "../lib/workstate/types.ts";
import { proveResume } from "../lib/workstate/frontier.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * THE STOPPING-LEGITIMACY TEST.
 *
 * Two independent questions at session close: **was the state preserved?** and
 * **was there a legitimate reason to stop?**
 *
 * The model that answered the second one used to compare a self-reported
 * `context_used_percent` against an 80% floor. **A session cannot measure that
 * quantity.** One reported approximately 4% used while the interface it was
 * running inside displayed roughly 47%, and the classifier believed it, because
 * a number was all it was given.
 *
 * RULING 189 removes the estimate and every proxy for it. What is left is three
 * real conditions — the work is done, the author stopped it, something outside
 * it actually prevented continuing — and this file's job is to prove that no
 * fourth one can be smuggled back in as prose.
 */

function accounting(over: Partial<StopAccounting> = {}): StopAccounting {
  return {
    stopReason: "unspecified",
    executableOwedWorkRemaining: 12,
    authorStop: false,
    externalStop: false,
    statePersisted: true,
    ...over,
  };
}

/* ==================================================================== */
/* NO ESTIMATE IS ASKED FOR, AND NONE CAN BE SUPPLIED                    */
/* ==================================================================== */

test("the stop accounting has no field for a context estimate", () => {
  // The load-bearing case, and the reason this amendment exists: the shape of
  // the input is the whole of the incentive. A field named
  // `contextUsedPercent` is a field a session will fill in, accurately or
  // otherwise.
  const keys = Object.keys(accounting());
  assert.deepEqual(keys.sort(), [
    "authorStop",
    "executableOwedWorkRemaining",
    "externalStop",
    "statePersisted",
    "stopReason",
  ]);
  for (const k of keys) {
    assert.ok(!/context|percent|capacity|remaining_/i.test(k), `${k} reintroduces a self-measurement`);
  }
});

test("classifySessionStop ignores any extra context field it is handed", () => {
  // A caller carrying the old shape forward gets the same verdict as one that
  // does not. There is no path by which a percentage changes an outcome.
  const withGhost = classifySessionStop({
    ...accounting(),
    // @ts-expect-error — the removed field, offered deliberately.
    contextUsedPercent: 95,
    contextRemainingPercent: 5,
    platformSignalledLimit: true,
  });
  assert.equal(withGhost.status, "EARLY_HANDOFF");
  assert.equal(classifySessionStop(accounting()).status, withGhost.status);
});

test("the removed vocabulary is gone from the status list", () => {
  const list = SESSION_STATUSES as readonly string[];
  assert.ok(!list.includes("CLEAN_HANDOFF_LIMIT_REACHED"));
  assert.ok(!list.includes("EARLY_HANDOFF_WITH_CAPACITY"));
  assert.ok(!list.includes("CLEAN_HANDOFF"));
  assert.equal(list.length, 5);
  assert.deepEqual(list, [
    "COMPLETE",
    "CLEAN_HANDOFF_AUTHOR_STOP",
    "CLEAN_HANDOFF_EXTERNAL_STOP",
    "EARLY_HANDOFF",
    "FAILED_CLOSEOUT",
  ]);
});

test("the closeout command refuses the removed flags rather than ignoring them", () => {
  const src = readFileSync(join(ROOT, "scripts/workstream-close.mts"), "utf8");
  // The flags are named ONCE, in the refusal list. Anywhere else would be a
  // path that still reads them.
  assert.match(src, /const REMOVED = \["--context-used", "--platform-limit", "--stopped-short"\]/);
  const withoutRefusal = src.replace(/const REMOVED = \[[^\]]*\]/, "");
  for (const flag of ["--context-used", "--platform-limit", "--stopped-short"]) {
    assert.ok(
      !new RegExp(`argv\\.(includes|indexOf)\\("${flag}"`).test(withoutRefusal),
      `${flag} is still read`,
    );
  }
  assert.ok(
    !/contextUsedPercent|contextRemainingPercent|platformSignalledLimit/.test(src),
    "the closeout still constructs a context accounting",
  );
});

/* ==================================================================== */
/* THE THREE REAL REASONS                                                */
/* ==================================================================== */

test("A — completed authorized work closes COMPLETE, derived from owed work", () => {
  assert.equal(classifySessionStop(accounting({ executableOwedWorkRemaining: 0 })).status, "COMPLETE");
  // And claiming it while work remains is refused, with the claim named.
  const v = classifySessionStop(accounting({ executableOwedWorkRemaining: 3 }), "COMPLETE");
  assert.equal(v.status, "EARLY_HANDOFF");
  assert.equal(v.refused, "COMPLETE");
});

test("B — an explicit author stop is represented honestly", () => {
  const v = classifySessionStop(
    accounting({ authorStop: true, stopReason: "the author redirected the session to a new brief" }),
  );
  assert.equal(v.status, "CLEAN_HANDOFF_AUTHOR_STOP");
  assert.match(v.reason, /author explicitly stopped, redirected or narrowed/);
});

test("C — an actual external interruption is represented honestly, and is never inferred", () => {
  const v = classifySessionStop(
    accounting({ externalStop: true, stopReason: "the platform terminated the run" }),
  );
  assert.equal(v.status, "CLEAN_HANDOFF_EXTERNAL_STOP");

  // One blocked item does not qualify while other authorized work exists. That
  // is represented by `externalStop` staying false and owed work staying above
  // zero — skip forward instead.
  assert.equal(
    classifySessionStop(accounting({ externalStop: false, executableOwedWorkRemaining: 1 })).status,
    "EARLY_HANDOFF",
  );
});

test("D — missing canonical state outranks everything", () => {
  const v = classifySessionStop(accounting({ statePersisted: false, authorStop: true }));
  assert.equal(v.status, "FAILED_CLOSEOUT");
});

test("anything else, however well preserved, is EARLY_HANDOFF", () => {
  const v = classifySessionStop(accounting({ stopReason: "the checklist finished" }));
  assert.equal(v.status, "EARLY_HANDOFF");
  assert.match(v.reason, /12 executable item/);
  assert.match(v.reason, /the stop was still early/);
});

/* ==================================================================== */
/* THE NON-REASONS                                                       */
/* ==================================================================== */

test("a self-estimated capacity cannot make a stop clean", () => {
  for (const reason of [
    "about 80% of usable context consumed",
    "running low on context",
    "context remaining was getting thin",
    "an imminent compaction event",
    "the token budget is nearly spent",
    "roughly 47% of context used",
  ]) {
    const v = classifySessionStop(accounting({ externalStop: true, stopReason: reason }));
    assert.equal(v.status, "EARLY_HANDOFF", `"${reason}" bought a clean stop`);
    assert.match(v.reason, /self-estimated capacity/);
  }
});

test("no other arbitrary proxy is accepted in its place", () => {
  // RULING 189 names these specifically: swapping the unit does not make the
  // guess a measurement.
  for (const reason of [
    "elapsed time suggests wrapping up",
    "the message count is high",
    "the command count is high",
    "the commit count for the session is reached",
    "the session work quota is met",
    "fatigue",
  ]) {
    assert.equal(
      classifySessionStop(accounting({ authorStop: true, stopReason: reason })).status,
      "EARLY_HANDOFF",
      `"${reason}" bought a clean stop`,
    );
  }
});

test("THE MERGE IS NOT A STOPPING CONDITION — the exact reason the last session gave", () => {
  // Verbatim from the preceding descent session's close, which stopped while
  // executable work remained. RULING 1 governs SHIPPING cadence; it says
  // nothing about how long a session runs.
  const v = classifySessionStop(
    accounting({ externalStop: true, stopReason: "one planned merge per session (RULING 1), now taken" }),
  );
  assert.equal(v.status, "EARLY_HANDOFF");
  assert.match(v.reason, /merge cadence/);
  assert.match(v.reason, /shipping cadence, not session duration/);

  for (const reason of [
    "the planned merge has occurred",
    "the merge is taken",
    "already shipped for the session",
    "merge cadence reached",
  ]) {
    assert.equal(
      classifySessionStop(accounting({ authorStop: true, stopReason: reason })).status,
      "EARLY_HANDOFF",
      `"${reason}" bought a clean stop`,
    );
  }
});

test("a non-reason disqualifies a CLEAN status; it never blocks the close itself", () => {
  // COMPLETE and FAILED_CLOSEOUT are derived from state, not from prose, so a
  // badly-worded reason cannot change either one.
  assert.equal(
    classifySessionStop(
      accounting({ executableOwedWorkRemaining: 0, stopReason: "the planned merge is taken" }),
    ).status,
    "COMPLETE",
  );
  assert.equal(
    classifySessionStop(
      accounting({ statePersisted: false, stopReason: "low on context", externalStop: true }),
    ).status,
    "FAILED_CLOSEOUT",
  );
  // And an ordinary early stop is not re-examined for wording: it is already
  // reported as early.
  const plain = classifySessionStop(accounting({ stopReason: "ran low on context" }));
  assert.equal(plain.status, "EARLY_HANDOFF");
  assert.ok(!plain.reason.includes("self-estimated capacity"));
});

test("every declared non-reason carries a name and a stated why", () => {
  assert.ok(NON_REASONS.length >= 2);
  for (const n of NON_REASONS) {
    assert.ok(n.name.length > 3);
    assert.ok(n.why.length > 20, `${n.name} must say why it is not a reason`);
  }
  assert.equal(disqualifyingNonReason("the work is genuinely finished"), null);
  assert.equal(disqualifyingNonReason("the author said stop"), null);
});

test("the rule is written where a session reads it, not only in a brief", () => {
  // A rule against self-measurement cannot be fully enforced by a type. What
  // CAN be enforced is that it is stated in current law and in the code a
  // session touches at close.
  const types = readFileSync(join(ROOT, "lib/workstate/types.ts"), "utf8");
  assert.match(types, /A session does not measure itself|cannot measure its own/i);
  assert.match(types, /Persisted resumability is not permission to stop/i);

  const claude = readFileSync(join(ROOT, "CLAUDE.md"), "utf8");
  assert.match(claude, /EARLY_HANDOFF/);
  assert.match(claude.replace(/\s+/g, " "), /A session does not measure itself/i);
  assert.match(claude.replace(/\s+/g, " "), /MERGE CADENCE IS NOT SESSION CADENCE/i);
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
