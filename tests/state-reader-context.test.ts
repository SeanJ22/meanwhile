import assert from "node:assert/strict";
import { AsyncResource } from "node:async_hooks";
import test from "node:test";
import { withReaderSelection } from "../lib/db/reader-route.ts";
import { stateBallotScope } from "../lib/ballot/state-scopes.ts";
import { readGenericBallotProjection, currentGenericBallotProjection } from "../lib/ballot/generic-projection.ts";
import { readVotingSitesProjection, votingSitesReadState } from "../lib/ballot/voting-sites-server.ts";
import { readCandidateProfilesProjection, readCandidateCorpusProjection, candidateProfilesReadState, candidateCorpusReadState } from "../lib/civic-data/manual-read-models.ts";
import { readDerivedCampaignSites, derivedCampaignSitesReadState } from "../lib/civic-data/derived-campaign-sites.ts";
import { absentEdgeEntry } from "./helpers/promoted-edge-entry.ts";

function unread() {
  for (const read of [candidateProfilesReadState, candidateCorpusReadState, votingSitesReadState, derivedCampaignSitesReadState]) {
    const result = read("AZ");
    assert.equal(result.kind, "STORE_UNREACHABLE");
    if (result.kind === "STORE_UNREACHABLE") assert.equal(result.code, "READ_NOT_INITIALIZED");
  }
  assert.throws(() => currentGenericBallotProjection("AZ"), /UNREAD/);
}

async function readState() {
  await readCandidateProfilesProjection("AZ", { edge: absentEdgeEntry("CANDIDATE_PROFILE", stateBallotScope("candidate-profiles", "AZ")) });
  await readCandidateCorpusProjection("AZ", { edge: absentEdgeEntry("CANDIDATE_PUBLICATION", stateBallotScope("candidate-corpus", "AZ")) });
  await readVotingSitesProjection("AZ", { edge: absentEdgeEntry("VOTING_SITE", stateBallotScope("voting-sites", "AZ")) });
  await readDerivedCampaignSites("AZ", { edge: absentEdgeEntry("CURATED_READER_RECORD", stateBallotScope("candidate-campaign-sites-derived", "AZ")) });
  await readGenericBallotProjection("AZ", { edge: absentEdgeEntry("BALLOT_CANDIDACY", stateBallotScope("ballot-contests", "AZ")) });
  for (const read of [candidateProfilesReadState, candidateCorpusReadState, votingSitesReadState, derivedCampaignSitesReadState]) {
    assert.equal(read("AZ").kind, "NOT_RECORDED");
  }
  assert.throws(() => currentGenericBallotProjection("AZ"), /NOT_RECORDED/);
}

test("independent worker async contexts do not retain another job's state reads", async () => {
  const first = new AsyncResource("state-worker"), second = new AsyncResource("state-worker");
  try {
    await first.runInAsyncScope(async () => { unread(); await readState(); });
    await second.runInAsyncScope(async () => { unread(); await readState(); });
  } finally { first.emitDestroy(); second.emitDestroy(); }
});

test("selection-scoped reads remain inside the request even without an edge bundle", async () => {
  for (let index = 0; index < 2; index++) {
    await withReaderSelection({ keys: new Set(["ocd-division/country:us/state:az"]) }, async () => {
      unread(); await readState();
    });
  }
});
