import { openZipFile, type FileArchiveMember } from "../archive.ts";
import type { PluralVoteFact } from "../plural/votes.ts";
import type { Officeholder } from "../../officials/types.ts";
import { digest, legiscanIdentityJoins, legiscanState, object, positiveId, profileUrl, text, validDay,
  type LegiscanDatasetEvidence, type LegiscanSession } from "./dataset.ts";

interface LegiscanDatasetInput {
  state: string; session: LegiscanSession; evidence: LegiscanDatasetEvidence;
  holders: readonly Officeholder[]; signal: AbortSignal;
  /** A consumer can publish each verified roll without retaining the session. */
  onVote?: (vote: PluralVoteFact) => Promise<void>;
}
async function readDatasetMember(entry: FileArchiveMember, signal: AbortSignal): Promise<{ body: string; value: Record<string, unknown> }> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of entry.stream()) { signal.throwIfAborted(); chunks.push(chunk); }
  const body = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  return { body, value: object(JSON.parse(body)) };
}
/** The first pass keeps bill metadata and the member crosswalk only. Raw rolls
 * are discarded immediately; the second pass normalizes one roll at a time. */
export async function parseLegiscanDatasetFile(input: LegiscanDatasetInput & { path: string }) {
  const state = legiscanState(input.state);
  const entries = await openZipFile(input.path, { maxEntries: 250_000, maxMemberBytes: 32 * 1024 * 1024, maxTotalBytes: 2 * 1024 * 1024 * 1024 });
  if (!entries.length || entries.some(entry => !entry.name.startsWith(`${state}/`))) throw new Error("LEGISCAN_DATASET_STATE_MISMATCH");
  const bills = new Map<number, Record<string, unknown>>(), people: Record<string, unknown>[] = [];
  const members: { name: string; sha256: string }[] = [], seenRolls = new Set<number>(), repeatedRolls = new Set<number>();
  const voteEntries: FileArchiveMember[] = [];
  for (const entry of entries) {
    input.signal.throwIfAborted();
    const relevant = /\/(bill|vote|people)\/[^/]+\.json$/.exec(entry.name)?.[1];
    if (!relevant) {
      for await (const _chunk of entry.stream()) input.signal.throwIfAborted();
      continue;
    }
    const { body, value } = await readDatasetMember(entry, input.signal);
    // Original archive bytes live once in the vault. Hashes retain exact replay.
    members.push({ name: entry.name, sha256: digest(body) });
    if (relevant === "bill") {
      const bill = object(value.bill);
      if (!positiveId(bill.bill_id) || bill.state !== state || bill.session_id !== input.session.sessionId) throw new Error("LEGISCAN_BILL_SCOPE_INVALID");
      if (bills.has(bill.bill_id)) throw new Error("LEGISCAN_BILL_DUPLICATE");
      bills.set(bill.bill_id, { bill_id: bill.bill_id, bill_number: bill.bill_number, title: bill.title,
        url: bill.url, state_link: bill.state_link, votes: bill.votes });
    } else if (relevant === "people") {
      const person = object(value.person);
      if (!positiveId(person.people_id) || person.state_id !== input.session.stateId) throw new Error("LEGISCAN_PERSON_SCOPE_INVALID");
      people.push(person);
    } else {
      const rollId = Number(object(value.roll_call).roll_call_id);
      if (seenRolls.has(rollId)) repeatedRolls.add(rollId);
      seenRolls.add(rollId); voteEntries.push(entry);
    }
  }
  if (new Set(people.map(person => person.people_id)).size !== people.length) throw new Error("LEGISCAN_PERSON_DUPLICATE");
  const joins = legiscanIdentityJoins(input.holders, people), peopleById = new Map(joins.map(identity => [identity.legiscanPeopleId, identity.personId]));
  const votes: PluralVoteFact[] = [], held: { key: string; detail: string }[] = people.filter(person => !peopleById.has(Number(person.people_id)))
    .map(person => ({ key: `legiscan:people:${person.people_id}`, detail: "No unique source-backed OpenStates person identity joined this vendor person." }));
  let rollCalls = 0, memberVotes = 0, unmatchedPositions = 0;
  for (const entry of voteEntries) {
    input.signal.throwIfAborted();
    const { value } = await readDatasetMember(entry, input.signal), roll = object(value.roll_call);
    const key = `legiscan:roll_call:${roll.roll_call_id}`;
    let vote: PluralVoteFact;
    try {
      const bill = bills.get(Number(roll.bill_id)), meta = (Array.isArray(bill?.votes) ? bill.votes : []).map(object).find(meta => meta.roll_call_id === roll.roll_call_id);
      if (!positiveId(roll.roll_call_id) || repeatedRolls.has(roll.roll_call_id) || !bill || !meta || !text(bill.bill_number) || !text(bill.title) ||
        !validDay(roll.date) || roll.date > input.evidence.retrievedAt.slice(0, 10) || !text(roll.desc) || !["H", "S", ...(state === "NE" ? ["L"] : [])].includes(text(roll.chamber)) ||
        !positiveId(roll.chamber_id) || ![0, 1].includes(Number(roll.passed)) || !Array.isArray(roll.votes)) throw new Error("native roll identity, bill, date or chamber is unresolved");
      const positions: PluralVoteFact["positions"] = [], seen = new Set<number>();
      let unresolvedPositions = 0;
      for (const raw of roll.votes) {
        const row = object(raw);
        if (!positiveId(row.people_id) || seen.has(row.people_id) || !text(row.vote_text)) throw new Error("native member position is malformed or duplicated");
        seen.add(row.people_id);
        const personId = peopleById.get(row.people_id);
        if (!personId) { unresolvedPositions++; continue; }
        positions.push({ personId, option: text(row.vote_text), retrievedAt: input.evidence.retrievedAt });
      }
      unmatchedPositions += unresolvedPositions;
      if (!positions.length) throw new Error("no exact OpenStates person identity joined this roll");
      const counts = ["yea", "nay", "nv", "absent"].map(option => {
        if (!Number.isSafeInteger(roll[option]) || Number(roll[option]) < 0) throw new Error("publisher tally is invalid");
        return { option, value: Number(roll[option]) };
      });
      if (counts.reduce((sum, row) => sum + row.value, 0) !== roll.total || roll.total !== roll.votes.length) throw new Error("publisher tally does not reconcile to native positions");
      const sourceUrls = [...new Set([meta.url, meta.state_link, bill.url, bill.state_link].flatMap(value => profileUrl(value) ? [profileUrl(value)!] : []))];
      if (!sourceUrls.some(url => url.startsWith(`https://legiscan.com/${state}/rollcall/`))) throw new Error("vendor roll source is unresolved");
      vote = { id: key, billId: `legiscan:bill:${bill.bill_id}`, billNumber: text(bill.bill_number), billTitle: text(bill.title),
        session: input.session.sessionName, organizationId: `legiscan:chamber:${state}:${roll.chamber_id}`, chamber: roll.chamber === "S" ? "upper" : roll.chamber === "L" ? "legislature" : "lower",
        date: roll.date, motion: text(roll.desc), result: roll.passed === 1 ? "Passed" : "Failed", counts, positions, unresolvedPositions,
        sourceUrls, sourceApiUrl: input.evidence.finalUrl, retrievedAt: input.evidence.retrievedAt };
    } catch (error) { held.push({ key, detail: error instanceof Error ? error.message : String(error) }); continue; }
    rollCalls++; memberVotes += vote.positions.length;
    if (input.onVote) await input.onVote(vote); else votes.push(vote);
  }
  return { votes, held, joins, rollCalls, memberVotes, unmatchedPositions, evidence: { ...input.evidence, members } };
}
