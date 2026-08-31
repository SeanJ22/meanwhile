/**
 * **OWNER INTAKE — two inputs, and `defects.md` is no longer one of them.**
 * (A.1 WI8, 2026-08-30, the author's decision.)
 *
 * ## What changed and why
 *
 * `docs/defects.md` was the author's production-defect scratchpad: he wrote
 * into it from outside the repo, which is why it joined the mirror set on
 * 2026-08-14. It has since grown far too large to work in and has become a
 * MACHINE surface — a long committed record that sessions append to and read.
 * Asking the owner to keep writing into it is asking him to edit a file whose
 * primary reader is a script.
 *
 * So owner intake becomes two inputs, and exactly two:
 *
 * ```
 *   owner-intake/defect-inbox/     screenshots. Unnamed. Annotated.
 *   owner-intake/Owner-Defects.xlsx  non-visual defects: wrong fact, wrong behavior
 * ```
 *
 * `defects.md` stays in the mirror set as a MACHINE-MAINTAINED record. It is
 * not deleted and it is not retired as a document — it is retired as a place
 * the owner writes.
 *
 * ## The annotation is the specification
 *
 * A screenshot the owner drew on is a statement about what the surface should
 * look like, and it OUTRANKS prose — his own or anyone's. That is why the
 * inbox takes unnamed images: naming them would ask him to describe in a
 * filename what he already drew, and the drawing is better evidence.
 *
 * The surface and the ZIP are identified from the image's own CONTENT, never
 * from its filename. An image that cannot be identified is LISTED, by
 * filename, with a best guess and ONE specific question — never silently
 * skipped, and never guessed at in the record.
 *
 * ## The two column families, and the boundary between them
 *
 * The workbook has YELLOW columns (the owner's) and GRAY columns (the
 * machine's). A sweep may never write in a yellow column. The owner states the
 * defect; the machine states what it did about it, and the two never overwrite
 * each other's account of the same row.
 *
 * ## The gate
 *
 * **Stated N equals rendered rows applies to the inbox.** Every image found is
 * either processed or listed as unidentifiable; every workbook row marked NEW
 * is either picked up or listed. An item in neither list is an item a sweep
 * silently dropped, and that fails the sweep gate — which is the whole point
 * of having one.
 */

/* ------------------------------------------------------------- the inbox */

/** Image extensions the inbox accepts. Anything else is reported, not read. */
export const INBOX_IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif"] as const;

