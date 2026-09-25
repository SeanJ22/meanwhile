import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  ORCHESTRATION_DISPOSITIONS,
  SERIALIZATION_NON_REASONS,
  areIndependent,
  classifyOrchestration,
  conflictOverlap,
  dependencyEvidence,
  disqualifyingSerializationReason,
  unprovenUpstreams,
  appendWorkstream,
  isExecutionArtifact,
  validateExecutionArtifacts,
  WorkstreamAppendError,
  type OrchestrationPlan,
  type SessionWorkstream,
} from "../lib/workstate/orchestration.ts";
import { reconcileCloseout } from "../lib/workstate/orchestration-closeout.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * THE ENGINEERING-TEAM TEST (RULING 190, RULING 191).
 *
 * The rule is not "make five branches". A branch count rewards fragmentation
 * and measures nothing. What is proven here is the semantic:
 *
 *     INDEPENDENT + EXECUTABLE + SERIALIZED WITH NOTHING CHECKABLE BEHIND IT
 *       -> failure, named pair by pair.
 *
 * and its mirror, which matters just as much: a REAL dependency serializes
 * without complaint, so the guard cannot be satisfied by shredding one workstream
 * into three that fight over the same file.
 */

function ws(over: Partial<SessionWorkstream> & { id: string }): SessionWorkstream {
  return {
    title: over.id,
    dependsOn: [],
    dependencyReasons: {},
    owns: { paths: [], data: [] },
    produces: [],
    consumes: [],
    executable: true,
    disposition: "PARALLEL",
    ...over,
  };
}

function plan(workstreams: SessionWorkstream[]): OrchestrationPlan {
  return { session: "test", integrationOwner: "claude/test-integration", workstreams };
}

test("independent executable work run serially is a named failure", () => {
  const v = classifyOrchestration(
    plan([
      ws({ id: "ballot", owns: { paths: ["app/ballot"], data: [] }, disposition: "SERIALIZED", dependsOn: [] }),
      ws({ id: "meetings", owns: { paths: ["lib/sources/legistar"], data: [] }, disposition: "SERIALIZED", dependsOn: [] }),
    ]),
  );
  assert.equal(v.status, "UNJUSTIFIED_SERIALIZATION");
  const rules = v.findings.map((f) => f.rule);
  assert.ok(rules.includes("independent-work-serialized"), `expected the pair finding, got ${rules.join(",")}`);
  const pair = v.findings.find((f) => f.rule === "independent-work-serialized")!;
  assert.deepEqual([...pair.workstreams].sort(), ["ballot", "meetings"]);
});

test("the same two workstreams run in parallel pass", () => {
  const v = classifyOrchestration(
    plan([
      ws({ id: "ballot", owns: { paths: ["app/ballot"], data: [] } }),
      ws({ id: "meetings", owns: { paths: ["lib/sources/legistar"], data: [] } }),
    ]),
  );
  assert.equal(v.status, "TEAM");
  assert.equal(v.findings.length, 0);
  assert.equal(v.independentPairs.length, 1);
});

test("a shared owned path proves the dependency and serializing is accepted", () => {
  const v = classifyOrchestration(
    plan([
      ws({ id: "map-core", owns: { paths: ["components/map/map-entry.tsx"], data: [] } }),
      ws({
        id: "map-overlap",
        owns: { paths: ["components/map/map-entry.tsx"], data: [] },
        dependsOn: ["map-core"],
        dependencyReasons: { "map-core": "both write components/map/map-entry.tsx" },
        disposition: "SERIALIZED",
      }),
    ]),
  );
  assert.equal(v.status, "TEAM");
  assert.equal(v.unprovenDependencies.length, 0);
  // Sharing a file means they are NOT independent — which is the whole reason
  // serializing them is legitimate.
  assert.equal(v.independentPairs.length, 0);
});

test("a produces/consumes handoff proves a dependency with no shared file", () => {
  const up = ws({ id: "votes-store", owns: { paths: ["lib/db"], data: [] }, produces: ["vote-retrieval-interface"] });
  const down = ws({
    id: "ask-votes",
    owns: { paths: ["lib/ask"], data: [] },
    consumes: ["vote-retrieval-interface"],
    dependsOn: ["votes-store"],
    dependencyReasons: { "votes-store": "rebases onto the vote retrieval interface votes-store lands" },
    disposition: "SERIALIZED",
  });
  assert.ok(dependencyEvidence(up, down));
  assert.equal(dependencyEvidence(up, down)!.kind, "artifact-handoff");
  const v = classifyOrchestration(plan([up, down]));
  assert.equal(v.status, "TEAM");
  assert.equal(v.unprovenDependencies.length, 0);
});

