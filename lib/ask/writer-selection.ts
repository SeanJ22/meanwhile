import type { EvidencePack, EvidenceRecord } from "./evidence.ts";

/**
 * **WHAT THE ANSWER-WRITING MODEL IS SENT: A BOUNDED, RELEVANT SELECTION OF
 * THE RECORDS THE READER IS SHOWN.** (2026-09-25, the Ask latency repair.)
 *
 * Measured on production read-only data 2026-09-25: *"What did the Pima County
 * Board of Supervisors decide at its last meeting?"* sent the synthesis model
 * 108,678 input tokens — 240 per-member vote rows (150,029 of the 228,293
 * characters it was given) beside the 51 recorded actions that actually say
 * what was decided. It cost $0.69, took 7.7 s, and the answer was then
 * rejected for length. Every member-vote row repeats its roll call's source
 * link, date and publisher; the rows of five members on one item are one fact
 * about that item, written five times.
 *
 * So the writer is sent every record EXCEPT per-member vote rows beyond a
 * bound, and those are cut only by whole roll call — never half a roll call,
 * which would misstate how a vote went:
 *
 * - The route already orders member-vote rows by relevance
 *   (`lib/ask/meeting-outcomes.ts`: a roll call whose item the question names
 *   first, then divided votes, then agenda order). Roll calls are kept in that
 *   order until the next whole roll call would pass `WRITER_MEMBER_VOTE_ROWS`;
 *   the first roll call is always kept whole.
 * - The recorded actions — the clerk's disposition and tally text — are never
 *   cut, so "what was decided" and each item's tally always reach the writer.
 * - The writer is told, in `writerSelection`, exactly how many rows and roll
 *   calls it was given and how many exist, and that the reader sees them all.
 *   The pack's own denominators (`personVotesHeldForThatMeeting`,
 *   `rollCallItemsHeldForThatMeeting`, ...) are untouched and still state the
 *   full counts.
 *
 * What does NOT change: the records the reader sees (`payload.records`) stay
 * complete, the validator checks the answer against the WHOLE pack, and a
 * failed check fails closed exactly as before. This module only decides what
 * one model call reads.
 */

/**
 * The most per-member vote rows the answer-writing model is sent: three to
 * five roll calls of a five-to-nine-member body. Measured 2026-09-25 with the
 * fast writer on the Pima sitting: 240 rows was 108,678 input tokens (7.7 s on
 * Opus 5); 40 rows, 36,964 tokens (2.9 s on Haiku 4.5) — each ~10k input
 * tokens costs the reader about 0.3 s before the first word.
 */
export const WRITER_MEMBER_VOTE_ROWS = 24;

/**
 * **A PERSON'S VOTES ARE SENT AS THE ONES THE QUESTION IS ABOUT.** (2026-09-29, S3.)
 *
 * Measured on staging that day, *"How did Juan Ciscomani vote on the budget?"*
 * sent the fast writer 104 records — 39 roll calls, 36 key-vote contexts, 12 key-vote
 * positions and 6 bill summaries, about 36,000 tokens. Haiku 4.5 did not answer in
 * its 6 s budget, the escalation writer took another 5.6 s, and the reader waited
 * 11.6 s for an answer that names three votes. The same rule as the sitting's
 * member votes applies: the records the reader is shown stay whole, and the writer
 * is sent the most relevant of them — those whose own words share a content word
 * with the question ("budget"), newest first — up to `WRITER_PERSON_VOTE_RECORDS`,
 * with each kept key-vote position's context beside it, and is told exactly what it
 * was not given.
 */
export const WRITER_PERSON_VOTE_RECORDS = 16;

const PERSON_VOTE_KINDS: ReadonlySet<EvidenceRecord["kind"]> = new Set(["ROLL_CALL_VOTE", "KEY_VOTE_POSITION", "KEY_VOTE_CONTEXT", "BILL_SUMMARY"]);

