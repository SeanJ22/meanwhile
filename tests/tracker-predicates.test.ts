import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  CANNOT_TELL,
  HOLDS,
  NOT_MACHINE_VERIFIABLE,
  RESOLVED_BY_EVIDENCE,
  auditCoverage,
  evaluateEntry,
  resolvedByEvidence,
} from "../lib/tracker/predicates.mjs";
import { PREDICATES, REGISTRY } from "../lib/tracker/registry.mjs";
import { UNKNOWN, firstClaimByLedger, readOpenedLedger, resolveOpenedDate } from "../lib/tracker/opened-dates.mjs";
import { ageInDays, describeAge, reconcile } from "../lib/tracker/reconcile.mjs";
import { isOpen, readStore, planMoves, readSections, WORKING_CSV, RESOLVED_CSV } from "../scripts/tracker-core.mjs";

/**
 * **RULING 227's GUARDS.**
 *
 * The rule: a row may not enter NEEDS_SEAN without either a machine-verifiable
 * predicate that is rechecked on every tracker generation and auto-resolves the
 * row when false, or an explicit NOT_MACHINE_VERIFIABLE marking with a decision
 * card. Escalation without reconciliation is prohibited.
 *
 * These assertions run against the STORES AS COMMITTED, not against fixtures,
 * for the reason `tests/tracker-stores.test.ts` gives: a fixture proves the code
 * works on data nobody has.
 */

/**
 * The registry lives in `.mjs`, which tsconfig does not type-check, so TypeScript
 * infers its entries structurally and widens every `kind` to `string` — which
 * means the predicate/card union does not narrow here the way it does at the
 * call sites inside the module. This interface is the shape the ASSERTIONS
 * below actually read, declared once so each test can say what it means without
 * a cast at every property access.
 */
interface RegistryEntry {
  rowId: string;
  kind: string;
  blocker?: string;
  whatIsNeeded?: string;
  whyNoMachineCanDecide?: string;
  options?: { option: string; consequence: string }[];
}

const REG = REGISTRY as unknown as RegistryEntry[];

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const sections = readSections(ROOT);
const working = readStore(WORKING_CSV, ROOT);
const resolved = readStore(RESOLVED_CSV, ROOT);
const openRows = working.filter(isOpen);

/* ========================================================================== */
/* The invariant                                                              */
/* ========================================================================== */

test("RULING 227: every open Needs Sean row is predicated or explicitly NOT_MACHINE_VERIFIABLE", () => {
  const needsSeanIds = openRows
    .filter((r) => (r.Section ?? "").trim() === "needs-sean")
    .map((r) => (r.ID ?? "").trim());
  const coverage = auditCoverage({ needsSeanIds, registry: REG });

  assert.deepEqual(
    coverage.uncovered,
    [],
    "a Needs Sean row in neither arm of the registry escalated to the author with no " +
      "route back down, which is the whole thing RULING 227 prohibits",
  );
  assert.ok(needsSeanIds.length > 0, "there are Needs Sean rows to cover");
});

test("RULING 227: an orphaned registry entry names a row that is genuinely closed, never a typo", () => {
  /*
   * A registry entry whose row is not open is expected — it is what a
   * successful auto-resolution LEAVES BEHIND. What would be a defect is an
   * entry naming an id that exists nowhere at all, which is a typo silently
   * reducing coverage.
   */
  const everyId = new Set([...working, ...resolved].map((r) => (r.ID ?? "").trim()));
  const unknownIds = REG.map((e) => e.rowId).filter((id) => !everyId.has(id));
  assert.deepEqual(
    unknownIds,
    [],
    "a registry entry for an id in neither store silently covers nothing",
  );
});

