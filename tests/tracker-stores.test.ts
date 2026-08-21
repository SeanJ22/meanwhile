import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  CLOSING_RESOLUTIONS,
  COLUMNS,
  DELETE_RESOLUTION,
  P1_CAP,
  PRIORITIES,
  RESOLUTIONS,
  RESOLVED_CSV,
  WORKING_CSV,
  auditSeanRows,
  isOpen,
  nextId,
  p1Census,
  planDeletions,
  planMoves,
  readSections,
  readStore,
  sectionOrder,
} from "../scripts/tracker-core.mjs";
import { buildWorkbook, readWorkbook, zip } from "../scripts/xlsx.mjs";
import { revertsProtectedFile } from "../scripts/guard-protected-files.mjs";

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

test("the stated open count equals the rows underneath it, section by section", () => {
  /*
   * **STATED N EQUALS RENDERED ROWS**, applied to the tracker's own summary.
   *
   * Caught 2026-08-20 on the workbook's first real contact with the author. He
   * marked two rows `Pending review`; `isOpen` was written as "carries no
   * resolution", so both rows stayed in the working store, kept rendering in
   * their section, and vanished from every count. `docs/tracker.md` stated
   * **140 open** above sections summing to **138**, and both lost rows were P1,
   * which took Needs Sean from three P1 rows to zero without anything
   * happening.
   *
   * A summary that can disagree with its own page is not a summary; it is a
   * second opinion presented as arithmetic. So the two are asserted to
   * reconcile, against the committed stores, rather than being computed twice
   * and hoped about.
   */
  const census = p1Census(working, sections);
  const summed = census.reduce((n, c) => n + c.open, 0);
  assert.equal(
    summed,
    working.length,
    `the per-section census counts ${summed} open row(s) and the working store ` +
      `holds ${working.length} — every row in the store renders in a section, so ` +
      "a row the census cannot see is a row the reader can see and the summary cannot",
  );

  // And the file says the same number the store holds.
  const md = readFileSync(join(ROOT, "docs/tracker.md"), "utf8");
  assert.ok(
    md.includes(`**${working.length} open**`),
    `docs/tracker.md states an open count other than ${working.length}`,
  );
  for (const c of census) {
    assert.ok(
      md.includes(`**${c.open} open · ${
        resolved.filter((r) => (r.Section ?? "") === c.slug).length
      } resolved.**`),
      `${c.title}'s stated counts are not the ones the stores hold`,
    );
    assert.equal(
      c.P1 + c.P2 + c.P3,
      c.open,
      `${c.title} holds ${c.open} open row(s) and ${c.P1 + c.P2 + c.P3} prioritised — ` +
        "an open row with no priority is a row that sorts nowhere",
    );
  }
});

test("RULING 36: Pending review does NOT close a row", () => {
  /*
   * It means "needs a look before it can close" — the looking has not happened,
   * so nothing has finished and the row belongs in the working store, counted.
   * Only Resolved and Conditionally resolved move a row out.
   */
  assert.equal(isOpen({ Resolution: "Pending review" }), true);
  assert.equal(isOpen({ Resolution: "" }), true);
  assert.equal(isOpen({}), true);
  assert.equal(isOpen({ Resolution: "Resolved" }), false);
  assert.equal(isOpen({ Resolution: "Conditionally resolved" }), false);
  assert.deepEqual(CLOSING_RESOLUTIONS, ["Resolved", "Conditionally resolved"]);
  assert.ok(RESOLUTIONS.includes("Pending review"));
});

/* ========================================================================== */
/* RULING 46 — Delete is his state, and a session may never set it            */
/* ========================================================================== */