/** Words that name what is asked rather than what it is about. */
const QUESTION_WORDS: ReadonlySet<string> = new Set([
  "how", "did", "does", "what", "when", "where", "which", "that", "this", "with", "from", "have", "has", "been", "were", "was", "are", "the", "and", "for",
  "vote", "voted", "votes", "voting", "record", "position", "stance", "about", "their", "they", "them", "tell", "show", "give", "recent", "recently", "last",
  "past", "time", "times", "ever", "always", "member", "representative", "senator", "congress", "house", "legislature", "bill", "bills", "law", "laws",
]);

/** The content words of a question, without the subject's own name, lightly stemmed. */
function contentTerms(question: string, subjectName: string): string[] {
  const name = new Set(subjectName.toLowerCase().split(/[^a-z]+/));
  const words = question.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4 && !QUESTION_WORDS.has(word) && !name.has(word));
  return [...new Set(words.map((word) => word.replace(/(?:ing|es|s)$/, "")).filter((word) => word.length >= 3))];
}

export interface WriterSelection {
  /** The records the writer is sent, in pack order. */
  records: EvidenceRecord[];
  /** What was held back and why, as the writer is told it. Null when nothing was. */
  note: string | null;
  /** Counts for the trace and the proofs. Zero when nothing was withheld. */
  withheld: { memberVoteRows: number; rollCalls: number; personVoteRecords?: number };
  shown: { memberVoteRows: number; rollCalls: number; personVoteRecords?: number };
}

/** The person-vote records the writer is sent, or null when the family fits the bound. */
function personVoteSelection(pack: Pick<EvidencePack, "records"> & Partial<Pick<EvidencePack, "question" | "subject">>): { kept: Set<EvidenceRecord>; total: number } | null {
  const family = pack.records.filter((record) => PERSON_VOTE_KINDS.has(record.kind));
  if (family.length <= WRITER_PERSON_VOTE_RECORDS) return null;
  const terms = contentTerms(pack.question ?? "", pack.subject?.name ?? "");
  const score = (record: EvidenceRecord) => terms.filter((term) => record.text.toLowerCase().includes(term)).length;
  const ranked = family
    .map((record, order) => ({ record, order, score: score(record) }))
    .sort((a, b) => b.score - a.score || (b.record.occurredAt ?? "").localeCompare(a.record.occurredAt ?? "") || a.order - b.order);
  const kept = new Set(ranked.slice(0, WRITER_PERSON_VOTE_RECORDS).map((entry) => entry.record));
  /* A key vote's context and its position travel together: a position with no account of what the bill is says nothing,
     and a context with no position invites "the records do not say how they voted" over a position we hold. */
  const entryOf = (context: EvidenceRecord) => context.id.replace(/^key-vote-entry:/, "");
  for (const record of [...kept]) {
    if (record.kind === "KEY_VOTE_POSITION" && record.keyVote) {
      for (const context of family) if (context.kind === "KEY_VOTE_CONTEXT" && record.keyVote.entryIds.includes(entryOf(context))) kept.add(context);
    } else if (record.kind === "KEY_VOTE_CONTEXT") {
      for (const position of family) if (position.kind === "KEY_VOTE_POSITION" && position.keyVote?.entryIds.includes(entryOf(record))) kept.add(position);
    }
  }
  return { kept, total: family.length };
}

/** The roll call a member-vote row belongs to: its id is `${eventItemId}#${member}`. */
function rollCallOf(record: EvidenceRecord): string {
  const at = record.id.lastIndexOf("#");
  return at > 0 ? record.id.slice(0, at) : record.id;
}

/**
 * **THE PROOF OF WHAT THE WRITER WAS SENT.** For the reader-proof harnesses,
 * which assert the model input. `writerRecords` is what the synthesis context
 * payload actually carries; it must be exactly this module's selection of the
 * pack, and every record the reader sees that the writer was not sent must be
 * a per-member vote row, counted here and still present in `payloadRecords`.
 */