test("RULING 227: every NOT_MACHINE_VERIFIABLE entry carries a complete decision card", () => {
  const cards = REG.filter((e) => e.kind === NOT_MACHINE_VERIFIABLE);
  assert.ok(cards.length > 0, "there are carded rows");

  const defects: string[] = [];
  for (const c of cards) {
    if (!(c.whatIsNeeded ?? "").trim()) defects.push(`${c.rowId}: no "what is needed"`);
    if (!(c.whyNoMachineCanDecide ?? "").trim()) {
      defects.push(`${c.rowId}: does not say why no machine can decide it`);
    }
    if (!Array.isArray(c.options) || c.options.length < 2) {
      defects.push(`${c.rowId}: fewer than two options — that is a question, not a decision`);
    }
    for (const o of c.options ?? []) {
      if (!(o.option ?? "").trim()) defects.push(`${c.rowId}: an unnamed option`);
      if (!(o.consequence ?? "").trim()) {
        defects.push(
          `${c.rowId}: option "${o.option}" states no consequence. A decision presented ` +
            "without its consequences is a question.",
        );
      }
    }
  }
  assert.deepEqual(defects, [], defects.join("\n"));
});

/* ========================================================================== */
/* The three proof cases                                                      */
/* ========================================================================== */

test("RULING 227: every predicate still reads its evidence and answers RESOLVED_BY_EVIDENCE", () => {
  /*
   * NH272, NH281 and NH300 are the rows the mechanism was built from, and all
   * three are now in the resolved store. This is the assertion that keeps them
   * honest: if the artifact each predicate reasons from is ever moved, renamed
   * or emptied, this goes red rather than the closes quietly becoming
   * unfounded.
   *
   * **OWN03 joined them on 2026-09-01 and it is a different KIND of predicate**,
   * which is why the count moved rather than the test being left at three. The
   * other three read an operational artifact — a deploy observation, a proof
   * record. This one reads the AUTHOR'S OWN DECISION out of
   * `data/photos/review.json`. It cannot decide for him and does not try; it
   * observes that he decided, which is the fact the row was blocked on. If any
   * of the nine ever stops carrying his approval against that exact image, this
   * goes red and the row goes back in front of him.
   *
   * **NS12 joined on 2026-09-01, and it joined by being CAUGHT.** It was
   * carded — `NOT_MACHINE_VERIFIABLE`, which HOLDS by construction because the
   * machine never asks again — while its blocker was "no Netlify credential
   * exists on this machine", which a machine can decide perfectly well. The
   * credential arrived, `pnpm deploy:live` started answering in full, and the
   * queue went on presenting the wall as current for days. That is precisely
   * the failure RULING 227 was adopted over, surviving inside the mechanism
   * built to prevent it: the card route is the OTHER HALF of the rule, not an
   * alternative to it, and a blocker a machine can decide does not get to take
   * the human route.
   */
  /*
   * **NH305 joined on 2026-09-01 as the first predicate over a row that is
   * still OPEN.** The runner's relaunch trigger needs an elevated install the
   * machine cannot perform; the predicate reads the proof record the elevated
   * `prove-relaunch` writes, and until then it HOLDS by name. That is the
   * other half of RULING 227 working as written — a blocker a machine can
   * check is re-checked on every generation and the row moves the moment the
   * proof lands. So an OPEN predicated row must NOT answer RESOLVED_BY_EVIDENCE
   * here (if it did, the row should already have moved), and a RESOLVED one
   * must still read its evidence and answer RESOLVED_BY_EVIDENCE.
   */
  /* NH306 (2026-09-02) is the second OPEN predicated row: two credentials await rotation. */
  /*
   * **NH305 RESOLVED on 2026-09-02 by its own predicate** — the owner ran the
   * elevated install, prove-relaunch measured a relaunch in 274 s, and the
   * committed proof moved the row. It now sits with the resolved set and must
   * keep reading its evidence. **NH310 joined the same day as the third OPEN
   * predicated row:** the Google client variables are absent from the
   * provider (read back by name), and the predicate reads the login readback's
   * `googleConfigured` field — CANNOT_TELL while the readback predates the
   * field, HOLDS while it names the missing variables, RESOLVED when the
   * deployed host reports the client configured.
   */
  // WF01 now reads the owner's explicit, scoped approval receipt, like OWN03.
  assert.equal(PREDICATES.length, 9);
  assert.equal(PREDICATES.filter(p => p.rowId === "WF01").length, 1);
  const openIds = new Set(openRows.map((r) => String(r.ID ?? "").trim()));
  for (const p of PREDICATES as unknown as RegistryEntry[]) {
    const outcome = evaluateEntry(p, { root: ROOT });
    assert.ok(outcome.read.length > 0, `${p.rowId} must name what it read`);
    if (openIds.has(p.rowId)) {
      assert.notEqual(
        outcome.verdict,
        RESOLVED_BY_EVIDENCE,
        `${p.rowId} is OPEN and its predicate answers RESOLVED_BY_EVIDENCE — the row should have moved: ${outcome.why}`,
      );
      assert.ok(outcome.why.trim().length > 0, `${p.rowId} must say why it still holds`);
      continue;
    }
    assert.equal(
      outcome.verdict,
      RESOLVED_BY_EVIDENCE,
      `${p.rowId} no longer reads as resolved: ${outcome.why}`,
    );
    assert.ok(
      outcome.evidence.length >= 3,
      `${p.rowId} must cite its evidence, not merely assert a verdict`,
    );
  }
});