test("RULING 46: a session may not delete a row, and Sean may", () => {
  const row = (over: Record<string, string>) => ({
    ...Object.fromEntries(COLUMNS.map((c) => [c, ""])),
    ...over,
  });

  // A session marking a row Delete, with nothing in his handwriting behind it.
  const sessionAttempt = planDeletions({
    rows: [row({ ID: "Z01", Section: "repo-ops", Resolution: DELETE_RESOLUTION })],
    actor: "session",
  });
  assert.equal(sessionAttempt.deletions.length, 0);
  assert.match(sessionAttempt.refusals[0] ?? "", /RULING 46/);

  // A session naming an id on the command line, with nothing behind it either.
  const flagAttempt = planDeletions({
    rows: [row({ ID: "Z02", Section: "repo-ops" })],
    requested: ["Z02"],
    actor: "session",
  });
  assert.equal(flagAttempt.deletions.length, 0);
  assert.match(flagAttempt.refusals[0] ?? "", /RULING 46/);

  // The same resolution, read out of the workbook, is in HIS handwriting.
  const his = planDeletions({
    rows: [row({ ID: "Z03", Section: "needs-sean", Resolution: DELETE_RESOLUTION })],
    resolutionAuthor: { Z03: "sean" },
    actor: "session",
  });
  assert.equal(his.deletions.length, 1);
  assert.deepEqual(his.refusals, []);

  // And his instruction in the Notes column he owns is the second route — the
  // one `B08` came through, because he wrote it on a row already resolved.
  const noted = planDeletions({
    rows: [
      row({
        ID: "Z04",
        Section: "needs-sean",
        Resolution: "Resolved",
        Notes: "This has absolutely nothing to do with this project at all.  Delete this entirely",
      }),
    ],
    requested: ["Z04"],
    actor: "session",
  });
  assert.equal(noted.deletions.length, 1);
  assert.match(noted.deletions[0].evidence, /his note/);
});

test("RULING 46: B08 is hard-removed from both stores and recorded in the log", () => {
  assert.deepEqual(
    all.filter((r) => (r.ID ?? "").trim() === "B08").map((r) => r.Section),
    [],
    "B08 is still in a store — Sean instructed its deletion explicitly",
  );

  const record = JSON.parse(
    readFileSync(join(ROOT, "docs", "tracker-deletions.json"), "utf8"),
  ) as { deletions: { id: string; deletedOn: string; deletedBy: string }[] };
  const b08 = record.deletions.find((d) => d.id === "B08");
  assert.ok(b08, "the permanent record of the deletion is missing");
  assert.match(b08!.deletedOn, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(b08!.deletedBy, "Sean");

  // RULING 46 asks for the deletion to be recorded in docs/log.md, and log.md
  // is generated FROM the stores — so the record has to be rendered into it
  // from outside, or a deleted row disappears without a trace.
  const log = readFileSync(join(ROOT, "docs", "log.md"), "utf8");
  assert.match(log, /## Deleted rows — RULING 46/);
  assert.match(log, /\*\*B08\*\*/);
  assert.match(log, /deleted \d{4}-\d{2}-\d{2} by Sean/);
});

test("RULING 46: no row in either store is left carrying Delete", () => {
  // A row that still says Delete is a deletion the script did not execute,
  // which would read as done and not be.
  assert.deepEqual(
    all
      .filter((r) => (r.Resolution ?? "").trim() === DELETE_RESOLUTION)
      .map((r) => r.ID),
    [],
  );
});

/* ========================================================================== */
/* RULING 48 — no session reverts his files with git                          */
/* ========================================================================== */

/**
 * The guard is a PreToolUse hook, because git has no hook that fires on
 * `git checkout -- <path>`. This asserts three things the hook alone cannot:
 * that the predicate catches the exact command that destroyed his edits, that
 * it does NOT catch the ordinary branch checkouts a session lives on, and that
 * the hook is actually wired into `.claude/settings.json` — a guard script
 * nothing calls is not a guard.
 *
 * **What it cannot cover, stated rather than implied.** The hook sees this
 * harness's shell tools. A committed script shelling out to git is covered by
 * the sweep below; a human with a git GUI, an IDE's "discard changes", or a
 * different agent runtime is covered by nothing, and nothing should pretend
 * otherwise.
 */
test("RULING 48: the guard catches the command that destroyed his edits", () => {
  const destructive = [
    "git checkout docs/tracker-working.csv docs/tracker-resolved.csv",
    "git checkout -- docs/tracker.csv",
    "git restore docs/state.md",
    "git restore --source=HEAD --staged --worktree docs/tracker.xlsx",
    "git reset --hard origin/main",
    "git -C . checkout HEAD -- docs/tracker-resolved.csv",
    "cd docs && git checkout -- tracker-working.csv",
    "git clean -fd",
    "git checkout HEAD -- docs/",
  ];
  for (const cmd of destructive) {
    assert.ok(
      revertsProtectedFile(cmd),
      `RULING 48 — this would have gone through: ${cmd}`,
    );
  }

  const allowed = [
    /*
     * **A COMMIT MESSAGE THAT DESCRIBES THE GUARD IS NOT A REVERT.** The very
     * first commit this hook ever saw was refused, because its message said
     * what the hook does and named the files it protects. A false positive on
     * a commit is not harmless: it is the failure that gets a guard turned off.
     */
    "git commit -F- <<EOF\nRULING 48 refuses git checkout against docs/tracker.csv\nEOF",
    "git commit -m 'restored docs/state.md by hand rather than with git restore'",
    'git commit -m "reset --hard was refused, correctly"',
    "git checkout -b claude/nh-hunt-0820",
    "git checkout main",
    "git status --short",
    "git show HEAD:docs/tracker-working.csv",
    "git log --oneline -5 -- docs/state.md",
    "git add docs/state.md",
    "git diff docs/tracker-working.csv",
  ];
  for (const cmd of allowed) {
    assert.equal(
      revertsProtectedFile(cmd),
      null,
      `RULING 48 — the guard is blocking ordinary work: ${cmd}`,
    );
  }
});

test("RULING 48: the hook is wired, and no committed script reverts a protected file", () => {
  const settings = JSON.parse(
    readFileSync(join(ROOT, ".claude", "settings.json"), "utf8"),
  ) as { hooks?: { PreToolUse?: { hooks?: { command?: string }[] }[] } };
  const wired = (settings.hooks?.PreToolUse ?? []).some((entry) =>
    (entry.hooks ?? []).some((h) =>
      (h.command ?? "").includes("guard-protected-files.mjs"),
    ),
  );
  assert.ok(wired, "the RULING 48 hook is not wired into .claude/settings.json");

  // The static half: a committed script that shells out to git bypasses the
  // hook entirely, because the hook sees the shell tool and not what a node
  // process does afterwards.
  const roots = ["scripts", "tests", ".github"];
  const hits: string[] = [];
  let scanned = 0;
  const walkDir = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".git") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walkDir(full);
      else if (/\.(mjs|mts|ts|js|yml|yaml|ps1|sh)$/.test(entry)) {
        scanned += 1;
        const rel = relative(ROOT, full).split(sep).join("/");
        if (rel === "scripts/guard-protected-files.mjs") continue;
        if (rel === "tests/tracker-stores.test.ts") continue;
        for (const line of readFileSync(full, "utf8").split("\n")) {
          if (line.trim().startsWith("*") || line.trim().startsWith("//")) continue;
          if (revertsProtectedFile(line)) hits.push(`${rel} — ${line.trim().slice(0, 90)}`);
        }
      }
    }
  };
  for (const r of roots) walkDir(join(ROOT, r));
  assert.ok(scanned > 40, `the sweep read ${scanned} files`);
  assert.deepEqual(hits, [], "a committed script reverts a protected file");
});

