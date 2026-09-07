import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createElement, isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BALLOT_SOURCES } from "../../lib/ballot/registry.ts";
import { lineupForContest } from "../../lib/ballot/general-lineup.ts";
import { surnameDisplayCase } from "../../lib/ballot/name-case.ts";
import { governingRecordHolderFor } from "../../lib/ballot/governing-record.ts";
import { incumbentHolderFor } from "../../lib/ballot/incumbent-record.ts";
import { committedIncumbentHolderFor, contestIncumbency, type ContestForIncumbency } from "../../lib/ballot/incumbency-resolve.ts";
import { getStateVotesSnapshot } from "../../lib/sources/legiscan/snapshot.ts";
import { getVotesSnapshot } from "../../lib/votes/snapshot.ts";
import { LEGISCAN_ATTRIBUTION } from "../../lib/sources/legiscan/types.ts";
import { reconciledCandidacyIdForCard } from "../../lib/identity/az-2026.ts";
import type { SeatHolder } from "../../lib/officials/lookup.ts";
import type { MemberRollCall, VoteAttribution } from "../../components/map/popup/official-popup.tsx";

export const ARIZONA_RECORD_CONTROLS = [
  { name: "Alma Hernandez", zip: "85719", candidacyId: "ballot-az-pima:state-senate-20:hernandez-alma", cardKey: "ballot-az-pima:state-senate-20|Alma Hernandez", officialId: "plural:6dba6afa-b274-4273-b8c6-270d27214eee", switches: true },
  { name: "Sally Ann Gonzales", zip: "85719", candidacyId: "ballot-az-pima:state-house-20:gonzales-sally-ann", cardKey: "ballot-az-pima:state-house-20|Sally Ann Gonzales", officialId: "plural:3c965e03-1e51-4f10-a037-4fb2f35292c5", switches: true },
  { name: "Gail Griffin", zip: "85641", candidacyId: "ballot-az-pima:state-senate-19:griffin-gail", cardKey: "ballot-az-pima:state-senate-19|Gail Griffin", officialId: "plural:1e39adcf-868d-4722-a07b-09fcd36ad9ed", switches: true },
  { name: "David Gowan", zip: "85641", candidacyId: "ballot-az-pima:state-house-19:gowan-david", cardKey: "ballot-az-pima:state-house-19|David Gowan", officialId: "plural:51520de4-0e87-475b-91d2-99aa18addf72", switches: true },
  { name: "Lupe Diaz", zip: "85641", candidacyId: "ballot-az-pima:state-house-19:diaz-lupe", cardKey: "ballot-az-pima:state-house-19|Lupe Diaz", officialId: "plural:bc52f516-a13b-4490-a12c-7b98fa3969e5", switches: false },
] as const;

type PageCardProps = {
  targetKey: string; contestTitle: string; contestOcdId: string;
  contestId: string; contestVoteFor: number; federal: boolean;
  contestCandidates: ContestForIncumbency["candidates"];
};
type CandidateProps = {
  subjectId: string; incumbency: string; holdsOrHeldTheOffice: boolean;
  sections: { record: ReactElement<{ holder: SeatHolder; contentOnly: boolean }> | null };
};
type PageCard = ReactElement<PageCardProps> & {
  type: (props: PageCardProps) => Promise<ReactElement<CandidateProps>>;
};
type VotePayload = { member: string; holdingStatus: string; count: number; generatedAt: string; attribution: VoteAttribution; votes: MemberRollCall[] };

/** Walk server-created element props without invoking client hooks or replacing
 * product components. BallotPage itself supplies these BallotBattlecard nodes. */
function ballotCards(tree: unknown): PageCard[] {
  const cards: PageCard[] = [];
  const seen = new WeakSet<object>();
  function visit(value: unknown) {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (isValidElement(value)) {
      if (typeof value.type === "function" && value.type.name === "BallotBattlecard") cards.push(value as PageCard);
      visit(value.props);
    } else for (const child of Object.values(value)) visit(child);
  }
  visit(tree);
  return cards;
}

const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const html = (value: string) => renderToStaticMarkup(createElement("span", null, value)).slice(6, -7);
const contestOf = (props: PageCardProps): ContestForIncumbency => ({ id: props.contestId, title: props.contestTitle, ocdId: props.contestOcdId, voteFor: props.contestVoteFor, federal: props.federal, candidates: props.contestCandidates });

/** Census both filed and certified keys; losing a record-bearing old projection
 * must be visible even when it is outside the five positive controls. */