export function isInboxImage(filename: string): boolean {
  const lower = filename.toLowerCase();
  return INBOX_IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** What a sweep did with one image. Every found image lands in exactly one. */
export type ImageDisposition =
  | {
      readonly kind: "PROCESSED";
      readonly file: string;
      /** The surface identified from the image's CONTENT. */
      readonly surface: string;
      readonly zip: string;
      /** The permanent VisualAcceptanceCheck the image became. */
      readonly checkId: string;
      /** Where it was moved to once handled. */
      readonly movedTo: string;
    }
  | {
      readonly kind: "UNIDENTIFIABLE";
      readonly file: string;
      /** The best guess, stated AS a guess and never recorded as a fact. */
      readonly bestGuess: string;
      /** ONE specific question. Not a list — a list is a survey, not an ask. */
      readonly question: string;
    };

/* ---------------------------------------------------------- the workbook */

/** The owner's columns. A sweep reads these and never writes them. */
export const OWNER_COLUMNS = [
  "Date",
  "ZIP",
  "Page",
  "What's wrong",
  "What's right + source",
  "Status",
] as const;

/** The machine's columns. Only a sweep writes these. */
export const MACHINE_COLUMNS = ["WorkItem", "Check ID", "Machine notes"] as const;

/**
 * The Status values, and the order a row moves through them.
 *
 * `Status` is deliberately in the OWNER family even though the sweep advances
 * it: it is the column the owner reads to know where his report got to, and
 * splitting "what I said" from "where it got to" across two columns would make
 * him read two places to learn one thing. The sweep writes ONLY the machine
 * transitions below and never overwrites an owner-authored value.
 */
export const STATUS_FLOW = ["NEW", "PICKED UP", "FIXED", "CHECK EXISTS"] as const;
export type DefectStatus = (typeof STATUS_FLOW)[number];

export function nextStatus(current: string): DefectStatus | null {
  const at = (STATUS_FLOW as readonly string[]).indexOf(current.trim().toUpperCase());
  if (at === -1 || at === STATUS_FLOW.length - 1) return null;
  return STATUS_FLOW[at + 1];
}

export interface DefectRow {
  readonly rowIndex: number;
  readonly date: string;
  readonly zip: string;
  readonly page: string;
  readonly whatsWrong: string;
  readonly whatsRight: string;
  readonly status: string;
  readonly workItem: string;
  readonly checkId: string;
}

/** What a sweep did with one workbook row. Every NEW row lands in exactly one. */
export type RowDisposition =
  | {
      readonly kind: "PICKED_UP";
      readonly rowIndex: number;
      readonly workItemId: string;
      readonly checkId: string | null;
      readonly status: DefectStatus;
    }
  | {
      readonly kind: "UNPROCESSABLE";
      readonly rowIndex: number;
      /** What is missing, precisely, so the owner is asked once and exactly. */
      readonly question: string;
    };

/**
 * A row with "What's right + source" filled is also a candidate ControlFact.
 *
 * The owner has done the verification work — he stated what is right AND where
 * he saw it — which is the whole content of a control fact. Surfacing it as a
 * candidate is not the same as loading it: only the owner marking it CONFIRMED
 * on the control-facts tab makes it an answer-key entry, because a control the
 * machine promoted itself is the machine grading its own homework.
 */
export function isControlFactCandidate(row: DefectRow): boolean {
  return row.whatsRight.trim().length > 0;
}

/* ---------------------------------------------------------------- the gate */

export interface SweepAccounting {
  readonly imagesFound: readonly string[];
  readonly imageDispositions: readonly ImageDisposition[];
  readonly rowsNew: readonly number[];
  readonly rowDispositions: readonly RowDisposition[];
}

export interface SweepGateVerdict {
  readonly ok: boolean;
  /** Images found and neither processed nor listed. */
  readonly unaccountedImages: readonly string[];
  /** NEW rows neither picked up nor listed. */
  readonly unaccountedRows: readonly number[];
  readonly detail: string;
}

/**
 * **THE SWEEP GATE.** Stated N equals rendered rows, mechanically.
 *
 * An image or a row that a sweep neither handled nor NAMED is one it dropped,
 * and a dropped item is invisible: the owner reported something and nothing
 * ever came back about it. That is the failure this gate exists to make loud,
 * and it is why "unidentifiable" is a first-class disposition rather than a
 * skip — an item we cannot identify is still an item we owe an answer about.
 */
export function sweepGate(accounting: SweepAccounting): SweepGateVerdict {
  const handledImages = new Set(accounting.imageDispositions.map((d) => d.file));
  const unaccountedImages = accounting.imagesFound.filter((f) => !handledImages.has(f));

  const handledRows = new Set(accounting.rowDispositions.map((d) => d.rowIndex));
  const unaccountedRows = accounting.rowsNew.filter((i) => !handledRows.has(i));

  const ok = unaccountedImages.length === 0 && unaccountedRows.length === 0;
  return {
    ok,
    unaccountedImages,
    unaccountedRows,
    detail: ok
      ? `every one of ${accounting.imagesFound.length} image(s) and ` +
        `${accounting.rowsNew.length} NEW row(s) is accounted for`
      : `${unaccountedImages.length} image(s) and ${unaccountedRows.length} NEW row(s) were ` +
        "neither processed nor listed. An item a sweep drops is an item the owner reported " +
        "and never heard back about.",
  };
}
