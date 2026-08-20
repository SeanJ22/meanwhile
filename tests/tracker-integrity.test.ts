import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * One row per ID in `docs/tracker.csv`. Nothing more.
 *
 * The defect that named this test, found at the h session's open: `M128` and
 * `M129` each carried TWO rows describing entirely different pieces of work —
 * g4's mask/extrusion pair, and g5's active-state-model/meetings-panel pair
 * appended underneath reusing the same IDs. 308 rows, 306 unique IDs.
 *
 * CLAUDE.md already forbids this by name ("A status change edits the existing
 * row. It never appends a second row with the same ID"), and already records
 * that M02 and M04 did it once before. It recurred anyway, because the rule
 * was enforced by nobody: the only thing standing between the tracker and a
 * duplicate pair was an agent remembering to look. A tracker with two rows per
 * ID cannot be read by anything — including the xlsx view generator — and it
 * silently breaks every lookup by ID, which is the failure mode that let this
 * one live through a whole session.
 *
 * This test is the mechanical half. It does not check that a status is
 * truthful; it checks the one property that makes the file addressable at all.
 */

const TRACKER = "docs/tracker.csv";

/**
 * Minimal RFC 4180 reader for the ID column only.
 *
 * We deliberately do not reuse a CSV library here: every Notes field in this
 * file is a paragraph containing commas, quotes and newlines, and the point of
 * the test is to be sure about row boundaries rather than to trust a parser we
 * have not read. Only the first field of each record is returned.
 */
function readIdColumn(csv: string): string[] {
  const ids: string[] = [];
  let field = "";
  let inQuotes = false;
  let atFieldStart = true;
  let firstFieldOfRecord = true;

  for (let i = 0; i < csv.length; i += 1) {
    const ch = csv[i];

    if (inQuotes) {
      if (ch === '"') {
        if (csv[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"' && atFieldStart) {
      inQuotes = true;
      atFieldStart = false;
      continue;
    }

    if (ch === ",") {
      if (firstFieldOfRecord) ids.push(field);
      field = "";
      atFieldStart = true;
      firstFieldOfRecord = false;
      continue;
    }

    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && csv[i + 1] === "\n") i += 1;
      if (firstFieldOfRecord && field !== "") ids.push(field);
      field = "";
      atFieldStart = true;
      firstFieldOfRecord = true;
      continue;
    }

    field += ch;
    atFieldStart = false;
  }

  if (firstFieldOfRecord && field !== "") ids.push(field);
  return ids;
}

/**
 * The same minimal reader, returning EVERY field of every record rather than
 * only the first. Kept beside `readIdColumn` rather than replacing it: the ID
 * reader is the one the uniqueness check has always used and its behaviour is
 * understood, and a rewrite of a passing check while fixing a different defect
 * is how a guard quietly stops guarding.
 */
function readRecords(csv: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;
  let atFieldStart = true;

  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];

    if (inQuotes) {
      if (ch === '"') {
        if (csv[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"' && atFieldStart) {
      inQuotes = true;
      atFieldStart = false;
      continue;
    }

    if (ch === ",") {
      record.push(field);
      field = "";
      atFieldStart = true;
      continue;
    }

    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && csv[i + 1] === "\n") i += 1;
      record.push(field);
      // A blank trailing line is not a record.
      if (!(record.length === 1 && record[0] === "")) records.push(record);
      record = [];
      field = "";
      atFieldStart = true;
      continue;
    }

    field += ch;
    atFieldStart = false;
  }

  if (field !== "" || record.length > 0) {
    record.push(field);
    if (!(record.length === 1 && record[0] === "")) records.push(record);
  }
  return records;
}

test("every tracker row carries a distinct ID", () => {
  const ids = readIdColumn(readFileSync(TRACKER, "utf8"));

  assert.equal(ids[0], "ID", "the tracker's first column is still the ID column");

  const rows = ids.slice(1).filter((id) => id.trim() !== "");
  assert.ok(rows.length > 200, `expected the full tracker, read ${rows.length} rows`);

  const seen = new Map<string, number>();
  for (const id of rows) seen.set(id, (seen.get(id) ?? 0) + 1);

  const duplicated = [...seen.entries()]
    .filter(([, count]) => count > 1)
    .map(([id, count]) => `${id} x${count}`);

  assert.deepEqual(
    duplicated,
    [],
    `docs/tracker.csv has more than one row per ID: ${duplicated.join(", ")}. ` +
      "A status change EDITS the existing row — it never appends a second one. " +
      "Merge the rows by hand; do not renumber a row other sessions already cite.",
  );

  // The count is stated rather than implied: an operation that can return
  // nothing must be asked what it returned, and a reader of this output should
  // be able to see the denominator the uniqueness claim was made against.
  console.log(`tracker-integrity: ${rows.length} rows, ${seen.size} distinct IDs`);
});

/**
 * Every record has exactly nine fields — and this is the half that was
 * missing.
 *
 * F01-continued session 2 (2026-08-19) found `F09`'s record ending
 * `…rather than here."` with **no line break** before `F10,Ballot,`. The two
 * rows had fused into one 17-field record. That did not merely make the file
 * unreadable by anything expecting nine columns; **it hid a duplicate from the
 * test above.** With `F10` sitting inside `F09`'s record rather than at the
 * start of its own, the ID reader saw one `F10`, the uniqueness check passed,
 * and a genuine second `F10` row went on standing — byte-identical to the
 * first, the exact defect `CLAUDE.md` names M02 and M04 for.
 *
 * So the ID check is necessary and was never sufficient: a broken record
 * boundary defeats it silently. The shape check has to come first.
 */
test("every tracker record carries exactly nine fields", () => {
  const records = readRecords(readFileSync(TRACKER, "utf8"));

  assert.equal(records[0].length, 9, "the header no longer has nine columns");
  assert.ok(records.length > 200, `expected the full tracker, read ${records.length} records`);

  const wrong = records
    .map((r, i) => ({ i, id: r[0], n: r.length }))
    .filter((r) => r.n !== 9);

  assert.deepEqual(
    wrong.map((w) => `${w.id} (record ${w.i + 1}): ${w.n} fields`),
    [],
    "a record with the wrong field count means a row boundary is broken — " +
      "usually a missing newline between two rows, which also HIDES a " +
      "duplicate ID from the uniqueness check above",
  );

  console.log(`tracker-integrity: ${records.length} records, all 9 fields`);
});

test("every tracker ID matches the committed shape", () => {
  const ids = readIdColumn(readFileSync(TRACKER, "utf8")).slice(1).filter((id) => id.trim() !== "");

  // Letter prefix + digits. This is not cosmetic: the renumber that fixed the
  // M128/M129 collision picked the next free M number, and that is only a safe
  // move while every ID in the file is mechanically enumerable.
  const malformed = ids.filter((id) => !/^[A-Z]+\d+$/.test(id));
  assert.deepEqual(malformed, [], `tracker IDs outside the committed shape: ${malformed.join(", ")}`);
});
