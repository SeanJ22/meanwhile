/**
 * **THE SEEDED FAILURE FOR THE OWNER-INTAKE SWEEP.** (A.1 WI8, 2026-08-30.)
 *
 * The brief's rule: a NEW row or an inbox image that a sweep neither processes
 * nor lists as unidentifiable fails the sweep gate. That is the failure mode a
 * busy sweep actually commits — not getting a defect wrong, but never
 * mentioning it, so the owner reported something and nothing came back.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  MACHINE_COLUMNS,
  OWNER_COLUMNS,
  isControlFactCandidate,
  isInboxImage,
  nextStatus,
  sweepGate,
  type DefectRow,
  type ImageDisposition,
  type RowDisposition,
} from "../lib/ops/owner-intake.ts";
import { EXPECTED_DIRS, OWNER_INTAKE_DIR } from "../scripts/mirror-set.mjs";

function row(over: Partial<DefectRow> = {}): DefectRow {
  return {
    rowIndex: 2,
    date: "2026-08-30",
    zip: "85701",
    page: "/ballot",
    whatsWrong: "The board is listed with four members.",
    whatsRight: "",
    status: "NEW",
    workItem: "",
    checkId: "",
    ...over,
  };
}

/* ====================================================================== */

test("SEEDED: an inbox image the sweep neither processed nor listed fails the gate", () => {
  const verdict = sweepGate({
    imagesFound: ["a.png", "b.png", "c.png"],
    /* Two accounted for. The third simply vanished. */
    imageDispositions: [
      {
        kind: "PROCESSED",
        file: "a.png",
        surface: "/ballot",
        zip: "85701",
        checkId: "vac:ballot-clipping",
        movedTo: "defect-inbox/processed/a.png",
      },
      {
        kind: "UNIDENTIFIABLE",
        file: "b.png",
        bestGuess: "a map popup, zip unclear",
        question: "Which ZIP was this taken at?",
      },
    ],
    rowsNew: [],
    rowDispositions: [],
  });
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.unaccountedImages, ["c.png"]);
  assert.match(verdict.detail, /neither processed nor listed/);
});

test("SEEDED: a NEW workbook row the sweep never accounted for fails the gate", () => {
  const verdict = sweepGate({
    imagesFound: [],
    imageDispositions: [],
    rowsNew: [2, 3, 4],
    rowDispositions: [
      { kind: "PICKED_UP", rowIndex: 2, workItemId: "wi:abc", checkId: null, status: "PICKED UP" },
      { kind: "UNPROCESSABLE", rowIndex: 3, question: "Which page is this about?" },
    ],
  });
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.unaccountedRows, [4]);
});

test("a sweep that accounts for everything — including as unidentifiable — passes", () => {
  const dispositions: ImageDisposition[] = [
    {
      kind: "UNIDENTIFIABLE",
      file: "a.png",
      bestGuess: "unclear",
      question: "Which page is this?",
    },
  ];
  const rowDispositions: RowDisposition[] = [
    { kind: "UNPROCESSABLE", rowIndex: 2, question: "Which page is this about?" },
  ];
  const verdict = sweepGate({
    imagesFound: ["a.png"],
    imageDispositions: dispositions,
    rowsNew: [2],
    rowDispositions,
  });
  assert.equal(verdict.ok, true, "unidentifiable IS an accounting — it is not a skip");
});

test("an empty inbox and an empty workbook pass, and say so on their own denominators", () => {
  const verdict = sweepGate({
    imagesFound: [],
    imageDispositions: [],
    rowsNew: [],
    rowDispositions: [],
  });
  assert.equal(verdict.ok, true);
  assert.match(verdict.detail, /0 image\(s\) and 0 NEW row\(s\)/);
});

/* ------------------------------------------------------- the boundaries */

test("the owner's columns and the machine's columns do not overlap", () => {
  const owner = new Set<string>(OWNER_COLUMNS);
  for (const machine of MACHINE_COLUMNS) {
    assert.ok(
      !owner.has(machine),
      `"${machine}" is in both column families — a sweep would write in a yellow column`,
    );
  }
});

test("the status flow advances one step at a time and stops at the end", () => {
  assert.equal(nextStatus("NEW"), "PICKED UP");
  assert.equal(nextStatus("PICKED UP"), "FIXED");
  assert.equal(nextStatus("FIXED"), "CHECK EXISTS");
  assert.equal(nextStatus("CHECK EXISTS"), null, "the terminal status does not advance");
  assert.equal(nextStatus("something the owner typed"), null, "an unknown status never advances");
});

test("a row with What's right + source is surfaced as a control-fact candidate", () => {
  assert.equal(isControlFactCandidate(row()), false);
  assert.equal(
    isControlFactCandidate(row({ whatsRight: "Five members, per pima.gov/2317" })),
    true,
  );
});

test("only image files are read out of the inbox", () => {
  for (const name of ["a.png", "B.JPG", "shot.jpeg", "x.webp", "y.gif"]) {
    assert.equal(isInboxImage(name), true, name);
  }
  for (const name of ["notes.txt", "Thumbs.db", "a.pdf", "processed"]) {
    assert.equal(isInboxImage(name), false, name);
  }
});

test("owner-intake/ is registered with the mirror through its normal mechanism", () => {
  assert.ok(
    EXPECTED_DIRS.includes(OWNER_INTAKE_DIR),
    "the owner-intake folder must be a declared mirror directory, or the set check fails on it",
  );
});