/*
 * **THE SECOND COPY OF A RULE, PAID FOR.**
 *
 * OWN03's predicate inlines the person-key normalisation from
 * `lib/photos/person.ts` because `lib/tracker/registry.mjs` is loaded by
 * `node scripts/tracker.mjs` with no build step and must not depend on type
 * stripping to reach a `.ts`. RULING 103 says once and only once, so a second
 * copy needs a reason AND a guard, and this is the guard.
 *
 * It is not theoretical. The first version of that inline copy lost its regex
 * escapes in transit — `\\s+` became `s+`, which collapses no whitespace at
 * all — and `Dale G. Caldwell` keyed to a double-spaced string that matched
 * nothing. The predicate then reported six of nine portraits unapproved on the
 * day the author approved all nine: a false blocker, put back in front of him
 * by the very mechanism written to take blockers away.
 */
test("OWN03: the inlined person key agrees with lib/photos/person.ts on every queued subject", async () => {
  const { personKey } = await import("../lib/photos/person.ts");

  /* The same normalisation the predicate performs, read out of the module it
     actually runs, so this cannot pass against a copy of the copy. */
  const source = readFileSync(join(ROOT, "lib/tracker/registry.mjs"), "utf8");
  const inlined = source.slice(
    source.indexOf("    const key = (name) =>"),
    source.indexOf("    const entityDecoded = (url) =>"),
  );
  assert.ok(inlined.includes("const key"), "the inlined key was not found in registry.mjs");
  assert.ok(
    !inlined.includes("\u0008"),
    "the inlined key contains a literal backspace — a regex escape was lost in transit",
  );

  /* eslint-disable-next-line no-new-func -- the point is to run REGISTRY's own text */
  const keyFn = new Function(`return ${inlined.slice(inlined.indexOf("(name) =>")).replace(/;\s*$/, "")}`)() as (
    n: string,
  ) => string;

  const recordPath = join(ROOT, "data/photos/door2-statewide-executives-2026-08-28.json");
  const record = JSON.parse(readFileSync(recordPath, "utf8")) as {
    rows: { subject?: string }[];
  };
  const subjects = record.rows.map((r) => (r.subject ?? "").trim()).filter(Boolean);
  assert.ok(subjects.length > 0, "no subjects to compare the two normalisations over");

  const drift = subjects
    .map((s) => ({ s, mine: keyFn(s), theirs: personKey(s) }))
    .filter((d) => d.mine !== d.theirs)
    .map((d) => `${d.s}: registry says "${d.mine}", person.ts says "${d.theirs}"`);

  assert.deepEqual(
    drift,
    [],
    "the tracker registry and the photo index disagree about who a person is, so an approval he made would read as an approval he did not make",
  );
});
test("RULING 227: the three rows are closed, and each carries its evidence in the resolved store", () => {
  for (const id of ["NH272", "NH281", "NH300"]) {
    const row = resolved.find((r) => (r.ID ?? "").trim() === id);
    assert.ok(row, `${id} is in the resolved store`);
    assert.equal((row as Record<string, string>).Resolution, "Resolved");
    const record = (row as Record<string, string>)["Session record"] ?? "";
    assert.match(record, /AUTO-RESOLVED under RULING 227/, `${id} records the authority for its close`);
    assert.match(record, /EVIDENCE:/, `${id} records the evidence that earned the close`);
    assert.match(
      record,
      /RULING 208/,
      `${id} must state that the obligation it concerned is NOT closed by the row closing`,
    );
  }
});