test("a dependency backed by prose alone is reported UNPROVEN but never silently accepted", () => {
  /*
   * The edge is declared between two workstreams that BOTH RAN ANYWAY. Nothing
   * was made to wait, so the unprovable sentence cost nothing and is reported
   * rather than refused — the session may hold a correctness reason the
   * repository cannot see, and the instrument makes it say so out loud instead
   * of overruling it.
   *
   * The moment that same sentence is used to make executable work WAIT, it stops
   * being reportable and becomes a finding. That is the test below this one.
   */
  const v = classifyOrchestration(
    plan([
      ws({ id: "a", owns: { paths: ["lib/a"], data: [] } }),
      ws({
        id: "b",
        owns: { paths: ["lib/b"], data: [] },
        dependsOn: ["a"],
        dependencyReasons: { a: "b needs the shape a settles on" },
        disposition: "PARALLEL",
      }),
    ]),
  );
  assert.equal(v.unprovenDependencies.length, 1);
  assert.equal(v.unprovenDependencies[0].rule, "unproven-dependency");
  assert.equal(v.status, "TEAM");
  assert.equal(v.findings.length, 0);
});

test("every refused justification is refused by name", () => {
  const refused: Array<[string, string]> = [
    ["PR size", "the PR is already large and this would add too many files changed"],
    ["branch simplicity", "one branch is simpler and avoids merge conflicts"],
    ["convenience", "finishing this first was more convenient"],
    ["caution", "out of an abundance of caution"],
    ["priority mistaken for a lock", "MTG-13 is P0 so everything else waits"],
    ["single-threaded tooling", "the tooling does not support subagents"],
  ];
  for (const [name, prose] of refused) {
    const hit = disqualifyingSerializationReason(prose);
    assert.ok(hit, `"${prose}" was accepted as a dependency reason`);
    assert.equal(hit.name, name);
  }
});

test("a non-reason on a dependency edge is a finding, not merely unproven", () => {
  const v = classifyOrchestration(
    plan([
      ws({ id: "p0", owns: { paths: ["lib/sources/legistar"], data: [] } }),
      ws({
        id: "ballot",
        owns: { paths: ["app/ballot"], data: [] },
        dependsOn: ["p0"],
        dependencyReasons: { p0: "p0 is the first correctness priority so this waits" },
        disposition: "SERIALIZED",
      }),
    ]),
  );
  assert.equal(v.status, "UNJUSTIFIED_SERIALIZATION");
  assert.ok(v.findings.some((f) => f.rule === "non-reason-dependency"));
});

test("a real dependency reason is NOT caught by the non-reason filter", () => {
  const real = [
    "both branches write app/globals.css, so the second rebases onto the first",
    "consumes the canonical body-identity interface the first workstream lands",
    "the second regenerates a view whose input the first changes",
  ];
  for (const r of real) {
    assert.equal(disqualifyingSerializationReason(r), null, `false positive on: ${r}`);
  }
});

test("a blocked workstream never counts as a serialization and never stops the others", () => {
  const v = classifyOrchestration(
    plan([
      ws({ id: "open-a", owns: { paths: ["lib/a"], data: [] } }),
      ws({
        id: "walled",
        owns: { paths: ["lib/b"], data: [] },
        disposition: "BLOCKED",
        blockedReason: "the publisher requires an authenticated session; records request pending",
      }),
    ]),
  );
  assert.equal(v.status, "TEAM");
  assert.equal(v.counts.blocked, 1);
});

test("a BLOCKED workstream that does not name the wall is a malformed plan", () => {
  const v = classifyOrchestration(
    plan([ws({ id: "a" }), ws({ id: "walled", disposition: "BLOCKED" })]),
  );
  assert.equal(v.status, "MALFORMED_PLAN");
  assert.ok(v.findings.some((f) => f.rule === "unnamed-blocker"));
});

test("a serialized workstream that waits on nothing is the unexplained serial chain", () => {
  const v = classifyOrchestration(
    plan([
      ws({ id: "a", owns: { paths: ["lib/a"], data: [] }, disposition: "INTEGRATED" }),
      ws({ id: "b", owns: { paths: ["lib/b"], data: [] }, disposition: "SERIALIZED" }),
    ]),
  );
  assert.equal(v.status, "UNJUSTIFIED_SERIALIZATION");
  assert.ok(v.findings.some((f) => f.rule === "serialized-without-dependency"));
});

test("dangling, unreasoned and cyclic dependencies are all malformed", () => {
  const dangling = classifyOrchestration(
    plan([ws({ id: "a", dependsOn: ["ghost"], dependencyReasons: { ghost: "x" } }), ws({ id: "b" })]),
  );
  assert.equal(dangling.status, "MALFORMED_PLAN");
  assert.ok(dangling.findings.some((f) => f.rule === "dangling-dependency"));

  const unreasoned = classifyOrchestration(
    plan([ws({ id: "a" }), ws({ id: "b", dependsOn: ["a"] })]),
  );
  assert.equal(unreasoned.status, "MALFORMED_PLAN");
  assert.ok(unreasoned.findings.some((f) => f.rule === "unreasoned-dependency"));

  const cyclic = classifyOrchestration(
    plan([
      ws({ id: "a", dependsOn: ["b"], dependencyReasons: { b: "shared" } }),
      ws({ id: "b", dependsOn: ["a"], dependencyReasons: { a: "shared" } }),
    ]),
  );
  assert.equal(cyclic.status, "MALFORMED_PLAN");
  assert.ok(cyclic.findings.some((f) => f.rule === "dependency-cycle"));
});

