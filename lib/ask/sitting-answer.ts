import { formatDateLong } from "../text/format-date.ts";
import type { EvidenceGap, EvidenceRecord } from "./evidence.ts";
import type { LexicalShape } from "./lexical-reading.ts";
import { overLengthBudget } from "./length-contract.ts";
import { localDate, localTime, localWeekday, zoneOf } from "./meeting-time.ts";
import type { ValidationVerdict } from "./validate.ts";

/**
 * **WHEN A BODY MEETS IS A FACT WE HOLD, NOT A PARAGRAPH TO WRITE.**
 * (2026-09-25, the Ask latency repair.)
 *
 * Measured on production 2026-09-25: *"When does the Mesa City Council meet
 * next?"* spent 7.2 s in the synthesis rung on a cold instance and 4-6.5 s on
 * a warm one, to say what two MEETING records already said — the sitting, its
 * date and time in the body's own zone, and the named gap about its agenda.
 * The model also opened with a definition of a city council that no record
 * supplied. Sean's bar is three seconds to a usable answer.
 *
 * So when a question asks WHEN a named body sits — or asks for its agenda or
 * its decisions and the pack holds nothing to summarise, only the sitting and
 * the named gaps — the answer is composed here, in code, from those records,
 * exactly as a topic timeline is (`lib/ask/topic-timeline.ts`):
 *
 * - every date and time is the MEETING record's own, read in the body's zone
 *   through `lib/ask/meeting-time.ts`, the module the record text uses;
 * - every title is the publisher's calendar title, quoted;
 * - every limitation is a named gap the route attached to THAT sitting, in its
 *   own words, so OURS and THEIRS can never be swapped by a paraphrase;
 * - the whole stays inside the one length contract, and the caller holds it to
 *   the same validator a model answer faces.
 *
 * It returns null — and the model writes the answer exactly as before —
 * whenever there is something to summarise (agenda items, recorded actions,
 * votes, minutes or notice summaries on an agenda or outcome question), when a
 * calendar listing's meeting identity is unresolved, when a sitting is
 * cancelled, or when a body's time zone is not recorded. Composition never
 * decides that a record does not matter; it only answers where no record
 * needs explaining.
 */

/** A sitting as the route resolved it (`AskSitting`), narrowed to what is read here. */
export interface ComposableSitting {
  id: string;
  title: string;
  startsAt: string;
  timeZone?: string | null;
  status: string;
}

/**
 * Why a gap was attached to the sitting. The order a composed answer states
 * them in depends on the question: an outcome question leads with whether the
 * outcome is held.
 */
export type SittingGapRole = "NO_SITTING" | "LISTING" | "AGENDA" | "NOTICE" | "MINUTES" | "OUTCOME";

export interface SittingGap {
  role: SittingGapRole;
  gap: EvidenceGap;
}

/** Records that carry something to summarise, not merely a sitting or a gap. */
const CONTENT_KINDS: ReadonlySet<EvidenceRecord["kind"]> = new Set([
  "AGENDA_ITEM",
  "AGENDA_MENTION",
  "MEETING_ACTION",
  "MEETING_MEMBER_VOTE",
  "MEETING_MINUTES_SUMMARY",
  "MEETING_NOTICE_SUMMARY",
]);

export interface SittingAnswerInput {
  shape: LexicalShape;
  subjectName: string;
  /** The chosen sitting FIRST, then any other sitting the body holds that local day. */
  sittings: readonly ComposableSitting[];
  /** The gated pack records — the same ones the validator checks. */
  records: readonly EvidenceRecord[];
  /** The gaps the route attached to these sittings, in the order it attached them. */
  sittingGaps: readonly SittingGap[];
  now: number;
}

function dayOf(sitting: ComposableSitting): string {
  const day = localDate(sitting);
  return `${localWeekday(sitting)}, ${formatDateLong(day) ?? day}`;
}

function quoted(title: string): string {
  return `"${title.replace(/"/g, "'").trim()}"`;
}

/** "Pima County Board Of Supervisors" reads as "Pima County Board of Supervisors" in a sentence. */
export function proseName(name: string): string {
  const connectors = new Set(["Of", "And", "The", "For", "In", "On", "At", "To"]);
  return name.split(" ").map((word, index) => (index > 0 && connectors.has(word) ? word.toLowerCase() : word)).join(" ");
}

const ISO_INSTANT_SOURCE = "(\\bat )?\\b(\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d+)?)?(?:Z|[+-]\\d{2}:\\d{2}))";

/**
 * A named gap in its own words, with any machine timestamp it carries spelled
 * out in the body's own zone — the plain-language rule for prose. The instant
 * is the same instant; only its spelling changes. Null when a timestamp is
 * present and no zone is known to spell it in.
 */
export function plainGapStatement(statement: string, zone: string | null): string | null {
  if (!new RegExp(ISO_INSTANT_SOURCE).test(statement)) return statement;
  if (!zone) return null;
  return statement.replace(new RegExp(ISO_INSTANT_SOURCE, "g"), (_all: string, at: string | undefined, iso: string) => {
    if (!Number.isFinite(Date.parse(iso))) return _all;
    const sitting = { startsAt: iso, timeZone: zone };
    const day = localDate(sitting);
    return `${at ? "on " : ""}${formatDateLong(day) ?? day} at ${localTime(sitting)}`;
  });
}

