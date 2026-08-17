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

test("every tracker ID matches the committed shape", () => {
  const ids = readIdColumn(readFileSync(TRACKER, "utf8")).slice(1).filter((id) => id.trim() !== "");

  // Letter prefix + digits. This is not cosmetic: the renumber that fixed the
  // M128/M129 collision picked the next free M number, and that is only a safe
  // move while every ID in the file is mechanically enumerable.
  const malformed = ids.filter((id) => !/^[A-Z]+\d+$/.test(id));
  assert.deepEqual(malformed, [], `tracker IDs outside the committed shape: ${malformed.join(", ")}`);
});
