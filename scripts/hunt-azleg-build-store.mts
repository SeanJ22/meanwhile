import { readFileSync, writeFileSync } from "node:fs";

import type {
  ExecutiveAction,
  ExecutiveActionStore,
} from "../lib/officials/executive-actions.ts";
import type { ChapterStamp, ParsedLetter } from "./hunt-azleg-parse.mts";

/**
 * **THE HUNT STATE, TURNED INTO THE COMMITTED RECORD.** (AZ04, 2026-08-28.)
 *
 * Separate from the hunter because collection and publication are different
 * acts with different failure modes. The hunter is allowed to be interrupted
 * at request 37 of 417; this runs over whatever it banked and emits a store
 * whose every row is sourced and whose denominators say what the walk did NOT
 * reach. Re-running it after more collection is the whole point.
 *
 * ## The three rules it enforces on the way out
 *
 *  1. **A row exists only for a document that was actually retrieved.** An
 *     indexed-but-unfetched bill contributes to the DENOMINATOR and never to
 *     `actions`. The index is evidence that the document exists; it is not
 *     evidence of what the document says.
 *  2. **A disposition is copied, never derived.** The 151 lettered bills and
 *     the 264 chaptered bills are disjoint — asserted below, not assumed — and
 *     nothing here turns "has a letter and no chapter" into "vetoed".
 *  3. **The executive-order rows already in the store are carried through
 *     unchanged.** They were collected under a different walk against a
 *     different host, and rebuilding them from a source this script never read
 *     would be inventing them.
 *
 *     pnpm exec tsx scripts/hunt-azleg-build-store.mts
 */

const STATE_PATH = process.argv[2] ?? "data/hunt/azleg-actions-progress.json";
const STORE_PATH = process.argv[3] ?? "data/officials/az-governor-actions.json";

const SEAT = "statewide:az/governor";
const NAME = "Katie Hobbs";
const OFFICE = "Governor";
const OCD = "ocd-division/country:us/state:az";
const ORG = "Arizona State Legislature";

interface HuntChapter {
  chapter: number;
  billNumber: string;
  shortTitle: string;
  chapteredVersionUrl: string;
  sessionId: string | null;
  status: number | null;
  extract: { outcome: string } | null;
  stamp: ChapterStamp | null;
}
interface HuntLetter {
  billNumber: string;
  letterUrl: string;
  sessionId: string | null;
  status: number | null;
  parsed: ParsedLetter | null;
}
interface HuntState {
  lastRunAt: string;
  requestsMade: number;
  index: {
    letters: { rowCount: number } | null;
    sessionLaws: { rowCount: number; missingChapters: number[] } | null;
  };
  chapters: Record<string, HuntChapter>;
  letters: Record<string, HuntLetter>;
  ocrEngine: { available: boolean; note: string } | null;
}

const state = JSON.parse(readFileSync(STATE_PATH, "utf8")) as HuntState;
const previous = JSON.parse(readFileSync(STORE_PATH, "utf8")) as ExecutiveActionStore;

/** The collection date comes from the walk, never from this process's clock. */
const collectedAt = state.lastRunAt.slice(0, 10);
const sessionOf = (s: string | null) => s ?? "57leg/2r";

/* ── the executive orders already held, carried through and widened ─────── */

const carried: ExecutiveAction[] = previous.actions
  .filter((a) => a.kind === "EXECUTIVE_ORDER")
  .map((a) => ({
    ...a,
    /* The new fields, filled with what is TRUE of an executive order rather
       than with a placeholder: an EO belongs to no legislative session, is not
       a chapter of session law, and covers no bills. */
    occurredAtState: a.occurredAt ? ("PUBLISHED" as const) : ("NOT_PUBLISHED_BY_SOURCE" as const),
    sessionId: null,
    chapter: null,
    coveredBills: [],
    enactmentRoute: null,
  }));

/* ── the chaptered versions ─────────────────────────────────────────────── */

const chapters = Object.values(state.chapters).sort((a, b) => a.chapter - b.chapter);
const chaptersRead = chapters.filter((c) => c.status === 200 && c.extract?.outcome === "EXTRACTED");

