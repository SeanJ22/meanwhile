/**
 * `pnpm owner:intake` — the standing owner-intake batch sweep. (A.1 WI8.)
 *
 * Reads the two owner inputs from the Drive mirror and accounts for every item
 * in both:
 *
 * ```
 *   owner-intake/defect-inbox/       screenshots. Unnamed. Annotated.
 *   owner-intake/Owner-Defects.xlsx  non-visual defects: wrong fact, wrong behavior
 * ```
 *
 * ## What this command does, and what it deliberately does not
 *
 * It ACCOUNTS. For every image it reports processed or unidentifiable-with-a-
 * question; for every row marked NEW it reports picked up or unprocessable-
 * with-a-question. Then it runs the sweep gate, which fails when anything was
 * neither handled nor named.
 *
 * It does NOT diagnose a defect it cannot see. Identifying a surface from an
 * image's content, determining the correct state from source records, fixing
 * at the shared code path and auditing the class across every surface and ZIP
 * are the work of the session that has the image in front of it. What this
 * guarantees is that no item passes through unremarked — which is the failure
 * the gate exists to catch, and the one a busy sweep actually commits.
 *
 * `--scaffold` creates the folder and an empty workbook with the owner's
 * columns, once, so the owner has somewhere to write.
 *
 * ## The colour boundary is enforced, not described
 *
 * The sweep writes ONLY the machine columns. `assertNoOwnerColumnWrites` runs
 * over the rows before anything is saved, and a write that would land in a
 * yellow column refuses the whole save — the owner's account of his own defect
 * is not something a script gets to edit.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  MACHINE_COLUMNS,
  OWNER_COLUMNS,
  isControlFactCandidate,
  isInboxImage,
  sweepGate,
  type DefectRow,
  type ImageDisposition,
  type RowDisposition,
} from "../lib/ops/owner-intake.ts";
import {
  OWNER_INTAKE_DIR,
  OWNER_INTAKE_INBOX,
  OWNER_INTAKE_PROCESSED,
  OWNER_INTAKE_WORKBOOK,
} from "./mirror-set.mjs";
import { floorLine, floored } from "../lib/ops/denominator-floor.ts";
import { buildWorkbook, readWorkbook } from "./xlsx.mjs";
import { today } from "./doc-dates.mjs";

const MIRROR = process.env.WTP_MIRROR ?? "G:/My Drive/we-the-people";
const INTAKE = join(MIRROR, OWNER_INTAKE_DIR);
const INBOX = join(INTAKE, OWNER_INTAKE_INBOX);
const PROCESSED = join(INBOX, OWNER_INTAKE_PROCESSED);
const WORKBOOK = join(INTAKE, OWNER_INTAKE_WORKBOOK);

const HEADER = [...OWNER_COLUMNS, ...MACHINE_COLUMNS];

/* --------------------------------------------------------------- scaffold */

function scaffold(): void {
  mkdirSync(PROCESSED, { recursive: true });
  console.log(`owner:intake --scaffold`);
  console.log(`  ${INBOX} ready`);
  if (existsSync(WORKBOOK)) {
    console.log(`  ${OWNER_INTAKE_WORKBOOK} already exists — left exactly as it is`);
    return;
  }
  const readme = [
    ["Two places, and only two."],
    [""],
    ["1. A SCREENSHOT of anything that looks wrong goes in defect-inbox/."],
    ["   Do not name it. Draw on it — the annotation is the specification and it"],
    ["   outranks anything written in prose, including ours."],
    [""],
    ["2. Anything NOT visual — a wrong fact, a wrong behaviour — is a row on the"],
    ["   Defects tab. Fill the yellow columns and leave the gray ones alone."],
    [""],
    ["Yellow columns are yours: Date, ZIP, Page, What's wrong, and optionally"],
    ["What's right + source. Set Status to NEW when the row is ready to be read."],
    [""],
    ["Gray columns are the machine's: WorkItem, Check ID, Machine notes. A sweep"],
    ["writes those and never touches yours."],
    [""],
    ["Status moves NEW -> PICKED UP -> FIXED -> CHECK EXISTS. You only ever set"],
    ["NEW; the rest is how you see where your report got to."],
    [""],
    ["If you fill in What's right + source, that row is also a candidate control"],
    ["fact — the answer key the system is graded against. A sweep will tell you"],
    ["which rows those are; nothing becomes a control until you confirm it."],
    [""],
    ["docs/defects.md is no longer where you write. It is kept as a machine"],
    ["record, and it is far too large to work in."],
  ];
  writeFileSync(
    WORKBOOK,
    buildWorkbook(
      [
        { name: "READ ME", header: ["How to report a defect"], rows: readme, widths: [110] },
        {
          name: "Defects",
          header: HEADER,
          rows: [],
          /* The owner's columns get room to write in; the machine's are
             narrower because nobody reads an id at width. */
          widths: [12, 8, 26, 60, 60, 14, 30, 22, 40],
        },
      ],
      today(),
    ),
  );
  console.log(`  ${OWNER_INTAKE_WORKBOOK} created with ${HEADER.length} columns`);
  console.log(`    owner (yellow): ${OWNER_COLUMNS.join(", ")}`);
  console.log(`    machine (gray): ${MACHINE_COLUMNS.join(", ")}`);
}

