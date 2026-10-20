/**
 * Explicitly refresh every official roll selected by reviewed key-question
 * version v1 and promote its facts/positions to the civic-data plane.
 *
 * `pnpm key-votes:positions`
 *
 * The selected question list and roll identities are a reviewed version
 * input. Question text, tally, official URL verification, and member position
 * are acquired again from House/Senate records. The command has no tracked
 * output mode, no scheduler, and no release side effect.
 *
 * @freshness-reads-here — each roll is stamped only after its official body,
 * tally, and non-empty current-member position set have parsed successfully.
 */
import { failedAcquisitionCandidate } from "../lib/civic-data/candidate-builders.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import {
  FEDERAL_KEY_VOTE_SCOPE,
  FEDERAL_VOTES_PARSER_VERSION,
  FEDERAL_VOTES_SOURCE_ID,
  federalKeyVotesCandidate,
  type FederalKeyVotePositions,
  type FederalKeyVotesSnapshot,
  heldAcquisitions,
  type HeldAcquisition,
} from "../lib/votes/data-plane.ts";
import { federalKeyVoteSelectionV1Snapshot } from "../lib/votes/key-vote-selection-v1.ts";
import { loadVoteIdentityBridge, withVoteWorkingSet } from "../lib/votes/working-set.ts";
import type { VotePosition } from "../lib/votes/types.ts";

if (!process.argv.includes("--promote")) throw new Error("PASS_--promote: this command has no tracked-output mode");
prepareProductionCivicDataWrite();