const chapterRows: ExecutiveAction[] = chaptersRead.map((c) => {
  const route = c.stamp?.route ?? "UNDETERMINED";
  const approved = c.stamp?.approvedAt ?? null;
  const filed = c.stamp?.filedAt ?? null;

  /*
   * **THE KIND IS THE STAMP'S ANSWER, NOT THE CHAPTER'S EXISTENCE.**
   *
   * Only an act that says "APPROVED BY THE GOVERNOR" on it is filed as
   * BILL_SIGNED. Everything else became law by a road the document names
   * differently, or by one it does not name at all, and calling any of those a
   * signature would be a claim about a governmental act that no document here
   * supports.
   */
  const signed = route === "APPROVED_BY_GOVERNOR" && approved !== null;
  const occurredAt = signed ? approved : filed;

  return {
    id: `az-chapter-${sessionOf(c.sessionId).replace("/", "-")}-${String(c.chapter).padStart(4, "0")}`,
    officeholderId: SEAT,
    officeholderName: NAME,
    officeTitle: OFFICE,
    ocdId: OCD,
    kind: signed ? ("BILL_SIGNED" as const) : ("BILL_ENACTED" as const),
    designation: c.billNumber,
    title: c.shortTitle || null,
    occurredAt,
    occurredAtState: occurredAt
      ? ("PUBLISHED" as const)
      : ("NOT_PUBLISHED_BY_SOURCE" as const),
    sourceUrl: "https://www.azleg.gov/sessionlaws/",
    documentUrl: c.chapteredVersionUrl,
    sourceOrg: ORG,
    collectedAt,
    sessionId: sessionOf(c.sessionId),
    chapter: String(c.chapter),
    coveredBills: [c.billNumber],
    enactmentRoute: route,
  };
});

/* ── the governor's letters ─────────────────────────────────────────────── */

const letters = Object.values(state.letters).sort((a, b) => (a.billNumber < b.billNumber ? -1 : 1));
const lettersFetched = letters.filter((l) => l.status === 200);

const letterRows: ExecutiveAction[] = lettersFetched.map((l) => {
  const parsed = l.parsed;
  const disposition = parsed?.disposition ?? "UNREAD";

  /*
   * UNREAD and UNDETERMINED both land on BILL_LETTER_UNREAD, and they mean
   * subtly different things — nobody looked, versus looked and could not tell.
   * Neither is a disposition, and the store refuses to guess between them by
   * promoting either one into an outcome. What reaches a reader from both is
   * the same honest sentence: we have the letter and have not read it.
   */
  const kind =
    disposition === "VETOED"
      ? ("VETO" as const)
      : disposition === "SIGNED"
        ? ("BILL_SIGNED" as const)
        : disposition === "ALLOWED_WITHOUT_SIGNATURE"
          ? ("BILL_ENACTED" as const)
          : ("BILL_LETTER_UNREAD" as const);

  const occurredAt = kind === "BILL_LETTER_UNREAD" ? null : (parsed?.date ?? null);

  return {
    id: `az-govletter-${sessionOf(l.sessionId).replace("/", "-")}-${l.billNumber.toLowerCase()}`,
    officeholderId: SEAT,
    officeholderName: NAME,
    officeTitle: OFFICE,
    ocdId: OCD,
    kind,
    designation: l.billNumber,
    /* The letters index publishes a bill number and a link and NO title, and
       the lettered set shares no bill with the titled chapter set. There is
       nothing to borrow, so the title is null and says so. */
    title: null,
    occurredAt,
    occurredAtState: occurredAt
      ? ("PUBLISHED" as const)
      : ("NOT_YET_READ" as const),
    sourceUrl: "https://www.azleg.gov/governors-letters/",
    documentUrl: l.letterUrl,
    sourceOrg: ORG,
    collectedAt,
    sessionId: sessionOf(l.sessionId),
    chapter: null,
    coveredBills: parsed?.coveredBills?.length ? parsed.coveredBills : [l.billNumber],
    enactmentRoute: null,
  };
});

/* ── the refusals, checked rather than trusted ───────────────────────────── */

const chapterBills = new Set(chapterRows.map((r) => r.designation));
const collision = letterRows.filter((r) => chapterBills.has(r.designation));
if (collision.length > 0) {
  /* Measured at zero when the indexes were walked. If it ever stops being
     zero, one bill would get two rows with two different dispositions, and the
     right response is a human deciding which document governs — never a
     silent merge picked by whichever array was concatenated second. */
  throw new Error(
    `${collision.length} bill(s) appear in BOTH the letters index and the chapters index ` +
      `(${collision.map((r) => r.designation).join(", ")}). The measured intersection was ZERO. ` +
      "Refusing to emit two rows for one bill — decide which document governs.",
  );
}

const actions = [...carried, ...chapterRows, ...letterRows];
const ids = new Set(actions.map((a) => a.id));
if (ids.size !== actions.length) throw new Error("duplicate action ids — refusing to write");

for (const a of actions) {
  if (a.occurredAt === null && a.occurredAtState === "PUBLISHED") {
    throw new Error(`${a.id} claims a published date and carries none`);
  }
  if (a.kind === "BILL_SIGNED" && a.occurredAt === null) {
    throw new Error(`${a.id} is filed as signed with no date read from a document`);
  }
}

/* ── the store ──────────────────────────────────────────────────────────── */

const lettersRead = lettersFetched.filter(
  (l) => l.parsed && l.parsed.disposition !== "UNREAD" && l.parsed.disposition !== "UNDETERMINED",
).length;

