import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { extractTextLayer } from "../lib/extract/text-layer.ts";
import { runOcr } from "../lib/extract/ocr.ts";
import {
  actionText,
  actionsFor,
  executiveActionStore,
  resetExecutiveActionCache,
  undatedFor,
  type ExecutiveAction,
} from "../lib/officials/executive-actions.ts";

const store = executiveActionStore();
assert.ok(store, "the committed store must be readable from the repo root");

const ALL = store.actions;
const SEAT = "statewide:az/governor";

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
    ...ALL.find((a) => a.kind === "BILL_SIGNED" || a.kind === "BILL_ENACTED")!,
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
  assert.ok(unread, "the store holds at least one retrieved-but-unread letter");
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

test("SCHEMA: a date is either published-and-read, or null with a reason naming whose gap it is", () => {
  for (const action of ALL) {
    if (action.occurredAt === null) {
      assert.ok(
        action.occurredAtState === "NOT_PUBLISHED_BY_SOURCE" ||
          action.occurredAtState === "NOT_YET_READ",
        `${action.id} has no date and no reason`,
      );
    } else {
      assert.equal(action.occurredAtState, "PUBLISHED", action.id);
      assert.match(action.occurredAt, /^\d{4}-\d{2}-\d{2}$/, action.id);
    }
  }
});

test("SCHEMA: nothing is filed as SIGNED without a date read from a document", () => {
  for (const action of ALL.filter((a) => a.kind === "BILL_SIGNED")) {
    assert.ok(action.occurredAt, `${action.id} claims a signing with no date`);
    assert.equal(action.enactmentRoute ?? "APPROVED_BY_GOVERNOR", "APPROVED_BY_GOVERNOR", action.id);
  }
});

test("SCHEMA: the session's general effective date is never used as a signing date", () => {
  /*
   * 2026-09-12 is the 57leg/2r general effective date — a fact about when laws
   * start working, and no evidence about when anyone signed anything.
   * Substituting it would produce 264 plausible, sourced-looking, wrong dates.
   */
  for (const action of ALL) {
    assert.notEqual(action.occurredAt, "2026-09-12", `${action.id} used the effective date`);
  }
});

test("WINDOW: an undated row is neither smuggled into a window nor silently dropped", () => {
  resetExecutiveActionCache();
  const undated = undatedFor(SEAT);
  if (undated.length === 0) return;

  const windowed = actionsFor(SEAT, { from: "1900-01-01", to: "2999-12-31" });
  for (const a of windowed) {
    assert.ok(a.occurredAt, `${a.id} has no date and was placed inside a window anyway`);
  }
  /* And they are still HELD — an unwindowed call returns everything. */
  const held = actionsFor(SEAT);
  for (const a of undated) {
    assert.ok(held.some((h) => h.id === a.id), `${a.id} vanished from the unwindowed result`);
  }
});

test("NEVER INFERRED: no bill is called a veto because it has a letter and no chapter", () => {
  /* Every VETO must carry a date, which only comes from a letter actually read. */
  for (const veto of ALL.filter((a) => a.kind === "VETO")) {
    assert.ok(
      veto.occurredAt,
      `${veto.id} is a veto with no date — the shape a derived veto would have`,
    );
    assert.equal(veto.occurredAtState, "PUBLISHED", veto.id);
  }

  /* And an unread letter is never promoted to an outcome. */
  for (const letter of ALL.filter((a) => a.kind === "BILL_LETTER_UNREAD")) {
    assert.equal(letter.occurredAt, null, `${letter.id} invented a date for an unread document`);
  }
});

test("DENOMINATOR: the legislative half states what it did NOT reach", () => {
  const leg = store.legislative;
  assert.ok(leg, "the legislative denominator travels with the store");
  assert.equal(leg!.chaptersIndexed, 264);
  assert.equal(leg!.lettersIndexed, 151);
  assert.deepEqual(leg!.chaptersMissingFromIndex, []);
  assert.ok(leg!.chaptersRead <= leg!.chaptersIndexed);
  assert.ok(leg!.lettersRead <= leg!.lettersRetrieved);
  assert.ok(leg!.lettersRetrieved <= leg!.lettersIndexed);

  /* Every row in the store must be backed by a document that was retrieved. */
  const bills = ALL.filter((a) => a.kind !== "EXECUTIVE_ORDER");
  assert.ok(
    bills.length <= leg!.chaptersRead + leg!.lettersRetrieved,
    "more rows than documents retrieved — a row exists that nothing was read for",
  );
});

test("ROBOTS RECORDED: apps.azleg.gov's Disallow is recorded as read, and every row cites the document actually read", () => {
  const leg = store.legislative!;
  // `[\s\S]` rather than the dotAll flag: `s` needs an es2018 target and this
  // tsconfig is below it, so the flag is a build error rather than a nicety.
  assert.match(leg.permission, /apps\.azleg\.gov[\s\S]*Disallow/);
  assert.match(leg.permission, /Crawl-delay: 120/);
  for (const action of ALL) {
    for (const url of [action.sourceUrl, action.documentUrl ?? ""]) {
      assert.ok(
        !url.includes("apps.azleg.gov"),
        `${action.id} cites ${url}; no adapter reads apps.azleg.gov, so a row citing it cites something nothing read`,
      );
    }
  }
});

test("WALLS: every remaining wall is a ROUTE state, never an assertion of absence", () => {
  const routes = store.legislative!.openRoutes;
  assert.ok(routes.length >= 3);
  const allowed = new Set(["OPEN", "REQUIRES_NEW_ADAPTER", "RECHECK_DUE", "BLOCKED_CURRENTLY", "DISALLOWED"]);
  for (const route of routes) {
    assert.ok(allowed.has(route.state), `${route.route} has an unrecognised state ${route.state}`);
    assert.ok(route.why.length > 40, `${route.route} does not say why`);
    /* The prohibition: a wall may never be written down as the record's absence. */
    assert.ok(
      !/does not (exist|publish)|is not published|no such record/i.test(route.why),
      `${route.route} states an ABSENCE rather than a route state: ${route.why}`,
    );
  }
  assert.ok(
    routes.some((r) => r.state === "RECHECK_DUE" && /CERT_HAS_EXPIRED/.test(r.why)),
    "an expired certificate is recorded as transport state, never as a permission verdict",
  );
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
