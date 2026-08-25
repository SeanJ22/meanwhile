/**
 * **A MIRRORED WORKBOOK IS COMPARED BY ITS ROWS, NEVER BY ITS BYTES.**
 * (2026-08-25, the final pass.)
 *
 * `pnpm handoff` refuses to overwrite a Drive-mirrored file whose content
 * matches no committed version — a protection against clobbering the author's
 * hand edits, and RULING 41 is why it exists: he adds tracker rows by hand and
 * a session may never reword or delete one.
 *
 * A `.xlsx` is a ZIP, and this repo rebuilds one on every `pnpm tracker:views`.
 * Two rebuilds of identical data differ in bytes, so the byte comparison could
 * only pass if the mirror happened to hold the exact bytes of a commit — which
 * it generally does not. The guard therefore reported **tracker.xlsx matches no
 * version in this file's history** and FAILED the handoff, which under RULING 75
 * is a gate.
 *
 * Diffing it by hand as the guard instructed found the mirror's Working sheet
 * holding **246 rows, ZERO of them absent from the repo's two stores** — no hand
 * edit at all, just a copy sixteen rows behind.
 *
 * So the question is asked properly now: does the mirror workbook hold a row id
 * this repo has never held? These guards prove BOTH directions, because a check
 * that only ever says yes is not a check.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { buildWorkbook, readWorkbook } from "../scripts/xlsx.mjs";
import { RESOLVED_CSV, WORKING_CSV, readStore } from "../scripts/tracker-core.mjs";

const ROOT = join(import.meta.dirname, "..");

/** The same question `workbookHoldsUnknownRows` asks, over a workbook's bytes. */
function unknownIdsIn(bytes: Buffer, known: Set<string>): string[] {
  /*
   * `readWorkbook` returns an ARRAY of sheets, and the handoff guard iterates
   * `Object.values(...)` over it — which works for both shapes and is why the
   * two read alike. Typed through `unknown` because the compiler is right that
   * an array and a record do not overlap, and pretending otherwise would be
   * asserting a shape rather than reading one.
   */
  const sheets = readWorkbook(bytes) as unknown as Record<string, { name: string; rows: string[][] }>;
  const unknown: string[] = [];
  for (const sheet of Object.values(sheets)) {
    const rows = sheet?.rows;
    if (!Array.isArray(rows) || rows.length < 2) continue;
    const idCol = rows[0].indexOf("ID");
    if (idCol < 0) continue;
    for (const row of rows.slice(1)) {
      const id = row[idCol];
      if (id && !known.has(id) && !unknown.includes(id)) unknown.push(id);
    }
  }
  return unknown;
}

const HEADER = ["ID", "Section", "Priority", "Title"];
const workbookOf = (rows: string[][]): Buffer =>
  buildWorkbook([{ name: "Working", header: HEADER, rows, widths: [10, 14, 6, 40] }], "2026-08-25") as Buffer;

describe("the mirror guard reads a workbook's rows, not its zip", () => {
  const known = new Set(
    [...readStore(WORKING_CSV), ...readStore(RESOLVED_CSV)].map((r) => r.ID).filter(Boolean),
  );

  it("the two live stores hold enough ids for the comparison to mean anything", () => {
    assert.ok(known.size > 200, `only ${known.size} known ids — the guard would refuse everything`);
  });

  it("REFUSES a workbook holding a row id this repo has never held", () => {
    /*
     * The direction that matters: a row the author typed into the workbook and
     * has not yet moved into a store. Overwriting that destroys his work, which
     * is the whole reason this protection exists.
     */
    const planted = workbookOf([
      ["B01", "needs-sean", "P2", "an id this repo does hold"],
      ["SEAN99", "needs-sean", "P2", "a row typed by hand in the workbook"],
    ]);
    assert.deepEqual(unknownIdsIn(planted, known), ["SEAN99"]);
  });

  it("PERMITS a workbook whose every row this repo already holds", () => {
    const ids = [...known].slice(0, 5);
    const ordinary = workbookOf(ids.map((id) => [id, "needs-sean", "P2", "a row from a store"]));
    assert.deepEqual(unknownIdsIn(ordinary, known), []);
  });

  it("two rebuilds of the SAME rows differ in bytes — which is why bytes are the wrong test", () => {
    /*
     * The measurement behind the whole change. If these were byte-identical the
     * old comparison would have been fine and the guard would never have
     * misfired.
     */
    const rows = [["B01", "needs-sean", "P2", "identical data"]];
    const a = workbookOf(rows);
    const b = buildWorkbook(
      [{ name: "Working", header: HEADER, rows, widths: [10, 14, 6, 40] }],
      "2026-08-26",
    ) as Buffer;
    assert.notEqual(
      Buffer.compare(a, b),
      0,
      "if a rebuild were byte-stable, comparing bytes would have been a correct guard",
    );
    assert.deepEqual(unknownIdsIn(a, known), unknownIdsIn(b, known), "and the ROWS are the same either way");
  });

  it("the live mirror, if it is present, holds no row this repo has never held", () => {
    /*
     * The actual claim this session made about Sean's Drive copy, kept as a
     * standing check rather than a sentence in a report. Skipped where the
     * mirror is not mounted — a session on another machine is not evidence.
     */
    const mirror = join("G:", "My Drive", "we-the-people", "tracker.xlsx");
    let bytes: Buffer;
    try {
      bytes = readFileSync(mirror);
    } catch {
      assert.ok(true, "the Drive mirror is not mounted here — nothing is claimed about it");
      return;
    }
    assert.deepEqual(
      unknownIdsIn(bytes, known),
      [],
      "the mirrored workbook holds a row id neither store has — a hand edit, and it must not be overwritten",
    );
  });

  void ROOT;
});
