import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { CardGapContribution } from "../components/ui/card-gap-context.tsx";
import { GENERIC_BALLOT_SCOPE } from "../lib/ballot/generic-projection.ts";

import { getCandidateTargetIds } from "../lib/ballot/candidate-targets.ts";
import {
  BALLOT_SOURCES,
  ballotSourceForTargetId,
  ballotSourcesForDivisions,
} from "../lib/ballot/registry.ts";
import { getSingleCandidateTargetIds } from "../lib/ballot/uncontested.ts";
import { loadBallotForDivisions } from "../lib/ask/server-sources.ts";
import { displayFor } from "../lib/questionnaire/candidacy-display.ts";
import { validReactionTargetsFor } from "../app/api/reactions/targets.ts";
import {
  ballotAuxiliaryPreloadSucceeded,
  settleBallotAuxiliaryPreloads,
  type BallotAuxiliaryFamily,
} from "../lib/ballot/auxiliary-preloads.ts";
import { readNhBallotProjection } from "../lib/civic-data/manual-read-models.ts";
import type { NhBallotProjection } from "../lib/civic-data/manual-projections.ts";
import { installAbsent, installAzBallot, installManualValue, syntheticAzBallot } from "./helpers/promoted-fixtures.ts";

// The AZ and NH ballots' promoted pointers, each a small synthetic ballot
// holding one statewide governor contest with one candidacy.
// Make the separate generic source explicitly absent: a configured workspace
// database must not add an unrelated store failure to this isolation test.
installAbsent("BALLOT_CANDIDACY", GENERIC_BALLOT_SCOPE);
const azBallot = syntheticAzBallot([{
  id: "ballot-az-pima:governor",
  title: "Governor",
  candidacies: [{ id: "ballot-az-pima:governor:candidate-a", givenName: "Alex", familyName: "Candidate" }],
}]);
await installAzBallot({ ...azBallot, ballot: { ...azBallot.ballot, formatVersion: 1 } });
const NH_PROVENANCE = { sourceUrl: "https://example.test/nh-ballot", sourceOrg: "Synthetic test ballot", collectedAt: "2026-09-25", verifiedAt: null };
installManualValue<NhBallotProjection>("nh-curated-ballot", {
  ballot: {
    formatVersion: 1,
    election: { id: "nh-2026-general-test", date: "2026-11-03", name: "2026 General Election (test)", state: "NH" },
    contests: [{
      id: "ballot-nh-merrimack:governor", electionId: "nh-2026-general-test", ocdId: "ocd-division/country:us/state:nh",
      divisionVintage: "2026", title: "Governor", type: "CANDIDACY", voteFor: 1, termYears: 2, scopeNote: null, provenance: NH_PROVENANCE,
    }],
    candidacies: [{
      id: "ballot-nh-merrimack:governor:candidate-b", contestId: "ballot-nh-merrimack:governor", familyName: "Candidate", givenName: "Blair",
      partyLabel: null, slogan: null, incumbent: null, websiteUrl: null, provenance: NH_PROVENANCE,
    }],
    measures: [],
    absences: [],
  },
});
await readNhBallotProjection();

const DIVISIONS = {
  az: ["ocd-division/country:us/state:az"],
  nh: ["ocd-division/country:us/state:nh"],
  nj: ["ocd-division/country:us/state:nj"],
} as const;

const TARGETS = {
  az: "ballot-az-pima:governor:candidate-a",
  nh: "ballot-nh-merrimack:governor:candidate-b",
  nj: "ballot-nj-morris:us-senate:booker",
} as const;

test("ballot authority selection happens from exact state or target identity before a read", () => {
  for (const state of ["az", "nh", "nj"] as const) {
    assert.deepEqual(
      ballotSourcesForDivisions(DIVISIONS[state]).map((entry) => entry.state),
      [state],
    );
    assert.equal(ballotSourceForTargetId(TARGETS[state])?.state, state);
  }
  assert.deepEqual(ballotSourcesForDivisions(["ocd-division/country:us"]), []);
  assert.equal(ballotSourceForTargetId("invented:target"), null);
});

