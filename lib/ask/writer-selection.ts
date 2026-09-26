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

export interface WriterSelection {
  /** The records the writer is sent, in pack order. */
  records: EvidenceRecord[];
  /** What was held back and why, as the writer is told it. Null when nothing was. */
  note: string | null;
  /** Counts for the trace and the proofs. Zero when nothing was withheld. */
  withheld: { memberVoteRows: number; rollCalls: number };
  shown: { memberVoteRows: number; rollCalls: number };
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
  pack: Pick<EvidencePack, "records">,
  payloadRecords: readonly EvidenceRecord[],
  writerRecords: readonly EvidenceRecord[],
): { receivesItsSelection: boolean; withheldMemberVoteRows: number } {
  const selection = writerSelection(pack);
  const sent = new Set(writerRecords.map((record) => `${record.kind}\u0000${record.id}`));
  const withheld = payloadRecords.filter((record) => !sent.has(`${record.kind}\u0000${record.id}`));
  return {
    receivesItsSelection:
      JSON.stringify(writerRecords) === JSON.stringify(selection.records) &&
      withheld.every((record) => record.kind === "MEETING_MEMBER_VOTE") &&
      withheld.length === selection.withheld.memberVoteRows,
    withheldMemberVoteRows: withheld.length,
  };
}

export function writerSelection(pack: Pick<EvidencePack, "records">): WriterSelection {
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