export async function governingRecordProjectionCensus() {
  const state = getStateVotesSnapshot(), federal = getVotesSnapshot();
  const heldCount = (id: string) => state.positions.filter(row => row.officeholderId === id).length + federal.positions.filter(row => row.officeholderId === id).length;
  const rows = [];
  for (const { source } of BALLOT_SOURCES) {
    const ballot = source.normalize(await source.fetch());
    for (const contest of ballot.contests.filter(row => row.type === "CANDIDACY")) {
      const filed = ballot.candidacies.filter(row => row.contestId === contest.id).map(row => ({ key: row.id, targetKey: row.id, display: `${row.givenName} ${surnameDisplayCase(row.familyName)}` }));
      const nominees = lineupForContest(contest.id)?.nominees.map(row => ({ key: `${contest.id}|${row.name}`, targetKey: `${contest.id}|${row.name}`, display: row.name }));
      for (const [kind, candidates] of [["FILED", filed], ["CERTIFIED", nominees]] as const) {
        if (!candidates?.length) continue;
        const input = { ...contest, candidates, federal: /\b(?:United States|U\.?S\.?)\s+(?:Senat|House|Represent)/i.test(contest.title) };
        const incumbency = await contestIncumbency(input, incumbentHolderFor);
        for (const candidate of candidates) {
          const before = await incumbentHolderFor(candidate.targetKey) ?? incumbency.holderFor.get(candidate.key) ?? null;
          const after = await governingRecordHolderFor(candidate.targetKey);
          rows.push({ key: candidate.targetKey, kind, beforeId: before?.id ?? null, afterId: after?.id ?? null, beforeHeld: before ? heldCount(before.id) : 0, afterHeld: after ? heldCount(after.id) : 0 });
        }
      }
    }
  }
  return { checked: rows.length, beforeResolved: rows.filter(row => row.beforeId).length, afterResolved: rows.filter(row => row.afterId).length,
    lostRecordDeliveries: rows.filter(row => row.beforeHeld > 0 && row.beforeId !== row.afterId),
    lostHolderLinks: rows.filter(row => row.beforeId && !row.afterId),
    gainedRecordDeliveries: rows.filter(row => row.beforeHeld === 0 && row.afterHeld > 0) };
}

/** Real Reader page → actual CandidateBattlecard record slot → actual votes
 * route → actual shared RecentVoteRecords renderer. No acquisition or writes. */