test("the guard is not a branch counter — fragmentation over one file does not pass as teamwork", () => {
  // Three branches all rewriting one module. A branch-count metric would score
  // this as maximally parallel. It is the failure mode RULING 190 names.
  const shared = { paths: ["app/globals.css"], data: [] };
  const v = classifyOrchestration(
    plan([ws({ id: "a", owns: shared }), ws({ id: "b", owns: shared }), ws({ id: "c", owns: shared })]),
  );
  assert.equal(v.independentPairs.length, 0, "workstreams sharing a file are not independent");
});

test("subtree ownership overlaps, so a parent path conflicts with its child", () => {
  const a = ws({ id: "a", owns: { paths: ["lib/sources/"], data: [] } });
  const b = ws({ id: "b", owns: { paths: ["lib/sources/legistar/fetch.ts"], data: [] } });
  assert.ok(conflictOverlap(a, b).length > 0);
  assert.equal(areIndependent(a, b, new Map([["a", a], ["b", b]])), false);
});

test("a data domain conflicts even with no shared path", () => {
  const a = ws({ id: "a", owns: { paths: ["scripts/x.mts"], data: ["docs/governance/ledger.jsonl"] } });
  const b = ws({ id: "b", owns: { paths: ["scripts/y.mts"], data: ["docs/governance/ledger.jsonl"] } });
  assert.deepEqual(conflictOverlap(a, b), ["docs/governance/ledger.jsonl"]);
});

test("one workstream is SINGLE_WORKSTREAM, not a violation", () => {
  const v = classifyOrchestration(plan([ws({ id: "only" })]));
  assert.equal(v.status, "SINGLE_WORKSTREAM");
});

test("every disposition the schema declares is understood by the classifier", () => {
  for (const d of ORCHESTRATION_DISPOSITIONS) {
    const w = ws({ id: "a", disposition: d });
    if (d === "BLOCKED") w.blockedReason = "named wall";
    const v = classifyOrchestration(plan([w]));
    assert.notEqual(v.status, "MALFORMED_PLAN", `${d} was not understood`);
  }
});

test("RULING 190 and RULING 191 are in force, with the operative law where they say it is", () => {
  // The 2026-09-03 consolidation absorbed RULING 190 and 191 into RULING 273
  // (how a session runs). The engineering-organization rule is unchanged; its
  // current home is 273, and the constitution carries the cross-cutting line.
  const index = JSON.parse(readFileSync(join(ROOT, "docs/governance/index.json"), "utf8"));
  const records: Array<Record<string, unknown>> = index.records;
  const r = records.find((x) => x.id === "R-0273");
  assert.ok(r, "R-0273 is not in the compiled governance index");
  assert.ok(
    ["ACTIVE", "AMENDED"].includes(r.status as string),
    `R-0273 is ${String(r.status)} and does not bind`,
  );
  // Since 2026-09-25 the rule an agent reads is Sean's adopted wording in
  // docs/rulings.md §5, which CLAUDE.md applies.
  const rulings = readFileSync(join(ROOT, "docs/rulings.md"), "utf8").replace(/\s+/g, " ");
  assert.match(rulings, /Run independent work in parallel without conflicting edits or interfering tests/);
  const guide = readFileSync(join(ROOT, "CLAUDE.md"), "utf8");
  assert.match(guide, /parallelize independent work/i);
});

test("this session's own plan is on disk and passes its own rule", () => {
  const dir = join(ROOT, "data", "workstate", "orchestration");
  assert.ok(existsSync(dir), "no orchestration plan directory — RULING 190 state was never written");
  const plans = readdirSync(dir).filter((f) => f.endsWith(".json"));
  assert.ok(plans.length > 0, "the plan directory is empty");
  for (const f of plans) {
    const p = JSON.parse(readFileSync(join(dir, f), "utf8")) as OrchestrationPlan;
    const v = classifyOrchestration(p);
    assert.ok(
      v.status === "TEAM" || v.status === "SINGLE_WORKSTREAM",
      `${f} is ${v.status}: ${v.findings.map((x) => x.detail).join(" | ")}`,
    );
  }
});