/*
 * **THE RECHECK RUNS EVERY GENERATION; THE APPEND HAPPENS ONCE.**
 *
 * Found 2026-09-01. An auto-resolved row STAYS IN THE WORKING STORE until
 * `pnpm tracker:move` carries it across, so every generation in between found
 * the same row, re-evaluated the same predicate to the same
 * RESOLVED_BY_EVIDENCE, and appended the same evidence paragraph again.
 *
 * It reached the resolved store: `NH272`, `NH281` and `NH300` each carried
 * their RULING 227 paragraph TWICE, verbatim. The verdict was right every
 * time; the append had no memory.
 *
 * The paragraph is the AUTHOR'S CARD, and a card that repeats itself is a card
 * that gets skimmed. These two tests hold both halves: the recheck still runs
 * (Last verified moves), and the record does not grow.
 */
test("RULING 227: a second generation over an already auto-resolved row appends nothing", () => {
  const registry = [
    {
      rowId: "TEST_APPEND_ONCE",
      kind: "predicate",
      blocker: "a blocker that has since cleared",
      evaluate: () => resolvedByEvidence("it cleared.", { evidence: ["an artifact says so"] }),
    },
  ];
  const row: Record<string, string> = {
    ID: "TEST_APPEND_ONCE",
    Section: "needs-sean",
    Resolution: "",
    "Session record": "",
    "Last verified": "",
  };

  const first = reconcile({
    working: [row],
    registry,
    stamp: "2026-09-01",
    sessionLabel: "first-generation",
    root: ROOT,
  });
  assert.equal(first.autoResolved.length, 1, "the first generation resolves it");
  const afterFirst = row["Session record"];
  assert.match(afterFirst, /AUTO-RESOLVED under RULING 227/);

  const second = reconcile({
    working: [row],
    registry,
    stamp: "2026-09-02",
    sessionLabel: "second-generation",
    root: ROOT,
  });
  assert.equal(second.autoResolved.length, 0, "the second generation resolves nothing new");
  assert.equal(row["Session record"], afterFirst, "and it appends nothing to the record");
  assert.equal(
    row["Closed by"],
    "first-generation (RULING 227 auto-reconciliation)",
    "the close keeps the generation that actually earned it",
  );
  assert.equal(row["Resolved on"], "2026-09-01", "and the day it was actually earned");
});

test("RULING 227: the recheck still RUNS on an already-resolved row — only the append is suppressed", () => {
  /*
   * The cheap fix would have been to skip the whole entry once a row is
   * resolved. That would stop the duplication and also stop the RECHECK, which
   * is the mechanism RULING 227 exists to install. `Last verified` moving on
   * the second generation is what proves the predicate was actually run again.
   */
  const registry = [
    {
      rowId: "TEST_STILL_RECHECKED",
      kind: "predicate",
      blocker: "a blocker that has since cleared",
      evaluate: () => resolvedByEvidence("it cleared.", { evidence: ["an artifact says so"] }),
    },
  ];
  const row: Record<string, string> = {
    ID: "TEST_STILL_RECHECKED",
    Section: "needs-sean",
    Resolution: "Resolved",
    "Session record": "closed by the author himself, in his own words",
    "Last verified": "",
  };

  reconcile({
    working: [row],
    registry,
    stamp: "2026-09-02",
    sessionLabel: "later-generation",
    root: ROOT,
  });

  assert.equal(
    row["Last verified"],
    `2026-09-02 · ${RESOLVED_BY_EVIDENCE}`,
    "the predicate was re-evaluated and its verdict recorded",
  );
  assert.equal(
    row["Session record"],
    "closed by the author himself, in his own words",
    "and a predicate never overwrites or extends an author's own close (RULING 37)",
  );
});