function listed(sittings: readonly ComposableSitting[]): string {
  const parts = sittings.map((sitting) => `${quoted(sitting.title)} at ${localTime(sitting)}`);
  return parts.length <= 2 ? parts.join(" and ") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/**
 * **A COMPOSED ANSWER SHIPS ONLY ON A PASSING VERDICT.** The composition is
 * held to the validator a model answer faces, and a failed check discards it
 * whole — the caller then asks the model exactly as it did before this module
 * existed. It is never repaired, trimmed or shipped with a warning.
 */
export function settleSittingComposition(
  composed: { answer: string; citedUrls: string[] } | null,
  validate: (answer: string, citedUrls: readonly string[]) => ValidationVerdict,
): { composed: { answer: string; citedUrls: string[] } | null; verdict: ValidationVerdict | null } {
  if (!composed) return { composed: null, verdict: null };
  const verdict = validate(composed.answer, composed.citedUrls);
  return { composed: verdict.kind === "PASSED" ? composed : null, verdict };
}

/**
 * Compose the answer, or null when a model should write it. See the module
 * note for exactly when each applies.
 */
export function composeSittingAnswer(input: SittingAnswerInput): { answer: string; citedUrls: string[] } | null {
  const summarisable = input.records.some((record) => CONTENT_KINDS.has(record.kind));
  if (input.shape !== "MEETING_TIME" && summarisable) return null;
  /* An agenda or outcome question about a sitting is answered by the gap that
     says what is not held. Without one, there is no composed answer to give. */
  const roles = new Set(input.sittingGaps.map((entry) => entry.role));
  if (input.sittings.length > 0 && input.shape === "MEETING_OUTCOME" && !roles.has("OUTCOME") && !roles.has("MINUTES")) return null;
  if (input.sittings.length > 0 && input.shape === "BODY_AGENDA" && !roles.has("AGENDA")) return null;
  if (input.records.some((record) => record.kind === "MEETING" && record.meetingListingIdentity)) return null;

  const sentences: string[] = [];
  const cited: string[] = [];
  const add = (sentence: string): boolean => {
    const clean = sentence.trim().replace(/[.\s]+$/, "");
    if (!clean) return false;
    const candidate = [...sentences, clean];
    if (overLengthBudget(`${candidate.join(". ")}.`) !== null) return false;
    sentences.push(clean);
    return true;
  };

  const [chosen, ...sameDay] = input.sittings;
  const subjectName = proseName(input.subjectName);
  if (chosen) {
    if (input.sittings.some((sitting) => sitting.status === "CANCELED" || !zoneOf(sitting).known)) return null;
    const meetingRecords = new Map(input.records.filter((record) => record.kind === "MEETING").map((record) => [record.id, record]));
    // Every sitting described must be a record the reader is shown.
    if (!input.sittings.every((sitting) => meetingRecords.has(sitting.id))) return null;
    const upcoming = Date.parse(chosen.startsAt) >= input.now;
    const lead = upcoming
      ? `The next ${subjectName} meeting is on ${dayOf(chosen)} at ${localTime(chosen)}, listed as ${quoted(chosen.title)}`
      : `The most recent ${subjectName} meeting we hold was on ${dayOf(chosen)} at ${localTime(chosen)}, listed as ${quoted(chosen.title)}`;
    if (!add(lead)) return null;
    for (const sitting of input.sittings) {
      const url = meetingRecords.get(sitting.id)?.sourceUrl;
      if (url && !cited.includes(url)) cited.push(url);
    }
    const later = sameDay.filter((sitting) => sitting.startsAt > chosen.startsAt);
    const earlier = sameDay.filter((sitting) => sitting.startsAt < chosen.startsAt);
    const alongside = sameDay.filter((sitting) => sitting.startsAt === chosen.startsAt);
    if (alongside.length) add(`At the same time: ${listed(alongside)}`);
    if (later.length) add(`Later that day: ${listed(later)}`);
    if (earlier.length) add(`Earlier that day: ${listed(earlier)}`);
    if (input.shape === "MEETING_TIME") {
      // Held agenda items, counted per sitting: two sittings one day are two dockets.
      for (const sitting of input.sittings) {
        const items = input.records.filter((record) => record.kind === "AGENDA_ITEM" &&
          (record.meetingId ?? chosen.id) === sitting.id).length;
        if (items > 0) add(`The ${quoted(sitting.title)} agenda we hold lists ${items} item${items === 1 ? "" : "s"}`);
      }
    }
  }

  /* The named gaps, in their own words. An outcome question leads with
     whether the outcome is held; every other question with the agenda. */
  const order: readonly SittingGapRole[] = input.shape === "MEETING_OUTCOME"
    ? ["NO_SITTING", "OUTCOME", "MINUTES", "AGENDA", "NOTICE", "LISTING"]
    : ["NO_SITTING", "AGENDA", "LISTING", "NOTICE", "MINUTES", "OUTCOME"];
  const required: readonly SittingGapRole[] = input.shape === "MEETING_OUTCOME"
    ? ["NO_SITTING", "OUTCOME", "MINUTES"]
    : input.shape === "BODY_AGENDA" ? ["NO_SITTING", "AGENDA"] : ["NO_SITTING"];
  const said = new Set<string>();
  const zone = chosen?.timeZone ?? null;
  for (const role of order) {
    for (const { gap } of input.sittingGaps.filter((entry) => entry.role === role)) {
      if (said.has(gap.statement)) continue;
      said.add(gap.statement);
      const plain = plainGapStatement(gap.statement, zone);
      // A gap that cannot be said plainly is never dropped from a composed
      // answer: the model writes the answer instead.
      if (plain === null) return null;
      // The gap that IS the answer (no sitting; no outcome for an outcome
      // question; no agenda for an agenda question) must fit, or the model
      // writes it. Any other gap that does not fit stays in the named gaps.
      if (!add(plain) && required.includes(role)) return null;
    }
  }

  if (sentences.length === 0) return null;
  // With no sitting, the answer is the named gap and nothing else.
  if (!chosen && !input.sittingGaps.some((entry) => entry.role === "NO_SITTING")) return null;
  return { answer: `${sentences.join(". ")}.`, citedUrls: cited };
}
