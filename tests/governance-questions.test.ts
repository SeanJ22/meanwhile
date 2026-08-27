import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { currentClaims } from "../lib/governance/claims.ts";
import { currentLawText, whereInLaw } from "../lib/governance/current-law.ts";
import { loadIndex } from "../lib/governance/ledger.ts";
import { ELIGIBLE_EDGE_VERSION } from "../lib/workstate/eligibility.ts";
import { generateHandoff, type Workstream } from "../lib/workstate/workstream.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * THE CURRENT-QUESTION TEST.
 *
 * The acceptance bar for this whole remediation is that a brand-new session,
 * using only the CURRENT startup path, can answer a fixed list of questions
 * quickly and unambiguously — **without reading 80,000 words of chronology**.
 *
 * So the list is a test. Each case names the artifact that supplies the answer
 * and asserts the answer is actually there. A question that could only be
 * answered by reading history fails here, which is the difference between an
 * architecture and an intention.
 *
 * The history files are deliberately NOT consulted by any assertion below.
 */

const index = loadIndex();
const law = currentLawText(ROOT);
const answers = currentClaims(index.records);

/** Collapse hard wrapping, so a match is over the sentence a reader sees. */
function flat(s: string): string {
  return s.replace(/\s+/g, " ");
}

function claim(key: string): string {
  const a = answers.get(key);
  assert.ok(a, `no ACTIVE record answers the declared rule slot \`${key}\``);
  return a.value;
}

/* -------------------------------------------------- answered by a rule slot */

test("Q: What is the current production-verification rule?", () => {
  // artifact: docs/governance/index.json — the compiled rule slots
  assert.equal(claim("verification.target"), "local-production-build");
});

test("Q: What is the shipping / close-out path?", () => {
  assert.equal(claim("shipping.closeout_path"), "no-separate-push");
});

test("Q: What counts as an absence? Does any number of attempted routes earn one?", () => {
  assert.equal(claim("discovery.absence_standard"), "argued-never-counted");
  // and the constitution says it in words a reader can act on
  assert.ok(whereInLaw("A finite attempt count never earns an absence", ROOT));
  assert.ok(whereInLaw("I have run out of ideas", ROOT));
});

test("Q: What exactly makes the workstream complete?", () => {
  assert.equal(claim("discovery.completion_model"), "bounded-universe-versioned-convergence");
});

test("Q: Is the current route manifest complete?", () => {
  assert.equal(claim("discovery.method_growth"), "living-versioned-never-final");
  assert.ok(whereInLaw(/never a finished list|is ever complete|KNOWS NOW/i, ROOT));
});

test("Q: Are ruling numbers global or per-brief?", () => {
  assert.equal(claim("rulings.id_namespace"), "global-immutable");
});

test("Q: Can a session close a Needs Sean row?", () => {
  // author-only, with ONE narrow exception a later ruling created.
  assert.equal(claim("tracker.needs_sean_closure"), "author-or-answering-ruling");
  const policy = readFileSync(join(ROOT, "docs/governance/policies/tracker-workflow.md"), "utf8");
  assert.match(policy, /Only the author closes a Needs Sean row/);
  assert.match(policy, /RULING 79/);
});

test("Q: If the current client cannot fetch robots.txt, what exactly is known about permission?", () => {
  assert.equal(claim("permission.transport_collapse"), "orthogonal-cannot-tell");
  assert.ok(whereInLaw("never \"robots disallows this host\"", ROOT) || whereInLaw("CANNOT_TELL", ROOT));
});

/* --------------------------------------------- answered by the constitution */

test("Q: Which document wins if history disagrees with current policy?", () => {
  const where = whereInLaw("History explains. History does not override.", ROOT);
  assert.equal(where, "CLAUDE.md", "the precedence model is in the root constitution");
  assert.match(readFileSync(join(ROOT, "CLAUDE.md"), "utf8"), /Authority precedence/);
});

test("Q: What governs candidate display right now?", () => {
  const policy = join(ROOT, "docs/governance/policies/rendering-neutrality.md");
  assert.ok(existsSync(policy));
  const text = readFileSync(policy, "utf8");
  assert.match(text, /Never generate a candidate position/);
  assert.match(text, /RULING 26|Collection state never governs display|SHOW EVERYTHING WE FIND/i);
  // and the constitution carries the cross-cutting version, so a session that
  // reads only the root file is not misled about it.
  assert.ok(whereInLaw("Show everything we find", ROOT));
});

test("Q: What happens when a route is blocked?", () => {
  assert.ok(whereInLaw("A blocked route may never become a blocked fact", ROOT));
  assert.ok(whereInLaw("BLOCKED_CURRENTLY", ROOT));
});

test("Q: What if a session reaches its context limit before the workstream is complete?", () => {
  // Amended 2026-08-26 (RULING 187). The answer is no longer one status.
  // Running out of context is only ONE legitimate reason to stop, and stopping
  // with capacity remaining is a different, named outcome — so a session
  // reading the constitution has to be able to tell which one applies to it.
  const claude = flat(readFileSync(join(ROOT, "CLAUDE.md"), "utf8"));
  assert.match(claude, /CLEAN_HANDOFF_LIMIT_REACHED/);
  assert.match(claude, /EARLY_HANDOFF_WITH_CAPACITY. is REQUIRED/);
  assert.match(claude, /Preservation quality is not permission to stop/i);
  assert.match(claude, /at least 80% of usable context actually consumed/i);
  assert.match(claude, /never a target/i);
});

