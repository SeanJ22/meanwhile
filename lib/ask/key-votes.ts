import { keyVotesForMember } from "../votes/key-votes-reader.ts";
import { keyVotePositionKey } from "../votes/key-vote-positions.ts";
import { KEY_VOTES_CRITERIA } from "../votes/key-votes.ts";
import { readFederalMemberVotes, readFederalRollCallsProjection } from "../votes/snapshot.ts";
import { readHistoricalFederalVotesForMember } from "../votes/history.ts";
import { summaryForBill } from "../votes/bill-summaries.ts";
import type { EvidenceGap, EvidenceRecord, EvidenceSubject } from "./evidence.ts";

/** The same exact-member key-vote answer as the official card and votes API. */
export async function keyVoteEvidenceFor(subject: EvidenceSubject, canonicalOfficialIds: readonly string[], select: typeof keyVotesForMember = keyVotesForMember,
  options: { includeSummaries?: boolean } = {}) {
  const records: EvidenceRecord[] = [];
  const gaps: EvidenceGap[] = [];
  const denominators: Record<string, number> = { keyVoteContextsReturned: 0, keyVotePositionsReturned: 0, keyVotePositionsUnresolved: 0, billSummariesReturned: 0 };
  if (subject.kind !== "PERSON") return { records, gaps, denominators };
  const seenContexts = new Set<string>();
  const seenSummaries = new Set<string>();
  const positions = new Map<string, EvidenceRecord>();
  const conflictedPositions = new Set<string>();
  for (const member of [...new Set(canonicalOfficialIds)].filter((id) => /^congress:[A-Z]\d{6}$/.test(id))) {
    let selected: Awaited<ReturnType<typeof keyVotesForMember>>;
    try { selected = await select(member); }
    catch {
      gaps.push({ whose: "OURS", statement: `The held key-vote records for ${subject.name} could not be read for this answer.` });
      denominators.keyVoteLoaderFailures = (denominators.keyVoteLoaderFailures ?? 0) + 1;
      continue;
    }
    const { chamber, rows } = selected;
    if (!chamber) continue;
    for (const row of rows) {
      if (!seenContexts.has(row.entry.id)) {
        seenContexts.add(row.entry.id);
        records.push({ kind: "KEY_VOTE_CONTEXT", id: `key-vote-entry:${row.entry.id}`, subjectId: subject.id, canonicalSubjectId: member,
          text: `${row.entry.title}: ${row.entry.explainer}${row.entry.pending ? " This measure is pending." : ""}${row.note ? ` ${row.note}` : ""} Selection criteria: ${KEY_VOTES_CRITERIA}`,
          // The holding gives this source as a publisher description, not a URL.
          // Attaching a roll-call link as the explainer's citation would invent it.
          sourceUrl: null, sourceOrg: row.entry.explainerSource, retrievedAt: row.entry.explainerReadAt });
      }
      for (const [index, ref] of row.refs.entries()) {
        const positionKey = keyVotePositionKey(row.entry.id, chamber, ref.congress, ref.session, ref.rollNumber);
        const position = row.positions[index];
        if (!row.held[index] || position === null || position === undefined || !ref.url || !ref.verifiedAt) {
          denominators.keyVotePositionsUnresolved += 1;
          gaps.push({ whose: "OURS", statement: row.held[index]
            ? `For ${row.entry.title}, we hold the ${chamber === "house" ? "House" : "Senate"} roll call but no sourced position for ${subject.name}. This does not establish that they did not vote.`
            : `For ${row.entry.title}, we have not read the applicable ${chamber === "house" ? "House" : "Senate"} roll call for this answer.` });
          continue;
        }
        const physicalKey = `${member}#${chamber}|${ref.congress}-${ref.session}:${ref.rollNumber}`;
        if (conflictedPositions.has(physicalKey)) continue;
        const prior = positions.get(physicalKey);
        if (prior) {
          if (prior.keyVote!.position !== position || prior.sourceUrl !== ref.url) {
            // Conflicting records cannot silently make either position true.
            positions.delete(physicalKey);
            conflictedPositions.add(physicalKey);
            gaps.push({ whose: "OURS", statement: `The held key-vote records disagree for ${subject.name} on ${chamber} roll call ${ref.rollNumber}; no position is attached for that roll call.` });
            denominators.keyVoteIdentityConflicts = (denominators.keyVoteIdentityConflicts ?? 0) + 1;
            continue;
          }
          prior.keyVote!.entryIds.push(row.entry.id); prior.keyVote!.positionKeys.push(positionKey);
          continue;
        }
        positions.set(physicalKey, { kind: "KEY_VOTE_POSITION", id: `key-vote:${physicalKey}`, subjectId: subject.id, canonicalSubjectId: member,
          text: `${subject.name}: the ${chamber === "house" ? "U.S. House" : "U.S. Senate"} recorded ${position} on roll call ${ref.rollNumber}, Congress ${ref.congress}, session ${ref.session}. ${ref.question ?? row.entry.title}${ref.tally ? ` Recorded tally: ${ref.tally}.` : ""}`,
          sourceUrl: ref.url, sourceOrg: chamber === "house" ? "U.S. House of Representatives" : "U.S. Senate", retrievedAt: selected.positionsReadAt ?? ref.verifiedAt,
          rollCall: { position, what: `${row.entry.title} — ${ref.question ?? row.entry.title}`,
            when: `Congress ${ref.congress}, session ${ref.session}`, result: ref.tally ?? "" },
          keyVote: { entryIds: [row.entry.id], positionKeys: [positionKey], chamber, congress: ref.congress, session: ref.session, rollNumber: ref.rollNumber, position, referenceVerifiedAt: ref.verifiedAt } });
      }
    }
    // A summary belongs to the exact official bill URL on a proven vote,
    // whether that vote is still in Recent or now in verified Earlier records.
    if (options.includeSummaries !== false) try {
      const addSummary = (billUrl: string | null, summary: ReturnType<typeof summaryForBill>) => {
        if (!summary || !billUrl || seenSummaries.has(billUrl)) return;
        seenSummaries.add(billUrl);
        records.push({ kind: "BILL_SUMMARY", id: `bill-summary:${billUrl}`, subjectId: subject.id, canonicalSubjectId: member,
          text: `${summary.title} (${summary.legisNum}): ${summary.summary} Basis: ${summary.basis}`,
          sourceUrl: billUrl, sourceOrg: "Congressional Research Service", retrievedAt: summary.curatedAt });
      };
      const own = await readFederalMemberVotes(member);
      if (own.kind === "STORE_UNREACHABLE") throw new Error(own.detail);
      for (const vote of own.kind === "PROMOTED" || own.kind === "BOOTSTRAP" ? own.value.votes : [])
        addSummary(vote.billUrl, summaryForBill(vote.billUrl));
      if (process.env.DATABASE_URL) {
        const current = await readFederalRollCallsProjection();
        if (current.kind !== "PROMOTED") throw new Error("No proven current federal vote window");
        let cursor: string | null = null;
        const seenCursors = new Set<string>();
        for (;;) {
          const page = await readHistoricalFederalVotesForMember(member, current, { cursor, pageSize: 16 });
          for (const vote of page.votes) addSummary(vote.billUrl, vote.billSummary);
          if (page.status === "COMPLETE") break;
          if (page.status !== "MORE" || !page.nextVersionId || seenCursors.has(page.nextVersionId))
            throw new Error("Earlier bill-summary source continuation unavailable");
          cursor = page.nextVersionId;
          seenCursors.add(cursor);
        }
      }
    } catch {
      gaps.push({ whose: "OURS", statement: `The held bill-summary links for ${subject.name} could not be read for this answer.` });
      denominators.billSummaryLoaderFailures = (denominators.billSummaryLoaderFailures ?? 0) + 1;
    }
  }
  records.push(...positions.values());
  denominators.keyVoteContextsReturned = records.filter((record) => record.kind === "KEY_VOTE_CONTEXT").length;
  denominators.keyVotePositionsReturned = positions.size;
  denominators.billSummariesReturned = records.filter((record) => record.kind === "BILL_SUMMARY").length;
  return { records, gaps, denominators };
}
