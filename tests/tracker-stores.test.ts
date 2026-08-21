import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  CLOSING_RESOLUTIONS,
  COLUMNS,
  P1_CAP,
  PRIORITIES,
  RESOLUTIONS,
  RESOLVED_CSV,
  WORKING_CSV,
  auditSeanRows,
  isOpen,
  nextId,
  p1Census,
  planMoves,
  readSections,
  readStore,
  sectionOrder,
} from "../scripts/tracker-core.mjs";
import { buildWorkbook, readWorkbook, zip } from "../scripts/xlsx.mjs";

/**
 * **THE TRACKER'S GUARDS** (Prompt E items 5–9, 2026-08-20).
 *
 * The tracker is now a workflow rather than a list, and a workflow has rules
 * about who may move what. Rules that live only in a script are rules a later
 * session can edit out of the script; these are the assertions that make the
 * build fail instead.
 *
 * Every one of them is on the STORES as committed, not on a fixture, because a
 * fixture proves the code works on data nobody has and the stores are the data
 * everybody has.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const sections = readSections(ROOT);
const working = readStore(WORKING_CSV, ROOT);
const resolved = readStore(RESOLVED_CSV, ROOT);
const all = [...working, ...resolved];

/* ========================================================================== */
/* The shape of the two stores                                                */
/* ========================================================================== */

test("the two stores reconcile as a pair against the frozen tracker", () => {
  /*
   * `docs/tracker.csv` is the pre-rebuild snapshot, FROZEN. It is read for
   * history and never written again — pinned by digest, because "frozen" that
   * nothing checks is a comment. If a later session genuinely needs to change
   * it, changing this hash is the deliberate act that says so.
   */
  const frozen = readFileSync(join(ROOT, "docs/tracker.csv"));
  assert.equal(
    createHash("sha256").update(frozen).digest("hex"),
    "4cc995177d1324352e2c657d19f3e899511e18f1773f2f340763773549dd3c06",
    "docs/tracker.csv is the frozen pre-rebuild snapshot and is never written again",
  );

  assert.ok(working.length > 0 && resolved.length > 0, "both stores hold rows");
  const ids = all.map((r) => r.ID.trim());
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual(
    [...new Set(dupes)],
    [],
    "an id in both stores, or twice in one, breaks every lookup by id — the " +
      "exact corruption CLAUDE.md names",
  );
  assert.ok(
    ids.every((id) => id.length > 0),
    "every row carries an id; a blank one is a row nothing can refer to",
  );
});

test("RULING 32: every row has a home, and there is no holding section", () => {
  const slugs = new Set(sections.map((s) => s.slug));
  const homeless = all.filter((r) => !slugs.has((r.Section ?? "").trim()));
  assert.deepEqual(
    homeless.map((r) => `${r.ID} — "${r.Section}"`),
    [],
    "a row that fits nowhere is evidence the section list is incomplete, and " +
      "the answer is a named section — never a junk drawer",
  );
  for (const forbidden of ["misc", "other", "unsorted", "holding", "general"]) {
    assert.ok(
      !slugs.has(forbidden),
      `"${forbidden}" is a junk drawer and RULING 32 forbids one`,
    );
  }
});

test("RULING 31: Needs Sean is first, and the order comes from the list not from a number", () => {
  assert.equal(sections[0].slug, "needs-sean");
  assert.equal(sections[0].onlySeanResolves, true);

  /*
   * **THE IDENTIFIER SCHEME, ASSERTED** (item 5). A row carries a SLUG. Order
   * is this array's index, computed at render time. So inserting a new state's
   * hunt section renumbers nothing — there is no number on a row to renumber.
   *
   * The demonstration is run rather than described: a section is spliced into
   * the middle of the list and every row's section value is compared.
   */
  const rowsBefore = JSON.stringify(all.map((r) => r.Section));
  const orderBefore = sectionOrder(sections);

  const withNM = [
    ...sections.slice(0, 3),
    { slug: "nm-hunt", title: "New Mexico hunt", what: "Everything owed to a reader in New Mexico." },
    ...sections.slice(3),
  ];
  const orderAfter = sectionOrder(withNM);

  // The ORDER moved: Arizona was fourth and is now fifth.
  assert.equal(orderBefore.get("az-hunt"), 3);
  assert.equal(orderAfter.get("az-hunt"), 4);
  assert.equal(orderAfter.get("nm-hunt"), 3);
  // Everything before the insertion is untouched, in both directions.
  for (const slug of ["needs-sean", "nh-hunt", "nj-hunt"]) {
    assert.equal(orderBefore.get(slug), orderAfter.get(slug));
  }
  // And NOTHING a row carries changed, because a row carries a slug and the
  // slug of every section is what it was.
  assert.equal(
    JSON.stringify(all.map((r) => r.Section)),
    rowsBefore,
    "inserting a section renumbers nothing — there is no number on a row to renumber",
  );
  for (const s of withNM) {
    assert.ok(/^[a-z][a-z0-9-]*$/.test(s.slug), `${s.slug} is a slug, not a number`);
    assert.ok(all.every((r) => r.Section !== String(orderAfter.get(s.slug))));
  }
});

