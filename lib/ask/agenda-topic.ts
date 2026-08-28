import {
  agendaTopicFor,
  searchAgendas,
  type AgendaDocumentLike,
  type AgendaTopic,
} from "../routing/agenda-search.ts";

import type { EvidenceGap, EvidenceRecord } from "./evidence.ts";

/**
 * **THE TOPIC SWEEP, AS EVIDENCE INSTEAD OF AS A SECOND ANSWER.**
 * (ASK-05, 2026-08-28.)
 *
 * ## What this replaces, and why it had to be replaced
 *
 * *"Is there a data centre coming?"* is a real question with a real answer and
 * a real denominator, and this module is the whole of the capability that
 * answers it. Nothing about it is deleted here.
 *
 * What is deleted is its status. The map Ask box ran `/api/ask/grounded` and
 * `/api/ask/agenda` through one `Promise.all` and rendered BOTH replies, so a
 * single question could paint two civic answers on one screen: the grounded
 * engine's, about a government it had canonically bound and whose own records
 * it had retrieved, and this sweep's, with its own eyebrow, its own four-way
 * denominator sentence, its own corpus caveat and its own hit list. Two
 * authorities, no precedence, reader picks.
 *
 * So the sweep now emits `AGENDA_MENTION` records into the ONE evidence pack.
 * It leads nothing. It is supplemental evidence under the grounded answer,
 * it is validated against the same allow-list as every other record, and its
 * denominator is a number in `pack.denominators` rather than a ternary in a
 * component.
 *
 * ## Every sentence the component used to build is a NAMED GAP here
 *
 * The four-way ternary at `ask-box.tsx:1404-1416` distinguished four states —
 * nothing searched, nothing found, all hits shown, hits clipped — plus an
 * `unreadable` suffix and a standing corpus caveat. Every one of those
 * distinctions is load-bearing and every one survives, as a gap with an
 * explicit `whose`:
 *
 * | State | Why it is its own sentence |
 * |---|---|
 * | searched 0 | Nothing searched is NOT nothing found. Silence reads as "no". |
 * | found 0 | A sweep that ran and found nothing is a fact about our corpus. |
 * | clipped | Stated N must equal rendered rows, or a clip reads as a small result. |
 * | unreadable > 0 | A document we could not read is not a document with nothing in it. |
 * | always | Agendas are not the permit record. A filing exists long before a docket. |
 *
 * The last one rides on the HIT case as well as the empty one, which was
 * already the rule: a reader who found one mention still needs to know there
 * may be filings behind it that we have not wired.
 *
 * ## It generates nothing
 *
 * Every `text` below is either the clerk's own line, quoted, or a curated
 * label from `AGENDA_TOPICS`. A summary of a zoning agenda is a claim about
 * what a government is about to do, made by us.
 */

/** Enough to answer, few enough to read. The denominator states the rest. */
export const MAX_AGENDA_MENTIONS = 12;

export interface AgendaTopicEvidence {
  /** Null when the question carried no curated topic — the sweep did not run. */
  topic: AgendaTopic | null;
  records: EvidenceRecord[];
  gaps: EvidenceGap[];
  denominators: Record<string, number>;
}

/** What the sweep needs to know about a meeting to attribute a hit. */
export interface SweptMeeting {
  id: string;
  ocdId: string | null;
  bodyName: string;
  title: string;
  startsAt: string;
  agendaUrl?: string | null;
}

/**
 * Sweep the readable agendas in scope for the topic the question carries.
 *
 * **The trigger is the DETERMINISTIC detector, not the model's intent.**
 * `agendaTopicFor` is the only thing in this product that can produce a topic,
 * and it is a curated keyword match that runs with no API key. Gating the
 * sweep on `intent === "AGENDA_TOPIC"` alone would silently delete the whole
 * capability every time the interpretation rung is unavailable, over its
 * ceiling or unreachable — which is exactly the degraded path this pipeline is
 * built to keep honest. The intent member exists so the vocabulary declares
 * the question and the trace can name it; the detector decides.
 *
 * **The scope is a decision the caller has already made.** When a body bound,
 * the caller passes that body's own documents and the sweep is about that
 * government; otherwise the caller passes the reader's divisions' documents.
 * Either way this module never widens a scope, because a hit from a government
 * the reader did not ask about, rendered under their answer, is the
 * substitution defect wearing a quote.
 */