test("a planted NJ authority failure cannot take down AZ or NH Readers and stays explicit for NJ", async () => {
  const nj = BALLOT_SOURCES.find(({ state }) => state === "nj")!;
  const original = nj.source.fetch;
  let njReads = 0;
  try {
    nj.source.fetch = async () => {
      njReads += 1;
      throw new Error("PLANTED_NJ_CANONICAL_AUTHORITY_UNAVAILABLE");
    };

    const az = await loadBallotForDivisions(DIVISIONS.az);
    const nh = await loadBallotForDivisions(DIVISIONS.nh);
    assert.equal(az.set?.election.state, "AZ");
    assert.equal(nh.set?.election.state, "NH");
    assert.deepEqual(az.loaderFailures, []);
    assert.deepEqual(nh.loaderFailures, []);
    assert.equal(njReads, 0, "an AZ/NH Reader opened the unrelated NJ authority");

    assert.ok((await getCandidateTargetIds(TARGETS.az)).has(TARGETS.az));
    assert.ok((await getCandidateTargetIds(TARGETS.nh)).has(TARGETS.nh));
    assert.ok(await displayFor(TARGETS.az));
    assert.equal(njReads, 0, "exact AZ/NH target validation opened NJ");

    const requested = await loadBallotForDivisions(DIVISIONS.nj);
    assert.equal(requested.set, null);
    assert.deepEqual(requested.loaderFailures, ["nj"]);
    await assert.rejects(
      () => getCandidateTargetIds(TARGETS.nj),
      /PLANTED_NJ_CANONICAL_AUTHORITY_UNAVAILABLE/,
    );
    await assert.rejects(
      () => getSingleCandidateTargetIds(TARGETS.nj),
      /PLANTED_NJ_CANONICAL_AUTHORITY_UNAVAILABLE/,
    );
    await assert.rejects(
      () => displayFor(TARGETS.nj),
      /PLANTED_NJ_CANONICAL_AUTHORITY_UNAVAILABLE/,
    );
  } finally {
    nj.source.fetch = original;
  }
});

test("reaction intake opens only the authority named by its submitted target family", async () => {
  const calls: string[] = [];
  const readers = {
    candidateTargets: async (targetId: string) => {
      calls.push(`candidate:${targetId}`);
      return new Set([targetId]);
    },
    provisionTargets: () => {
      calls.push("measure");
      return new Set(["measure:one"]);
    },
    refreshFunding: async () => {
      calls.push("funding");
      throw new Error("PLANTED_FEC_AUTHORITY_UNAVAILABLE");
    },
    fundingTargets: () => new Set(["funding:one"]),
    refreshStateMoney: async () => { calls.push("stateMoney"); },
    stateMoneyTargets: () => new Set<string>(),
    contributorTargets: () => new Set(["contributor:one"]),
    refreshVotes: async () => {
      calls.push("votes");
      throw new Error("PLANTED_VOTE_AUTHORITY_UNAVAILABLE");
    },
    voteTargets: () => new Set(["vote:one"]),
  };

  assert.ok((await validReactionTargetsFor("CANDIDATE", TARGETS.az, readers)).has(TARGETS.az));
  assert.deepEqual(calls, [`candidate:${TARGETS.az}`], "candidate intake opened an unrelated authority");

  calls.length = 0;
  assert.ok((await validReactionTargetsFor("MEASURE_PROVISION", "measure:one", readers)).has("measure:one"));
  assert.deepEqual(calls, ["measure"], "measure intake opened an unrelated authority");

  calls.length = 0;
  await assert.rejects(
    () => validReactionTargetsFor("FUNDING_TOTAL_REACTION", "funding:one", readers),
    /PLANTED_FEC_AUTHORITY_UNAVAILABLE/,
  );
  assert.deepEqual(calls, ["funding"]);

  calls.length = 0;
  await assert.rejects(
    () => validReactionTargetsFor("FEDERAL_VOTE", "vote:one", readers),
    /PLANTED_VOTE_AUTHORITY_UNAVAILABLE/,
  );
  assert.deepEqual(calls, ["votes"]);
});