const UA = "we-the-people-civic-app/0.1 (contact: seanj22@gmail.com)";
const SPACING_MS = 350;
await withVoteWorkingSet(async working => {
const store = new PostgresRoutineDataStore();

// The question/roll denominator is reviewed software input. Canonical runtime
// data supplies LKG, never the authority to add or replace a selected roll.
const snapshot = federalKeyVoteSelectionV1Snapshot(new Date().toISOString());
const acquisitions: HeldAcquisition[] = [];
const failures: string[] = [];

async function blocked(detail: string): Promise<never> {
  const attemptedAt = new Date().toISOString();
  const failed = failedAcquisitionCandidate({
    sourceId: FEDERAL_VOTES_SOURCE_ID,
    recordClass: "FEDERAL_KEY_VOTE",
    scope: FEDERAL_KEY_VOTE_SCOPE,
    requestedUrl: "https://www.senate.gov/legislative/",
    attemptedAt,
    failureDetail: detail,
    parserVersion: FEDERAL_VOTES_PARSER_VERSION,
  });
  const outcome = await processRegisteredManualCandidate(store, "federal-key-votes", failed, attemptedAt);
  printSourceRunnerReceipt("federal-key-votes", failed, outcome);
  throw new Error(detail);
}

async function getOfficial(url: string): Promise<string | null> {
  await new Promise((resolve) => setTimeout(resolve, SPACING_MS));
  try {
    const response = await fetch(url, { headers: { "user-agent": UA } });
    if (!response.ok) {
      failures.push(`${url} -> HTTP ${response.status}`);
      return null;
    }
    const body = await response.text();
    acquisitions.push(...heldAcquisitions([{ requestedUrl: url, finalUrl: response.url || url, httpStatus: response.status, body }]));
    return body;
  } catch (error) {
    failures.push(`${url} -> ${error instanceof Error ? error.message : "fetch failed"}`);
    return null;
  }
}

function textOf(xml: string, ...names: string[]): string | null {
  for (const name of names) {
    const match = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(xml);
    if (match) return match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  return null;
}

function tallyOf(xml: string, chamber: "house" | "senate"): string | null {
  if (chamber === "house") {
    const pairs = [...xml.matchAll(/<yea-total>(\d+)<\/yea-total>\s*<nay-total>(\d+)<\/nay-total>/gi)];
    const total = pairs.at(-1);
    return total ? `${total[1]}-${total[2]}` : null;
  }
  const yeas = textOf(xml, "yeas");
  const nays = textOf(xml, "nays");
  return yeas && nays && /^\d+$/.test(yeas) && /^\d+$/.test(nays) ? `${yeas}-${nays}` : null;
}

function mapPosition(raw: string): VotePosition | null {
  const value = raw.trim().toLowerCase();
  if (["yea", "aye", "yes", "guilty"].includes(value)) return "YES";
  if (["nay", "no", "not guilty"].includes(value)) return "NO";
  if (value === "present") return "PRESENT";
  if (value === "not voting" || value === "absent") return "NOT_VOTING";
  return null;
}

try { await loadVoteIdentityBridge(working); } catch(error) { await blocked(`Current federal identity bridge failed: ${String(error)}`); }
const heldRefs = new Set<string>();

let refsSeen = 0;
let houseSeen = 0;
let houseCurrent = 0;
let senateSeen = 0;
let senateCurrent = 0;

for (const entry of snapshot.entries) {
  for (const chamber of ["house", "senate"] as const) {
    for (const ref of entry[chamber]) {
      refsSeen += 1;
      if (!ref.url) {
        failures.push(`${entry.id}/${chamber}/${ref.rollNumber}: reviewed selection has no official URL`);
        continue;
      }
      const machineUrl = ref.url.endsWith(".htm") ? `${ref.url.slice(0, -4)}.xml` : ref.url;
      const xml = await getOfficial(machineUrl);
      if (!xml) continue;
      const question = chamber === "house"
        ? textOf(xml, "vote-question", "vote-desc")
        : textOf(xml, "vote_question_text", "vote_title", "question");
      const tally = tallyOf(xml, chamber);
      if (!question || !tally) {
        failures.push(`${entry.id}/${chamber}/${ref.rollNumber}: official question or tally did not parse`);
        continue;
      }
      const positions: Record<string, VotePosition> = {};
      if (chamber === "house") {
        for (const match of xml.matchAll(/<recorded-vote>\s*<legislator name-id="([^"]+)"[^>]*>[\s\S]*?<\/legislator>\s*<vote>([^<]+)<\/vote>\s*<\/recorded-vote>/g)) {
          houseSeen += 1;
          if (!working.hasBioguide(match[1])) continue;
          houseCurrent += 1;
          const position = mapPosition(match[2]);
          if (position) positions[`congress:${match[1]}`] = position;
        }
      } else {
        for (const match of xml.matchAll(/<member>[\s\S]*?<vote_cast>([^<]+)<\/vote_cast>[\s\S]*?<lis_member_id>([^<]+)<\/lis_member_id>[\s\S]*?<\/member>/g)) {
          senateSeen += 1;
          const bioguide = working.bioguideForLis(match[2]);
          if (!bioguide) continue;
          senateCurrent += 1;
          const position = mapPosition(match[1]);
          if (position) positions[`congress:${bioguide}`] = position;
        }
      }
      const key = `${entry.id}|${chamber}|${ref.congress}-${ref.session}:${ref.rollNumber}`;
      if (Object.keys(positions).length === 0) {
        failures.push(`${entry.id}/${chamber}/${ref.rollNumber}: parsed zero current-member positions`);
        continue;
      }
      ref.question = question;
      ref.tally = tally;
      ref.verifiedAt = new Date().toISOString().slice(0, 10);
      for(const [member,position] of Object.entries(positions)) working.position(member,key,position);
      heldRefs.add(key);
    }
  }
}

const retrievedAt = new Date().toISOString();
const positions: FederalKeyVotePositions = {
  formatVersion: 1,
  fetchedAt: retrievedAt,
  note: "Official per-roll positions for sitting members, keyed by reviewed question/chamber/roll identity. Missing members remain unknown, never DID_NOT_VOTE.",
  positions: Object.fromEntries([...heldRefs].map(key=>[key,{}])),
};
const refreshedSnapshot: FederalKeyVotesSnapshot = { ...snapshot, fetchedAt: retrievedAt };
// Reconcile every source roll before advancing any member; a failed source keeps every prior GOOD pointer.
const candidate = federalKeyVotesCandidate({ acquisitions, retrievedAt, snapshot: refreshedSnapshot, positions });
if(candidate.semantics.violations.length===0) {
  for(const member of working.members()) {
    const memberPositions: FederalKeyVotePositions={...positions,positions:Object.fromEntries([...heldRefs].map(key=>[key,{}]))};
    for(const row of working.positionsForMember(member)) memberPositions.positions[row.voteId][member]=row.position;
    const memberCandidate=federalKeyVotesCandidate({acquisitions,retrievedAt,snapshot:refreshedSnapshot,positions:memberPositions,officeholderId:member});
    const result=await processRegisteredManualCandidate(store,"federal-key-votes",memberCandidate,retrievedAt);
    if(!result.promoted&&!result.confirmed) throw new Error(`FEDERAL_KEY_VOTE_MEMBER_REFUSED:${member}:${result.candidate.failureCode ?? result.candidate.state}`);
  }
}
const outcome = await processRegisteredManualCandidate(store, "federal-key-votes", candidate, retrievedAt);
printSourceRunnerReceipt("federal-key-votes", candidate, outcome);

console.log([
  `refs: ${heldRefs.size} acquired of ${refsSeen} selected`,
  `house: ${houseCurrent} current of ${houseSeen} recorded positions`,
  `senate: ${senateCurrent} current of ${senateSeen} recorded positions`,
  `candidate: ${candidate.id} ${outcome.candidate.state}`,
].join("\n"));
for (const failure of failures) console.log(`  HELD ${failure}`);
if (outcome.candidate.state !== "PROMOTED") {
  throw new Error(`FEDERAL_KEY_VOTE_PROMOTION_REFUSED:${outcome.candidate.failureCode ?? outcome.candidate.state}`);
}

});