export function agendaTopicEvidence(input: {
  question: string;
  documents: readonly AgendaDocumentLike[];
  meetings: readonly SweptMeeting[];
  /** Plain words for what was swept — "your area", or a body's own name. */
  scopeLabel: string;
}): AgendaTopicEvidence {
  const topic = agendaTopicFor(input.question);
  if (!topic) return { topic: null, records: [], gaps: [], denominators: {} };

  const { hits, searched, unreadable } = searchAgendas(input.documents, topic);
  const byMeeting = new Map(input.meetings.map((m) => [m.id, m]));

  const records: EvidenceRecord[] = [];
  const gaps: EvidenceGap[] = [];
  const shown = hits.slice(0, MAX_AGENDA_MENTIONS);

  for (const hit of shown) {
    const meeting = byMeeting.get(hit.meetingId);
    /*
     * The RECORD'S OWN WORDS. The clerk's line, quoted, prefixed only by the
     * body that scheduled it — which is a fact read off the meeting row, not a
     * characterisation. Without the body name a quote about a rezoning could
     * be read as belonging to whichever government the answer named above it.
     */
    records.push({
      kind: "AGENDA_MENTION",
      id: `${hit.documentUrl}#${hit.matchedPhrase}#${hit.quote.slice(0, 40)}`,
      text: meeting?.bodyName
        ? `${meeting.bodyName}: "${hit.quote}"`
        : `"${hit.quote}"`,
      occurredAt: meeting?.startsAt ?? null,
      /* The agenda a reader can open. The document URL is the fallback, not
         the preference: an agenda page is where they go to read it whole. */
      sourceUrl: meeting?.agendaUrl ?? hit.documentUrl,
      sourceOrg: hit.sourceOrg,
      retrievedAt: hit.retrievedAt,
    });
  }

  const denominators: Record<string, number> = {
    agendasSweptForTopic: searched,
    agendaMentionsFound: hits.length,
    agendaMentionsShown: shown.length,
    agendasHeldButUnreadable: unreadable,
  };

  if (searched === 0) {
    /* Nothing searched is NOT nothing found. The two read identically to a
       reader unless we say which one happened, and the second is a claim we
       are not entitled to make. */
    gaps.push({
      whose: "OURS",
      statement: `We don't hold any readable agendas for ${input.scopeLabel} yet, so nothing was searched for ${topic.label}. That is a gap in what we have, not a statement that nothing is planned.`,
    });
  } else if (hits.length === 0) {
    gaps.push({
      whose: "OURS",
      statement: `No mention of ${topic.label} in the ${searched} agenda${searched === 1 ? "" : "s"} we hold for ${input.scopeLabel}.`,
    });
  } else if (shown.length < hits.length) {
    /* Stated N equals rendered rows. A clip that says nothing reads as a
       small result rather than as a long one we shortened. */
    gaps.push({
      whose: "OURS",
      statement: `${hits.length} mentions of ${topic.label} across the ${searched} agendas we hold for ${input.scopeLabel} — the first ${shown.length} are shown.`,
    });
  }

  if (unreadable > 0) {
    gaps.push({
      whose: "OURS",
      statement: `${unreadable} more agenda${unreadable === 1 ? "" : "s"} we hold but could not read, so ${unreadable === 1 ? "it is" : "they are"} not included.`,
    });
  }

  /*
   * **THE CORPUS LIMIT RIDES ON EVERY OUTCOME, HIT OR EMPTY.**
   *
   * This sweeps AGENDAS — what bodies have scheduled to discuss. A permit
   * application, a rezoning filing and a site-plan submission all exist in a
   * jurisdiction's permitting system BEFORE they reach an agenda, and often
   * without ever reaching one. Left unqualified, "no mention on an agenda"
   * lets a reader take it for "nothing has been filed", which is a far larger
   * claim about a record of a different kind.
   *
   * **The sentence states the SCOPE, and stops.** Its previous form ended
   * *"and we haven't wired those systems yet"* — a progress claim about our
   * own pipeline, which RULING 59 strikes from every reader surface and
   * RULING 139 strikes again as a verdict on ourselves. It survived only
   * because it lived in JSX as `haven&apos;t` and the sweep's regex could not
   * see through the entity. What a reader can act on is where else to look;
   * whether we have wired a permitting system is not something they can do
   * anything with.
   */
  gaps.push({
    whose: "OURS",
    statement:
      "This searches meeting agendas — what bodies have scheduled to discuss. It is not the permit or zoning-application record: something can be filed with a planning department long before it reaches an agenda, and some are never scheduled at all.",
  });

  return { topic, records, gaps, denominators };
}