/*
 * And the same defect, asserted where it actually landed: the committed store.
 * A generator fix is not finished until its output is regenerated and diffed
 * (RULING 102), so the three repaired rows are held here by count.
 */
test("RULING 227: no row in either store carries its evidence paragraph more than once", () => {
  const marker = "AUTO-RESOLVED under RULING 227";
  for (const [label, store] of [
    ["working", working],
    ["resolved", resolved],
  ] as const) {
    for (const row of store) {
      const record = (row as Record<string, string>)["Session record"] ?? "";
      const occurrences = record.split(marker).length - 1;
      assert.ok(
        occurrences <= 1,
        `${label} store row ${(row as Record<string, string>).ID} repeats its RULING 227 card ${occurrences} times`,
      );
    }
  }
});

test("a predicate that cannot reach its evidence returns CANNOT_TELL, and CANNOT_TELL is not a resolution", () => {
  /*
   * The failure this refuses: a predicate whose artifact has been renamed
   * quietly answering "not blocked any more" and closing a live blocker. An
   * unreadable file is not evidence in either direction.
   */
  const outcome = evaluateEntry(
    {
      rowId: "TEST_MISSING_ARTIFACT",
      kind: "predicate",
      evaluate: () => {
        throw new Error("artifact gone");
      },
    },
    { root: ROOT },
  );
  assert.equal(outcome.verdict, CANNOT_TELL);
  assert.notEqual(outcome.verdict, RESOLVED_BY_EVIDENCE);
});

test("a NOT_MACHINE_VERIFIABLE entry HOLDS by construction and is never evaluated", () => {
  const outcome = evaluateEntry(
    {
      rowId: "TEST_CARD",
      kind: NOT_MACHINE_VERIFIABLE,
    },
    { root: ROOT },
  );
  assert.equal(outcome.verdict, HOLDS);
});

/* ========================================================================== */
/* RULING 37 is not weakened                                                  */
/* ========================================================================== */

test("RULING 227 does not open a general door: a plain session still cannot close a Needs Sean row", () => {
  const row = {
    ID: "TEST01",
    Section: "needs-sean",
    Title: "t",
    "What this is": "d",
    Resolution: "Resolved",
    Condition: "",
  };
  const asSession = planMoves({ working: [row], sections, actor: "session" });
  assert.equal(asSession.moves.length, 0, "RULING 37 still refuses a session");
  assert.match(asSession.refusals[0], /RULING 37/);

  const asPredicate = planMoves({
    working: [row],
    sections,
    actor: "session",
    resolutionAuthor: { TEST01: "predicate" },
  });
  assert.equal(
    asPredicate.moves.length,
    1,
    "and RULING 227's predicate author does move a row whose blocker has gone false",
  );
});

/* ========================================================================== */
/* Opened on — derived, and UNKNOWN rather than guessed                       */
/* ========================================================================== */

test("every row in both stores carries an Opened on, and it is a date or UNKNOWN — never blank", () => {
  const bad = [...working, ...resolved].filter((r) => {
    const v = (r["Opened on"] ?? "").trim();
    return v !== UNKNOWN && !/^\d{4}-\d{2}-\d{2}$/.test(v);
  });
  assert.deepEqual(
    bad.map((r) => `${r.ID} — "${r["Opened on"]}"`),
    [],
    "a blank date is indistinguishable from an unrecoverable one, and they are " +
      "different facts",
  );
});