test("THE NEGATIVE CONTROL: a serial queue dressed in declared edges does not escape the rule", () => {
  /*
   * The realistic evasion, and the shape of the session RULING 190 was written
   * against. Three independent domains — a meetings adapter, the ballot, an
   * Arizona ingest — run one after another, and the chain is made to LOOK like
   * a dependency graph by declaring an edge between each pair.
   *
   * Declaring the edges USED TO suppress `independent-work-serialized`, because
   * the independence predicate walked the declared graph. It no longer does:
   * only a PROVEN edge suppresses independence, so all three pairs are still
   * named as independent work run serially, ON TOP OF the two reasons being
   * refused by name and the head of the chain waiting on nothing at all.
   *
   * Six findings for three workstreams is not noise. Each is a different true
   * statement about the same queue, and a session reading the report needs all
   * three claims: these pairs were independent, these reasons were not reasons,
   * and this one was not even downstream of anything.
   */
  const v = classifyOrchestration(
    plan([
      ws({ id: "mtg13", owns: { paths: ["lib/sources/legistar"], data: [] }, disposition: "SERIALIZED" }),
      ws({
        id: "ballot",
        owns: { paths: ["app/ballot"], data: [] },
        dependsOn: ["mtg13"],
        dependencyReasons: { mtg13: "MTG-13 is P0 so the ballot work waits until it is finished" },
        disposition: "SERIALIZED",
      }),
      ws({
        id: "azleg",
        owns: { paths: ["lib/sources/azleg"], data: [] },
        dependsOn: ["ballot"],
        dependencyReasons: { ballot: "the PR is already large and this would add too many files changed" },
        disposition: "SERIALIZED",
      }),
    ]),
  );

  assert.equal(v.status, "UNJUSTIFIED_SERIALIZATION");
  assert.equal(v.findings.length, 6);
  // The head of the chain is caught for waiting on nothing at all...
  assert.ok(v.findings.some((f) => f.rule === "serialized-without-dependency" && f.workstreams[0] === "mtg13"));
  // ...both invented edges are caught by the justification they appealed to...
  const nonReasons = v.findings.filter((f) => f.rule === "non-reason-dependency");
  assert.equal(nonReasons.length, 2);
  assert.match(nonReasons[0].detail, /priority mistaken for a lock/);
  assert.match(nonReasons[1].detail, /PR size/);
  // ...and the declared edges no longer hide the shape of the queue: every one
  // of the three pairs is still independent executable work run serially.
  const pairs = v.findings.filter((f) => f.rule === "independent-work-serialized");
  assert.equal(pairs.length, 3);
  assert.deepEqual(
    pairs.map((f) => [...f.workstreams].sort().join("+")).sort(),
    ["azleg+mtg13", "ballot+mtg13", "azleg+ballot"].sort(),
  );
});

test("the non-reason list is not empty and every entry carries its why", () => {
  assert.ok(SERIALIZATION_NON_REASONS.length >= 6);
  for (const n of SERIALIZATION_NON_REASONS) {
    assert.ok(n.name.length > 0 && n.why.length > 0, `${n.name} carries no why`);
  }
});

/* ===========================================================================
 * FINDING A — the declared-edge loophole.
 *
 * The guard could be turned off by the thing it was guarding against: declare
 * an edge, write a sentence that dodges every non-reason pattern, and
 * `independent-work-serialized` never fires. These tests hold the repair down
 * from both sides — an unproven edge cannot suppress independence, and a proven
 * one still must.
 * ======================================================================== */

test("THE NEGATIVE CONTROL: an invented edge with plausible prose cannot buy a serialization", () => {
  /*
   * The evasion in its strongest form. A and B are disjoint in every checkable
   * way — no shared path, no shared data domain, nothing produced and consumed
   * — and the stated reason is deliberately chosen to be a sentence a competent
   * engineer might actually write. It appeals to no non-reason at all, which is
   * why the reason filter cannot catch it and why the INDEPENDENCE half had to.
   */
  const reason =
    "B cannot name its rows consistently until A settles the normalized identifier scheme";

  // Proof that the evasion is live: this string appeals to none of the refused
  // justifications. If a later non-reason pattern happens to catch it, this
  // assertion fails and the test must be given a fresh string — a negative
  // control quietly caught by a different rule controls for nothing.
  assert.equal(
    disqualifyingSerializationReason(reason),
    null,
    "the negative control string is caught by a non-reason pattern and no longer controls for anything",
  );

  const a = ws({ id: "a", owns: { paths: ["lib/a"], data: ["store-a"] }, disposition: "SERIALIZED" });
  const b = ws({
    id: "b",
    owns: { paths: ["lib/b"], data: ["store-b"] },
    dependsOn: ["a"],
    dependencyReasons: { a: reason },
    disposition: "SERIALIZED",
  });

  // No overlap, no handoff: there is nothing behind the edge at all.
  assert.equal(dependencyEvidence(a, b), null);

  const v = classifyOrchestration(plan([a, b]));
  assert.equal(v.status, "UNJUSTIFIED_SERIALIZATION");

  const pair = v.findings.find((f) => f.rule === "independent-work-serialized");
  assert.ok(pair, `expected the pair finding, got ${v.findings.map((f) => f.rule).join(",")}`);
  assert.deepEqual([...pair.workstreams].sort(), ["a", "b"]);

  // And the serialization itself is named, with the upstream and the reason verbatim.
  const serial = v.findings.find((f) => f.rule === "serialized-on-unproven-dependency");
  assert.ok(serial, "a SERIALIZED workstream resting only on unproven edges is a finding, not a report");
  assert.deepEqual([...serial.workstreams].sort(), ["a", "b"]);
  assert.match(serial.detail, /b is SERIALIZED behind a/);
  assert.ok(serial.detail.includes(reason), "the stated reason is quoted verbatim so a reader can judge it");
});

test("an unproven edge cannot change the independence result", () => {
  const a = ws({ id: "a", owns: { paths: ["lib/a"], data: [] } });
  const b = ws({
    id: "b",
    owns: { paths: ["lib/b"], data: [] },
    dependsOn: ["a"],
    dependencyReasons: { a: "b cannot name its rows until a settles the normalized identifier scheme" },
  });
  const byId = new Map([
    ["a", a],
    ["b", b],
  ]);

  // The declared edge is present and still the pair is independent: the edge
  // buys nothing, which is the entire repair.
  assert.equal(areIndependent(a, b, byId), true);
  assert.deepEqual(unprovenUpstreams(b, byId), ["a"]);

  const v = classifyOrchestration(plan([a, b]));
  assert.equal(v.independentPairs.length, 1);
  assert.deepEqual([...v.independentPairs[0]].sort(), ["a", "b"]);
});

