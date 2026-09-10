import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  civicDataReadNotInitialized,
  mayUseTestFixture,
  promotedVersionOrThrow,
  readPromotedCivicData,
  readPromotedOrBootstrap,
  type CivicDataBootstrap,
  type CivicDataReadResult,
  type PromotedCivicDataReadOptions,
} from "../civic-data/read-model.ts";
import { AZ_OFFICIAL_ACTIONS_CONTRACT } from "../outcomes/data-plane.ts";

/**
 * **WHAT AN OFFICEHOLDER HAS DONE, from the office's own publication.**
 * (AZ03, 2026-08-28.)
 *
 * ## The lead was a reader's question
 *
 * The grounded Ask pipeline was asked *"What did Katie Hobbs do for the state
 * of Arizona in the last 12 months?"* and answered honestly that it holds who
 * she IS and nothing about what she has DONE — `lib/votes/` is congressional
 * only and no store of gubernatorial actions existed. That honest gap was the
 * lead, and this is the store it opened. Reader demand located the gap; the
 * hunt followed it.
 *
 * ## What a row is, and what it is not
 *
 * Every row is a GOVERNMENTAL ACTION with a date and a signed primary document
 * behind it: an executive order's number, its title as the office titles it,
 * the date it was signed, the office's own detail page, and the PDF. Nothing
 * here is read from a press summary, nothing is inferred, and nothing is
 * paraphrased — the title is the office's own words.
 *
 * **It is deliberately NOT a record of everything a governor does.** Signed
 * bills and vetoes are a different publication with a different permission
 * story: the legislature's modern bill-status application lives on
 * `apps.azleg.gov`, which publishes `User-agent: * / Disallow: /`, so there is
 * no permitted route through it and none was attempted. `www.azleg.gov` is
 * allowed with a 120-second crawl delay and is the eligible branch that remains.
 *
 * ## The denominator travels, because a partial is a different answer
 *
 * The file carries how many orders the index held, how many index pages were
 * walked, and how many detail pages were actually read. An answer built from
 * this may say *"the actions in the records we currently hold"* and may never
 * say *"everything she did"* — and the numbers are what makes the first
 * sentence checkable rather than modest.
 */

/**
 * **WHAT KIND OF ACT THE ROW RECORDS — and every value is something we READ.**
 * (Extended by AZ04, 2026-08-28, when `www.azleg.gov` turned out to publish
 * the legislative half after all.)
 *
 * The two additions are both refusals to overstate a document.
 *
 * `BILL_ENACTED` exists because **a chapter of session law is proof of
 * ENACTMENT and is not proof of a SIGNATURE.** `/sessionlaws/` publishes
 * chapter number, bill number and short title; a bill reaches a chapter by
 * signature, by lapsing into law unsigned, or over a veto, and the index does
 * not say which. Filing all 264 chapters as `BILL_SIGNED` would assert a
 * gubernatorial act for every bill that became law without her — the same
 * class of false claim as the hardcoded word "signed" that `actionText` used
 * to emit. `BILL_SIGNED` and `VETO` therefore stay reserved for a row whose
 * disposition was read out of the Governor's own letter.
 *
 * `BILL_LETTER_UNREAD` exists because the letters at `/govlettr/` are SCANS —
 * measured: `/Font 0`, `/Image 40`, `/CCITTFaxDecode 18`, and the repo's own
 * text-layer instrument returns `ZERO_ROWS` on them — and no OCR engine is
 * installed. That the Governor transmitted a letter about a given bill IS a
 * fact, published in her legislature's own index, and it is held here with the
 * document's URL. What the letter SAYS is not known, and the row says so.
 * A blocked route is never a blocked fact.
 */
export type ExecutiveActionKind =
  | "EXECUTIVE_ORDER"
  /** Chaptered as session law. Enactment — NEVER read as a signature. */
  | "BILL_ENACTED"
  /** Only ever from a transmittal letter whose own words say she signed it. */
  | "BILL_SIGNED"
  /** Only ever from a transmittal letter whose own words say she vetoed it. */
  | "VETO"
  /** A letter we hold, with a URL, that nobody has read yet. OURS, not theirs. */
  | "BILL_LETTER_UNREAD"
  | "PROCLAMATION";

/**
 * **WHY A ROW HAS NO DATE — and whose fact that is.**
 *
 * A null date with no explanation is the render-default defect waiting to
 * happen: "we never read it" and "they never published it" are different
 * facts about different parties, and a surface that showed them as the same
 * blank would be making one of them up.
 */
