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
} from "../lib/tracker/predicates.mjs";
import { PREDICATES, REGISTRY } from "../lib/tracker/registry.mjs";
import { UNKNOWN, firstClaimByLedger, readOpenedLedger, resolveOpenedDate } from "../lib/tracker/opened-dates.mjs";
import { ageInDays, describeAge } from "../lib/tracker/reconcile.mjs";
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

test("RULING 227: each of the three proof-case predicates still reads its evidence and answers RESOLVED_BY_EVIDENCE", () => {
  /*
   * NH272, NH281 and NH300 are the rows the mechanism was built from, and all
   * three are now in the resolved store. This is the assertion that keeps them
   * honest: if the artifact each predicate reasons from is ever moved, renamed
   * or emptied, this goes red rather than the closes quietly becoming
   * unfounded.
   *
   * It also proves the mechanism itself works, which nothing else can now do —
   * the three rows are closed, so the live generation has no predicated open
   * row left to exercise.
   */
  assert.equal(PREDICATES.length, 3);
  for (const p of PREDICATES as unknown as RegistryEntry[]) {
    const outcome = evaluateEntry(p, { root: ROOT });
    assert.equal(
      outcome.verdict,
      RESOLVED_BY_EVIDENCE,
      `${p.rowId} no longer reads as resolved: ${outcome.why}`,
    );
    assert.ok(
      outcome.evidence.length >= 3,
      `${p.rowId} must cite its evidence, not merely assert a verdict`,
    );
    assert.ok(outcome.read.length > 0, `${p.rowId} must name what it read`);
  }
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

  // And the nine that ARE queued are all named, so the card is complete as well as correct.
  const missing = queued
    .map((full) => full.split(/\s+/).at(-1) ?? "")
    .filter((surname) => !new RegExp(`\\b${surname}\\b`).test(cardText));
  assert.deepEqual(missing, [], `OWN03's card omits queued subject(s): ${missing.join(", ")}`);
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
