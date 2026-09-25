import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { loadIndex } from "../lib/governance/ledger.ts";
import { CURRENT_STATUSES } from "../lib/governance/schema.ts";
import {
  applyEarnedPortability,
  earnedPortability,
  emptyKnowledge,
  findReopenings,
  learnRoute,
  recordRouteOutcome,
  type MethodKnowledge,
  type MethodRoute,
  type PriorConclusion,
} from "../lib/method/knowledge.ts";
import { unknownApplicability } from "../lib/method/portability.ts";
import { planDescentStart } from "../lib/workstate/frontier.ts";
import { DESCENT_STATES, loadWorkstreamFor } from "../lib/workstate/load.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * THE POST-REMEDIATION AUDIT HOTFIX.
 *
 * Four defects an independent audit found in the landed implementation. Each
 * one had passed the acceptance suite, which is the interesting part: every
 * gate was green while the compatibility view carried 24 headings that resolve
 * to nothing, an ACTIVE rule commanded a retired process, the resume proof
 * proved a helper the command did not use, and the method store had no writer.
 *
 * These guards test the thing itself rather than the thing's freshness.
 */

/* ================================================================ FINDING 1 */

test("FINDING 1 — the compatibility view contains no RULING undefined", () => {
  const text = readFileSync(join(ROOT, "docs", "governance", "rulings-index.md"), "utf8");
  assert.equal(
    (text.match(/RULING undefined/g) ?? []).length,
    0,
    "docs/governance/rulings-index.md renders a heading that resolves to no record",
  );
});

test("FINDING 1 — every RULING n row names a real numeric record, and none is omitted", () => {
  const index = loadIndex();
  const text = readFileSync(join(ROOT, "docs", "governance", "rulings-index.md"), "utf8");

  // The view is a one-line-per-ruling index now, so a ruling is a table ROW
  // (`| RULING n | ...`) rather than an `## RULING n` heading. The property is
  // the same: every numbered ruling appears exactly once and resolves.
  const rows = [...text.matchAll(/^\| RULING (.+?) \|/gm)].map((m) => m[1].trim());
  assert.ok(rows.length > 150, `read ${rows.length} rows — the guard has lost its subject`);

  const numericIds = new Set(
    index.records
      .filter((r) => /^R-0*\d+$/.test(r.id))
      .map((r) => String(Number(/^R-0*(\d+)$/.exec(r.id)?.[1]))),
  );

  for (const h of rows) {
    assert.match(h, /^\d+$/, `"| RULING ${h} |" is not a ruling number`);
    assert.ok(numericIds.has(String(Number(h))), `"| RULING ${h} |" resolves to no canonical record`);
  }
  // Every numbered ruling must be represented, or a legacy reference breaks.
  const seen = new Set(rows.map((h) => String(Number(h))));
  const missing = [...numericIds].filter((id) => !seen.has(id));
  assert.deepEqual(missing, [], `numbered rulings absent from the compatibility view: ${missing.join(", ")}`);
  assert.equal(rows.length, numericIds.size);
});