/* ========================================================================== */
/* RULING 48 — a state.md section edit INSERTS; it never replaces             */
/* ========================================================================== */

/**
 * A `state.md` §7 replace destroyed 28 KB in one call on 2026-08-20, including
 * the Phase A–E roadmap, and it was recovered from git rather than noticed.
 * The structural fact that would have caught it is that the file lost sections
 * and shrank, so that is what is asserted — against the committed HEAD version,
 * which is the only version a test can compare to without a session declaring
 * a baseline it could also get wrong.
 */
test("RULING 48: docs/state.md never loses a section or a third of its bytes", () => {
  const path = join(ROOT, "docs", "state.md");
  const now = readFileSync(path, "utf8");
  const headings = (src: string) =>
    src.split("\n").filter((l) => /^#{1,3}\s/.test(l)).map((l) => l.trim());

  let head = "";
  try {
    head = execFileSync("git", ["show", "HEAD:docs/state.md"], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    // No git, or the file is new in this commit. A check that could not RUN is
    // reported as that and never as a pass in disguise — see RULING 24 — but a
    // unit test has only pass and fail, so the honest form is to assert the
    // thing that is still checkable and say why the rest was skipped.
    assert.ok(now.length > 1000, "docs/state.md is present and not a stub");
    return;
  }

  const before = headings(head);
  const after = headings(now);
  const lost = before.filter((h) => !after.includes(h));
  assert.deepEqual(
    lost,
    [],
    "a section edit INSERTS; it never replaces. These headings were in HEAD " +
      "and are gone from the working tree — which is what a replace looks like.",
  );
  assert.ok(
    now.length >= Math.floor(head.length * 0.9),
    `docs/state.md shrank from ${head.length} to ${now.length} bytes — a ` +
      "section edit adds and amends; it does not remove a tenth of the file",
  );
});