test("a supporting ballot authority failure cannot suppress the ballot or another supporting family", async () => {
  const calls: string[] = [];
  const preloads = new Map<BallotAuxiliaryFamily, () => Promise<unknown>>([
    ["candidate-profiles", async () => {
      calls.push("candidate-profiles");
      throw new Error("PLANTED_PROFILE_AUTHORITY_UNAVAILABLE");
    }],
    ["state-money", async () => {
      calls.push("state-money");
      return { kind: "PROMOTED", metadata: { versionId: "state-money-good" } };
    }],
    ["registry-runtime", async () => {
      calls.push("registry-runtime");
      return { kind: "STORE_UNREACHABLE", metadata: { versionId: null } };
    }],
    ["nh-members", async () => {
      calls.push("nh-members");
      return { kind: "NOT_RECORDED", metadata: { versionId: null } };
    }],
  ]);

  const outcomes = await settleBallotAuxiliaryPreloads(preloads);
  assert.deepEqual(calls.sort(), ["candidate-profiles", "nh-members", "registry-runtime", "state-money"]);
  assert.equal(ballotAuxiliaryPreloadSucceeded(outcomes.get("candidate-profiles")), false);
  assert.equal(ballotAuxiliaryPreloadSucceeded(outcomes.get("registry-runtime")), false);
  assert.equal(ballotAuxiliaryPreloadSucceeded(outcomes.get("nh-members")), false);
  assert.equal(ballotAuxiliaryPreloadSucceeded(outcomes.get("state-money")), true);
  assert.equal(outcomes.get("state-money")?.status, "fulfilled");
});

test("all production ballot entry points use state-scoped selection", () => {
  for (const path of [
    "app/ballot/page.tsx",
    "lib/geo/address-resolve.ts",
    "app/api/ballot/scope/route.ts",
    "lib/ask/server-sources.ts",
  ]) {
    const source = readFileSync(join(process.cwd(), path), "utf8");
    assert.match(source, /readerBallotSourcesForDivisions\(/, `${path} did not scope its ballot authority`);
    assert.doesNotMatch(source, /for\s*\([^)]*\bBALLOT_SOURCES\b/, `${path} reopened every state authority`);
  }

  const page = readFileSync(join(process.cwd(), "app/ballot/page.tsx"), "utf8");
  assert.ok(
    page.indexOf("readerBallotSourcesForDivisions(ocdIds)") < page.indexOf("settleBallotAuxiliaryPreloads(auxiliaryPreloads)"),
    "supporting authorities were opened before the requested ballot authority was selected",
  );
  assert.match(page, /data-ballot-canonical-holding-gaps/);
  assert.match(page, /<CardGapContribution id=\{`ballot-holding:\$\{family\}`\} label=\{HOLDING_LABEL\[family\]\}/,
    "supporting authority failures contribute to the card footer");
  assert.match(page, /matched\.contests\.some\(nhLegislativeRosterAppliesTo\)/);
  assert.match(page, /auxiliaryPreloads\.set\("nh-members", settleNhSeatHolders\)/);

  const reactions = ["route.ts", "targets.ts"].map((file) => readFileSync(join(process.cwd(), "app/api/reactions", file), "utf8")).join("\n");
  assert.match(reactions, /candidateTargets:\s*getCandidateTargetIds/);
  assert.match(reactions, /validReactionTargetsFor\(\s*submission\.targetType,\s*submission\.targetId/);
  assert.doesNotMatch(reactions, /Promise\.all\(\[refreshFundingFromPromoted\(\),\s*refreshFederalVotesFromPromoted\(\)\]\)/);

  const demand = readFileSync(join(process.cwd(), "app/api/demand-signal/route.ts"), "utf8");
  assert.match(demand, /getCandidateTargetIds\(submission\.subjectId\)/);
});


test("supporting authority failures contribute reader labels without field placeholders", () => {
  const page = ts.createSourceFile("ballot.tsx", readFileSync("app/ballot/page.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const all: ts.Node[] = [];
  const visit = (node: ts.Node) => { all.push(node); ts.forEachChild(node, visit); };
  visit(page);
  const labels = all.find(node => ts.isVariableDeclaration(node) && node.name.getText(page) === "HOLDING_LABEL");
  const unavailable = all.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "unavailableHolding");
  assert.ok(labels && unavailable);
  const executable = ts.transpileModule(`const ${labels.getText(page)}; ${unavailable.getText(page)}; return unavailableHolding;`, {
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const render = new Function("React", "CardGapContribution", executable)(React, CardGapContribution);
  for (const [family, label] of [
    ["candidate-publication", "public positions"],
    ["officeholder-directory", "officeholder information"],
    ["candidate-profile", "candidate background"],
    ["federal campaign-finance", "campaign money"],
    ["state campaign-finance", "campaign money"],
  ]) {
    const gap = render(family);
    assert.equal(gap.type, CardGapContribution);
    assert.equal(gap.props.id, `ballot-holding:${family}`);
    assert.equal(gap.props.label, label);
    assert.equal(renderToStaticMarkup(gap), "", "only the card footer displays the missing information");
  }
});