export type OccurredAtState =
  /** The source published a date and it was read off the document. */
  | "PUBLISHED"
  /**
   * THEIRS. The source publishes no such date. Arizona's chaptered versions
   * carry no approval date and the Governor's office publishes no bill index,
   * so an enacted bill has no published signing date to hold. The session's
   * general effective date is NOT a substitute — it says when a law starts
   * working, not when anyone signed it.
   */
  | "NOT_PUBLISHED_BY_SOURCE"
  /** OURS. The document exists, we hold its URL, and nobody has read it yet. */
  | "NOT_YET_READ";

export interface ExecutiveAction {
  id: string;
  /** The seat, as `lib/officials/statewide-executives.ts` ids it. */
  officeholderId: string;
  officeholderName: string;
  officeTitle: string;
  ocdId: string;
  kind: ExecutiveActionKind;
  /** "Executive Order 2026-02", or a bill's own number "HB2022". */
  designation: string;
  /**
   * The publisher's own title. Never rewritten, only entity-decoded.
   *
   * **Null is real here.** `/governors-letters/` publishes a bill number and a
   * link and no title at all, and the 151 lettered bills are DISJOINT from the
   * 264 chaptered ones (intersection measured at zero), so there is no second
   * index to borrow a title from. A borrowed or guessed title would be our
   * words presented as theirs.
   */
  title: string | null;
  /**
   * `YYYY-MM-DD` when the source published one, and NULL when it did not.
   *
   * Nullable rather than a sentinel, deliberately. Every non-date string that
   * could sit here — `""`, `"UNKNOWN"`, the session's effective date — either
   * sorts as if it were a date or renders as if it were one, and the last of
   * those is a fabrication. `null` is the shape the type system forces every
   * caller to handle, and `occurredAtState` says whose gap it is.
   */
  occurredAt: string | null;
  occurredAtState: OccurredAtState;
  sourceUrl: string;
  /** The signed document. Null only where the office published none. */
  documentUrl: string | null;
  sourceOrg: string;
  collectedAt: string;
  /** `57leg/2r` for a legislative row; null for an executive order. */
  sessionId: string | null;
  /** Chapter of session law, as published. Null unless the bill was chaptered. */
  chapter: string | null;
  /**
   * Every bill one document covers, when the document covers more than one.
   *
   * A single letter can dispose of several bills — SB1002's reads *"Today I
   * vetoed the following bills:"* and then enumerates them — and the index
   * gives each of those bills its own row and its own copy of the same PDF.
   * The store therefore keys on the BILL and carries the letter's full reach
   * here, so a reader is never shown one bill's disposition as though the
   * document were only about that bill.
   */
  coveredBills: string[];
  /**
   * **HOW AN ENACTED BILL BECAME LAW, off the act's own enactment stamp.**
   *
   * Arizona's chaptered versions end with a stamp — *"APPROVED BY THE GOVERNOR
   * FEBRUARY 6, 2026. FILED IN THE OFFICE OF THE SECRETARY OF STATE FEBRUARY
   * 6, 2026."* — and a bill reaches a chapter by three different roads. This
   * is which road the document names, so the rendered sentence can say it
   * instead of flattening all three into the word "signed".
   *
   * Null for anything that is not a chaptered bill.
   */
  enactmentRoute: "APPROVED_BY_GOVERNOR" | "WITHOUT_SIGNATURE" | "OVER_VETO" | "UNDETERMINED" | null;
}

export interface ExecutiveActionStore {
  note: string;
  source: {
    index: string;
    publisher: string;
    permission: string;
    collectedAt: string;
  };
  /**
   * **WHAT WAS SEARCHED, so an answer can state a denominator.**
   *
   * `reachedEndOfIndex` false means this is a FLOOR: more orders exist than
   * were indexed, and any sentence built on this must not imply completeness.
   */
  denominator: {
    indexedAcrossPagesWalked: number;
    indexPagesWalked: number;
    detailPagesRead: number;
    reachedEndOfIndex: boolean;
  };
  /**
   * **THE LEGISLATIVE HALF, WITH ITS OWN DENOMINATOR.** (AZ04, 2026-08-28.)
   *
   * A second block rather than more fields on the first, because the two
   * halves were walked against different hosts under different permissions and
   * a single merged count would let one half's completeness stand in for the
   * other's. Null while nothing legislative has been collected.
   */
  legislative: {
    /** `57leg/2r`, read out of the published paths rather than assumed. */
    sessionId: string;
    index: { chapters: string; letters: string };
    permission: string;
    /** Chapters the `/sessionlaws/` index carried. */
    chaptersIndexed: number;
    /** Chaptered versions actually retrieved AND extracted. */
    chaptersRead: number;
    /** Chapter numbers between 1 and the highest that the index did not carry. */
    chaptersMissingFromIndex: number[];
    /** Bills the `/governors-letters/` index carried. */
    lettersIndexed: number;
    /** Letter PDFs retrieved. */
    lettersRetrieved: number;
    /** Letters whose disposition was READ from the document's own words. */
    lettersRead: number;
    /** The named rung that stands between `lettersRetrieved` and `lettersRead`. */
    letterReadWall: string;
    /** Why an enacted bill here carries no signing date. */
    signingDateGap: string;
    /** Routes that are open questions, named as route states, never as absence. */
    openRoutes: { route: string; state: string; why: string }[];
    collectedAt: string;
  } | null;
  actions: ExecutiveAction[];
}