/* ------------------------------------------------------------- the sweep */

function readRows(): DefectRow[] {
  if (!existsSync(WORKBOOK)) return [];
  const sheets = readWorkbook(readFileSync(WORKBOOK)) as { name: string; rows: string[][] }[];
  const sheet = sheets.find((s) => s.name === "Defects");
  if (!sheet) {
    throw new Error(
      `${WORKBOOK} has no "Defects" sheet. Refusing to guess which tab holds the rows: ` +
        "reading the wrong one would report the owner's defects as zero.",
    );
  }
  const header = (sheet.rows[0] ?? []).map((h) => String(h ?? "").trim());
  const at = (name: string) => header.indexOf(name);
  return sheet.rows.slice(1).flatMap((row, i) => {
    const cell = (name: string) => String(row[at(name)] ?? "").trim();
    /* A row with nothing in any owner column is an empty spreadsheet row, not
       a defect with missing fields. Counting it would inflate the denominator
       with the workbook's own blank tail. */
    const anything = OWNER_COLUMNS.some((c) => cell(c).length > 0);
    if (!anything) return [];
    return [
      {
        rowIndex: i + 2,
        date: cell("Date"),
        zip: cell("ZIP"),
        page: cell("Page"),
        whatsWrong: cell("What's wrong"),
        whatsRight: cell("What's right + source"),
        status: cell("Status"),
        workItem: cell("WorkItem"),
        checkId: cell("Check ID"),
      },
    ];
  });
}