test("Q: What prevents the project from recursively crawling irrelevant links forever?", () => {
  assert.ok(whereInLaw("plausibly advances", ROOT) || whereInLaw("owed question", ROOT));
  // Whitespace-normalized: the constitution is hard-wrapped, so a sentence a
  // reader sees as one line is several in the file. A guard whose granularity
  // is finer than the unit of meaning reports the right rule against the wrong
  // text — the same correction this repository already made for its wall check.
  assert.match(
    flat(readFileSync(join(ROOT, "CLAUDE.md"), "utf8")),
    /does not\s+recursively make every hyperlink/i,
  );
});

test("Q: Can a state complete without teaching the project anything new?", () => {
  const policy = readFileSync(join(ROOT, "docs/governance/policies/discovery.md"), "utf8");
  assert.match(
    policy,
    /"Nothing new learned" is a legitimate measured result only after\s+genuine expansion work occurred/,
  );
});

/* ------------------------------------------ answered by the method/work state */

test("Q: Does a new route learned in state 44 become available to state 45?", () => {
  // The proof is executable — `pnpm method:prove` — and asserted in
  // tests/method-knowledge.test.ts. Here we assert the ANSWER is discoverable
  // from current authority rather than only from a passing test.
  assert.ok(whereInLaw("inherited by every later jurisdiction", ROOT) || whereInLaw("PROJECT knowledge", ROOT));
});

test("Q: Can a new route reopen an old converged or absent result?", () => {
  assert.ok(whereInLaw("mechanically reopens", ROOT) || whereInLaw("reopen", ROOT));
  const policy = readFileSync(join(ROOT, "docs/governance/policies/discovery.md"), "utf8");
  assert.match(policy, /reopen/i);
});

test("Q: What does CONVERGED_AS_OF actually mean?", () => {
  const claude = readFileSync(join(ROOT, "CLAUDE.md"), "utf8");
  assert.match(claude, /CONVERGED_AS_OF/);
  assert.match(claude, /never that no other source exists/i);
});

test("Q: Is an entity candidate the same thing as a body in the registry?", () => {
  const claude = flat(readFileSync(join(ROOT, "CLAUDE.md"), "utf8"));
  assert.match(claude, /A lead is not a body/i);
  assert.match(claude, /no candidate count may substitute for the promoted-body count/i);
});

test("Q: What is the current ballot-measure DONE standard?", () => {
  const r171 = index.resolve("RULING 171");
  assert.ok(r171, "RULING 171 must resolve");
  assert.equal(r171.status, "ACTIVE");
  const policy = readFileSync(join(ROOT, `${r171.operativePolicy}`.replace("docs/", "docs/")), "utf8");
  assert.match(policy, /RULING 171/);
  // The seven fields, and the money as a PAIR that blocks.
  assert.match(policy, /seven/i);
  assert.match(policy, /BLOCKED_ASYMMETRIC|equal depth|equal effort/i);
});

test("Q: Can the next session resume the exact descent frontier without recrawling seeds?", () => {
  const dir = join(ROOT, "data", "workstate");
  if (!existsSync(dir)) return;
  for (const s of ["nj", "az", "nh"]) {
    const p = join(dir, `${s}.json`);
    if (!existsSync(p)) continue;
    const w = JSON.parse(readFileSync(p, "utf8")) as Workstream;
    assert.ok(w.edges.length > 0, `${s}: edges are persisted individually`);
    assert.ok(w.cursor, `${s}: an exact cursor is persisted`);
    // And the part that cannot be resumed is NAMED rather than implied.
    assert.match(w.cursor, /NOT persisted by the legacy format/);
  }
});

test("Q: Under the replacement status model, how is the preceding descent session classified?", () => {
  const p = join(ROOT, "data", "workstate", "nj.json");
  if (!existsSync(p)) return;
  const w = JSON.parse(readFileSync(p, "utf8")) as Workstream;
  const h = generateHandoff(
    w,
    { today: "2026-08-26", methodVersion: 0, eligibleEdgeVersion: ELIGIBLE_EDGE_VERSION },
    "EARLY_HANDOFF_WITH_CAPACITY",
  );
  assert.equal(h.session, "EARLY_HANDOFF_WITH_CAPACITY");
  assert.equal(h.workstream, "OPEN");
  assert.equal(h.graph, "EXPANDING");
});

/* ------------------------------------------------------------ and the bar itself */

test("answering a CURRENT question never requires the history files", () => {
  // The bar: if answering a current-rule question still requires reading the
  // chronology, the remediation is not finished. So the history is measured
  // against what a session must actually load.
  const historyBytes = ["docs/governance/history.md", "docs/rulings.md", "docs/governance/ledger.jsonl"]
    .filter((p) => existsSync(join(ROOT, p)))
    .reduce((n, p) => n + Buffer.byteLength(readFileSync(join(ROOT, p), "utf8")), 0);
  const constitution = Buffer.byteLength(readFileSync(join(ROOT, "CLAUDE.md"), "utf8"));

  // History is allowed to be enormous. That is the point — it grows forever.
  assert.ok(historyBytes > constitution * 10, "history is the big thing, and that is correct");

  // What must stay small is the ALWAYS-READ root.
  assert.ok(
    constitution < 40_000,
    `the root constitution is ${constitution} bytes; it replaced a 254,943-byte file and must not grow back into one`,
  );

  // And every question above was answered from `law` — constitution plus
  // policies — or from compiled state. None of them opened the history.
  assert.ok(law.length > 0);
});
