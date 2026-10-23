import {
  civicDataReadNotInitialized,
  promotedVersionOrThrow,
  readPromotedCivicData,
  type CivicDataReadResult,
  type PromotedCivicDataReadOptions,
} from "../civic-data/read-model.ts";
import { AZ_OFFICIAL_ACTIONS_CONTRACT } from "../outcomes/data-plane.ts";
import { readPromotedEdgeFirst } from "../registry/runtime-edge.ts";

/**
 * What an officeholder has done, from the office's own publication: each row a governmental action with a date and a
 * signed primary document, in the office's own words. Not a record of everything a governor does. The denominator
 * travels with the store, so an answer can say "the actions we hold" and never "everything".
 */

/**
 * What kind of act the row records; every value is something read. `BILL_ENACTED` proves enactment, not a signature;
 * `BILL_SIGNED` and `VETO` come only from the Governor's own letter. `BILL_LETTER_UNREAD` is a letter we hold and have
 * not read.
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

/** Why a row has no date, and whose fact that is. */
export type OccurredAtState =
  /** The source published a date and it was read off the document. */
  | "PUBLISHED"
  /** THEIRS: the source publishes no such date. An effective date is never a substitute. */
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
  /** The office's own designation, e.g. an executive order number or a bill number. */
  designation: string;
  /** The publisher's own title, entity-decoded only. Null when the index publishes none; a title is never borrowed. */
  title: string | null;
  /** `YYYY-MM-DD` when the source published one, else null; `occurredAtState` says whose gap it is. */
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
  /** Every bill one document covers, so one bill's disposition never reads as the document's whole reach. */
  coveredBills: string[];
  /** How an enacted bill became law, off the act's own enactment stamp; null for anything not a chaptered bill. */
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
  /** What was searched; `reachedEndOfIndex` false means this is a floor. */
  denominator: {
    indexedAcrossPagesWalked: number;
    indexPagesWalked: number;
    detailPagesRead: number;
    reachedEndOfIndex: boolean;
  };
  /** The legislative half, with its own denominator; null while nothing legislative has been collected. */
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

function validateActionProjection(value: ExecutiveActionStore, version: string): void {
  if (!Array.isArray(value.actions) || value.actions.length === 0) {
    throw new Error(`Arizona official-action projection ${version} contains no action records.`);
  }
  if (new Set(value.actions.map((action) => action.id)).size !== value.actions.length) {
    throw new Error(`Arizona official-action projection ${version} contains duplicate action ids.`);
  }
}

export async function readExecutiveActionsProjection(
  options: PromotedCivicDataReadOptions = {},
): Promise<CivicDataReadResult<ExecutiveActionStore>> {
  actionReadState = await readPromotedCivicData<ExecutiveActionStore>(
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

/** The executive-action preload, edge first: the reader edge's proven copy, else the database. */
export const settleExecutiveActionsRead = (): Promise<string | null> =>
  readPromotedEdgeFirst(AZ_OFFICIAL_ACTIONS_CONTRACT.recordClass, AZ_OFFICIAL_ACTIONS_CONTRACT.scope, refreshExecutiveActionsFromPromoted, "The Arizona executive actions");

/** The held store, or null: "we hold no action records" is a fact about us, never about a government. */
export function executiveActionStore(): ExecutiveActionStore | null {
  return actionReadState.kind === "PROMOTED" || actionReadState.kind === "BOOTSTRAP" ? actionReadState.value : null;
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

/** One officeholder's actions, newest first, optionally inside an inclusive window. Selected on the officeholder ID, never the name. */
export function actionsFor(
  officeholderId: string,
  window: ActionWindow = {},
): ExecutiveAction[] {
  const store = executiveActionStore();
  if (!store) return [];
  const mine = store.actions.filter((a) => a.officeholderId === officeholderId);

  // A windowed call returns dated matches only; `undatedFor` returns the remainder. An unwindowed call returns everything.
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

/** The rows this officeholder has that carry no date, so a date-shaped question can report what it could not reach. */
export function undatedFor(officeholderId: string): ExecutiveAction[] {
  const store = executiveActionStore();
  if (!store) return [];
  return store.actions
    .filter((a) => a.officeholderId === officeholderId && a.occurredAt === null)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** The ISO date `n` months before `today`, clamped to the target month's last day rather than rolling forward. */
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
 * One action as a sentence, from the office's own facts. The sentence branches on kind: no branch asserts a signature
 * that was not read, invents a date, or phrases an unread document as anything but ours.
 */
export function actionText(action: ExecutiveAction): string {
  const title = action.title ? ` "${action.title}",` : "";
  const on = action.occurredAt ? ` on ${action.occurredAt}` : "";

  switch (action.kind) {
    case "EXECUTIVE_ORDER":
      return action.occurredAt
        ? `${action.designation},${title} signed ${action.occurredAt}.`
        : `${action.designation},${title} signed — the office publishes no date for it.`;

    case "BILL_ENACTED": {
      const chapter = action.chapter ? ` as Chapter ${action.chapter}` : "";
      const session = action.sessionId ? ` of the ${action.sessionId} session` : "";
      /* Passive: enactment is not one person's act; the row is filed under the seat for retrieval. */
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
      // The sentence names the document the signature was read from: the act's approval stamp or the transmittal letter.
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