test("a PROVEN conflict overlap still suppresses independence, with no finding", () => {
  // `a` is INTEGRATED rather than SERIALIZED: a SERIALIZED head of a chain waits
  // on nothing and is its own separate finding, which would mask the one thing
  // this test is about.
  const a = ws({ id: "a", owns: { paths: ["lib/shared/thing.ts"], data: [] }, disposition: "INTEGRATED" });
  const b = ws({
    id: "b",
    owns: { paths: ["lib/shared/thing.ts"], data: [] },
    dependsOn: ["a"],
    dependencyReasons: { a: "both write lib/shared/thing.ts, so b rebases onto a" },
    disposition: "SERIALIZED",
  });
  const byId = new Map([
    ["a", a],
    ["b", b],
  ]);
  assert.equal(dependencyEvidence(a, b)!.kind, "conflict-overlap");
  assert.equal(areIndependent(a, b, byId), false);

  const v = classifyOrchestration(plan([a, b]));
  assert.equal(v.status, "TEAM");
  assert.equal(v.findings.length, 0);
  assert.equal(v.unprovenDependencies.length, 0);
});

test("a PROVEN produces/consumes handoff still suppresses independence, with no finding", () => {
  const a = ws({ id: "a", owns: { paths: ["lib/a"], data: [] }, produces: ["canonical-identifier-scheme"] });
  const b = ws({
    id: "b",
    owns: { paths: ["lib/b"], data: [] },
    consumes: ["canonical-identifier-scheme"],
    dependsOn: ["a"],
    dependencyReasons: { a: "b rebases onto the canonical identifier scheme a lands" },
    disposition: "SERIALIZED",
  });
  const byId = new Map([
    ["a", a],
    ["b", b],
  ]);
  assert.equal(dependencyEvidence(a, b)!.kind, "artifact-handoff");
  assert.equal(areIndependent(a, b, byId), false);

  const v = classifyOrchestration(plan([a, b]));
  assert.equal(v.status, "TEAM");
  assert.equal(v.findings.length, 0);
});

test("an unproven edge between two PARALLEL workstreams stays reported and not fatal", () => {
  const v = classifyOrchestration(
    plan([
      ws({ id: "a", owns: { paths: ["lib/a"], data: [] }, disposition: "PARALLEL" }),
      ws({
        id: "b",
        owns: { paths: ["lib/b"], data: [] },
        dependsOn: ["a"],
        dependencyReasons: { a: "b expects to inherit whatever identifier scheme a settles on" },
        disposition: "PARALLEL",
      }),
    ]),
  );
  assert.equal(v.status, "TEAM");
  assert.equal(v.findings.length, 0);
  assert.equal(v.unprovenDependencies.length, 1);
  assert.equal(v.unprovenDependencies[0].rule, "unproven-dependency");
});

test("the two serialization rules never double-report one workstream", () => {
  // `serialized-without-dependency` owns dependsOn.length === 0.
  // `serialized-on-unproven-dependency` owns edges-with-nothing-proven.
  const noEdges = classifyOrchestration(
    plan([
      ws({ id: "a", owns: { paths: ["lib/a"], data: [] }, disposition: "INTEGRATED" }),
      ws({ id: "b", owns: { paths: ["lib/b"], data: [] }, disposition: "SERIALIZED" }),
    ]),
  );
  const bRules = noEdges.findings.filter((f) => f.workstreams.includes("b")).map((f) => f.rule);
  assert.ok(bRules.includes("serialized-without-dependency"));
  assert.ok(!bRules.includes("serialized-on-unproven-dependency"));

  // And a workstream already refused BY NAME for the justification it appealed
  // to is not told a second time that the same edges are unproven.
  const nonReason = classifyOrchestration(
    plan([
      ws({ id: "a", owns: { paths: ["lib/a"], data: [] }, disposition: "INTEGRATED" }),
      ws({
        id: "b",
        owns: { paths: ["lib/b"], data: [] },
        dependsOn: ["a"],
        dependencyReasons: { a: "out of an abundance of caution" },
        disposition: "SERIALIZED",
      }),
    ]),
  );
  const rules = nonReason.findings.filter((f) => f.workstreams.includes("b")).map((f) => f.rule);
  assert.ok(rules.includes("non-reason-dependency"));
  assert.ok(!rules.includes("serialized-on-unproven-dependency"));
});

test("one proven edge among several is enough to justify the serialization", () => {
  const a = ws({ id: "a", owns: { paths: ["lib/a"], data: [] }, produces: ["thing"] });
  const c = ws({ id: "c", owns: { paths: ["lib/c"], data: [] } });
  const b = ws({
    id: "b",
    owns: { paths: ["lib/b"], data: [] },
    consumes: ["thing"],
    dependsOn: ["a", "c"],
    dependencyReasons: { a: "b rebases onto thing", c: "c settles a naming question b expects to inherit" },
    disposition: "SERIALIZED",
  });
  const v = classifyOrchestration(plan([a, c, b]));
  assert.ok(!v.findings.some((f) => f.rule === "serialized-on-unproven-dependency"));
  // The unprovable half is still reported. Being partly justified is not being
  // wholly checked.
  assert.equal(v.unprovenDependencies.length, 1);
  assert.deepEqual(v.unprovenDependencies[0].workstreams, ["b", "c"]);
});

