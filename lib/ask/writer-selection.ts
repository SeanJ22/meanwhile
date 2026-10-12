import type { EvidencePack, EvidenceRecord } from "./evidence.ts";

export const WRITER_MEMBER_VOTE_ROWS = 24;

export const WRITER_PERSON_VOTE_RECORDS = 16;

const PERSON_VOTE_KINDS: ReadonlySet<EvidenceRecord["kind"]> = new Set(["ROLL_CALL_VOTE", "KEY_VOTE_POSITION", "KEY_VOTE_CONTEXT", "BILL_SUMMARY"]);

const QUESTION_WORDS: ReadonlySet<string> = new Set([
  "how", "did", "does", "what", "when", "where", "which", "that", "this", "with", "from", "have", "has", "been", "were", "was", "are", "the", "and", "for",
  "vote", "voted", "votes", "voting", "record", "position", "stance", "about", "their", "they", "them", "tell", "show", "give", "recent", "recently", "last",
  "past", "time", "times", "ever", "always", "member", "representative", "senator", "congress", "house", "legislature", "bill", "bills", "law", "laws",
]);

function contentTerms(question: string, subjectName: string): string[] {
  const name = new Set(subjectName.toLowerCase().split(/[^a-z]+/));
  const words = question.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4 && !QUESTION_WORDS.has(word) && !name.has(word));
  return [...new Set(words.map((word) => word.replace(/(?:ing|es|s)$/, "")).filter((word) => word.length >= 3))];
}

export interface WriterSelection {
  records: EvidenceRecord[];
  note: string | null;
  withheld: { memberVoteRows: number; rollCalls: number; personVoteRecords?: number };
  shown: { memberVoteRows: number; rollCalls: number; personVoteRecords?: number };
}

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
