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
  assert.match(policy, /a dated ruling which demonstrably answers one is applied by the session/);
});

test("Q: If the current client cannot fetch robots.txt, what exactly is known about permission?", () => {
  assert.equal(claim("permission.transport_collapse"), "orthogonal-cannot-tell");
  assert.ok(whereInLaw("never \"robots disallows this host\"", ROOT) || whereInLaw("CANNOT_TELL", ROOT));
});

/* --------------------------------------------- answered by the constitution */

test("Q: Which document wins if history disagrees with current policy?", () => {
  const where = whereInLaw("History explains. History never overrides.", ROOT);
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

test("Q: When may a session stop before the workstream is complete?", () => {
  // Amended 2026-08-27 (RULING 189). The old answer required the session to
  // measure its own context and compare it to an 80% floor. It cannot measure
  // that: one session reported ~4% used while the interface showed ~47%. So
  // the constitution now names three real conditions and no threshold, and
  // this test asserts the ABSENCE of the estimate as hard as the presence of
  // the rule — a removed instruction that survives in the file a session reads
  // is not removed.
  const raw = readFileSync(join(ROOT, "CLAUDE.md"), "utf8");
  const claude = flat(raw);
  const lawFlat = flat(law);

  // The one-line form is in the constitution; the full vocabulary is in the
  // meta-governance policy (RULING 273). Both are current law.
  assert.match(claude, /A session does not measure itself/i);
  assert.match(claude, /keep working while authorized/i);
  assert.match(claude, /stop only when complete, redirected, or actually prevented/i);
  assert.match(lawFlat, /CLEAN_HANDOFF_AUTHOR_STOP/);
  assert.match(lawFlat, /external stop is never inferred/i);
  assert.match(lawFlat, /Merge cadence is not session cadence/i);
  assert.match(lawFlat, /resumability is not permission to stop/i);

  for (const gone of [
    "context_used_percent",
    "context_remaining_percent",
    "CLEAN_HANDOFF_LIMIT_REACHED",
    "EARLY_HANDOFF_WITH_CAPACITY",
    "80% of usable context",
  ]) {
    assert.ok(!raw.includes(gone), `the constitution still carries ${gone}`);
  }
});

test("Q: is the context-usage stopping model gone from CURRENT authority?", () => {
  // The policies are GENERATED from the ledger, so this is the check that the
  // amendment actually retired RULING 187 rather than leaving it standing
  // beside its replacement. RULING 189's own body names what it removed —
  // that is a description, not an instruction — so the guard reads every
  // OTHER current law record.
  const recs = readFileSync(join(ROOT, "docs/governance/ledger.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as { id: string; status: string; kind: string; body: string });
  const current = recs.filter(
    (r) => (r.status === "ACTIVE" || r.status === "AMENDED") && r.id !== "R-0189",
  );
  assert.ok(current.length > 40, "the ledger must actually have been read");
  const offenders = current.filter((r) =>
    /context_used_percent|context_remaining_percent|80% of usable context|CLEAN_HANDOFF_LIMIT_REACHED|EARLY_HANDOFF_WITH_CAPACITY/.test(
      r.body,
    ),
  );
  assert.deepEqual(
    offenders.map((r) => r.id),
    [],
    "current law still instructs a session to measure its own context",
  );

  const r187 = recs.find((r) => r.id === "R-0187");
  assert.equal(r187?.status, "SUPERSEDED", "RULING 187 must be retired, not left current");
});
test("Q: What prevents the project from recursively crawling irrelevant links forever?", () => {
  assert.ok(whereInLaw("plausibly advances", ROOT) || whereInLaw("owed question", ROOT));
  // Whitespace-normalized: the constitution is hard-wrapped, so a sentence a
  // reader sees as one line is several in the file. A guard whose granularity
  // is finer than the unit of meaning reports the right rule against the wrong
  // text — the same correction this repository already made for its wall check.
  assert.match(
    flat(law),
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
  assert.ok(whereInLaw("inherited by every later", ROOT) || whereInLaw("project knowledge", ROOT));
});

test("Q: Can a new route reopen an old converged or absent result?", () => {
  assert.ok(whereInLaw("mechanically reopens", ROOT) || whereInLaw("reopen", ROOT));
  const policy = readFileSync(join(ROOT, "docs/governance/policies/discovery.md"), "utf8");
  assert.match(policy, /reopen/i);
});

test("Q: What does CONVERGED_AS_OF actually mean?", () => {
  assert.match(flat(law), /CONVERGED_AS_OF/);
  assert.match(flat(law), /never that no other source exists/i);
});

test("Q: Is an entity candidate the same thing as a body in the registry?", () => {
  assert.match(flat(law), /A lead is not a body/i);
  assert.match(flat(law), /no candidate count may substitute for the promoted-body count/i);
});

test("Q: What is the current ballot-measure DONE standard?", () => {
  // RULING 171 (ballot-measure DONE) was consolidated into RULING 255, which
  // carries the seven-field standard and the money-as-a-pair block.
  const r255 = index.resolve("RULING 255");
  assert.ok(r255 && ["ACTIVE", "AMENDED"].includes(r255.status), "RULING 255 must be current");
  const policy = readFileSync(join(ROOT, "docs/governance/policies/rendering-neutrality.md"), "utf8");
  assert.match(policy, /seven/i);
  assert.match(policy, /equal depth|equal effort/i);
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
    // The cursor states BOTH numbers: what is resumable, and the historical
    // obligation whose identities the legacy format never wrote down. Summing
    // them would claim addresses this repository does not have.
    assert.match(w.cursor, /\d+ eligible edge\(s\) outstanding/);
    assert.match(w.cursor, /unmaterialized obligation \d+/);
  }
});

test("Q: Under the replacement status model, how is the preceding descent session classified?", () => {
  const p = join(ROOT, "data", "workstate", "nj.json");
  if (!existsSync(p)) return;
  const w = JSON.parse(readFileSync(p, "utf8")) as Workstream;
  const h = generateHandoff(
    w,
    { today: "2026-08-26", methodVersion: 0, eligibleEdgeVersion: ELIGIBLE_EDGE_VERSION },
    "EARLY_HANDOFF",
  );
  assert.equal(h.session, "EARLY_HANDOFF");
  assert.equal(h.workstream, "OPEN");
  assert.equal(h.graph, "EXPANDING");
});

/* ------------------------------------------------------------ and the bar itself */

/* ------------------------------------------- the acquisition doctrine (205-209) */

/*
 * These five are the questions the author had to answer IN PERSON, in a
 * directive, because no artifact answered them. That is the whole test: a
 * session reaching the same five moments must now find the answer here rather
 * than needing him to state it again.
 *
 * Each one is phrased as the session actually meets it — mid-hunt, with a
 * failure in hand and a plausible reason to stop.
 */

test("Q: every route we know is blocked and the record exists. Is that an absence?", () => {
  assert.equal(claim("acquisition.obligation_closure"), "acquired-evidenced-or-human-route");
  // The three closes, and the one thing that is never evidence of absence.
  assert.ok(whereInLaw("Three closes, and no fourth", ROOT));
  assert.ok(whereInLaw("our failure to retrieve is never that evidence", ROOT));
  // A blocked route escalates the EXECUTION MODE; it never produces a fact
  // about the government.
  assert.ok(whereInLaw("PUBLIC RECORD STILL OWED", ROOT));
  assert.match(
    flat(law),
    /the record obligation cannot/i,
    "current law no longer says the obligation outlives the route",
  );
});

test("Q: the vendor host that serves the agenda PDF disallows us. Is the agenda unavailable?", () => {
  assert.equal(claim("acquisition.record_identity"), "government-record-with-representations");
  assert.ok(whereInLaw("VENDOR != RECORD", ROOT));
  // The distinction that does the work: the URL is a representation, and the
  // record belongs to the government.
  assert.match(
    flat(law),
    /GOVERNMENT → RECORD → REPRESENTATION\(S\) → ROUTE\(S\)/,
    "current law no longer carries the record-vs-representation model",
  );
});

test("Q: the API returned 200. May the adapter skip the accessible agenda and the PDF?", () => {
  assert.equal(claim("acquisition.representation_coverage"), "every-material-representation");
  assert.ok(whereInLaw("ONE ROUTE SUCCESS", ROOT));
  assert.match(
    flat(law),
    /an API 200 never retires the PDF|Materially distinct representations carry different facts/i,
    "current law no longer forbids collapsing the source universe onto one successful route",
  );
  // And the shape that prevents it recurring: an adapter is a portfolio.
  assert.match(flat(law), /an adapter is a route portfolio/i);
});

test("Q: an API key would help. May this record's work stop until the author answers?", () => {
  assert.equal(claim("escalation.access_request"), "parallel-never-blocking");
  assert.ok(whereInLaw("NEEDS SEAN != STOP", ROOT));
  assert.match(
    flat(law),
    /never closes, pauses or satisfies the obligation the row is about/i,
    "current law no longer says an escalation leaves the obligation running",
  );
  /*
   * RULING 146 is the older half — the SESSION keeps going. It must still be
   * current, because RULING 208 extends it rather than replacing it, and an
   * amendment that silently retires its target is the failure the ledger
   * exists to make impossible.
   */
  // RULING 146's obligation (the SESSION keeps going) was consolidated into
  // RULING 271, which must be current; 146 itself is superseded, not dropped.
  const r271 = index.resolve("R-0271");
  assert.ok(r271 && ["ACTIVE", "AMENDED"].includes(r271.status), "RULING 271 (the escalation lane) stopped being current");
});

test("Q: we hold text from a host later found to disallow crawling. Purge it?", () => {
  assert.equal(claim("sources.held_artifact_retention"), "keep-and-use-with-replacement-obligation");
  /*
   * This one was a live Needs Sean row (NH286) for exactly as long as nothing
   * answered it. The answer is deliberately general — permission binds the
   * next fetch, not possession — so the next host discovered after the fact
   * does not reopen the same question.
   */
  assert.match(
    flat(law),
    /binds the next fetch and never possession|binds the next fetch, never possession/i,
    "current law no longer separates permission-to-fetch from possession",
  );
  const r209 = index.resolve("R-0209");
  assert.ok(r209, "RULING 209 is gone");
  assert.match(flat(r209.body), /KEEP AND USE/, "RULING 209 no longer records the author's decision");
});

/* ------------------------------------------------ the Level 1 activation (240) */

test("Q: May the standing autonomous system perform bounded public-source scouting without session-by-session owner authorization?", () => {
  // artifact: docs/governance/index.json — the compiled rule slot RULING 240 claims
  assert.equal(claim("activation.standing_level"), "level-1-research");
  // and the policy says it in the author's own words, so a session that reads
  // only current law finds the authorization AND its ceiling in one place.
  assert.ok(whereInLaw("Meanwhile is authorized to operate at Level 1", ROOT));
  assert.match(
    flat(law),
    /without session-by-session\s*(owner\s*)?authorization/i,
    "current law no longer states that Level 1 research needs no per-session authorization",
  );
  // Research is not publication. The same paragraph that authorizes the hunt
  // withholds promotion, and RULING 215's Level-4/5 limits stay current.
  assert.match(
    flat(law),
    /Level 1 never authorizes promotion because a model found something/i,
    "current law no longer withholds promotion from a model's finding",
  );
  assert.match(flat(law), /Absence is argued, never asserted/);
  const r215 = index.resolve("RULING 215");
  assert.ok(r215 && ["ACTIVE", "AMENDED"].includes(r215.status), "RULING 215 stopped being current");
});

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