let actionReadState: CivicDataReadResult<ExecutiveActionStore> = civicDataReadNotInitialized(
  AZ_OFFICIAL_ACTIONS_CONTRACT.recordClass,
  AZ_OFFICIAL_ACTIONS_CONTRACT.scope,
  "The Arizona official-action pointer has not been read for this process.",
);

function actionTestSeed(): ExecutiveActionStore | null {
  if (!mayUseTestFixture()) return null;
  try {
    return JSON.parse(
      readFileSync(join(process.cwd(), "data", "states", "az", "officials", "az-governor-actions.json"), "utf8"),
    ) as ExecutiveActionStore;
  } catch {
    return null;
  }
}

function actionTestBootstrap(): CivicDataBootstrap<ExecutiveActionStore> {
  const value = actionTestSeed();
  if (!value) throw new Error("AZ_OFFICIAL_ACTION_TEST_SEED_MISSING");
  const sourceThrough = value.actions.map((action) => action.collectedAt).sort().at(-1) ?? value.source.collectedAt;
  return {
    value,
    sourceId: AZ_OFFICIAL_ACTIONS_CONTRACT.sourceId,
    version: sourceThrough,
    versionId: `test-seed:az-official-actions:${sourceThrough}`,
    sourceThrough,
    retrievedAt: /^\d{4}-\d{2}-\d{2}$/.test(sourceThrough) ? `${sourceThrough}T00:00:00.000Z` : sourceThrough,
    detail: "Node test fixture selected only inside the explicit test process.",
  };
}

function validateActionProjection(value: ExecutiveActionStore, version: string): void {
  if (!Array.isArray(value.actions) || value.actions.length === 0) {
    throw new Error(`Arizona official-action projection ${version} contains no action records.`);
  }
  if (new Set(value.actions.map((action) => action.id)).size !== value.actions.length) {
    throw new Error(`Arizona official-action projection ${version} contains duplicate action ids.`);
  }
}

/** Read the exact GOOD pointer. Production never opens the tracked first seed. */
export async function readExecutiveActionsProjection(
  options: PromotedCivicDataReadOptions = {},
): Promise<CivicDataReadResult<ExecutiveActionStore>> {
  actionReadState = mayUseTestFixture()
    ? await readPromotedOrBootstrap<ExecutiveActionStore>({
        ...options,
        recordClass: AZ_OFFICIAL_ACTIONS_CONTRACT.recordClass,
        scope: AZ_OFFICIAL_ACTIONS_CONTRACT.scope,
        bootstrap: actionTestBootstrap,
        allowUnconfiguredBootstrap: true,
      })
    : await readPromotedCivicData<ExecutiveActionStore>(
        AZ_OFFICIAL_ACTIONS_CONTRACT.recordClass,
        AZ_OFFICIAL_ACTIONS_CONTRACT.scope,
        options,
      );
  if (actionReadState.kind === "PROMOTED" || actionReadState.kind === "BOOTSTRAP") {
    validateActionProjection(actionReadState.value, actionReadState.metadata.versionId ?? "unknown");
  }
  return actionReadState;
}

export async function refreshExecutiveActionsFromPromoted(
  options: PromotedCivicDataReadOptions = {},
): Promise<string | null> {
  return promotedVersionOrThrow(await readExecutiveActionsProjection(options));
}

export const executiveActionsReadState = (): CivicDataReadResult<ExecutiveActionStore> => actionReadState;

/**
 * The committed store, or null.
 *
 * Null is a real state and is reported as one by every caller: "we hold no
 * action records" is a fact about us, and it may never render as a fact about
 * a government. Read through `process.cwd()`, which is why the route that
 * reaches it names `./data/officials/*.json` in `outputFileTracingIncludes` —
 * an untraced read on a serverless host returns null and the surface then says
 * we have recorded nothing, which is indistinguishable from honest missing data.
 */