/* ========================================================================== */
/* Items 8a and 8b — a description and an attribution on every row            */
/* ========================================================================== */

test("item 8a: every row in both stores carries a plain-English description", () => {
  const missing = all.filter((r) => (r["What this is"] ?? "").trim().length < 20);
  assert.deepEqual(
    missing.map((r) => r.ID),
    [],
    "a row without a description is a defect, not an acceptable remainder",
  );
  // And it is not the title in longer words.
  const restatements = all.filter(
    (r) => (r["What this is"] ?? "").trim().toLowerCase() === (r.Title ?? "").trim().toLowerCase(),
  );
  assert.deepEqual(restatements.map((r) => r.ID), []);
});

test("RULING 40: every row names the session that opened it, and UNKNOWN is a defect", () => {
  const unattributed = all.filter((r) => (r["Opened by"] ?? "").trim() === "");
  assert.deepEqual(
    unattributed.map((r) => r.ID),
    [],
    "attribution is a lookup, not a guess — the commits are in the repository",
  );
  const unknown = all.filter((r) => /^unknown$/i.test((r["Opened by"] ?? "").trim()));
  assert.deepEqual(unknown.map((r) => r.ID), [], "UNKNOWN is a defect, not an ending");

  // A resolved row also names who closed it.
  const closedNameless = resolved.filter((r) => (r["Closed by"] ?? "").trim() === "");
  assert.deepEqual(
    closedNameless.map((r) => r.ID),
    [],
    "a finished row records which session finished it",
  );
});

/* ========================================================================== */
/* RULINGS 29, 30 and 36 — priority, the cap, and the three resolution states */
/* ========================================================================== */

test("RULING 29: three priority levels on every open row, and no fourth", () => {
  const bad = working.filter((r) => !PRIORITIES.includes((r.Priority ?? "").trim()));
  assert.deepEqual(
    bad.map((r) => `${r.ID} — "${r.Priority}"`),
    [],
    "P1, P2, P3. P0 belonged to a scale that marked three-quarters of the queue " +
      "top priority, which sorts nothing",
  );
});

test("RULING 36: three resolution states, and only these three", () => {
  const bad = all.filter((r) => {
    const v = (r.Resolution ?? "").trim();
    return v !== "" && !RESOLUTIONS.includes(v);
  });
  assert.deepEqual(bad.map((r) => `${r.ID} — "${r.Resolution}"`), []);

  // The working store holds only open rows; a closing resolution belongs in
  // the resolved store, which is the whole point of the queue model.
  const stragglers = working.filter((r) => CLOSING_RESOLUTIONS.includes((r.Resolution ?? "").trim()));
  assert.deepEqual(
    stragglers.map((r) => r.ID),
    [],
    "a resolved row leaves the working view — the number Sean looks at is what is left",
  );
  assert.ok(working.every(isOpen), "every row in the working store is open");

  // RULING 39: a resolved row is stamped.
  const undated = resolved.filter((r) => !/^\d{4}-\d{2}-\d{2}$/.test((r["Resolved on"] ?? "").trim()));
  assert.deepEqual(
    undated.map((r) => r.ID),
    [],
    "the move script writes the stamp; a formula can be overwritten and a " +
      "silently wrong stamp is worse than none",
  );

  // A conditional resolution without its condition is unreadable by the next
  // session, which RULING 38 makes responsible for satisfying it.
  const conditionless = resolved.filter(
    (r) => (r.Resolution ?? "").trim() === "Conditionally resolved" && !(r.Condition ?? "").trim(),
  );
  assert.deepEqual(conditionless.map((r) => r.ID), []);
});