export async function governingRecordReaderProof() {
  for (const key of ["DATABASE_URL", "DATABASE_URL_UNPOOLED", "NEON_DATABASE_URL", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete process.env[key];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Governing-record proof forbids network requests"); };
  try {
    const { default: BallotPage } = await import("../../app/ballot/page.tsx");
    const { RecentVotes, RecentVoteRecords } = await import("../../components/map/popup/official-popup.tsx");
    const { GET } = await import("../../app/api/votes/route.ts");
    const snapshot = getStateVotesSnapshot();
    const sourceBytes = readFileSync("data/votes/state-votes-snapshot.json");
    const pages = new Map<string, PageCard[]>();
    for (const zip of new Set(ARIZONA_RECORD_CONTROLS.map(row => row.zip))) pages.set(zip, ballotCards(await BallotPage({ searchParams: Promise.resolve({ zip }) })));
    const controls = [];
    for (const control of ARIZONA_RECORD_CONTROLS) {
      const pageCard = pages.get(control.zip)!.find(row => row.props.targetKey === control.cardKey);
      assert.ok(pageCard, `${control.cardKey}: actual ballot page must project the candidate`);
      const candidate = await pageCard.type(pageCard.props);
      assert.equal(candidate.props.subjectId, control.cardKey);
      const slot = candidate.props.sections.record;
      assert.ok(slot, `${control.cardKey}: held votes must reach the actual candidate card`);
      function recentElement(value: unknown): ReactElement<{ holder: SeatHolder; contentOnly: boolean }> | null {
        if (!value || typeof value !== "object") return null;
        if (isValidElement(value)) {
          if (value.type === RecentVotes) return value as ReactElement<{ holder: SeatHolder; contentOnly: boolean }>;
          return recentElement(value.props);
        }
        for (const child of Object.values(value)) { const found = recentElement(child); if (found) return found; }
        return null;
      }
      const record = recentElement(slot);
      assert.ok(record, `${control.cardKey}: record slot must contain the real RecentVotes`);
      assert.equal(record.type, RecentVotes);
      assert.equal(record.props.contentOnly, true);
      const holder = record.props.holder;
      const slotMarkup = renderToStaticMarkup(slot);
      assert.ok(slotMarkup.includes(`data-governing-record-office="${html(holder.officeTitle)}"`));
      assert.ok(slotMarkup.includes(`Record from service as ${html(holder.officeTitle)}.`));
      if (control.officialId) assert.equal(holder.id, control.officialId);
      assert.equal(reconciledCandidacyIdForCard(control.cardKey), control.candidacyId);
      assert.equal((await governingRecordHolderFor(control.candidacyId))?.id, holder.id);
      const contest = contestOf(pageCard.props);
      const oldStanding = await contestIncumbency(contest, incumbentHolderFor);
      const before = await incumbentHolderFor(control.cardKey) ?? oldStanding.holderFor.get(control.cardKey) ?? null;
      const exact = await committedIncumbentHolderFor(contest, control.cardKey);
      if (control.switches) {
        assert.equal(before, null);
        assert.equal(exact, null);
        assert.notEqual(candidate.props.incumbency, "INCUMBENT");
      } else {
        assert.equal(exact?.id, holder.id);
        assert.equal(candidate.props.incumbency, "INCUMBENT");
        assert.equal(before?.id, holder.id);
      }
      assert.equal(candidate.props.incumbency, oldStanding.decisions.get(control.cardKey)?.standing);
      const positions = snapshot.positions.filter(row => row.officeholderId === holder.id);
      const positionById = new Map(positions.map(row => [row.rollCallId, row]));
      const held = snapshot.rollCalls.filter(row => positionById.has(row.id)).sort((a, b) => b.date.localeCompare(a.date));
      assert.ok(held.length > 0);
      const response = await GET(new Request(`http://localhost/api/votes?member=${encodeURIComponent(holder.id)}`));
      assert.equal(response.status, 200);
      const payload = await response.json() as VotePayload;
      assert.equal(payload.member, holder.id);
      assert.equal(payload.holdingStatus, "HELD");
      assert.equal(payload.count, held.length);
      assert.equal(payload.votes.length, held.length);
      assert.equal(payload.generatedAt, snapshot.generatedAt);
      assert.deepEqual(payload.attribution, LEGISCAN_ATTRIBUTION);
      for (const [index, vote] of payload.votes.entries()) {
        const source = held[index];
        assert.deepEqual([vote.id, vote.title, vote.question, vote.result, vote.legisNum, vote.date, vote.position, vote.billUrl, vote.rollCallUrl],
          [source.id, source.billTitle, source.motion, source.result, source.billNumber || null, source.date, positionById.get(source.id)!.position, source.billUrl, source.rollCallUrl]);
        assert.deepEqual(vote.jurisdiction, { level: "state", state: source.state });
      }
      const markup = renderToStaticMarkup(createElement(RecentVoteRecords, { votes: payload.votes, attribution: payload.attribution, failed: false, reactionContext: null }));
      assert.equal((markup.match(/data-recent-vote-id=/g) ?? []).length, held.length);
      for (const vote of payload.votes) {
        assert.ok(markup.includes(`data-recent-vote-id="${html(vote.id)}"`));
        assert.ok(markup.includes(html(vote.title)));
        assert.ok(markup.includes(`href="${html(vote.rollCallUrl)}"`));
      }
      assert.ok(markup.includes(LEGISCAN_ATTRIBUTION.licenceUrl));
      assert.ok(markup.includes(LEGISCAN_ATTRIBUTION.url));
      controls.push({ name: holder.name, zip: control.zip, candidacyId: control.candidacyId, cardKey: control.cardKey, officialId: holder.id,
        recordOffice: holder.officeTitle, recordChamber: holder.officeTitle === "State Senator" ? "Senate" : "House", contestedOffice: contest.title, contestedDivision: contest.ocdId,
        switches: control.switches, standing: candidate.props.incumbency, exactSeatHolderId: exact?.id ?? null,
        heldRows: held.length, beforeEligibleRows: before ? held.length : 0, afterEligibleRows: payload.count, initiallyVisibleRows: Math.min(20, held.length), renderedExpandedRows: held.length,
        sourceThrough: held[0].date, generatedAt: payload.generatedAt, holderProvenance: holder.provenance,
        renderedRecordOffice: holder.officeTitle,
        attribution: payload.attribution, sourceRollCallIdsSha256: hash(JSON.stringify(held.map(row => row.id))), renderedMarkupSha256: hash(markup),
        provenanceUnchanged: true, sourceRowsUnchanged: true });
    }
    const sourceCard = pages.get("85719")!.find(row => row.props.targetKey === ARIZONA_RECORD_CONTROLS[0].cardKey)!;
    const gaps = [];
    for (const subjectId of ["unresolved:Alma Hernandez", "unresolved:Alma Hernández", "ballot-az-pima:state-senate-20:hernandez-alma-unlinked"]) {
      // Keep the real card's displayed name and contested office while
      // replacing only the identity with an unlinked key. A runtime name
      // fallback would now incorrectly attach Alma's held House votes.
      const unlinked = await sourceCard.type({ ...sourceCard.props, targetKey: subjectId,
        contestCandidates: [{ key: subjectId, targetKey: subjectId, display: "Alma Hernández" }] });
      assert.equal(unlinked.props.subjectId, subjectId);
      assert.equal(unlinked.props.sections.record, null);
      assert.equal(unlinked.props.holdsOrHeldTheOffice, false);
      assert.notEqual(unlinked.props.incumbency, "INCUMBENT");
      gaps.push({ subjectId, recordSlot: null, standing: unlinked.props.incumbency, honestGapPreserved: true });
    }
    assert.equal(hash(readFileSync("data/votes/state-votes-snapshot.json")), hash(sourceBytes));
    const census = await governingRecordProjectionCensus();
    return { executionLevel: "ACTUAL_BALLOT_PAGE_AND_CANDIDATE_SLOT_TO_REAL_API_AND_RENDERER", networkDisabled: true,
      snapshotSha256: hash(sourceBytes), controls, gaps, census };
  } finally { globalThis.fetch = originalFetch; }
}