export function writerInputProof(
  pack: Pick<EvidencePack, "records"> & Partial<Pick<EvidencePack, "question" | "subject">>,
  payloadRecords: readonly EvidenceRecord[],
  writerRecords: readonly EvidenceRecord[],
): { receivesItsSelection: boolean; withheldMemberVoteRows: number } {
  const selection = writerSelection(pack);
  const sent = new Set(writerRecords.map((record) => `${record.kind}\u0000${record.id}`));
  const withheld = payloadRecords.filter((record) => !sent.has(`${record.kind}\u0000${record.id}`));
  return {
    receivesItsSelection:
      JSON.stringify(writerRecords) === JSON.stringify(selection.records) &&
      withheld.every((record) => record.kind === "MEETING_MEMBER_VOTE" || PERSON_VOTE_KINDS.has(record.kind)) &&
      withheld.length === selection.withheld.memberVoteRows + (selection.withheld.personVoteRecords ?? 0),
    withheldMemberVoteRows: withheld.length,
  };
}

export function writerSelection(pack: Pick<EvidencePack, "records"> & Partial<Pick<EvidencePack, "question" | "subject">>): WriterSelection {
  const meeting = memberVoteSelection(pack);
  const person = personVoteSelection(pack);
  if (!person) return meeting;
  const records = meeting.records.filter((record) => !PERSON_VOTE_KINDS.has(record.kind) || person.kept.has(record));
  const note =
    `These records hold ${person.total} recorded votes, positions and bill summaries for this person. To keep this short you are given the ${[...person.kept].length} most relevant to the question. ` +
    "Every record is shown to the reader beneath your answer. The others WERE published and ARE recorded: never say or imply that votes were not published, not recorded or not available.";
  return {
    records,
    note: meeting.note ? `${meeting.note} ${note}` : note,
    withheld: { ...meeting.withheld, personVoteRecords: person.total - person.kept.size },
    shown: { ...meeting.shown, personVoteRecords: person.kept.size },
  };
}

function memberVoteSelection(pack: Pick<EvidencePack, "records">): WriterSelection {
  const votes = pack.records.filter((record) => record.kind === "MEETING_MEMBER_VOTE");
  const rollCalls: string[] = [];
  const rows = new Map<string, number>();
  for (const record of votes) {
    const key = rollCallOf(record);
    if (!rows.has(key)) rollCalls.push(key);
    rows.set(key, (rows.get(key) ?? 0) + 1);
  }
  const kept = new Set<string>();
  let keptRows = 0;
  for (const key of rollCalls) {
    const count = rows.get(key) ?? 0;
    if (kept.size > 0 && keptRows + count > WRITER_MEMBER_VOTE_ROWS) break;
    kept.add(key);
    keptRows += count;
  }
  const withheldRows = votes.length - keptRows;
  if (withheldRows === 0) {
    return { records: [...pack.records], note: null, withheld: { memberVoteRows: 0, rollCalls: 0 }, shown: { memberVoteRows: votes.length, rollCalls: rollCalls.length } };
  }
  const records = pack.records.filter((record) => record.kind !== "MEETING_MEMBER_VOTE" || kept.has(rollCallOf(record)));
  return {
    records,
    note:
      `These records hold how each member voted on ${rollCalls.length} roll-call items (${votes.length} rows). ` +
      `To keep this short you are given the rows for ${kept.size} of them (${keptRows} rows) — the items the question names ` +
      "or whose vote was split come first. Every row is shown to the reader beneath your answer, and each item's recorded " +
      "action and tally is in your records. The other items' votes WERE published and ARE recorded: never say or imply " +
      "that votes were not published, not recorded or not available.",
    withheld: { memberVoteRows: withheldRows, rollCalls: rollCalls.length - kept.size },
    shown: { memberVoteRows: keptRows, rollCalls: kept.size },
  };
}
