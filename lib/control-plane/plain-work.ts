import { plainCode, plainText } from "./plain-words.ts";

export interface WorkNeedsYou {
  readonly needed: boolean;
  /** When needed: the action, in his words. Null when nothing is needed. */
  readonly action: string | null;
}

const NEEDS_NOTHING: WorkNeedsYou = { needed: false, action: null };

export interface PlainWork {
  readonly trying: string;
  /** What actually happened. Past tense. Never a machine constant. */
  readonly happened: string;
  /** What happens next. Future tense. Never "nothing" and never "never". */
  readonly next: string;
  readonly needsYou: WorkNeedsYou;
}

/** Keys are the exact record-class strings providers stamp; a class with no entry falls through to `plainCode`. */
export const RECORD_CLASS_WORDS: Readonly<Record<string, string>> = {
  "campaign-finance": "campaign finance filings",
  "candidate-enrichment": "candidate record",
  "local-jurisdiction": "local government record",
  meetings: "meeting list",
  "meeting-times": "meeting times",
  agendas: "agendas",
  tracker: "record named on the tracker",
  MEETINGS: "meeting list",
  AGENDA: "agenda",
  AGENDA_PACKET: "agenda packet",
  MINUTES: "minutes",
  MINUTES_OR_ACTION_SUMMARY: "minutes",
  ACTION_SUMMARY: "action summary",
  ROLL_CALL: "recorded vote",
  MEETING_NOTICE: "meeting notice",
  ROSTER: "list of who sits on the body",
  RECORDING_OR_TRANSCRIPT: "recording or transcript",
  CAMPAIGN_FINANCE: "campaign finance filings",
  BALLOT_AND_CANDIDATES: "ballot and candidate list",
  CANDIDATE_FILINGS: "candidate filings",
  CANDIDATE_FILING_DOCUMENT: "candidate filing document",
  OFFICIAL_BOARD_DIRECTORY: "official board directory",
  OFFICIAL_MEETING_DOCUMENT_INVENTORY: "list of the meeting documents published",
  OFFICIAL_SOURCE_SCHEMA: "source's own published schema",
  GOVERNMENT_IDENTITY: "official identity of the body",
  LEGISTAR_EVENTS: "meeting list",
  CIVICCLERK_EVENTS: "meeting list",
  INTERNAL_METHOD_KNOWLEDGE: "reusable method",
};

export function recordClassWords(recordClass: string | null | undefined): string {
  const raw = (recordClass ?? "").trim();
  if (raw === "") return "public record";
  const known = RECORD_CLASS_WORDS[raw];
  if (known !== undefined) return known;
  const words = plainCode(raw).toLowerCase();
  return words === "" ? "public record" : words;
}

export interface ScoutFacts {
  readonly recordClass: string;
  readonly routeId: string | null;
  readonly outcome: string;
  /** MODEL when the Scout chose to stop; BOUND when it ran out of its budget. */
  readonly stoppedBy: string;
  /** The executor's refusal codes. Empty when the finish was accepted. */
  readonly refusalCodes: readonly string[];
  readonly candidateCount: number;
  readonly artifactCount: number;
  readonly evidenceRungs: number;
  readonly nextRungs: readonly string[];
}

/** The subject as the owner reads it, e.g. "Atlantic County, New Jersey". */
export interface WorkSubject {
  readonly name: string;
  readonly retryPhrase?: string | null;
}

function retryClause(subject: WorkSubject): string {
  const phrase = (subject.retryPhrase ?? "").trim();
  return phrase === "" ? "a later cycle picks it up" : `it is due again ${phrase}`;
}