test("the existing Aug 28 plan's declared edges are all PROVEN under the proven-graph rule", () => {
  const p = JSON.parse(
    readFileSync(join(ROOT, "data/workstate/orchestration/2026-08-28-finish-aug28.json"), "utf8"),
  ) as OrchestrationPlan;
  const byId = new Map(p.workstreams.map((w) => [w.id, w]));
  const edges = p.workstreams.flatMap((w) => w.dependsOn.map((dep) => [dep, w.id] as const));
  assert.equal(edges.length, 3, "the plan carries three declared edges");
  for (const [up, down] of edges) {
    const e = dependencyEvidence(byId.get(up)!, byId.get(down)!);
    assert.ok(e, `${down} <- ${up} is not proven, and the plan would now fail its own rule`);
  }
  assert.equal(classifyOrchestration(p).unprovenDependencies.length, 0);
});

/* ===========================================================================
 * FINDING B — the canonical denominator that did not match the session.
 *
 * The Aug 28 plan declared TEN workstreams. Twelve `ws/*` refs existed. The
 * session reported TWELVE, which was the BRANCH COUNT. The true logical count
 * was THIRTEEN: nine refs mapped 1:1, one workstream ran on the integration
 * branch with no private ref, and three refs carried shipped work the plan was
 * never told about.
 *
 * The prohibition these tests hold down is the one RULING 190 states directly:
 * AN ARTIFACT COUNT IS NEVER A WORKSTREAM COUNT, in either direction.
 * ======================================================================== */

function closed(over: Partial<SessionWorkstream> & { id: string }): SessionWorkstream {
  return ws({ disposition: "INTEGRATED", ...over });
}

test("an executed workstream that was never declared FAILS closeout", () => {
  const p = plan([closed({ id: "declared-a" }), closed({ id: "declared-b" })]);
  const r = reconcileCloseout(p, {
    artifacts: [],
    executedWorkstreamIds: ["declared-a", "declared-b", "mtg13union"],
  });
  assert.equal(r.status, "UNRECONCILED");
  const f = r.findings.find((x) => x.rule === "undeclared-workstream");
  assert.ok(f, `expected undeclared-workstream, got ${r.findings.map((x) => x.rule).join(",")}`);
  assert.deepEqual(f.workstreams, ["mtg13union"]);
});

test("a workstream that used TWO branches is still ONE workstream", () => {
  const p = plan([
    closed({
      id: "wide",
      executionArtifacts: [
        { kind: "branch", ref: "ws/wide" },
        { kind: "branch", ref: "ws/wide-followup" },
        { kind: "worktree", ref: "C:/Users/seanj/dev/wtp-wt/wide" },
      ],
    }),
    closed({ id: "narrow", executionArtifacts: [{ kind: "branch", ref: "ws/narrow" }] }),
  ]);
  const r = reconcileCloseout(p, {
    artifacts: [
      { kind: "branch", ref: "ws/wide" },
      { kind: "branch", ref: "ws/wide-followup" },
      { kind: "worktree", ref: "C:/Users/seanj/dev/wtp-wt/wide" },
      { kind: "branch", ref: "ws/narrow" },
    ],
  });
  assert.equal(r.status, "RECONCILED");
  // FOUR artifacts, TWO workstreams. The two numbers are reported apart and
  // neither is derived from the other.
  assert.equal(r.counts.observedArtifacts, 4);
  assert.equal(r.counts.declaredWorkstreams, 2);
  assert.equal(r.links.find((l) => l.workstream === "wide")!.artifacts.length, 3);
  assert.ok(
    r.notes.some((n) => /DIFFERENT NUMBERS/.test(n)),
    "the report must say out loud that the artifact count is not the workstream count",
  );
});

test("a workstream that ran on the integration branch declares zero private refs and still reconciles", () => {
  // The Aug 28 `governance-orchestration` case: it held the shared load-bearing
  // files, so it ran on the integration branch and produced no `ws/*` ref. Under
  // a branch count it does not exist at all.
  const p = plan([
    closed({
      id: "governance-orchestration",
      executionArtifacts: [{ kind: "integration-branch", ref: "claude/finish-aug28-integration" }],
    }),
    closed({ id: "ballot", executionArtifacts: [{ kind: "branch", ref: "ws/ballot" }] }),
  ]);
  const r = reconcileCloseout(p, {
    artifacts: [{ kind: "branch", ref: "ws/ballot" }],
    integrationArtifacts: [{ kind: "integration-branch", ref: "claude/finish-aug28-integration" }],
  });
  assert.equal(r.status, "RECONCILED");
  assert.equal(r.counts.declaredWorkstreams, 2);
  assert.equal(r.counts.observedArtifacts, 1);
});