test("Opened on is DERIVED: every value matches what the opened ledger says, independently recomputed", () => {
  /*
   * This is the immutability guard. The column is a projection, so the way to
   * prove it cannot be hand-edited is to recompute it from the ledger and
   * assert the file agrees — a hand edit shows up here as a disagreement.
   */
  const claims = firstClaimByLedger(readOpenedLedger(ROOT));
  const drifted: string[] = [];
  for (const r of [...working, ...resolved]) {
    const id = (r.ID ?? "").trim();
    const expected = resolveOpenedDate(id, claims).date;
    if ((r["Opened on"] ?? "").trim() !== expected) {
      drifted.push(`${id}: store says "${r["Opened on"]}", the ledger derives "${expected}"`);
    }
  }
  assert.deepEqual(drifted, [], drifted.slice(0, 10).join("\n"));
});

test("an UNKNOWN opened date is never silently turned into a real one, and never sorts as new", () => {
  assert.equal(ageInDays(UNKNOWN, "2026-08-31"), null, "UNKNOWN has no age");
  assert.equal(ageInDays("", "2026-08-31"), null, "a blank has no age");
  assert.match(describeAge(UNKNOWN, "2026-08-31"), /age unknown/);
  // A real date still measures.
  assert.equal(ageInDays("2026-08-11", "2026-08-31"), 20);
  assert.equal(describeAge("2026-08-31", "2026-08-31"), "opened today");
});

test("the opened-date resolver refuses to invent a date from a session label that carries none", () => {
  const claims = new Map([
    ["A", { session: "Prompt B", opened: "reconstructed-2026-08-21", reconstructed: true }],
    ["B", { session: "2026-08-11 · something", opened: "reconstructed-2026-08-21", reconstructed: true }],
    ["C", { session: "nh-hunt5", opened: "2026-08-21" }],
  ]);
  assert.equal(resolveOpenedDate("A", claims).date, UNKNOWN, "no date in the label means UNKNOWN");
  assert.equal(resolveOpenedDate("A", claims).source, "unrecoverable");
  assert.equal(resolveOpenedDate("B", claims).date, "2026-08-11", "a dated label is recoverable");
  assert.equal(resolveOpenedDate("C", claims).date, "2026-08-21", "a stamped ledger entry wins");
  assert.equal(resolveOpenedDate("ZZZ", claims).date, UNKNOWN, "an unclaimed id is UNKNOWN");
});

/* ========================================================================== */
/* The owner view                                                             */
/* ========================================================================== */