/** `plainText` runs first, while codes are still intact, before hyphens are removed. */
function rungWords(rungs: readonly string[]): string {
  const named = rungs.map((r) => plainText(r).replace(/^other:/, "").replace(/-/g, " ").trim()).filter((r) => r !== "");
  if (named.length === 0) return "";
  if (named.length === 1) return named[0];
  return `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
}

export function scoutStory(facts: ScoutFacts, subject: WorkSubject): PlainWork {
  const what = recordClassWords(facts.recordClass);
  const name = subject.name.trim() === "" ? "a public body" : subject.name.trim();
  const trying = `Trying to get the ${what} for ${name}.`;
  const evidence = facts.artifactCount === 1 ? "1 document" : `${facts.artifactCount} documents`;
  const routes = facts.evidenceRungs === 1 ? "1 route" : `${facts.evidenceRungs} routes`;
  const owed = rungWords(facts.nextRungs);
  const owedNext = owed === "" ? "" : ` The routes it has not tried yet: ${owed}.`;

  if (facts.refusalCodes.length > 0) {
    return {
      trying,
      happened: `The finish was refused — ${facts.refusalCodes.map((c) => plainCode(c).toLowerCase()).join("; ")} — so nothing it claimed was put on file.`,
      next: `The item is still open and ${retryClause(subject)}.${owedNext}`,
      needsYou: NEEDS_NOTHING,
    };
  }

  const ranOut = facts.stoppedBy === "BOUND" || facts.stoppedBy === "TIMEOUT";
  switch (facts.outcome) {
    case "ROUTE_CANDIDATE":
      return {
        trying,
        happened: `Found a way in: ${facts.candidateCount === 1 ? "1 route" : `${facts.candidateCount} routes`}, backed by ${evidence} saved as evidence.`,
        next: "Next: the route is validated, then ordinary code can walk it without spending a model.",
        needsYou: NEEDS_NOTHING,
      };
    case "EVIDENCE_FOUND":
      return {
        trying,
        happened: `Reached the record itself and saved ${evidence} as evidence.`,
        next: "Next: the facts are pulled out of it and checked against the source before anything reaches a reader.",
        needsYou: NEEDS_NOTHING,
      };
    case "NEEDS_ADAPTER":
      return {
        trying,
        happened: `The source answers, and nothing here can read the format it answers in yet (${routes} walked with evidence).`,
        next: "Next: a worker writes the reader for that format; the item keeps its place in line.",
        needsYou: NEEDS_NOTHING,
      };
    case "BLOCKED":
      return {
        trying,
        happened: `Every route tried was refused or walled off (${routes} walked with evidence).`,
        next: `Next: a different route is tried and ${retryClause(subject)}.${owedNext}`,
        needsYou: NEEDS_NOTHING,
      };
    case "HUMAN_REQUIRED":
      return {
        trying,
        happened: `The automatic routes are exhausted (${routes} walked with evidence); what remains is something only a person can do.`,
        next: "Next: a records request or a call to the office that holds it.",
        needsYou: { needed: true, action: "say whether to file a records request for this one" },
      };
    case "NO_PROGRESS":
      return {
        trying,
        happened: ranOut
          ? `It ran out of its time and turn budget after ${routes} walked with evidence, before it reached the record.`
          : `${routes} were walked with evidence and none of them reached the record.`,
        next: `Next: it resumes from where it stopped and ${retryClause(subject)}.${owedNext}`,
        needsYou: NEEDS_NOTHING,
      };
    default:
      return {
        trying,
        happened: `The Scout finished with an outcome this page has no wording for yet (${plainCode(facts.outcome).toLowerCase()}).`,
        next: `The item is still open and ${retryClause(subject)}.`,
        needsYou: NEEDS_NOTHING,
      };
  }
}

export interface AttemptFacts {
  readonly outcome: string;
  readonly verdict: string | null;
  /** MATCHED when a typed result certifies the Attempt; REFUSED or NOT_RECORDED otherwise. */
  readonly resultStatus: string;
  /** The work item's state, which is what says whether the GOAL is still open. */
  readonly workItemState: string;
  readonly findingCount: number;
}

/** States only the owner can move, each with the action he would take. */
const OWNER_ACTION: Readonly<Record<string, string>> = {
  AWAITING_OWNER: "decide what should happen with {subject}",
  AUTHOR_DECISION_REQUIRED: "make the call on {subject} — no machine is allowed to make this one",
  RECORDS_REQUEST_REQUIRED: "file a records request for {subject}",
  HUMAN_INTERACTION_REQUIRED: "handle {subject} in person — the source needs a human at the other end",
};

/** Work-item states that mean the goal is settled and nothing more is owed on it. */
const SETTLED: ReadonlySet<string> = new Set<string>(["VERIFIED_COMPLETE", "LEGALLY_WITHHELD"]);

const WORK_STATE_NEXT: Readonly<Record<string, string>> = {
  OPEN: "{subject} is open and in the queue; the next cycle with budget for it picks it up",
  BLOCKED: "{subject} is waiting on an earlier step to finish before it can move; nothing is lost and nothing needs you",
  AWAITING_VALIDATION: "{subject} is waiting for a validator to check what was extracted against the source",
  AWAITING_AUDIT: "{subject} is waiting for an auditor to try to break it from independent evidence",
  REOPENED: "{subject} was reopened by a later result and goes back through the queue",
  NOT_YET_PUBLISHED: "the source has not published it yet, so {subject} is re-checked on a schedule until it appears",
  RECORD_NOT_YET_CREATED: "the record does not exist yet, so {subject} is re-checked on a schedule until it does",
  OFFLINE_PUBLIC_ACCESS: "{subject} is public but not online, so it is obtained in person or by request rather than fetched",
  UNKNOWN: "{subject} is on the queue in a state this page has no wording for; it is still owed",
};

/** An Attempt can be COMPLETED while its goal was never reached: the Attempt sets the first sentence, the work item's state the second. */
export function workerAttemptStory(facts: AttemptFacts, subject: WorkSubject): PlainWork {
  const name = subject.name.trim() === "" ? "this work" : subject.name.trim();
  const trying = `Working on ${name}.`;
  const settled = SETTLED.has(facts.workItemState);
  const ownerAction = OWNER_ACTION[facts.workItemState];
  const ownerMoves = ownerAction !== undefined;
  const findings = facts.findingCount === 0 ? "" : ` It raised ${facts.findingCount === 1 ? "1 finding" : `${facts.findingCount} findings`}.`;

  const happened =
    facts.outcome === "RUNNING"
      ? "It is running now; no result has been recorded yet."
      : facts.outcome === "COMPLETED"
        ? facts.resultStatus === "MATCHED" && facts.verdict !== null
          ? `The worker ran to the end of its procedure and recorded a result: ${plainCode(facts.verdict).toLowerCase()}.${findings}`
          : "The worker ran to the end of its procedure, and no typed result was recorded for it — so nothing here is certified."
        : facts.outcome === "ABORTED"
          ? `The worker stopped itself before finishing.${findings}`
          : `The worker did not finish (${plainCode(facts.outcome).toLowerCase()}).${findings}`;

  const stated = WORK_STATE_NEXT[facts.workItemState];
  const when = (subject.retryPhrase ?? "").trim();
  const owed =
    facts.outcome === "RUNNING"
      ? `the result is recorded when it ends, and ${name} stays open until it is`
      : stated !== undefined
        ? stated.replace("{subject}", name)
        : `${name} is still open, so the record is still owed and a later cycle picks it up`;
  const next = settled
    ? `${name} is finished and independently checked. Nothing further is owed on it.`
    : ownerMoves
      ? `${name} cannot move until you act, so it waits rather than retries.`
      : `Next: ${owed}${when === "" ? "" : `; it is due again ${when}`}.`;

  return {
    trying,
    happened,
    next,
    needsYou: ownerAction === undefined ? NEEDS_NOTHING : { needed: true, action: ownerAction.replace("{subject}", name) },
  };
}