test("RULING 30: a section over the five-P1 cap is REPORTED as stopped, never trimmed", () => {
  const census = p1Census(working, sections);
  const over = census.filter((c) => c.overCap);
  const md = readFileSync(join(ROOT, "docs/tracker.md"), "utf8");
  for (const c of over) {
    assert.ok(
      md.includes(`${c.title} — **${c.P1}**`) && md.includes("STOPPED"),
      `${c.title} holds ${c.P1} P1 rows and docs/tracker.md must say the section is stopped`,
    );
  }
  if (over.length === 0) {
    assert.ok(
      md.includes("No section is over the five-P1 cap."),
      "when nothing is over the cap the file says so, rather than saying nothing",
    );
  }
  assert.equal(P1_CAP, 5);
});

/* ========================================================================== */
/* RULING 37 — who may move a row                                             */
/* ========================================================================== */

test("RULING 37: a session may not resolve or move a Needs Sean row, in either direction", () => {
  const row = {
    ID: "TEST01",
    Section: "needs-sean",
    Title: "t",
    "What this is": "d",
    Resolution: "Resolved",
    Condition: "",
  };
  const asSession = planMoves({ working: [row], sections, actor: "session" });
  assert.equal(asSession.moves.length, 0, "the session moves nothing out of Needs Sean");
  assert.equal(asSession.refusals.length, 1);
  assert.match(asSession.refusals[0], /RULING 37/);
  assert.match(asSession.refusals[0], /TEST01/);

  // The same value in HIS handwriting does move.
  const asSean = planMoves({
    working: [row],
    sections,
    actor: "session",
    resolutionAuthor: { TEST01: "sean" },
  });
  assert.equal(asSean.moves.length, 1, "only Sean closes a Needs Sean row — and he can");
  assert.deepEqual(asSean.refusals, []);

  // Everywhere else a session closes its own work.
  const elsewhere = planMoves({
    working: [{ ...row, ID: "TEST02", Section: "repo-ops" }],
    sections,
    actor: "session",
  });
  assert.equal(elsewhere.moves.length, 1);
  assert.deepEqual(elsewhere.refusals, []);

  // A conditional resolution with no condition is refused wherever it sits.
  const conditionless = planMoves({
    working: [{ ...row, ID: "TEST03", Section: "repo-ops", Resolution: "Conditionally resolved" }],
    sections,
    actor: "session",
  });
  assert.equal(conditionless.moves.length, 0);
  assert.match(conditionless.refusals[0], /RULING 36/);
});

/* ========================================================================== */
/* RULING 41 — Sean authors rows, and a session never rewords one             */
/* ========================================================================== */

test("RULING 41: a session may not reword, retitle or delete a row Sean wrote", () => {
  const his = {
    ID: "SEAN01",
    Section: "visual-feedback",
    Title: "The map looks wrong on my phone",
    "What this is": "It looks wrong on my phone.",
    "Opened by": "Sean",
  };

  assert.deepEqual(auditSeanRows({ before: [his], after: [his] }), []);

  const reworded = auditSeanRows({
    before: [his],
    after: [{ ...his, "What this is": "Investigate mobile viewport regression." }],
  });
  assert.equal(reworded.length, 1);
  assert.match(reworded[0], /RULING 41/);
  assert.match(reworded[0], /What this is/);

  const retitled = auditSeanRows({ before: [his], after: [{ ...his, Title: "Mobile defect" }] });
  assert.equal(retitled.length, 1);
  assert.match(retitled[0], /Title/);

  const deleted = auditSeanRows({ before: [his], after: [] });
  assert.equal(deleted.length, 1);
  assert.match(deleted[0], /no longer in either store/);

  const stolen = auditSeanRows({ before: [his], after: [{ ...his, "Opened by": "Prompt F" }] });
  assert.ok(stolen.some((r) => /attribution to Sean was overwritten/.test(r)));

  // What a session MAY do: work the row, and set a priority if none is set.
  assert.deepEqual(
    auditSeanRows({
      before: [his],
      after: [{ ...his, Priority: "P2", Resolution: "Pending review" }],
    }),
    [],
  );

  // And the id it would be given is in the right format and free.
  const fresh = nextId("SEAN", all);
  assert.match(fresh, /^SEAN\d\d$/);
  assert.ok(!all.some((r) => r.ID === fresh));
});