test("FINDING 1 — un-numbered records keep their namespace and are not dropped", () => {
  const index = loadIndex();
  const text = readFileSync(join(ROOT, "docs", "governance", "rulings-index.md"), "utf8");
  const unnumbered = index.records.filter((r) => !/^R-0*\d+$/.test(r.id));
  assert.ok(unnumbered.length > 20, "the un-numbered namespaces are populated");

  for (const r of unnumbered) {
    assert.ok(text.includes(`\`${r.id}\``), `${r.id} is absent from the compatibility view`);
    // And it is NOT given a ruling number.
    assert.ok(
      !new RegExp(`^## RULING .* — ${r.title.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "m").test(text),
      `${r.id} was minted a ruling number`,
    );
  }
  assert.ok(/^R-C-/.test(unnumbered.find((r) => r.id.startsWith("R-C-"))?.id ?? ""));
  assert.ok(/^R-X-/.test(unnumbered.find((r) => r.id.startsWith("R-X-"))?.id ?? ""));
});

/* ================================================================ FINDING 2 */

test("FINDING 2 — RULING 99's dual-write clause is no longer current, and R99 is preserved", () => {
  const index = loadIndex();
  const r99 = index.resolve("RULING 99");
  const r176 = index.resolve("RULING 176");
  assert.ok(r99 && r176);

  // The historical wording is UNTOUCHED — the clause is still readable.
  assert.match(r99.body, /mapping line in BOTH/, "RULING 99's original text must be preserved verbatim");

  // ...and its status says its dual-write clause is retired — amended by RULING
  // 176, then absorbed (SUPERSEDED) by the 2026-09-03 consolidation into 272.
  assert.ok(
    ["AMENDED", "SUPERSEDED"].includes(r99.status),
    `RULING 99 must be non-current (amended or superseded), is ${r99.status}`,
  );

  // The amendment is STRUCTURED, naming both halves.
  const rel = r176.relations.find((x) => x.target === r99.id);
  assert.ok(rel, "RULING 176 must carry the structured amendment to RULING 99");
  assert.equal(rel.kind, "amends");
  assert.match(rel.changed ?? "", /dual write|mapping line/i);
  assert.match(rel.survives ?? "", /names the number it/i);
  assert.match(rel.survives ?? "", /never edited in place|immutable/i);
});

test("FINDING 2 — there is exactly ONE current amendment procedure", () => {
  const index = loadIndex();
  const holders = index.records
    .filter((r) => CURRENT_STATUSES.includes(r.status))
    .filter((r) => r.claims.some((c) => c.key === "governance.amendment_procedure"));

  assert.equal(holders.length, 1, "exactly one ACTIVE record answers how law is amended");
  assert.equal(
    holders[0].claims.find((c) => c.key === "governance.amendment_procedure")?.value,
    "canonical-ledger-and-generated-views",
  );

  // The retired procedure may exist as HISTORY, never as a current answer.
  const current = index.records.filter((r) => CURRENT_STATUSES.includes(r.status));
  for (const r of current) {
    for (const c of r.claims) {
      assert.notEqual(
        c.value,
        "dual-write-claude-and-rulings",
        `${r.id} still commands the retired dual write`,
      );
    }
  }
});

/* ================================================================ FINDING 3 */

test("FINDING 3 — the EXECUTION path resumes canonical work with the seed initializer unavailable", () => {
  // `planDescentStart` is what `scripts/descent.mts` calls. Passing 0 seeds is
  // exactly what the command sees when the seed list is empty or removed.
  //
  // The old proof exercised `resumeFrom` and concluded the descent resumes
  // without seeds. It proved the HELPER; the command still threw on an empty
  // seed list, so recovering 1,614 persisted edges depended on the initializer.
  for (const state of DESCENT_STATES) {
    const w = loadWorkstreamFor(ROOT, state);
    if (!w) continue;

    const plan = planDescentStart(ROOT, state, 0);
    assert.equal(plan.mode, "RESUME", `${state}: must resume from canonical state with no seeds`);
    assert.ok(plan.outstanding > 0, `${state}: outstanding work is recovered`);
    assert.ok(plan.firstEdge, `${state}: the first canonical edge is identified without a crawl`);

    // The first edge and the cursor AGREE with canonical state — the plan is
    // reading the store, not reconstructing an answer.
    const canonicalFirst = w.edges.find((e) => e.id === plan.firstEdge?.id);
    assert.ok(canonicalFirst, `${state}: the first edge exists in the persisted workstream`);
    assert.equal(plan.cursor, w.cursor, `${state}: the plan's cursor is the persisted cursor`);

    // Root recheck is SEPARATE work, and its unavailability is stated rather
    // than folded into recovery.
    assert.equal(plan.rootRecheckAvailable, false);
    assert.match(plan.reason, /top-of-tier recheck is SKIPPED|Tier roots/);
  }
});

test("FINDING 3 — seeds still initialize a jurisdiction with no canonical state, and nothing refuses silently", () => {
  const dir = mkdtempSync(join(tmpdir(), "wtp-plan-"));
  try {
    // No canonical state, no seeds -> REFUSED, with the reason named.
    const refused = planDescentStart(dir, "zz", 0);
    assert.equal(refused.mode, "REFUSED");
    assert.match(refused.reason, /RULING 93/);

    // No canonical state, seeds present -> INITIALIZE. Seeds keep their job.
    const init = planDescentStart(dir, "zz", 5);
    assert.equal(init.mode, "INITIALIZE");
    assert.match(init.reason, /tier roots/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("FINDING 3 — the command no longer gates the run on the seed list", () => {
  const src = readFileSync(join(ROOT, "scripts", "descent.mts"), "utf8");
  assert.match(src, /planDescentStart\(/, "the command must call the shared plan");
  // The specific shape that caused the finding: a throw on an empty seed list
  // BEFORE canonical state is consulted.
  assert.ok(
    !/seeds\.length === 0\s*\)\s*\{\s*throw/.test(src.replace(/\s+/g, " ")),
    "the seed list must not gate the run before canonical state is read",
  );
});

/* ================================================================ FINDING 4 */

function route(id: string, over: Partial<MethodRoute> = {}): Omit<MethodRoute, "learnedAtVersion"> {
  return {
    id,
    title: id,
    tier: "A1",
    fields: ["roster"],
    applicability: unknownApplicability("test"),
    outcomes: [],
    subBranches: [],
    origin: "test",
    learnedOn: "2026-08-26",
    ...over,
  };
}

test("FINDING 4 — one success records the outcome and does NOT become NATIONWIDE", () => {
  let k = learnRoute(emptyKnowledge(), route("r1"), "2026-08-26").knowledge;
  k = recordRouteOutcome(k, "r1", {
    jurisdiction: "nh",
    walkedOn: "2026-08-26",
    rows: 12,
    outcome: "YIELDED",
  }).knowledge;

  assert.equal(k.routes[0].outcomes.length, 1, "the outcome is recorded");
  const earned = earnedPortability(k.routes[0]);
  assert.equal(earned.portability, "UNKNOWN", "one success proves reach nowhere else");
  assert.match(earned.because, /one success does not prove it fails elsewhere/);

  // And it keeps inheriting — narrowing on one success would stop it being
  // offered in the next state, which is the opposite of inherit-everything.
  const { knowledge } = applyEarnedPortability(k);
  assert.equal(knowledge.routes[0].applicability.portability, "UNKNOWN");
});

test("FINDING 4 — breadth earns a transition, deterministically", () => {
  let k = learnRoute(emptyKnowledge(), route("r1"), "2026-08-26").knowledge;
  for (const j of ["nh", "nj"]) {
    k = recordRouteOutcome(k, "r1", { jurisdiction: j, walkedOn: "2026-08-26", rows: 5, outcome: "YIELDED" }).knowledge;
  }
  assert.equal(earnedPortability(k.routes[0]).portability, "STATE_FAMILY");

  k = recordRouteOutcome(k, "r1", { jurisdiction: "az", walkedOn: "2026-08-26", rows: 5, outcome: "YIELDED" }).knowledge;
  const three = applyEarnedPortability(k);
  assert.equal(three.knowledge.routes[0].applicability.portability, "NATIONWIDE");
  assert.deepEqual(three.knowledge.routes[0].applicability.states, ["az", "nh", "nj"]);
  assert.equal(three.moved.length, 1);
  assert.match(three.moved[0].because, /YIELDED in 3 distinct jurisdictions/);
});

test("FINDING 4 — a FAILED or BLOCKED attempt never narrows jurisdictional applicability", () => {
  // RULING 182 applied to method knowledge: a timeout, a TLS refusal, a CAPTCHA
  // and a missing adapter are facts about the ATTEMPT.
  let k = learnRoute(emptyKnowledge(), route("r1"), "2026-08-26").knowledge;
  k = recordRouteOutcome(k, "r1", { jurisdiction: "nh", walkedOn: "2026-08-26", rows: 3, outcome: "YIELDED" }).knowledge;
  for (const o of ["FAILED", "BLOCKED"] as const) {
    k = recordRouteOutcome(k, "r1", {
      jurisdiction: "az",
      walkedOn: "2026-08-26",
      rows: 0,
      outcome: o,
      note: "TLS fingerprint refused before any bytes arrived",
    }).knowledge;
  }
  assert.equal(k.routes[0].outcomes.length, 3, "every attempt is recorded");
  assert.equal(
    earnedPortability(k.routes[0]).portability,
    "UNKNOWN",
    "a transport failure must not narrow the route away from Arizona",
  );

  // Narrowing requires a DECLARED jurisdictional failure — a sentence somebody
  // wrote on purpose.
  const narrowed = earnedPortability(k.routes[0], [
    { jurisdiction: "az", why: "Arizona counties have no equivalent office to walk" },
  ]);
  assert.equal(narrowed.portability, "STATE_SPECIFIC");
  assert.match(narrowed.because, /declared jurisdictionally inapplicable/);
});

test("FINDING 4 — a ZERO outcome is recorded as knowledge", () => {
  let k = learnRoute(emptyKnowledge(), route("r1"), "2026-08-26").knowledge;
  const res = recordRouteOutcome(k, "r1", {
    jurisdiction: "nh",
    walkedOn: "2026-08-26",
    rows: 0,
    outcome: "ZERO",
  });
  k = res.knowledge;
  assert.equal(res.recorded, true, "a zero-yield walk is knowledge, not a non-event (RULING 88)");
  assert.equal(k.routes[0].outcomes[0].outcome, "ZERO");
  assert.equal(earnedPortability(k.routes[0]).portability, "UNKNOWN");
});

test("FINDING 4 — recording is idempotent across sessions", () => {
  let k = learnRoute(emptyKnowledge(), route("r1"), "2026-08-26").knowledge;
  const outcome = { jurisdiction: "nh", walkedOn: "2026-08-26", rows: 4, outcome: "YIELDED" as const };
  k = recordRouteOutcome(k, "r1", outcome).knowledge;
  const again = recordRouteOutcome(k, "r1", outcome);
  assert.equal(again.recorded, false, "the same observation must not deepen the evidence");
  assert.match(again.reason, /already recorded/);
  assert.equal(again.knowledge.routes[0].outcomes.length, 1);

  // Three re-reads of ONE state must never earn NATIONWIDE.
  let spam = k;
  for (let i = 0; i < 5; i += 1) spam = recordRouteOutcome(spam, "r1", outcome).knowledge;
  assert.equal(earnedPortability(spam.routes[0]).portability, "UNKNOWN");
});

test("FINDING 4 — a newly learned route still reopens a prior conclusion", () => {
  let k = learnRoute(emptyKnowledge(), route("r1"), "2026-08-26").knowledge;
  const conclusions: PriorConclusion[] = [
    {
      id: "absence-1",
      kind: "ABSENCE",
      field: "roster",
      jurisdiction: { state: "nh" },
      earnedAtVersion: k.version,
      earnedOn: "2026-08-20",
    },
  ];
  assert.equal(findReopenings(k, conclusions).length, 0);
  k = learnRoute(k, route("r2"), "2026-08-27").knowledge;
  assert.equal(findReopenings(k, conclusions).length, 1, "the compounding rule still holds after the hotfix");
});

test("FINDING 4 — the OPERATIONAL descent path writes outcomes through the canonical store", () => {
  // Not "a data structure exists". The command's source is checked for the
  // actual write, because the finding was precisely that the structure existed
  // and nothing populated it.
  const src = readFileSync(join(ROOT, "scripts", "descent.mts"), "utf8");
  assert.match(src, /recordRouteOutcome\(/, "descent must record route outcomes");
  assert.match(src, /applyEarnedPortability\(/, "and apply what the evidence earns");
  assert.match(src, /data", "method", "knowledge\.json"|knowledge\.json/, "through the canonical method store");
  // ZERO must be one of the outcomes it can write.
  assert.match(src, /"ZERO"/, "a walked-but-empty tier is recorded, not swallowed");
});

test("FINDING 4 — the real store round-trips a recorded outcome", () => {
  // Load canonical state, exercise the path, observe the earned result. The
  // committed store is NOT written — this runs against a copy.
  const dir = mkdtempSync(join(tmpdir(), "wtp-method-"));
  try {
    cpSync(join(ROOT, "data", "method"), join(dir, "data", "method"), { recursive: true });
    const p = join(dir, "data", "method", "knowledge.json");
    let k = JSON.parse(readFileSync(p, "utf8")) as MethodKnowledge;
    const id = k.routes[0].id;
    assert.equal(k.routes[0].applicability.portability, "UNKNOWN");

    for (const j of ["nh", "nj", "az"]) {
      k = recordRouteOutcome(k, id, { jurisdiction: j, walkedOn: "2026-08-26", rows: 7, outcome: "YIELDED" }).knowledge;
    }
    const { knowledge } = applyEarnedPortability(k);
    writeFileSync(p, JSON.stringify(knowledge, null, 2), "utf8");

    const reloaded = JSON.parse(readFileSync(p, "utf8")) as MethodKnowledge;
    const r = reloaded.routes.find((x) => x.id === id);
    assert.equal(r?.outcomes.length, 3, "outcomes survive the round trip");
    assert.equal(r?.applicability.portability, "NATIONWIDE", "and the earned class is observable on reload");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ============================================== NO DESCENT MUTATION */

test("the descent only ever grows from the hotfix fingerprint — nothing is lost or rewritten", () => {
  /*
   * WHAT THIS GUARD IS FOR NOW, AND WHY IT CHANGED.
   *
   * It was written for the 2026-08-26 hotfix session, whose scope forbade
   * walking anything, and it asserted EQUALITY against a fingerprint taken
   * before the first fix: same edges, same candidates, same promoted count.
   *
   * That made it a guard with a one-session lifespan. The descent is supposed
   * to advance, and the next session that advanced it — the descent-resume
   * session, which promoted 667 bodies and recovered 69 stranded Arizona
   * addresses — was failed by a guard whose real complaint was that work had
   * been done.
   *
   * The durable invariant underneath it is MONOTONICITY, and that one is worth
   * keeping forever: canonical state may grow, and it may never shrink. An
   * edge count that falls means a frontier was rebuilt from seeds instead of
   * resumed (RULING 181); a candidate count that falls means leads were
   * deleted rather than classified (RULING 88); a promoted count that falls
   * means a body left the registry without anyone saying so.
   *
   * So equality becomes `>=`, the fingerprint stays exactly as it was, and the
   * guard now catches the thing that would actually be a defect.
   */
  const fp = join(ROOT, "docs", "governance", "hotfix-fingerprint.json");
  if (!existsSync(fp)) return;
  const before = JSON.parse(readFileSync(fp, "utf8")) as {
    states: Record<string, { edges: number; outstanding: number; edgeDigest: string; candidates: number; promoted: number; unmaterialized: number }>;
  };
  for (const [state, b] of Object.entries(before.states)) {
    const w = loadWorkstreamFor(ROOT, state);
    assert.ok(w, `${state} must still exist`);
    assert.ok(
      w.edges.length >= b.edges,
      `${state}: edge count FELL from ${b.edges} to ${w.edges.length} — a frontier was rebuilt, not resumed`,
    );
    assert.ok(
      w.candidates.length >= b.candidates,
      `${state}: candidate count FELL from ${b.candidates} to ${w.candidates.length} — leads were deleted rather than classified`,
    );
    assert.ok(
      w.candidates.filter((c) => c.state === "BODY_PROMOTED").length >= b.promoted,
      `${state}: promoted-body count FELL — a body left the registry without anyone saying so`,
    );
    /* The historical obligation is the one number that may NOT quietly move in
     * either direction. It is discharged by a recovery walk that reports what
     * it recovered, never by a run that stops mentioning it — which is exactly
     * what happened to the cursor clause on 2026-08-26 before `deriveCursor`
     * was made to derive it. */
    const owed = (w.unmaterialized ?? []).reduce((n, u) => n + (u.count ?? 0), 0);
    assert.equal(
      owed,
      b.unmaterialized,
      `${state}: the unmaterialized obligation moved from ${b.unmaterialized} to ${owed} without a recovery walk accounting for it`,
    );
  }
});

void execFileSync;