const store: ExecutiveActionStore = {
  note: previous.note,
  source: previous.source,
  denominator: previous.denominator,
  legislative: {
    sessionId: "57leg/2r",
    index: {
      chapters: "https://www.azleg.gov/sessionlaws/",
      letters: "https://www.azleg.gov/governors-letters/",
    },
    permission:
      "www.azleg.gov robots.txt: User-agent: *, Crawl-delay: 120 — honoured on every request. " +
      "/sessionlaws/, /legtext/ and /govlettr/ are not among the named disallows. " +
      "apps.azleg.gov publishes Disallow: / and was never requested.",
    chaptersIndexed: state.index.sessionLaws?.rowCount ?? 0,
    chaptersRead: chaptersRead.length,
    chaptersMissingFromIndex: state.index.sessionLaws?.missingChapters ?? [],
    lettersIndexed: state.index.letters?.rowCount ?? 0,
    lettersRetrieved: lettersFetched.length,
    lettersRead,
    letterReadWall: state.ocrEngine?.available
      ? "None — an OCR engine is present and the letters are read mechanically."
      : "REQUIRES_NEW_ADAPTER. The letters at /govlettr/ are mixed-raster SCANS (measured: /Font 0, " +
        "/Image 40, /CCITTFaxDecode 18) and the repo's text-layer instrument returns ZERO_ROWS on them. " +
        "No OCR engine is installed, so lib/extract/ocr.ts returns CANNOT_RUN. The documents are held " +
        "with their URLs and are NOT READ. This is a blocked ROUTE and never a blocked FACT: nothing " +
        "about what these letters decided may be inferred from their being unread, and nothing about " +
        "a bill's fate may be inferred from its having a letter.",
    signingDateGap:
      "None for chaptered bills. Each chaptered version carries its own enactment stamp — " +
      "'APPROVED BY THE GOVERNOR <date>' / 'FILED IN THE OFFICE OF THE SECRETARY OF STATE <date>' — " +
      "and the date on a row is read from it. A prior session recorded this as unavailable after " +
      "grepping the PDF BYTES, where a born-digital PDF's text is compressed and invisible to grep; " +
      "the session's general effective date was never substituted and must never be.",
    openRoutes: [
      {
        route: "https://www.azleg.gov/govlettr/57leg/2r/<billno>.pdf",
        state: state.ocrEngine?.available ? "OPEN" : "REQUIRES_NEW_ADAPTER",
        why: "Scanned letters; OCR is the named rung. Install Tesseract and re-run the letters phase.",
      },
      {
        route: "prior sessions of /governors-letters/ and /sessionlaws/",
        state: "REQUIRES_NEW_ADAPTER",
        why:
          "The session picker offers 108 sessions back to 2009 (value 130 = 2026 57th-2R). The switch " +
          "is driven by az.js under /azlegwp/, which is DISALLOWED, and ?sessionId= is IGNORED (a " +
          "byte-identical response, proved). Prior sessions are NOT absent — the deterministic " +
          "/govlettr/<leg>leg/<sess>/<billno>.pdf pattern remains a fallback wherever bill numbers " +
          "are known by another route.",
      },
      {
        route: "azhouse.gov, azsenate.gov",
        state: "RECHECK_DUE",
        why:
          "robots.txt unreadable by two independent clients; cause isolated to CERT_HAS_EXPIRED " +
          "(CN=azsenate.gov, GoDaddy, valid_to Aug 28 16:04:01 2026 GMT). Transport state is not a " +
          "permission verdict (RULING 182). CANNOT_TELL fails safe for the route; not walked.",
      },
      {
        route: "apps.azleg.gov BillStatus / BillOverview",
        state: "DISALLOWED",
        why:
          "User-agent: * / Disallow: /. Never requested. Its URLs may travel as cross-reference " +
          "strings for a human to click and are never fetched. A disallow is not re-walked on a clock.",
      },
    ],
    collectedAt,
  },
  actions,
};

writeFileSync(STORE_PATH, `${JSON.stringify(store, null, 2)}\n`, "utf8");

const by = (k: string) => actions.filter((a) => a.kind === k).length;
console.log(`wrote ${STORE_PATH}`);
console.log(`  EXECUTIVE_ORDER ${by("EXECUTIVE_ORDER")}  BILL_SIGNED ${by("BILL_SIGNED")}  BILL_ENACTED ${by("BILL_ENACTED")}  VETO ${by("VETO")}  BILL_LETTER_UNREAD ${by("BILL_LETTER_UNREAD")}`);
console.log(`  chapters ${chaptersRead.length} read of ${store.legislative!.chaptersIndexed} indexed (missing from index: ${store.legislative!.chaptersMissingFromIndex.length})`);
console.log(`  letters ${lettersFetched.length} retrieved and ${lettersRead} READ, of ${store.legislative!.lettersIndexed} indexed`);
console.log(`  rows with a published date: ${actions.filter((a) => a.occurredAt).length} of ${actions.length}`);
