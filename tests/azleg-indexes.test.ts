import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  decodeCell,
  normaliseBillNumber,
  parseChapterStamp,
  parseGovernorLetter,
  parseLetterIndex,
  parseSessionLawIndex,
  tableRows,
} from "../scripts/hunt-azleg-parse.mts";

/**
 * **THE ARIZONA LEGISLATURE'S TWO INDEXES, against recorded bytes.**
 * (AZ04, 2026-08-28. No live calls — `tests/fixtures/azleg-*`.)
 *
 * Every assertion here is a MINIMUM ROW COUNT or an exact string, never the
 * absence of an error, because every defect this file exists to catch reports
 * success. `www.azleg.gov` ships three separate deviations from well-formed
 * HTML, and each one makes a parser return a plausible WRONG NUMBER rather
 * than throw:
 *
 *   - `<tr>` is never closed, so a `</tr>`-based split returns 2 rows for a
 *     151-row table, and 2 is a number a caller will happily record;
 *   - cells close as `</td >` with a space, so a `</td>` literal matches
 *     nothing and the table reads as empty;
 *   - short titles carry `&nbsp` with no semicolon, which a strict decoder
 *     passes through as visible text into a reader's sentence.
 */

const read = (name: string) => readFileSync(join(import.meta.dirname, "fixtures", name), "utf8");

const LETTERS = read("azleg-governors-letters.html");
const SESSION_LAWS = read("azleg-sessionlaws.html");

/* ══════════════════════════════════════════════════════════════════════
   THE MARKUP TRAPS
   ══════════════════════════════════════════════════════════════════════ */

test("MARKUP: rows are cut on the OPENING <tr, because </tr> is never written", () => {
  /*
   * The trap, stated as a measurement, and it is nastier than a missing tag.
   *
   * The document contains exactly TWO `</tr>` in a table of 151 rows — the
   * data rows are never closed, and a stray pair survives elsewhere in the
   * page furniture. So splitting on `</tr>` does not throw and does not return
   * zero: it returns **2 rows**, a number small enough to be wrong and
   * plausible enough to be recorded. That is the whole reason rows are cut on
   * the OPENING `<tr` instead.
   */
  const closingTags = (LETTERS.match(/<\/tr\s*>/gi) ?? []).length;
  assert.equal(closingTags, 2, "the recorded trap: 2 closing </tr> against 151 data rows");
  assert.ok(
    LETTERS.split(/<\/tr\s*>/i).length - 1 < 10,
    "a </tr> split yields a handful of rows, not 151 — the failure that reports success",
  );

  const { rowsSeen, cells } = tableRows(LETTERS);
  assert.ok(rowsSeen >= 150, `only ${rowsSeen} <tr chunks — a </tr> split would have found 1`);
  assert.ok(cells.length >= 150, `only ${cells.length} rows produced cells`);
});

test("MARKUP: cells close as `</td >` with a space, and are still matched", () => {
  assert.ok(
    /<\/td\s+>/i.test(LETTERS),
    "the fixture must still contain a spaced `</td >` — that is the trap being tested",
  );
  /* A `</td>` literal against this document finds nothing at all. */
  assert.equal(
    (LETTERS.match(/<\/td>/gi) ?? []).length,
    0,
    "no cell closes without the space, so a strict `</td>` parser reads an EMPTY table",
  );
  const { cells } = tableRows(LETTERS);
  assert.ok(cells[0].length >= 2, "a letters row is [Bill #][View Letter]");
});

test("MARKUP: the malformed `&nbsp` with no semicolon never reaches a title", () => {
  assert.ok(
    /&nbsp(?!;)/i.test(SESSION_LAWS),
    "the fixture must still contain a semicolon-less `&nbsp` — that is the trap being tested",
  );
  assert.equal(decodeCell("SCHOOLS&nbspFUNDING"), "SCHOOLS FUNDING");
  assert.equal(decodeCell("a&nbsp;b"), "a b");

  const { rows } = parseSessionLawIndex(SESSION_LAWS);
  for (const row of rows) {
    assert.ok(
      !/&nbsp|&amp;|&#\d+;/i.test(row.shortTitle),
      `chapter ${row.chapter} carries an undecoded entity in its title: ${row.shortTitle}`,
    );
  }
});