/* ========================================================================== */
/* RULING 34 — the reader artifacts are generated, and hold no duplicate copy  */
/* ========================================================================== */

test("RULING 34: tracker.md and log.md declare themselves generated and list no resolved row", () => {
  const md = readFileSync(join(ROOT, "docs/tracker.md"), "utf8");
  const log = readFileSync(join(ROOT, "docs/log.md"), "utf8");
  for (const [name, text] of [
    ["docs/tracker.md", md],
    ["docs/log.md", log],
  ] as const) {
    assert.ok(text.includes("GENERATED FILE"), `${name} says it is generated`);
    assert.ok(text.includes("scripts/tracker.mjs"), `${name} names what wrote it`);
  }

  // Open rows only, and the count in the summary is the count of what follows.
  assert.ok(md.includes(`**${working.length} open**`), "the stated open count is the store's");
  for (const r of resolved.slice(0, 40)) {
    assert.ok(
      !md.includes(`**${r.ID}** —`),
      `${r.ID} is resolved and must not be listed in the working view`,
    );
  }

  // No engineering shorthand outside a row label.
  for (const banned of ["NOT_HUNTED", "VERIFIED_ABSENT", "NOT_APPLICABLE", "OCD-ID"]) {
    assert.ok(!md.includes(banned), `${banned} is internal vocabulary and never reaches this file`);
  }
});

/* ========================================================================== */
/* The workbook is readable back — and Excel's own encoding is handled         */
/* ========================================================================== */

test("the workbook round-trips, and a shared-string sheet reads as text", () => {
  const book = buildWorkbook(
    [
      {
        name: "Working",
        header: COLUMNS,
        rows: working.slice(0, 5).map((r) => COLUMNS.map((c) => r[c] ?? "")),
        widths: COLUMNS.map(() => 20),
      },
    ],
    "2026-08-20",
  );
  const [sheet] = readWorkbook(book);
  assert.equal(sheet.name, "Working");
  assert.deepEqual(sheet.rows[0], COLUMNS);
  assert.equal(sheet.rows.length, 6);
  assert.equal(sheet.rows[1][0], working[0].ID);
  assert.equal(sheet.rows[1][4], working[0]["What this is"]);

  /*
   * Excel does not write `inlineStr`. When Sean opens the workbook, edits one
   * cell and saves, every sheet comes back with a shared-string TABLE and cells
   * holding an index into it. A reader that understood only its own output
   * would read his saved file as empty and report his edits as deletions —
   * which, under a rule that nothing is ever deleted, refuses the whole run.
   * So the shape Excel writes is asserted here, hand-built, rather than hoped
   * for.
   */
  const shared =
    '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    "<si><t>ID</t></si><si><t>a note Sean typed</t></si></sst>";
  const excelSheet =
    '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row>' +
    '<row r="2"><c r="B2" t="s"><v>1</v></c></row></sheetData></worksheet>';
  const workbookXml =
    '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets><sheet name="Working" sheetId="1" r:id="rId1"/></sheets></workbook>';
  const rels =
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>';

  // Assembled through the same zip writer, because a reader proved against a
  // hand-made archive is a reader proved against nothing real.
  const excelBook = zip(
    [
      { name: "xl/workbook.xml", data: Buffer.from(workbookXml, "utf8") },
      { name: "xl/_rels/workbook.xml.rels", data: Buffer.from(rels, "utf8") },
      { name: "xl/sharedStrings.xml", data: Buffer.from(shared, "utf8") },
      { name: "xl/worksheets/sheet1.xml", data: Buffer.from(excelSheet, "utf8") },
    ],
    "2026-08-20",
  );
  const [excelRead] = readWorkbook(excelBook);
  assert.equal(excelRead.rows[0][0], "ID", "a shared-string cell reads as its text");
  assert.equal(
    excelRead.rows[1][1],
    "a note Sean typed",
    "a cell Excel wrote by index reads as what he typed, not as an empty cell",
  );
  assert.equal(
    excelRead.rows[1][0],
    "",
    "an omitted leading cell is filled in, so no column shifts left",
  );
});