test("a branch no workstream claims is an EXECUTION ARTIFACT REQUIRING DISPOSITION, not a workstream", () => {
  const p = plan([closed({ id: "declared", executionArtifacts: [{ kind: "branch", ref: "ws/declared" }] })]);
  const r = reconcileCloseout(p, {
    artifacts: [
      { kind: "branch", ref: "ws/declared" },
      { kind: "branch", ref: "ws/methodint" },
    ],
  });
  assert.equal(r.status, "UNRECONCILED");
  assert.deepEqual(r.unlinkedArtifacts, ["branch:ws/methodint"]);
  const f = r.findings.find((x) => x.rule === "unlinked-execution-artifact");
  assert.ok(f);
  assert.match(f.detail, /EXECUTION ARTIFACT REQUIRING DISPOSITION/);
  // The unaccounted ref is NOT promoted to a workstream, which is the whole
  // prohibition: the denominator stays 1.
  assert.equal(r.counts.declaredWorkstreams, 1);
  assert.equal(r.counts.unlinkedArtifacts, 1);
  assert.deepEqual(f.workstreams, []);
});

test("a declared executable workstream left PARALLEL at closeout FAILS", () => {
  for (const open of ["NOT_STARTED", "PARALLEL", "SERIALIZED"] as const) {
    const r = reconcileCloseout(plan([closed({ id: "done" }), ws({ id: "open", disposition: open })]), {
      artifacts: [],
    });
    assert.equal(r.status, "UNRECONCILED", `${open} was accepted as an ending`);
    const f = r.findings.find((x) => x.rule === "non-terminal-at-closeout");
    assert.ok(f, `${open} produced no finding`);
    assert.deepEqual(f.workstreams, ["open"]);
  }
});

test("a BLOCKED workstream with a named wall passes closeout; without one it fails", () => {
  const named = reconcileCloseout(
    plan([
      closed({ id: "done" }),
      ws({
        id: "walled",
        disposition: "BLOCKED",
        blockedReason: "the publisher requires an authenticated session; records request pending",
      }),
    ]),
    { artifacts: [] },
  );
  assert.equal(named.status, "RECONCILED");
  assert.equal(named.counts.terminal, 2);
  assert.equal(named.counts.nonTerminal, 0);

  const unnamed = reconcileCloseout(
    plan([closed({ id: "done" }), ws({ id: "walled", disposition: "BLOCKED" })]),
    { artifacts: [] },
  );
  assert.equal(unnamed.status, "UNRECONCILED");
  assert.ok(unnamed.findings.some((f) => f.rule === "blocked-without-named-wall"));
});

test("a non-executable workstream is not owed a terminal disposition", () => {
  const r = reconcileCloseout(
    plan([closed({ id: "done" }), ws({ id: "not-ours", executable: false, disposition: "NOT_STARTED" })]),
    { artifacts: [] },
  );
  assert.equal(r.status, "RECONCILED");
  assert.equal(r.counts.declaredWorkstreams, 2);
  assert.equal(r.counts.declaredExecutable, 1);
});

test("two workstreams claiming one ref is an ambiguous mapping, not a shared one", () => {
  const r = reconcileCloseout(
    plan([
      closed({ id: "a", executionArtifacts: [{ kind: "branch", ref: "ws/shared" }] }),
      closed({ id: "b", executionArtifacts: [{ kind: "branch", ref: "ws/shared" }] }),
    ]),
    { artifacts: [{ kind: "branch", ref: "ws/shared" }] },
  );
  assert.equal(r.status, "UNRECONCILED");
  const f = r.findings.find((x) => x.rule === "ambiguous-artifact-claim");
  assert.ok(f);
  assert.deepEqual([...f.workstreams].sort(), ["a", "b"]);
});

test("a workstream declared POST HOC counts as declared and is reported separately", () => {
  const p = plan([
    closed({ id: "declared", executionArtifacts: [{ kind: "branch", ref: "ws/declared" }] }),
    closed({
      id: "mtg13union",
      executionArtifacts: [{ kind: "branch", ref: "ws/mtg13union" }],
      declaredPostHoc: {
        backfilledOn: "2026-08-28",
        evidence:
          "ws/mtg13union commit a9d5744, branched from the integration branch at 5349710; " +
          "every non-test file byte-identical to origin/main",
      },
    }),
  ]);
  const r = reconcileCloseout(p, {
    artifacts: [
      { kind: "branch", ref: "ws/declared" },
      { kind: "branch", ref: "ws/mtg13union" },
    ],
    executedWorkstreamIds: ["declared", "mtg13union"],
  });

  // Declared, so it does not fail as undeclared work...
  assert.equal(r.status, "RECONCILED");
  assert.ok(!r.findings.some((f) => f.rule === "undeclared-workstream"));
  assert.equal(r.counts.declaredWorkstreams, 2);

  // ...and counted apart, because the record being repaired and the discipline
  // having held are not the same claim.
  assert.equal(r.counts.declaredPostHoc, 1);
  assert.equal(r.counts.addedDuringSession, 0);
  assert.ok(
    r.notes.some((n) => /declared post hoc — the plan was not kept append-safe/.test(n)),
    `expected the post-hoc note, got: ${r.notes.join(" | ")}`,
  );
});

