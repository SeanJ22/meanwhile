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
  type OrchestrationPlan,
  type SessionWorkstream,
} from "../lib/workstate/orchestration.ts";

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
  const v = classifyOrchestration(
    plan([
      ws({ id: "a", owns: { paths: ["lib/a"], data: [] } }),
      ws({
        id: "b",
        owns: { paths: ["lib/b"], data: [] },
        dependsOn: ["a"],
        dependencyReasons: { a: "b needs the shape a settles on" },
        disposition: "SERIALIZED",
      }),
    ]),
  );
  assert.equal(v.unprovenDependencies.length, 1);
  assert.equal(v.unprovenDependencies[0].rule, "unproven-dependency");
  // Reported, not fatal: the session may hold a correctness reason the
  // repository cannot see. The instrument makes it say so, it does not overrule.
  assert.equal(v.status, "TEAM");
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
  const index = JSON.parse(readFileSync(join(ROOT, "docs/governance/index.json"), "utf8"));
  const records: Array<Record<string, unknown>> = index.records;
  for (const id of ["R-0190", "R-0191"]) {
    const r = records.find((x) => x.id === id);
    assert.ok(r, `${id} is not in the compiled governance index`);
    assert.ok(
      ["ACTIVE", "AMENDED"].includes(r.status as string),
      `${id} is ${String(r.status)} and does not bind`,
    );
  }
  // The constitution carries the cross-cutting half, because a session opening
  // on ANY domain reads it.
  const constitution = readFileSync(join(ROOT, "CLAUDE.md"), "utf8");
  assert.match(constitution, /RULING 190/);
  assert.match(constitution, /INDEPENDENT WORK\s+-> PARALLEL BY DEFAULT/);
  assert.match(constitution, /orchestration:check/);
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

test("the non-reason list is not empty and every entry carries its why", () => {
  assert.ok(SERIALIZATION_NON_REASONS.length >= 6);
  for (const n of SERIALIZATION_NON_REASONS) {
    assert.ok(n.name.length > 0 && n.why.length > 0, `${n.name} carries no why`);
  }
});