/* ══════════════════════════════════════════════════════════════════════
   THE TWO INDEXES, AND THE NUMBERS THEY MUST RECONCILE TO
   ══════════════════════════════════════════════════════════════════════ */

test("/governors-letters/ parses to 151 bills, 83 HB and 68 SB", () => {
  const { rows, rejected } = parseLetterIndex(LETTERS);
  assert.equal(rows.length, 151, "the measured count of lettered bills");
  assert.equal(rows.filter((r) => r.billNumber.startsWith("HB")).length, 83);
  assert.equal(rows.filter((r) => r.billNumber.startsWith("SB")).length, 68);
  assert.deepEqual(rejected, [], "no row the parser could half-read was dropped");

  assert.equal(new Set(rows.map((r) => r.letterUrl)).size, 151, "151 distinct PDF URLs");
  for (const row of rows) {
    assert.match(row.letterUrl, /^https:\/\/www\.azleg\.gov\/govlettr\/57leg\/2r\/[a-z]+\d+\.pdf$/);
    assert.equal(row.sessionId, "57leg/2r", "the session is read out of the path, never assumed");
  }
});

test("/sessionlaws/ parses to 264 chapters, numbered 1..264 with NO holes", () => {
  const { rows, missingChapters } = parseSessionLawIndex(SESSION_LAWS);
  assert.equal(rows.length, 264);
  /*
   * The gap check is the point. "264 rows" is consistent with chapters
   * 1..263 plus a duplicate, and a store built on that would be missing a law
   * while reporting a full count.
   */
  assert.deepEqual(missingChapters, [], "every chapter between 1 and the highest is present");
  assert.equal(Math.min(...rows.map((r) => r.chapter)), 1);
  assert.equal(Math.max(...rows.map((r) => r.chapter)), 264);

  for (const row of rows) {
    assert.match(
      row.chapteredVersionUrl,
      /^https:\/\/www\.azleg\.gov\/legtext\/57Leg\/2R\/laws\/\d{4}\.pdf$/,
      `chapter ${row.chapter} has an off-pattern URL`,
    );
    assert.ok(row.shortTitle.length > 0, `chapter ${row.chapter} lost its short title`);
  }
});

test("STRUCTURAL: the lettered and chaptered bills are DISJOINT — and that proves nothing", () => {
  /*
   * **THE MEASUREMENT THAT MUST NOT BECOME AN INFERENCE.**
   *
   * Not one of the 151 lettered bills is among the 264 chaptered ones. That is
   * exactly what you would see if every letter were a veto — and it is also
   * what you would see for several other reasons, so it is evidence of the
   * SHAPE of the two indexes and of nothing about any bill's fate. This test
   * records the fact and the sibling test below forbids the leap.
   */
  const lettered = new Set(parseLetterIndex(LETTERS).rows.map((r) => r.billNumber));
  const chaptered = new Set(parseSessionLawIndex(SESSION_LAWS).rows.map((r) => r.billNumber));
  const both = [...lettered].filter((b) => chaptered.has(b));
  assert.deepEqual(both, [], "the intersection is empty");
  assert.equal(lettered.size, 151);
  assert.equal(chaptered.size, 264);
});

test("a bill designation normalises off the publisher's spacing and punctuation", () => {
  assert.equal(normaliseBillNumber("HB2003"), "HB2003");
  assert.equal(normaliseBillNumber("H.B. 2003"), "HB2003");
  assert.equal(normaliseBillNumber(" SB 1002 "), "SB1002");
  assert.equal(normaliseBillNumber("no bill here"), null);
});

/* ══════════════════════════════════════════════════════════════════════
   THE ENROLLED ACT'S OWN ENACTMENT STAMP
   ══════════════════════════════════════════════════════════════════════ */

test("STAMP: the approval date is read, and it is date-anchored", () => {
  const stamp = parseChapterStamp(
    "...operative immediately as provided by law. 39 APPROVED BY THE GOVERNOR FEBRUARY 6, 2026. " +
      "FILED IN THE OFFICE OF THE SECRETARY OF STATE FEBRUARY 6, 2026.",
  );
  assert.equal(stamp.route, "APPROVED_BY_GOVERNOR");
  assert.equal(stamp.approvedAt, "2026-02-06");
  assert.equal(stamp.filedAt, "2026-02-06");
});