test("a post-hoc declaration with no evidence is refused — an invented mapping is not a repair", () => {
  const w = closed({
    id: "backfilled",
    declaredPostHoc: { backfilledOn: "2026-08-28", evidence: "   " },
  });
  const problems = validateExecutionArtifacts(w);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /invented mapping/);
  assert.equal(classifyOrchestration(plan([w, closed({ id: "other" })])).status, "MALFORMED_PLAN");

  // And an unstamped date is refused too: a backfill that cannot be placed
  // against the session it repairs is not a record of anything.
  assert.match(
    validateExecutionArtifacts(
      closed({ id: "x", declaredPostHoc: { backfilledOn: "yesterday", evidence: "commit a9d5744" } }),
    )[0],
    /not a stamped date/,
  );
});

test("an unresolvable declared-versus-executed gap is carried, never guessed away", () => {
  const p: OrchestrationPlan = {
    ...plan([closed({ id: "a", executionArtifacts: [{ kind: "branch", ref: "ws/a" }] })]),
    postHocDiscrepancies: [
      {
        kind: "unattributable-ref",
        detail: "a thirteenth ref appeared in the session report and its provenance is gone",
      },
    ],
  };
  const r = reconcileCloseout(p, { artifacts: [{ kind: "branch", ref: "ws/a" }] });
  assert.equal(r.counts.unresolvedDiscrepancies, 1);
  assert.ok(r.notes.some((n) => /unresolvable rather than guessing a mapping/.test(n)));
});

test("execution artifacts are validated, not merely typed", () => {
  assert.ok(isExecutionArtifact({ kind: "branch", ref: "ws/x" }));
  assert.ok(isExecutionArtifact({ kind: "integration-branch", ref: "claude/int" }));
  assert.ok(!isExecutionArtifact({ kind: "vibes", ref: "ws/x" }));
  assert.ok(!isExecutionArtifact({ kind: "branch", ref: "" }));
  assert.ok(!isExecutionArtifact("ws/x"));

  // A malformed artifact makes the plan uncheckable, and an uncheckable plan is
  // not evidence that the rule was followed.
  const bad = ws({
    id: "a",
    executionArtifacts: [{ kind: "vibes", ref: "ws/x" }] as never,
  });
  const v = classifyOrchestration(plan([bad, ws({ id: "b" })]));
  assert.equal(v.status, "MALFORMED_PLAN");
  assert.ok(v.findings.some((f) => f.rule === "malformed-execution-artifact"));

  const dupe = ws({
    id: "a",
    executionArtifacts: [
      { kind: "branch", ref: "ws/x" },
      { kind: "branch", ref: "ws/x" },
    ],
  });
  assert.match(validateExecutionArtifacts(dupe)[0], /declares the artifact branch:ws\/x twice/);
});

test("a mid-session workstream is appended to the plan and stamped as an addendum", () => {
  const base = plan([closed({ id: "first", produces: ["thing"] })]);
  const grown = appendWorkstream(
    base,
    ws({
      id: "p0-incident",
      owns: { paths: ["lib/db"], data: [] },
      consumes: ["thing"],
      dependsOn: ["first"],
      dependencyReasons: { first: "rebases onto thing" },
      disposition: "INTEGRATED",
    }),
  );
  assert.equal(grown.workstreams.length, 2);
  assert.equal(grown.workstreams[1].addedDuringSession, true);
  // The input plan is not mutated: a caller that already wrote the old plan to
  // disk must write the RESULT, not assume its object changed underneath it.
  assert.equal(base.workstreams.length, 1);

  const r = reconcileCloseout(grown, { artifacts: [], executedWorkstreamIds: ["first", "p0-incident"] });
  assert.equal(r.status, "RECONCILED");
  assert.equal(r.counts.addedDuringSession, 1);
  assert.equal(r.counts.declaredPostHoc, 0);
});

test("appending refuses a duplicate id, a dangling edge, and an unreasoned edge", () => {
  const base = plan([closed({ id: "first" })]);
  assert.throws(() => appendWorkstream(base, ws({ id: "first" })), WorkstreamAppendError);
  assert.throws(
    () => appendWorkstream(base, ws({ id: "next", dependsOn: ["ghost"], dependencyReasons: { ghost: "x" } })),
    /not in the plan/,
  );
  assert.throws(
    () => appendWorkstream(base, ws({ id: "next", dependsOn: ["first"] })),
    /gives no reason/,
  );
  assert.throws(() => appendWorkstream(base, ws({ id: "  " })), /the id is empty/);
});

test("the existing Aug 28 plan still parses against the widened schema", () => {
  // The fields added for reconciliation are OPTIONAL on purpose. A schema change
  // that invalidates the canonical record of a shipped session is a worse defect
  // than the gap it closes.
  const p = JSON.parse(
    readFileSync(join(ROOT, "data/workstate/orchestration/2026-08-28-finish-aug28.json"), "utf8"),
  ) as OrchestrationPlan;
  for (const w of p.workstreams) assert.deepEqual(validateExecutionArtifacts(w), []);
  assert.notEqual(classifyOrchestration(p).status, "MALFORMED_PLAN");
});
