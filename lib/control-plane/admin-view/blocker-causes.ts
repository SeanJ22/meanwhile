import { stateCodeOf } from "../unit-state.ts";

/**
 * **WHY IS IT STUCK? — ONE PLAIN-ENGLISH CAUSE PER KIND OF BLOCKER.**
 *
 * The published assignment index says, per stuck row, who owns the next move
 * and a sentence from the machine (`blocker`). This module groups those rows by
 * the cause behind the sentence, in words a reader of Admin can act on. It is a
 * class of causes, not a list of examples: a row is placed by the shape of its
 * blocker (a provider that did not answer, a service that timed out, a source
 * that returned too little, a walk that found no route, a missing adapter, a
 * saved page that was missing, work nobody has reached yet), and a row that
 * matches no shape is grouped by its own words with the numbers taken out, so
 * an unknown cause still groups with its twins rather than standing alone.
 *
 * PURE. It counts and labels; it never decides what to do about a blocker.
 */

export type BlockerLane = "decision" | "auto" | "publisher" | "software";

/** The fields of a published assignment-index row this module reads. */
export interface StuckRowLike {
  readonly id: string;
  readonly state: string;
  readonly lane: string | null;
  readonly owner: string | null;
  readonly blocker: string | null;
  readonly label: string | null;
  readonly subjectName: string | null;
  readonly stateCode: string | null;
  readonly overdue: boolean | null;
  readonly band: number | null;
  readonly waitingSince: string | null;
  readonly eligibleAt: string | null;
  readonly lastActivityAt: string | null;
  readonly nextAction: string | null;
  readonly assignmentKeys: readonly string[];
}

export interface Cause {
  readonly key: string;
  /** The cause in one plain sentence. */
  readonly words: string;
  readonly lane: BlockerLane;
  /** What happens next, in words, for the group. */
  readonly next: string;
  /** Who moves it, in words. */
  readonly owner: string;
}

const LANE_OF_OWNER: Readonly<Record<string, BlockerLane>> = {
  OWNER: "decision", NOBODY: "decision", SOURCE: "publisher", ENGINEERING: "software",
  RUNNER: "auto", SCOUT_LANE: "auto", FLEET: "auto",
};
const OWNER_WORDS: Readonly<Record<string, string>> = {
  OWNER: "You", NOBODY: "Nobody owns it yet", SOURCE: "The publisher", ENGINEERING: "Engineering",
  RUNNER: "The runner (automatic)", SCOUT_LANE: "The Scout lane (automatic)", FLEET: "The fleet (automatic)",
};

interface Shape {
  readonly key: string;
  readonly test: RegExp;
  readonly words: string;
  readonly lane?: BlockerLane;
  readonly next: string;
}

/** Order matters: the first shape that matches wins. */
const SHAPES: readonly Shape[] = [
  { key: "provider-silent", test: /model provider did not answer|model transport failed/i,
    words: "The AI model service didn’t answer. The agent’s steps so far are kept.",
    next: "The next agent resumes from those steps when the work comes due again, and moves up a model tier if the service keeps failing." },
  { key: "service-timeout", test: /operation was aborted|timed out|timeout|nothing was reached at/i,
    words: "A search or data service took too long and was cut off.",
    next: "The runner tries again on its backoff. Repeated timeouts point at that service, not at the place." },
  { key: "too-little", test: /yield contract was not satisfied|returned (no|too little)|\bHTTP 206\b|\b\d+ bytes\b/i,
    words: "A source answered, but with too little to use.",
    next: "The next attempt tries another route to the same source." },
  { key: "no-route", test: /found no route and no record/i,
    words: "Agents searched and found no way to the record yet.",
    next: "The next agent starts from the routes this one named." },
  { key: "needs-adapter", test: /needs an adapter|missing capability of ours/i, lane: "software",
    words: "We haven’t built a reader for this kind of source yet. The source itself isn’t the problem.",
    next: "Engineering builds the reader. Sending agents won’t fix it." },
  { key: "page-missing", test: /not in vault|ARTIFACT_NOT_IN_VAULT|saved page was missing/i,
    words: "A saved page was missing when an agent needed it.",
    next: "The page is fetched again and the work retried." },
  { key: "not-reached", test: /no worker has reached it yet|runner has not dispatched/i, lane: "auto",
    words: "Waiting for its turn. No agent has reached it yet.",
    next: "The runner dispatches it when its turn comes. Sending agents moves it up." },
  { key: "stopped-early", test: /stopped early|reached no boundary/i,
    words: "The agent stopped before it reached an answer.",
    next: "The runner sends another agent when the work comes due again." },
  { key: "needs-person", test: /only a human|records request|phone|in person|offline act/i, lane: "decision",
    words: "Only a person can move this: a records request, a call or a visit.",
    next: "Waiting for you." },
];

