import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { CardGapContribution } from "../components/ui/card-gap-context.tsx";
import { currentGenericBallotProjection, GENERIC_BALLOT_SCOPE } from "../lib/ballot/generic-projection.ts";

import { getCandidateTargetIds } from "../lib/ballot/candidate-targets.ts";
import { readerBallotSourceForTargetId, readerBallotSourcesForDivisions } from "../lib/ballot/reader-sources.ts";
import { getSingleCandidateTargetIds } from "../lib/ballot/uncontested.ts";
import { loadBallotForDivisions } from "../lib/ask/server-sources.ts";
import { displayFor } from "../lib/questionnaire/candidacy-display.ts";
import { validReactionTargetsFor } from "../app/api/reactions/route.ts";
import {
  ballotAuxiliaryPreloadSucceeded,
  settleBallotAuxiliaryPreloads,
  type BallotAuxiliaryFamily,
} from "../lib/ballot/auxiliary-preloads.ts";
import { installBallots, installRegistryAuthority, promotedFixtureBundle, syntheticAzBallot } from "./helpers/promoted-fixtures.ts";
import { manualEdgeEntry } from "./helpers/promoted-edge-entry.ts";
import { withReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";
import { nhBallot } from "./helpers/reader-fixtures.ts";
import { POST as ballotScope } from "../app/api/ballot/scope/route.ts";
import { resolveZip } from "../lib/geo/zcta.ts";

await installBallots(syntheticAzBallot([{
  id: "ballot-az-pima:governor", title: "Governor",
  candidacies: [{ id: "ballot-az-pima:governor:candidate-a", givenName: "Alex", familyName: "Candidate" }],
}]), nhBallot([{
  id: "ballot-nh-merrimack:governor", title: "Governor", ocdId: "ocd-division/country:us/state:nh",
  candidacies: [{ id: "ballot-nh-merrimack:governor:candidate-b", givenName: "Blair", familyName: "Candidate" }],
}]));

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

test("national ballot selection returns only the requested state or exact held target", async () => {
  for (const state of ["az", "nh"] as const) {
    assert.deepEqual((await readerBallotSourcesForDivisions(DIVISIONS[state])).map(entry => entry.state), [state]);
    assert.equal((await readerBallotSourceForTargetId(TARGETS[state]))?.state, state);
    const held = await loadBallotForDivisions(DIVISIONS[state]);
    assert.equal(held.set?.election.state, state.toUpperCase());
    assert.deepEqual(held.loaderFailures, []);
    assert.ok((await getCandidateTargetIds(TARGETS[state])).has(TARGETS[state]));
    assert.ok((await getSingleCandidateTargetIds(TARGETS[state])).has(TARGETS[state]));
    assert.ok(await displayFor(TARGETS[state]));
  }
  assert.deepEqual(await readerBallotSourcesForDivisions(DIVISIONS.nj), []);
  assert.deepEqual(await readerBallotSourcesForDivisions(["ocd-division/country:us"]), []);
  assert.equal(await readerBallotSourceForTargetId("invented:target"), null);
});

test("a failed national ballot is an explicit gap for each state and exact target", async () => {
  await readerBallotSourcesForDivisions(DIVISIONS.az);
  assert.ok(Object.keys(currentGenericBallotProjection().ballots).length);
  const failed = manualEdgeEntry("ballot-contests", { kind: "malformed-ballot-fixture", ballots: {} }, "test:failed-national-ballot");
  const edge = promotedFixtureBundle({ promoted: new Map([[`BALLOT_CANDIDACY:${GENERIC_BALLOT_SCOPE}`, failed]]) });
  await withReaderAuthorityEdge(edge, async () => {
    for (const state of ["az", "nh", "nj"] as const) {
      const result = await loadBallotForDivisions(DIVISIONS[state]);
      assert.equal(result.set, null);
      assert.deepEqual(result.loaderFailures, ["general ballot"]);
      assert.throws(() => currentGenericBallotProjection(), /National ballot projection is UNREAD/);
      await assert.rejects(() => getCandidateTargetIds(TARGETS[state]), /GENERIC_BALLOT_INVALID/);
      await assert.rejects(() => getSingleCandidateTargetIds(TARGETS[state]), /GENERIC_BALLOT_INVALID/);
      await assert.rejects(() => displayFor(TARGETS[state]), /GENERIC_BALLOT_INVALID/);
    }
  });
});

test("an edge-only read failure clears the previously read national ballot", async () => {
  await readerBallotSourcesForDivisions(DIVISIONS.az);
  assert.ok(Object.keys(currentGenericBallotProjection().ballots).length);
  await withReaderAuthorityEdge({ edgeOnly: true }, async () => {
    const result = await loadBallotForDivisions(DIVISIONS.az);
    assert.equal(result.set, null);
    assert.deepEqual(result.loaderFailures, ["general ballot"]);
    assert.throws(() => currentGenericBallotProjection(), /National ballot projection is UNREAD/);
  });
});

test("ballot scope reports an unavailable national ballot without using another authority", async () => {
  await installRegistryAuthority();
  const failed = manualEdgeEntry("ballot-contests", { kind: "malformed-ballot-fixture", ballots: {} }, "test:failed-national-ballot");
  const edge = promotedFixtureBundle({ promoted: new Map([[`BALLOT_CANDIDACY:${GENERIC_BALLOT_SCOPE}`, failed]]) });
  for (const zip of ["85701", "03255"]) {
    const location = resolveZip(zip);
    assert.ok(location.ok);
    const response = await withReaderAuthorityEdge(edge, () => ballotScope(new Request("https://fixture.test/api/ballot/scope", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(location.centroid),
    })));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ok: false });
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
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
    "app/api/address/resolve/route.ts",
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

  const reactions = readFileSync(join(process.cwd(), "app/api/reactions/route.ts"), "utf8");
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
