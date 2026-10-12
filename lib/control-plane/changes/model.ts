/**
 * One plain line per pull request, with where it has got to.
 *
 * ```
 *   building    a draft, or one whose checks are still running or failing
 *   on test     ready for review with every check passing: it can be tried now
 *   deploying   merged, and the live site has not picked it up yet
 *   live        merged, and the live site is running it (or it changes nothing
 *               the site serves, so there is nothing to deploy)
 * ```
 *
 * Pure. No fetch, no clock, no environment.
 */

export const CHANGE_STATUSES = ["building", "on-test", "deploying", "live"] as const;
export type ChangeStatus = (typeof CHANGE_STATUSES)[number];

export const CHANGE_STATUS_WORDS: Readonly<Record<ChangeStatus, string>> = {
  building: "Building",
  "on-test": "On test",
  deploying: "Deploying",
  live: "Live",
};

/** What each status means, in the words the page prints under its heading. */
export const CHANGE_STATUS_MEANING: Readonly<Record<ChangeStatus, string>> = {
  building: "Still being written, or its checks are running or failing.",
  "on-test": "Finished and passing every check. It can be tried now and is waiting to go live.",
  deploying: "Merged. The live site has not picked it up yet.",
  live: "Merged and running on the live site, or it changes nothing the site serves.",
};

export type ChecksState = "SUCCESS" | "FAILURE" | "ERROR" | "PENDING" | "EXPECTED" | null;

/** What the page needs to know about one pull request. */
export interface ChangePr {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly state: "OPEN" | "MERGED" | "CLOSED";
  readonly isDraft: boolean;
  readonly updatedAt: string;
  readonly mergedAt: string | null;
  readonly headRefName: string;
  readonly baseRefName: string;
  readonly checks: ChecksState;
}

/** What was worked out about a merged pull request's place on the live site. */
export type LiveReading = "in-live-site" | "not-yet" | "no-site-change" | "unknown";

export interface ChangeRow {
  readonly number: number;
  /** A session id from the title or branch, or null when neither names one. */
  readonly session: string | null;
  readonly line: string;
  readonly status: ChangeStatus;
  readonly statusWords: string;
  /** One short clause that says why it is in this status. */
  readonly why: string;
  readonly url: string;
  /** When it last moved: merged time for merged work, else last update. */
  readonly at: string;
}

const SESSION_TITLE = /^\s*(S\d+)(?:\s+draft)?\s*[:\-–—]\s*/i;
const SESSION_BRANCH = /(?:^|\/)(s\d+)(?:[-_/]|$)/i;
const LINE_MAX_CHARS = 150;

/** A session id, from the title when it leads with one, else from the branch name. */
export function sessionOf(pr: Pick<ChangePr, "title" | "headRefName">): string | null {
  const title = SESSION_TITLE.exec(pr.title);
  if (title) return title[1].toUpperCase();
  const branch = SESSION_BRANCH.exec(pr.headRefName);
  return branch ? branch[1].toUpperCase() : null;
}

/**
 * The title as one plain sentence: the session prefix off, the first letter up,
 * and a long tail after a dash cut away so the line stays one line.
 */
export function plainLine(title: string): string {
  let line = title.replace(SESSION_TITLE, "").replace(/^\s*draft\s*[:\-–—]\s*/i, "").replace(/\s+/g, " ").trim();
  if (line === "") return "Untitled change";
  if (line.length > LINE_MAX_CHARS) {
    const dash = line.search(/\s[—–-]\s/);
    if (dash > 40) line = line.slice(0, dash);
  }
  if (line.length > LINE_MAX_CHARS) {
    const cut = line.lastIndexOf(" ", LINE_MAX_CHARS - 1);
    line = `${line.slice(0, cut > 40 ? cut : LINE_MAX_CHARS - 1)}…`;
  }
  return line.charAt(0).toUpperCase() + line.slice(1);
}

/**
 * The row for one pull request, or null when it should not be listed (closed
 * without merging: the work was dropped, so nothing about it moved).
 */
export function changeRowOf(pr: ChangePr, live: LiveReading = "unknown"): ChangeRow | null {
  if (pr.state === "CLOSED") return null;
  const base = {
    number: pr.number,
    session: sessionOf(pr),
    line: plainLine(pr.title),
    url: pr.url,
  };
  if (pr.state === "OPEN") {
    const at = pr.updatedAt;
    if (pr.isDraft) return { ...base, status: "building", statusWords: CHANGE_STATUS_WORDS.building, why: "Still a draft.", at };
    if (pr.checks === "SUCCESS") {
      return { ...base, status: "on-test", statusWords: CHANGE_STATUS_WORDS["on-test"], why: "Every check passes; waiting to be merged.", at };
    }
    const why =
      pr.checks === "FAILURE" || pr.checks === "ERROR"
        ? "A check is failing."
        : pr.checks === null
          ? "No check result has arrived yet."
          : "Its checks are still running.";
    return { ...base, status: "building", statusWords: CHANGE_STATUS_WORDS.building, why, at };
  }
  const at = pr.mergedAt ?? pr.updatedAt;
  if (pr.baseRefName !== "main") {
    return { ...base, status: "building", statusWords: CHANGE_STATUS_WORDS.building, why: `Merged into ${pr.baseRefName}, not into main yet.`, at };
  }
  if (live === "in-live-site") return { ...base, status: "live", statusWords: CHANGE_STATUS_WORDS.live, why: "The live site is running it.", at };
  if (live === "no-site-change") {
    return { ...base, status: "live", statusWords: CHANGE_STATUS_WORDS.live, why: "It changes nothing the site serves, so there is nothing to deploy.", at };
  }
  if (live === "not-yet") return { ...base, status: "deploying", statusWords: CHANGE_STATUS_WORDS.deploying, why: "Merged; the live site has not picked it up yet.", at };
  return { ...base, status: "deploying", statusWords: CHANGE_STATUS_WORDS.deploying, why: "Merged; whether the live site runs it could not be read.", at };
}

/** Newest movement first. */
export function byRecency(a: ChangeRow, b: ChangeRow): number {
  return a.at < b.at ? 1 : a.at > b.at ? -1 : b.number - a.number;
}

/** The rows of each status, newest first, every status present even when empty. */
export function groupChanges(rows: readonly ChangeRow[]): Readonly<Record<ChangeStatus, readonly ChangeRow[]>> {
  const out: Record<ChangeStatus, ChangeRow[]> = { building: [], "on-test": [], deploying: [], live: [] };
  for (const row of [...rows].sort(byRecency)) out[row.status].push(row);
  return out;
}
