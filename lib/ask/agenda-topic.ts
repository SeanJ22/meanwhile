import {
  agendaTopicFor,
  searchAgendas,
  type AgendaDocumentLike,
  type AgendaTopic,
} from "../routing/agenda-search.ts";

import type { EvidenceGap, EvidenceRecord } from "./evidence.ts";
import { classifyAgendaPublication } from "./agenda-publication.ts";

/**
 * The agenda topic sweep as evidence in the one pack: hits are
 * `AGENDA_MENTION` records and every outcome sentence is a named gap with an
 * explicit `whose`. Nothing searched, nothing found, clipped results and
 * unreadable documents each get their own sentence, and the corpus limit
 * (agendas are not the permit record) rides on every outcome. Every `text` is
 * the clerk's own line or a curated label from `AGENDA_TOPICS`; nothing is
 * generated.
 */

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
 * Sweep the readable agendas in scope for the question's topic. The trigger is
 * the deterministic `agendaTopicFor` detector, which runs with no API key, not
 * the model's intent. The caller decides the scope (a bound body's documents,
 * or the reader's divisions'); this never widens it.
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

  let portals = 0;
  const documents = input.documents.flatMap((document) => {
    const publication = classifyAgendaPublication({ meetingId: document.meetingId,
      bodyName: document.sourceOrg, documentsForMeeting: [document],
      documentsAcrossCorpus: input.documents, meetingsAcrossCorpus: input.meetings, now: Date.now() });
    if (publication.acquisition === "ACQUIRED_IS_PUBLICATION_INDEX") { portals++; return []; }
    return [publication.acquisition === "ACQUIRED_NOT_READABLE" ? { ...document, text: null } : document];
  });
  const { hits, searched, unreadable } = searchAgendas(documents, topic);
  const byMeeting = new Map(input.meetings.map((m) => [m.id, m]));

  const records: EvidenceRecord[] = [];
  const gaps: EvidenceGap[] = [];
  const shown = hits;

  for (const hit of shown) {
    const meeting = byMeeting.get(hit.meetingId);
    /* The clerk's line, quoted, prefixed only by the body that scheduled it. */
    records.push({
      kind: "AGENDA_MENTION",
      id: `${hit.documentUrl}#${hit.matchedPhrase}#${hit.quote.slice(0, 40)}`,
      text: meeting?.bodyName
        ? `${meeting.bodyName}: "${hit.quote}"`
        : `"${hit.quote}"`,
      occurredAt: meeting?.startsAt ?? null,
      /* The agenda page first; the document URL is the fallback. */
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
    agendaPortalRepresentationsHeld: portals,
  };

  if (searched === 0) {
    /* Nothing searched is not nothing found. */
    gaps.push({
      whose: "OURS",
      statement: `We don't hold any readable agendas for ${input.scopeLabel} yet, so nothing was searched for ${topic.label}. That is a gap in what we have, not a statement that nothing is planned.`,
    });
  } else if (hits.length === 0) {
    gaps.push({
      whose: "OURS",
      statement: `No mention of ${topic.label} in the ${searched} agenda${searched === 1 ? "" : "s"} we hold for ${input.scopeLabel}.`,
    });
  }

  if (portals > 0) gaps.push({ whose: "OURS",
    statement: `${portals} held link${portals === 1 ? " leads" : "s lead"} to a publisher portal rather than an agenda; portal navigation was not searched as meeting content.` });

  if (unreadable > 0) {
    gaps.push({
      whose: "OURS",
      statement: `${unreadable} more agenda${unreadable === 1 ? "" : "s"} we hold but could not read, so ${unreadable === 1 ? "it is" : "they are"} not included.`,
    });
  }

  /*
   * The corpus limit rides on every outcome: permits and filings exist before
   * and outside agendas. The sentence states the scope and stops.
   */
  gaps.push({
    whose: "OURS",
    statement:
      "This searches meeting agendas — what bodies have scheduled to discuss. It is not the permit or zoning-application record: something can be filed with a planning department long before it reaches an agenda, and some are never scheduled at all.",
  });

  return { topic, records, gaps, denominators };
}