function sweep(): void {
  console.log(`owner:intake · reading ${INTAKE}`);

  if (!existsSync(INTAKE)) {
    console.log(
      `  BOUNDARY · ${INTAKE} does not exist. This is a failed read with the wall named — ` +
        "not an empty inbox. Run `pnpm owner:intake --scaffold`, or check the Drive mount.",
    );
    process.exit(1);
  }

  /* ---- the inbox, and the place the owner actually put them ---- */
  /*
   * **TWO LOCATIONS, BECAUSE THE OWNER USED THE SECOND ONE.** (2026-08-30.)
   *
   * The declared inbox is `owner-intake/defect-inbox/` in the mirror. On the
   * day this sweep was written the owner dropped 21 screenshots into
   * `feedback/<date>/` in the repo instead — which is not the declared path
   * and is not a reason to report zero images.
   *
   * A sweep that reads only the folder it prefers reports an empty inbox while
   * the owner is looking at a folder full of his own screenshots. So both are
   * read, every image from either is accounted for, and the report says which
   * location each came from. The declared path is still the declared path; this
   * is the sweep refusing to mistake "not where I looked" for "not there".
   */
  const inboxImages = existsSync(INBOX)
    ? readdirSync(INBOX)
        .filter((n) => isInboxImage(n))
        .map((n) => `${OWNER_INTAKE_INBOX}/${n}`)
    : [];

  const repoFeedback: string[] = [];
  /** Non-image files sitting beside the captures. Reported, never filtered away. */
  const companions: string[] = [];
  const feedbackRoot = join(process.cwd(), "feedback");
  if (existsSync(feedbackRoot)) {
    for (const day of readdirSync(feedbackRoot)) {
      const dir = join(feedbackRoot, day);
      let entries: string[] = [];
      try {
        entries = readdirSync(dir);
      } catch {
        /* A file rather than a directory under feedback/ is not an inbox day. */
        continue;
      }
      for (const name of entries) {
        if (isInboxImage(name)) repoFeedback.push(`feedback/${day}/${name}`);
        /*
         * **A COMPANION DOCUMENT IS OWNER INPUT AND IS NOT AN IMAGE.**
         * (2026-08-30.) The owner's 20 screenshots arrived beside a Word file
         * carrying the commentary that explains them — the annotation for
         * captures he did not draw on. Filtering it away as "not an image"
         * would drop the half that says what the pictures mean, which is the
         * exact failure the sweep gate exists to prevent, one file to the left.
         */
        else companions.push(`feedback/${day}/${name}`);
      }
    }
  }

  const imagesFound = [...inboxImages, ...repoFeedback];

  /*
   * Every image found is UNIDENTIFIABLE from this command, and that is the
   * honest disposition rather than a placeholder: identifying a surface means
   * looking at the image, which is the work of the session holding it. What
   * the gate guarantees is that none of them passes unremarked.
   */
  const imageDispositions: ImageDisposition[] = imagesFound.map((file) => ({
    kind: "UNIDENTIFIABLE",
    file,
    bestGuess:
      "not yet examined — this command accounts for the inbox; identifying the surface and " +
      "the ZIP from the image content is done by the session that opens it",
    question: "Which page and ZIP is this, if the image content does not make it obvious?",
  }));

  /* ---- the workbook ---- */
  const rows = readRows();
  const newRows = rows.filter((r) => r.status.trim().toUpperCase() === "NEW");
  const rowDispositions: RowDisposition[] = newRows.map((row) => ({
    kind: "UNPROCESSABLE",
    rowIndex: row.rowIndex,
    question:
      `Row ${row.rowIndex} (${row.page || "no page"} at ${row.zip || "no zip"}) is NEW and ` +
      "has not been diagnosed. Diagnosis, the fix at the shared code path and the permanent " +
      "check are the work of a session reading it.",
  }));

  const gate = sweepGate({
    imagesFound,
    imageDispositions,
    rowsNew: newRows.map((r) => r.rowIndex),
    rowDispositions,
  });

  /* ---- the report. Stated N equals rendered rows, both halves. ---- */
  const processed = imageDispositions.filter((d) => d.kind === "PROCESSED");
  const unidentifiable = imageDispositions.filter((d) => d.kind === "UNIDENTIFIABLE");

  console.log(
    `\n  images: ${imagesFound.length} found — ${inboxImages.length} in the declared inbox ` +
      `(${OWNER_INTAKE_INBOX}/), ${repoFeedback.length} under feedback/ in the repo`,
  );
  /*
   * RULING 159. "0 processed" over an empty inbox and "0 processed" over
   * eleven images are opposite facts, and a bare count renders them the same.
   */
  console.log(
    `    ${floorLine(
      floored(
        "processed",
        "the defect inbox",
        imagesFound.length,
        processed.length,
        imagesFound.length === 0 ? "the inbox holds no images" : undefined,
      ),
    )}`,
  );
  for (const d of processed) {
    if (d.kind === "PROCESSED") console.log(`      ${d.file} → ${d.surface} @ ${d.zip} → ${d.checkId}`);
  }
  console.log(`    unidentifiable: ${unidentifiable.length}`);
  if (companions.length > 0) {
    console.log(
      `    ${companions.length} companion file(s) beside the captures — owner input that is ` +
        "not an image, and is read rather than filtered away:",
    );
    for (const c of companions) console.log(`      ${c}`);
  }
  for (const d of unidentifiable) {
    if (d.kind === "UNIDENTIFIABLE") {
      console.log(`      ${d.file}`);
      console.log(`        best guess: ${d.bestGuess}`);
      console.log(`        question:   ${d.question}`);
    }
  }

  console.log(`\n  Owner-Defects.xlsx: ${rows.length} row(s), ${newRows.length} marked NEW`);
  const pickedUp = rowDispositions.filter((d) => d.kind === "PICKED_UP");
  console.log(
    `    ${floorLine(
      floored(
        "picked up",
        "the rows marked NEW",
        newRows.length,
        pickedUp.length,
        newRows.length === 0 ? "no row is marked NEW" : undefined,
      ),
    )}`,
  );
  for (const d of rowDispositions) {
    if (d.kind === "UNPROCESSABLE") console.log(`      row ${d.rowIndex}: ${d.question}`);
  }

  const candidates = rows.filter(isControlFactCandidate);
  if (candidates.length > 0) {
    console.log(
      `\n  ${candidates.length} row(s) carry "What's right + source" and are CANDIDATE ` +
        "control facts — surfaced, never loaded. Only the owner marking a row CONFIRMED on " +
        "the control-facts tab makes it an answer-key entry.",
    );
    for (const c of candidates) console.log(`    row ${c.rowIndex}: ${c.whatsRight.slice(0, 80)}`);
  }

  console.log(`\n  SWEEP GATE: ${gate.ok ? "OK" : "FAILED"} — ${gate.detail}`);
  if (!gate.ok) {
    for (const f of gate.unaccountedImages) console.log(`    × image never accounted for: ${f}`);
    for (const r of gate.unaccountedRows) console.log(`    × NEW row never accounted for: ${r}`);
    process.exit(1);
  }
}

if (process.argv.includes("--scaffold")) scaffold();
else sweep();
