import { readFileSync } from "node:fs";
import { join } from "node:path";

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

export type ExecutiveActionKind =
  | "EXECUTIVE_ORDER"
  /** Declared here so a later source has somewhere to land, and EMPTY today. */
  | "BILL_SIGNED"
  | "VETO"
  | "PROCLAMATION";

export interface ExecutiveAction {
  id: string;
  /** The seat, as `lib/officials/statewide-executives.ts` ids it. */
  officeholderId: string;
  officeholderName: string;
  officeTitle: string;
  ocdId: string;
  kind: ExecutiveActionKind;
  /** "Executive Order 2026-02" — the office's own designation. */
  designation: string;
  /** The office's own title for the action. Never rewritten. */
  title: string;
  /** `YYYY-MM-DD`, the date the office publishes for the action. */
  occurredAt: string;
  sourceUrl: string;
  /** The signed document. Null only where the office published none. */
  documentUrl: string | null;
  sourceOrg: string;
  collectedAt: string;
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
  actions: ExecutiveAction[];
}

let cache: ExecutiveActionStore | null | undefined;

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
  if (cache !== undefined) return cache;
  try {
    cache = JSON.parse(
      readFileSync(join(process.cwd(), "data", "officials", "az-governor-actions.json"), "utf8"),
    ) as ExecutiveActionStore;
  } catch {
    cache = null;
  }
  return cache;
}

/** Test seam — the suite must never inherit another test's cached read. */
export function resetExecutiveActionCache(): void {
  cache = undefined;
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
  return store.actions
    .filter((a) => a.officeholderId === officeholderId)
    .filter((a) => (window.from ? a.occurredAt >= window.from : true))
    .filter((a) => (window.to ? a.occurredAt <= window.to : true))
    .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));
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
 * Designation, title, date — the office's own three facts, joined. Nothing is
 * summarised: a summary of an executive order is a claim about what a
 * government did, made by us.
 */
export function actionText(action: ExecutiveAction): string {
  return `${action.designation}, "${action.title}", signed ${action.occurredAt}.`;
}