export function executiveActionStore(): ExecutiveActionStore | null {
  if (actionReadState.kind === "PROMOTED" || actionReadState.kind === "BOOTSTRAP") return actionReadState.value;
  return actionReadState.kind === "STORE_UNREACHABLE" && actionReadState.code === "READ_NOT_INITIALIZED"
    ? actionTestSeed()
    : null;
}

/** Test seam — the suite must never inherit another test's cached read. */
export function resetExecutiveActionCache(): void {
  actionReadState = civicDataReadNotInitialized(
    AZ_OFFICIAL_ACTIONS_CONTRACT.recordClass,
    AZ_OFFICIAL_ACTIONS_CONTRACT.scope,
    "The Arizona official-action pointer has not been read for this process.",
  );
}

export interface ActionWindow {
  /** Inclusive `YYYY-MM-DD` floor. Omit for everything held. */
  from?: string | null;
  /** Inclusive `YYYY-MM-DD` ceiling. Omit for everything held. */
  to?: string | null;
}

/**
 * One officeholder's actions, newest first, optionally inside a window.
 *
 * **Selected on the officeholder ID, never on the name.** A name is not an
 * identity — the whole reason the Ask pipeline binds canonically — and a store
 * that matched on one would attach a governor's orders to anybody who shares
 * her name.
 *
 * The window is INCLUSIVE at both ends and is compared as ISO strings, which
 * sort correctly by date and carry no timezone to get wrong: an action's date
 * is the day the office published it, not an instant.
 */
export function actionsFor(
  officeholderId: string,
  window: ActionWindow = {},
): ExecutiveAction[] {
  const store = executiveActionStore();
  if (!store) return [];
  const mine = store.actions.filter((a) => a.officeholderId === officeholderId);

  /*
   * **AN UNDATED ROW CANNOT BE PLACED IN A WINDOW, AND IS NOT QUIETLY PLACED
   * IN ONE EITHER WAY.** (AZ04, 2026-08-28.)
   *
   * Two wrong answers were available here and both are silent. Including
   * undated rows in a windowed result claims they fall inside a period nobody
   * can show they fall inside. Dropping them claims the opposite, and hides
   * records we actually hold. So a windowed call returns the DATED matches
   * only — and `undatedFor` exists beside it so a caller cannot forget the
   * remainder, which the grounded route surfaces as a named gap.
   *
   * An UNWINDOWED call returns everything held, undated rows included: "what
   * do we have" has no date in the question.
   */
  const windowed = window.from || window.to;
  const selected = windowed
    ? mine.filter(
        (a) =>
          a.occurredAt !== null &&
          (window.from ? a.occurredAt >= window.from : true) &&
          (window.to ? a.occurredAt <= window.to : true),
      )
    : mine;

  /* Dated rows newest first; undated rows after them in a stable, explicitly
     NON-chronological order, because there is no chronology to sort them by. */
  return [...selected].sort((a, b) => {
    if (a.occurredAt && b.occurredAt) return a.occurredAt < b.occurredAt ? 1 : -1;
    if (a.occurredAt) return -1;
    if (b.occurredAt) return 1;
    return a.id < b.id ? -1 : 1;
  });
}

/**
 * The rows this officeholder has that carry NO date, and therefore cannot be
 * placed inside or outside any period a reader asks about.
 *
 * Separate from `actionsFor` on purpose: a windowed answer that just returned
 * fewer rows would have hidden these, and the count of what a date-shaped
 * question could not reach is itself something the reader is owed.
 */
export function undatedFor(officeholderId: string): ExecutiveAction[] {
  const store = executiveActionStore();
  if (!store) return [];
  return store.actions
    .filter((a) => a.officeholderId === officeholderId && a.occurredAt === null)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

/**
 * The ISO date `n` months before `today`, for a trailing-window question.
 *
 * Pure string arithmetic on a supplied date, because this module is not a
 * clock and an agent does not know today's date. A month subtraction that
 * lands on a day the target month does not have (the 31st of a 30-day month)
 * clamps to that month's last day rather than rolling into the next one —
 * rolling forward would silently NARROW the window a reader asked for.
 */
export function monthsBefore(today: string, months: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today);
  if (!m) return today;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const total = year * 12 + (month - 1) - months;
  const targetYear = Math.floor(total / 12);
  const targetMonth = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  const targetDay = Math.min(day, lastDay);
  return `${String(targetYear).padStart(4, "0")}-${String(targetMonth).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`;
}