test("STAMP: a marker with no readable date yields a route and a NULL date", () => {
  const stamp = parseChapterStamp("APPROVED BY THE GOVERNOR sometime last spring.");
  assert.equal(stamp.approvedAt, null, "no date was published, so none is claimed");
});

test("STAMP: the three roads to a chapter are told apart, and signature is not the default", () => {
  assert.equal(
    parseChapterStamp("BECAME LAW WITHOUT GOVERNOR'S SIGNATURE FILED IN THE OFFICE OF THE SECRETARY OF STATE MARCH 3, 2026.").route,
    "WITHOUT_SIGNATURE",
  );
  assert.equal(
    parseChapterStamp("PASSED THE SENATE OVER THE GOVERNOR'S VETO APRIL 1, 2026.").route,
    "OVER_VETO",
  );
  /*
   * The load-bearing one. A chapter with no stamp the parser recognises is
   * UNDETERMINED and NEVER APPROVED_BY_GOVERNOR — a bill can reach a chapter
   * without a signature, and defaulting to one would assert a gubernatorial
   * act that no document supports.
   */
  assert.equal(parseChapterStamp("Be it enacted by the Legislature...").route, "UNDETERMINED");
  assert.equal(parseChapterStamp("").approvedAt, null);
});

test("STAMP: body text about signatures is NOT an approval stamp", () => {
  /*
   * A REGRESSION, and it was real. The first detector shipped here matched
   * `(approved|signed|filed).{0,60}(governor|secretary of state)` and fired on
   * chapter 1's ordinary text about nomination signatures — a FALSE POSITIVE,
   * which would have published a date the document never stamped.
   */
  const stamp = parseChapterStamp(
    "reject those nomination petitions, nomination papers or signatures based solely on the " +
      "date of the primary election, as certified by the secretary of state.",
  );
  assert.equal(stamp.route, "UNDETERMINED");
  assert.equal(stamp.approvedAt, null);
  assert.equal(stamp.filedAt, null);
});

/* ══════════════════════════════════════════════════════════════════════
   THE GOVERNOR'S LETTERS
   ══════════════════════════════════════════════════════════════════════ */

test("LETTER: a veto is read from her own sentence, with its date", () => {
  const parsed = parseGovernorLetter(
    "June 19, 2026 The Honorable Steve Montenegro Speaker of the House RE: HB2003 " +
      "Dear Speaker Montenegro: Today I vetoed HB2003. Sincerely, Katie Hobbs Governor",
  );
  assert.equal(parsed.disposition, "VETOED");
  assert.equal(parsed.date, "2026-06-19");
  assert.deepEqual(parsed.coveredBills, ["HB2003"]);
});

test("LETTER: one letter can cover several bills, and every one is carried", () => {
  /*
   * SB1002's letter reads "Today I vetoed the following bills:" and enumerates
   * them. The index gives each bill its own row pointing at this same PDF, so
   * the store keys on the BILL and carries the letter's full reach — otherwise
   * a reader is shown one bill's disposition as though the document concerned
   * only that bill.
   */
  const parsed = parseGovernorLetter(
    "February 20, 2026 RE: SB1002; SB1331; SB1334 Dear President: Today I vetoed the " +
      "following bills: SB1002, relating to elections; SB1331, relating to taxation; " +
      "and SB1334, relating to schools. Sincerely, Katie Hobbs",
  );
  assert.equal(parsed.disposition, "VETOED");
  assert.equal(parsed.date, "2026-02-20");
  assert.deepEqual(parsed.coveredBills, ["SB1002", "SB1331", "SB1334"]);
});

test("LETTER: empty text is UNREAD, which is a fact about US and not a disposition", () => {
  const parsed = parseGovernorLetter("");
  assert.equal(parsed.disposition, "UNREAD");
  assert.equal(parsed.date, null);
  assert.deepEqual(parsed.coveredBills, []);
});

test("LETTER: text with no disposition verb is UNDETERMINED, never SIGNED by default", () => {
  const parsed = parseGovernorLetter("March 1, 2026 RE: HB1234 Dear Speaker: Regards, Katie Hobbs");
  assert.equal(
    parsed.disposition,
    "UNDETERMINED",
    "a default disposition would be a manufactured claim about a governmental act",
  );
  assert.deepEqual(parsed.coveredBills, ["HB1234"]);
});
