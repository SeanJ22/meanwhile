import { UNKNOWN_PROBLEM } from "./plain-words.ts";
import { stateCodeOf } from "../unit-state.ts";

export type BlockerLane = "decision" | "auto" | "publisher" | "software";

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

/** Why a card needs the owner. Every card in the decision lane names exactly one. */
export const NEEDS = ["money", "platform", "credentials", "contract", "broken"] as const;
export type Need = (typeof NEEDS)[number];
export const NEED_WORDS: Readonly<Record<Need, string>> = {
  money: "Needs money", platform: "Needs a platform", credentials: "Needs a login or key", contract: "Needs a contract or terms", broken: "Needs a fix only you can decide",
};

/** Anything not matching a named reason is "broken". */
export function needOf(blocker: string | null): Need {
  const t = blocker ?? "";
  if (/\b(budget|spend|paid|ceiling|cost|pay|fee|purchase)\b|\$\d/i.test(t)) return "money";
  if (/credential|token|api key|password|log ?in|sign ?in|secret/i.test(t)) return "credentials";
  if (/contract|licen[cs]e|terms of|agreement|records request|permission/i.test(t)) return "contract";
  if (/platform|account|provider access|subscription|vendor/i.test(t)) return "platform";
  return "broken";
}

export interface Cause {
  readonly needs: Need | null;
  readonly undescribed?: boolean;
  readonly key: string;
  readonly words: string;
  readonly lane: BlockerLane;
  readonly next: string;
  readonly owner: string;
}

const LANE_OF_OWNER: Readonly<Record<string, BlockerLane>> = {
  OWNER: "decision", NOBODY: "auto", SOURCE: "publisher", ENGINEERING: "software",
  RUNNER: "auto", SCOUT_LANE: "auto", FLEET: "auto",
};
const OWNER_WORDS: Readonly<Record<string, string>> = {
  OWNER: "You", NOBODY: "The runner (unassigned)", SOURCE: "The publisher", ENGINEERING: "Engineering",
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
  { key: "directory-page-unread", test: /DIRECTORY_NO_READABLE_SAVED_PAGE/i,
    words: "The directory’s saved page could not be read.", next: "The team finds a readable directory page and tries it again." },
  { key: "election-office-unfound", test: /ELECTION_OFFICE_NOT_ON_SAVED_PAGES/i,
    words: "The saved pages do not name the election office yet.", next: "Agents look for the office on another official page." },
  { key: "roster-page-unread", test: /ROSTER_NO_READABLE_SAVED_PAGE/i,
    words: "The membership list’s saved page could not be read.", next: "The team finds a readable membership page and tries it again." },
  { key: "stored-base-unconfirmed", test: /MANUAL_PROMOTION_BASE_PROOF_INVALID/i, lane: "software",
    words: "This update could not confirm the saved record it builds on.", next: "The team checks that record and its source; other updates continue." },
  { key: "spending-guard", test: /SCOUT_POLICY_DENIED/i,
    words: "This attempt was refused by the spending controls.", next: "The team checks the refusal while keeping the current spending limits." },

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

function causeCore(row: Pick<StuckRowLike, "state" | "owner" | "blocker" | "overdue">): Omit<Cause, "needs"> {
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
      : "Stuck, and the record gives no reason.", lane: laneByOwner, next: "Nothing says what moves it; this needs a look.", owner: OWNER_WORDS[owner] ?? "The runner (unassigned)" };
  }
  return { key: `other:${normalized(blocker)}`, words: UNKNOWN_PROBLEM, undescribed: true, lane: laneByOwner,
    next: "The team adds a description and works out the next step.", owner: OWNER_WORDS[owner] ?? "The runner (automatic)" };
}

export function causeOf(row: Pick<StuckRowLike, "state" | "owner" | "blocker" | "overdue">): Cause {
  const core = causeCore(row);
  return { ...core, needs: core.lane === "decision" ? needOf(row.blocker) : null };
}

export function stateOfRow(row: Pick<StuckRowLike, "stateCode" | "id" | "subjectName">): string | null {
  if (row.stateCode && /^[a-z]{2}$/i.test(row.stateCode)) return row.stateCode.toLowerCase();
  return stateCodeOf(row.id, "");
}

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
export function ageOf(row: Pick<StuckRowLike, "waitingSince" | "eligibleAt" | "lastActivityAt">, nowIso: string): Ageing {
  const times = [row.waitingSince, row.eligibleAt, row.lastActivityAt].filter((t): t is string => t !== null && Number.isFinite(Date.parse(t)));
  if (times.length === 0) return { words: "for an unknown time", rank: 0 };
  const since = Math.min(...times.map((t) => Date.parse(t)));
  const days = Math.max(0, Math.floor((Date.parse(nowIso) - since) / DAY));
  return { words: days === 0 ? "since today" : days === 1 ? "for 1 day" : `for ${days} days`, rank: days };
}

/** The runner reads these words as a target (scheduler/dispatch-target.ts): every extra word is a term a unit must contain, so carry only state names, the ZIP, and at most one specific word. */
export function sendWordsFor(input: { readonly stateNames: readonly string[]; readonly zip: string | null; readonly subject: string | null; readonly label: string | null }): string | null {
  if (input.stateNames.length === 0) return null;
  const source = `${input.subject ?? ""} ${input.label ?? ""}`;
  const specific = source.toLowerCase().split(/[^a-z0-9]+/).filter((tok) => tok.length >= 4 && /[a-z]/.test(tok) && !GENERIC.has(tok)).sort((x, y) => y.length - x.length)[0] ?? null;
  return ["Deploy fleet to", input.stateNames.join(" and "), input.zip, specific].filter(Boolean).join(" ");
}
const GENERIC = new Set(["with", "from", "that", "this", "candidate", "general", "index", "availability", "positions", "await", "awaits", "campaign", "finance", "city", "county", "board", "committee", "authored", "enrichment", "site"]);