/** Numbers, hashes and ids differ between twins; take them out so twins group. */
function normalized(text: string): string {
  return text.toLowerCase().replace(/https?:\/\/\S+/g, "").replace(/[0-9a-f]{8,}/g, "#").replace(/\d+/g, "#").replace(/\s+/g, " ").trim().slice(0, 90);
}

export function causeOf(row: Pick<StuckRowLike, "state" | "owner" | "blocker" | "overdue">): Cause {
  const owner = row.owner ?? "RUNNER";
  const laneByOwner = LANE_OF_OWNER[owner] ?? "auto";
  const blocker = (row.blocker ?? "").trim();
  for (const shape of SHAPES) {
    if (shape.test.test(blocker)) {
      const lane = shape.lane ?? (laneByOwner === "decision" || laneByOwner === "software" || laneByOwner === "publisher" ? laneByOwner : "auto");
      return { key: shape.key, words: shape.words, lane, next: shape.next, owner: OWNER_WORDS[owner] ?? "The runner (automatic)" };
    }
  }
  if (blocker === "") {
    return { key: `no-reason:${row.state.toLowerCase()}`, words: row.overdue === true ? "Overdue, and the record gives no reason."
      : "Stuck, and the record gives no reason.", lane: laneByOwner, next: "Nothing says what moves it; this needs a look.", owner: OWNER_WORDS[owner] ?? "Nobody owns it yet" };
  }
  const first = blocker.split(/(?<=[.!?])\s/)[0] ?? blocker;
  return { key: `other:${normalized(blocker)}`, words: first.length > 160 ? `${first.slice(0, 157)}…` : first, lane: laneByOwner,
    next: "See the item for what the system says happens next.", owner: OWNER_WORDS[owner] ?? "The runner (automatic)" };
}

/** The row's state, from its saved state code, else from the structure of its id (never two letters found anywhere in it). */
export function stateOfRow(row: Pick<StuckRowLike, "stateCode" | "id" | "subjectName">): string | null {
  if (row.stateCode && /^[a-z]{2}$/i.test(row.stateCode)) return row.stateCode.toLowerCase();
  return stateCodeOf(row.id, "");
}

/** The UI place key an index row belongs to: its saved ZIP hunt, else its state, else the whole country. */
export function placeKeyOfRow(row: Pick<StuckRowLike, "assignmentKeys" | "stateCode">): string {
  for (const key of row.assignmentKeys) {
    const zip = /^zcta:\d{4}\/(\d{5})$/.exec(key);
    if (zip && row.stateCode) return `geo:${row.stateCode.toLowerCase()}.zcta.${zip[1]}`;
    const county = /^county:\d{4}\/(\d{5})$/.exec(key);
    if (county && row.stateCode) return `geo:${row.stateCode.toLowerCase()}.county.${county[1]}`;
  }
  return row.stateCode && /^[a-z]{2}$/i.test(row.stateCode) ? `st:${row.stateCode.toLowerCase()}` : "us";
}

const DAY = 86_400_000;
export interface Ageing { readonly words: string; readonly rank: number }
/** How long it has been stuck, from the earliest time the row names; never a guess when it names none. */
export function ageOf(row: Pick<StuckRowLike, "waitingSince" | "eligibleAt" | "lastActivityAt">, nowIso: string): Ageing {
  const times = [row.waitingSince, row.eligibleAt, row.lastActivityAt].filter((t): t is string => t !== null && Number.isFinite(Date.parse(t)));
  if (times.length === 0) return { words: "for an unknown time", rank: 0 };
  const since = Math.min(...times.map((t) => Date.parse(t)));
  const days = Math.max(0, Math.floor((Date.parse(nowIso) - since) / DAY));
  return { words: days === 0 ? "since today" : days === 1 ? "for 1 day" : `for ${days} days`, rank: days };
}

/**
 * The words a "send agents" instruction carries. The runner reads them as a target (scheduler/dispatch-target.ts):
 * every state named, plus terms; a unit matches the state and at least one term, and a target with no state matches
 * nothing. "Deploy" and "fleet" are filler it drops, so the words must not carry any other verb or noun: each extra
 * word is a term a unit has to contain. So: the state name(s), the ZIP when the row belongs to one, and at most one
 * specific word of what is stuck.
 */
export function sendWordsFor(input: { readonly stateNames: readonly string[]; readonly zip: string | null; readonly subject: string | null; readonly label: string | null }): string | null {
  if (input.stateNames.length === 0) return null;
  const source = `${input.subject ?? ""} ${input.label ?? ""}`;
  const specific = source.toLowerCase().split(/[^a-z0-9]+/).filter((tok) => tok.length >= 4 && /[a-z]/.test(tok) && !GENERIC.has(tok)).sort((x, y) => y.length - x.length)[0] ?? null;
  return ["Deploy fleet to", input.stateNames.join(" and "), input.zip, specific].filter(Boolean).join(" ");
}
const GENERIC = new Set(["with", "from", "that", "this", "candidate", "general", "index", "availability", "positions", "await", "awaits", "campaign", "finance", "city", "county", "board", "committee", "authored", "enrichment", "site"]);