test("the owner view is generated, declares itself so, and carries a date and a verification state on every row", () => {
  const path = join(ROOT, "docs/tracker-owner-view.md");
  assert.ok(existsSync(path), "docs/tracker-owner-view.md is generated by pnpm tracker:views");
  const md = readFileSync(path, "utf8");

  assert.match(md, /GENERATED FILE — do not hand-edit/);
  assert.match(md, /RULING 227/);

  /*
   * Every decision heading is followed by an italic line carrying the row's
   * opened date and its verification state. Asserting the SHAPE rather than the
   * text is what keeps this from becoming a copy of the generator.
   */
  const headings = md.match(/^#### [A-Z]+\d+ — /gm) ?? [];
  assert.ok(headings.length > 0, "the view lists decisions");
  const meta = md.match(/^\*Opened .+·.+\*$/gm) ?? [];
  assert.equal(
    meta.length,
    headings.length,
    "every decision row carries its opened date and verification state",
  );
});

test("the owner view lists no row that is already resolved", () => {
  const md = readFileSync(join(ROOT, "docs/tracker-owner-view.md"), "utf8");
  const listed = new Set((md.match(/^#### ([A-Z]+\d+) — /gm) ?? []).map((h) => h.replace(/^#### /, "").replace(/ — $/, "")));
  const closedIds = new Set(resolved.map((r) => (r.ID ?? "").trim()));
  const wrong = [...listed].filter((id) => closedIds.has(id));
  assert.deepEqual(wrong, [], "a resolved row presented as a decision is the exact defect this view was built to end");
});

test("a decision card naming subjects for approval names ONLY subjects the record actually queued", () => {
  /*
   * **THE OWN03 DEFECT, GUARDED.**
   *
   * OWN03 asked the author to approve nine statewide portraits and named three
   * of them: "Mayes, Fontes and Horne among them". The COUNT was right — nine
   * were queued — and that is exactly what hid the error, because there is
   * nothing wrong with the arithmetic. Tom Horne was not among them. His decode
   * reads `ok: false, reason: NOT_AN_IMAGE`: the fetch returned a Cloudflare
   * challenge page, 5,796 bytes beginning `<!DOCTYPE html>`, so his image was
   * never read and approving it was never a thing anybody could do.
   *
   * A row that names a person the machine never obtained is a row that asks for
   * a decision that does not exist. This asserts the card against the
   * acquisition record itself rather than against the sentence, which is the
   * only direction in which the check means anything.
   */
  const recordPath = join(ROOT, "data/photos/door2-statewide-executives-2026-08-28.json");
  if (!existsSync(recordPath)) return; // the record is the subject; without it there is nothing to check

  const record = JSON.parse(readFileSync(recordPath, "utf8"));
  const rows: { subject?: string; portrait?: unknown; decode?: { ok?: boolean } }[] = record.rows ?? [];
  /*
   * QUEUED is not a field — it is a conjunction, and getting it wrong is how
   * the original error survived. A row carries `portrait` when a name-matched
   * image was FOUND on the page, and a top-level `decode` when those bytes were
   * READ. Ten rows carry a portrait; nine of them decoded. Horne is the row
   * where "we found an image for this person" and "we obtained an image of this
   * person" come apart, and only the second one is a thing anybody can approve.
   */
  const isQueued = (r: (typeof rows)[number]) => r.portrait != null && r.decode?.ok === true;
  const queued = rows.filter(isQueued).map((r) => (r.subject ?? "").trim());
  const notQueued = rows.filter((r) => !isQueued(r)).map((r) => (r.subject ?? "").trim());

  assert.equal(
    queued.length,
    record.totals.portraitsQueued,
    "the queued rows equal the stated queued total",
  );

  const own03 = REG.find((e) => e.rowId === "OWN03");
  assert.ok(own03, "OWN03 carries a card");
  const cardText = `${own03.whatIsNeeded ?? ""}`;

  /*
   * Any name the record explicitly did NOT queue must not appear as one of the
   * subjects the card asks him to approve. Surnames are used because that is
   * how the row referred to them.
   */
  const wronglyOffered = notQueued
    .map((full) => full.split(/\s+/).at(-1) ?? "")
    .filter((surname) => surname.length > 2)
    .filter((surname) => new RegExp(`\\b${surname}\\b`).test(cardText));

  assert.deepEqual(
    wronglyOffered,
    [],
    `OWN03's card offers for approval a subject the acquisition record did not queue: ` +
      `${wronglyOffered.join(", ")}. Approving an image the system never read is not a ` +
      "decision. Correct the card; do not close the row.",
  );

  /*
   * The completeness half — every queued subject NAMED — applies to a CARD,
   * where the author is being asked to decide about specific people and an
   * omitted name is somebody he never got to rule on. A PREDICATE names a
   * population and derives its members from the acquisition record, so there is
   * no list to be incomplete; requiring one would force a second copy of the
   * population into the row's text, which is exactly how "Mayes, Fontes and
   * Horne among them" came to be wrong in the first place.
   */
  if (own03.kind === NOT_MACHINE_VERIFIABLE) {
    const missing = queued
      .map((full) => full.split(/\s+/).at(-1) ?? "")
      .filter((surname) => !new RegExp(`\\b${surname}\\b`).test(cardText));
    assert.deepEqual(missing, [], `OWN03's card omits queued subject(s): ${missing.join(", ")}`);
  }
});

test("the reconciliation record is written and reconciles with the registry", () => {
  const path = join(ROOT, "docs/tracker-reconciliation.json");
  assert.ok(existsSync(path));
  const rec = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(rec.ruling, "RULING 227");
  assert.deepEqual(rec.coverage.uncovered, [], "the recorded coverage agrees with the live audit");
  assert.equal(
    rec.summary.predicates + rec.summary.notMachineVerifiable,
    rec.outcomes.length,
    "the stated counts equal the rows underneath them",
  );
});
