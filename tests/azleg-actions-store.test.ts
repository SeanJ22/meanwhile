import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { extractTextLayer } from "../lib/extract/text-layer.ts";
import { runOcr } from "../lib/extract/ocr.ts";
import {
  actionText,
  type ExecutiveAction,
} from "../lib/officials/executive-actions.ts";

/*
 * The rendering rules over a small synthetic set of rows, one of each kind the store holds. The committed
 * store these tests once read is gone: production reads the promoted executive-action projection.
 */
const SEAT = "statewide:az/governor";
const VETO: ExecutiveAction = {
  id: "az-govletter-57leg-2r-hb2003",
  officeholderId: SEAT,
  officeholderName: "Katie Hobbs",
  officeTitle: "Governor",
  ocdId: "ocd-division/country:us/state:az",
  kind: "VETO",
  designation: "HB2003",
  title: null,
  occurredAt: "2026-06-19",
  occurredAtState: "PUBLISHED",
  sourceUrl: "https://www.azleg.gov/governors-letters/",
  documentUrl: "https://www.azleg.gov/govlettr/57leg/2r/hb2003.pdf",
  sourceOrg: "Arizona State Legislature",
  collectedAt: "2026-08-28",
  sessionId: "57leg/2r",
  chapter: null,
  coveredBills: ["HB2003"],
  enactmentRoute: null,
};
const CHAPTERED: ExecutiveAction = { ...VETO, id: "synthetic-chaptered", kind: "BILL_SIGNED", designation: "HB2001", coveredBills: ["HB2001"], chapter: "12",
  documentUrl: "https://www.azleg.gov/legtext/57leg/2R/laws/0012.pdf" };
const LETTERED: ExecutiveAction = { ...VETO, id: "synthetic-lettered", kind: "BILL_SIGNED", designation: "HB2002", coveredBills: ["HB2002"] };
const UNREAD: ExecutiveAction = { ...VETO, id: "synthetic-unread", kind: "BILL_LETTER_UNREAD", designation: "HB2004", coveredBills: ["HB2004"], occurredAt: null, occurredAtState: "NOT_YET_READ" };
const ALL: readonly ExecutiveAction[] = [VETO, CHAPTERED, LETTERED, UNREAD];

const fixture = (name: string) =>
  new Uint8Array(readFileSync(join(import.meta.dirname, "fixtures", name)));

test("RENDER: no row that is not a signing ever renders the word `signed`", () => {
  for (const action of ALL) {
    const text = actionText(action);
    if (action.kind === "VETO" || action.kind === "BILL_LETTER_UNREAD") {
      assert.ok(
        !/\bsigned\b/i.test(text),
        `${action.id} (${action.kind}) rendered the word "signed": ${text}`,
      );
    }
  }
});

test("RENDER: a veto says vetoed, and never asserts a signature", () => {
  const veto: ExecutiveAction = {
    id: "az-govletter-57leg-2r-hb2003",
    officeholderId: SEAT,
    officeholderName: "Katie Hobbs",
    officeTitle: "Governor",
    ocdId: "ocd-division/country:us/state:az",
    kind: "VETO",
    designation: "HB2003",
    title: null,
    occurredAt: "2026-06-19",
    occurredAtState: "PUBLISHED",
    sourceUrl: "https://www.azleg.gov/governors-letters/",
    documentUrl: "https://www.azleg.gov/govlettr/57leg/2r/hb2003.pdf",
    sourceOrg: "Arizona State Legislature",
    collectedAt: "2026-08-28",
    sessionId: "57leg/2r",
    chapter: null,
    coveredBills: ["HB2003"],
    enactmentRoute: null,
  };
  const text = actionText(veto);
  assert.match(text, /vetoed by the Governor on 2026-06-19/);
  assert.ok(!/\bsigned\b/i.test(text), text);
});

test("RENDER: an enacted bill with no recognised stamp does not claim she signed it", () => {
  const enacted: ExecutiveAction = {
    ...CHAPTERED,
    kind: "BILL_ENACTED",
    enactmentRoute: "UNDETERMINED",
    occurredAt: null,
    occurredAtState: "NOT_PUBLISHED_BY_SOURCE",
    chapter: "7",
  };
  const text = actionText(enacted);
  assert.match(text, /became Arizona session law as Chapter 7/);
  assert.match(text, /does not state whether the Governor signed it/);
});

test("RENDER: a signed bill cites the DOCUMENT its date came from", () => {
  /*
   * Two different sources produce a signed bill — the enrolled act's approval
   * stamp (which carries a chapter number) and a transmittal letter — and
   * citing the wrong one is a false statement about provenance.
   */
  const chaptered = ALL.find((a) => a.kind === "BILL_SIGNED" && a.chapter);
  if (chaptered) {
    const text = actionText(chaptered);
    assert.match(text, /chaptered as Chapter \d+/);
    assert.ok(!/transmittal letter/.test(text), text);
  }
  const lettered = ALL.find((a) => a.kind === "BILL_SIGNED" && !a.chapter);
  if (lettered) assert.match(actionText(lettered), /per her transmittal letter/);
});

test("RENDER: an unread letter says WE have not read it, in plain language", () => {
  const unread = ALL.find((a) => a.kind === "BILL_LETTER_UNREAD");
  assert.ok(unread, "the set holds a retrieved-but-unread letter");
  const text = actionText(unread!);
  /* OURS, not theirs, and no verdict on the bill. */
  assert.match(text, /\bWe have the letter but have not read it yet\b/);
  assert.match(text, /we cannot say what it decided/i);
  assert.ok(!/veto/i.test(text), `an unread letter must not mention a veto: ${text}`);
  assert.equal(unread!.occurredAtState, "NOT_YET_READ");
  assert.ok(unread!.documentUrl, "and we can still link the reader to the document");
});

test("RENDER: no rendered sentence ever contains a null, undefined or empty quote", () => {
  for (const action of ALL) {
    const text = actionText(action);
    assert.ok(!/null|undefined|""/.test(text), `${action.id}: ${text}`);
    assert.ok(text.endsWith("."), `${action.id} does not end as a sentence: ${text}`);
  }
});

test("PDF: a chaptered version is born-digital and its text layer reads", async () => {
  const result = await extractTextLayer(fixture("azleg-legtext-0001.pdf"), "chapter 1");
  assert.equal(result.outcome, "EXTRACTED");
  assert.ok(result.rows >= 5, `only ${result.rows} pages of text`);
});

test("PDF: a governor's letter is a SCAN, and that reports as a failed read, not an empty document", async () => {
  const text = await extractTextLayer(fixture("azleg-govlettr-hb2003.pdf"), "hb2003 letter");
  assert.equal(text.outcome, "ZERO_ROWS", "a scan has no text layer to read");
  assert.equal(text.rows, 0);
  assert.ok(text.reason.length > 0, "and it says WHY, rather than returning an empty document");

  /* A fresh read: pdfjs detaches the buffer it is handed. */
  const ocr = await runOcr(fixture("azleg-govlettr-hb2003.pdf"), "hb2003 letter", {
    binary: "definitely-not-a-real-binary",
  });
  assert.equal(ocr.outcome, "CANNOT_RUN");
  assert.match(ocr.reason, /not.*PATH|no OCR engine/i);
});