/**
 * One action as a sentence, mechanically.
 *
 * Designation, title, date — the office's own facts, joined. Nothing is
 * summarised: a summary of an executive order is a claim about what a
 * government did, made by us.
 *
 * ## The word "signed" used to be hardcoded here, and that was a false claim
 * ## waiting for its first row (found and fixed by AZ04, 2026-08-28)
 *
 * The previous body was one template:
 *
 *     `${designation}, "${title}", signed ${occurredAt}.`
 *
 * It was correct for the only rows that existed — executive orders, which
 * genuinely are signed — and it was a landmine for every other kind the type
 * already declared. The first `VETO` row to reach a reader would have rendered
 * *`HB2003, "…", signed 2026-06-19.`* about a bill the Governor had just
 * refused to sign: a false statement about a governmental act, produced by a
 * render default, on the one surface where that is unsurvivable.
 *
 * So the sentence BRANCHES ON KIND, and three rules hold across every branch:
 *
 *  - **No branch asserts a signature that was not read.** `BILL_ENACTED` says
 *    a bill became law and names the chapter that proves it; it does not say
 *    who signed it, because the index that proves the enactment does not say.
 *  - **No branch invents a date.** A null date is never printed, never
 *    replaced with an effective date, and never dropped silently — the
 *    sentence simply does not make a claim it cannot source.
 *  - **An unread document says WE have not read it**, in plain language, and
 *    that is a fact about us. It is never phrased as though the Governor did
 *    nothing or as though the record does not exist.
 */
export function actionText(action: ExecutiveAction): string {
  const title = action.title ? ` "${action.title}",` : "";
  const on = action.occurredAt ? ` on ${action.occurredAt}` : "";

  switch (action.kind) {
    case "EXECUTIVE_ORDER":
      /* Wording unchanged from before this branch existed. Executive orders
         were already rendered correctly and there is no reason to churn a
         sentence that was never wrong. */
      return action.occurredAt
        ? `${action.designation},${title} signed ${action.occurredAt}.`
        : `${action.designation},${title} signed — the office publishes no date for it.`;

    case "BILL_ENACTED": {
      const chapter = action.chapter ? ` as Chapter ${action.chapter}` : "";
      const session = action.sessionId ? ` of the ${action.sessionId} session` : "";
      /* Passive, and deliberately so. Enactment is not one person's act, and
         this row is filed under the seat so it can be RETRIEVED, never to
         claim the officeholder performed it. The clause after the comma is the
         act's OWN account of how it got there — the whole reason this kind
         exists separately from BILL_SIGNED. */
      const how =
        action.enactmentRoute === "WITHOUT_SIGNATURE"
          ? " without the Governor's signature"
          : action.enactmentRoute === "OVER_VETO"
            ? " after the legislature passed it over the Governor's veto"
            : "";
      const tail =
        how === ""
          ? " The act as published does not state whether the Governor signed it."
          : "";
      return `${action.designation},${title} became Arizona session law${chapter}${session}${how}${on ? `, filed${on}` : ""}.${tail}`;
    }

    case "BILL_SIGNED":
      /*
       * **THE SENTENCE NAMES THE DOCUMENT IT WAS READ FROM.**
       *
       * Two different sources produce a signed bill and they are not
       * interchangeable: the enrolled act's own approval stamp ("APPROVED BY
       * THE GOVERNOR FEBRUARY 6, 2026", which comes with a chapter number),
       * and a transmittal letter in which she says she signed it. Citing the
       * wrong one is a small false statement about where a fact came from,
       * which is the same defect as a false statement about the fact.
       */
      return action.chapter
        ? `${action.designation},${title} signed by the Governor${on} and chaptered as Chapter ${action.chapter} of the ${action.sessionId} session.`
        : `${action.designation},${title} signed by the Governor${on}, per her transmittal letter.`;

    case "VETO":
      return `${action.designation},${title} vetoed by the Governor${on}, per her veto letter.`;

    case "BILL_LETTER_UNREAD": {
      const also =
        action.coveredBills.length > 1
          ? ` The letter also covers ${action.coveredBills.filter((b) => b !== action.designation).join(", ")}.`
          : "";
      return `${action.designation} — the Governor sent the legislature a letter about this bill. We have the letter but have not read it yet, so we cannot say what it decided.${also}`;
    }

    case "PROCLAMATION":
      return `${action.designation},${title} proclaimed${on}.`;
  }
}
