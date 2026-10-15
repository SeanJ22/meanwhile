import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { CardGapContribution } from "../components/ui/card-gap-context.tsx";
import { ballotPlaceDivisions } from "../lib/ballot/reader-place.ts";
import { readRegistryPlace } from "../lib/registry/reader-place.ts";
import { getRegistryRuntimeReadModel, withRegistryPlaceRead } from "../lib/registry/runtime-read-model.ts";
import { knownBodySubjectIds, settleRegistryAuthorityReads } from "../lib/registry/server.ts";
import { currentGenericBallotProjection } from "../lib/ballot/generic-projection.ts";

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
import { stateBallotScope } from "../lib/ballot/state-scopes.ts";
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
    assert.equal((await readerBallotSourceForTargetId(TARGETS[state], DIVISIONS[state]))?.state, state);
    const held = await loadBallotForDivisions(DIVISIONS[state]);
    assert.equal(held.set?.election.state, state.toUpperCase());
    assert.deepEqual(held.loaderFailures, []);
    assert.ok((await getCandidateTargetIds(DIVISIONS[state], TARGETS[state])).has(TARGETS[state]));
    assert.equal((await getSingleCandidateTargetIds(DIVISIONS[state], TARGETS[state])).has(TARGETS[state]), state === "az",
      "Only the AZ fixture establishes a complete candidate list; the partial NH list cannot establish an uncontested race.");
    assert.ok(await displayFor(state, TARGETS[state]));
  }
  assert.deepEqual(await readerBallotSourcesForDivisions(DIVISIONS.nj), []);
  assert.deepEqual(await readerBallotSourcesForDivisions(["ocd-division/country:us"]), []);
  assert.equal(await readerBallotSourceForTargetId("invented:target", DIVISIONS.az), null);
});

function failedBallotEdge(states: readonly string[]) {
  const base = promotedFixtureBundle();
  return { ...base, edgeOnly: true as const,
    promoted: new Map([...base.promoted!].filter(([key]) => !states.some(state => key === `BALLOT_CANDIDACY:${stateBallotScope("ballot-contests", state)}`))),
    stateAuthorities: { states: { "ballot-contests": new Set(states.map(state => state.toUpperCase())) },
      load: async () => { throw new Error("PLANTED_STATE_BALLOT_FAILURE"); } } };
}

test("a failed state ballot leaves another state readable and refuses its own exact target", async () => {
  const edge = failedBallotEdge(["AZ"]);
  await withReaderAuthorityEdge(edge, async () => {
    const result = await loadBallotForDivisions(DIVISIONS.az);
    assert.equal(result.set, null);
    assert.deepEqual(result.loaderFailures, ["az"]);
    assert.throws(() => currentGenericBallotProjection("AZ"), /Ballot for AZ is UNREAD/);
    await assert.rejects(() => getCandidateTargetIds(DIVISIONS.az, TARGETS.az), /PLANTED_STATE_BALLOT_FAILURE/);
    await assert.rejects(() => getSingleCandidateTargetIds(DIVISIONS.az, TARGETS.az), /PLANTED_STATE_BALLOT_FAILURE/);
    await assert.rejects(() => displayFor("AZ", TARGETS.az), /PLANTED_STATE_BALLOT_FAILURE/);
    const neighbor = await loadBallotForDivisions(DIVISIONS.nh);
    assert.equal(neighbor.set?.election.state, "NH");
    assert.deepEqual(neighbor.loaderFailures, []);
    assert.ok(await displayFor("NH", TARGETS.nh));
  });
});

test("an edge-only read failure cannot reuse a previously read state ballot", async () => {
  await readerBallotSourcesForDivisions(DIVISIONS.az);
  assert.ok(Object.keys(currentGenericBallotProjection("AZ").ballots).length);
  await withReaderAuthorityEdge({ edgeOnly: true }, async () => {
    const result = await loadBallotForDivisions(DIVISIONS.az);
    assert.equal(result.set, null);
    assert.deepEqual(result.loaderFailures, ["az"]);
    assert.throws(() => currentGenericBallotProjection("AZ"), /Ballot for AZ is UNREAD/);
  });
});

test("ballot scope reports an unavailable state ballot without using another authority", async () => {
  await installRegistryAuthority();
  const edge = failedBallotEdge(["AZ", "NH"]);
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
    candidateTargets: async (_divisions: readonly string[], targetId: string) => {
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
    page.indexOf("readerBallotSourcesForDivisions(ocdIds") < page.indexOf("settleBallotAuxiliaryPreloads(auxiliaryPreloads)"),
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
  assert.match(demand, /getCandidateTargetIds\(ocdIds, submission\.subjectId\)/);
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

test("same-version registry requests retain only their place and exact targets without sharing another place's index", async () => {
  await installRegistryAuthority();
  await withReaderAuthorityEdge(promotedFixtureBundle(), async () => {
    const azDivision = `${DIVISIONS.az[0]}/cd:1`, nhDivision = `${DIVISIONS.nh[0]}/cd:2`;
    const [az, nh] = await Promise.all([readRegistryPlace([azDivision]), readRegistryPlace([nhDivision])]);
    assert.equal(az.versionId, nh.versionId);
    assert.notEqual(az.selectorKey, nh.selectorKey);
    for (const [read, own, foreign] of [[az, azDivision, nhDivision], [nh, nhDivision, azDivision]] as const) {
      await withRegistryPlaceRead(read, async () => {
        await settleRegistryAuthorityReads("REGISTRY");
        assert.equal(getRegistryRuntimeReadModel(), read.value);
        const indexed = await knownBodySubjectIds();
        assert.ok(indexed.has(own));
        assert.ok(!indexed.has(foreign));
        assert.ok(read.value.officialCandidacies.rows.some(row => row.holder.divisions.includes(own)));
        assert.ok(read.value.officialCandidacies.rows.every(row => !row.holder.divisions.includes(foreign)));
      });
    }
    const bundle = promotedFixtureBundle();
    const executiveId = "statewide:az/attorney-general";
    const source = bundle.registryRuntime!;
    const expectedPhoto = source.value.officialPhotos.photos.find(row => row.officeholderId === executiveId);
    assert.ok(expectedPhoto);
    await withReaderAuthorityEdge({ ...bundle, registryRuntime: { ...source, value: { ...source.value,
      officialCandidacies: { ...source.value.officialCandidacies,
        rows: source.value.officialCandidacies.rows.filter(row => row.holder.id !== executiveId) } } } }, async () => {
      const selected = await readRegistryPlace(DIVISIONS.az);
      assert.deepEqual(selected.value.officialPhotos.photos.find(row => row.officeholderId === executiveId), expectedPhoto);
    });
    const role = "roster:merrimack-delegation#5";
    const named = await readRegistryPlace(DIVISIONS.az, [role]);
    assert.ok(named.value.bodyRosters.some(roster => roster.members.some(member => member.id === role)));
    assert.ok(!az.value.bodyRosters.some(roster => roster.members.some(member => member.id === role)));
    await withRegistryPlaceRead(new Error("PLANTED_PLACE_READ_FAILURE"), async () => {
      assert.throws(getRegistryRuntimeReadModel, /PLANTED_PLACE_READ_FAILURE/);
      await assert.rejects(() => settleRegistryAuthorityReads("REGISTRY"), /PLANTED_PLACE_READ_FAILURE/);
    });
  });
});


test("coordinate ballot requests derive their place directly from Census geography", async () => {
  const fixture = JSON.parse(readFileSync("tests/fixtures/census-address-tx.json", "utf8"));
  const geographies = fixture.result.addressMatches[0].geographies;
  const previous = globalThis.fetch;
  const urls: URL[] = [];
  globalThis.fetch = async input => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    urls.push(url);
    return Response.json({ result: { geographies } });
  };
  try {
    const ids = await ballotPlaceDivisions({ lat: 30.2712, lng: -97.7431 });
    assert.ok(ids.includes("ocd-division/country:us/state:tx"));
    assert.ok(ids.some(id => id.includes("/county:travis")));
    assert.ok(ids.every(id => id.startsWith("ocd-division/country:us/state:tx")));
    assert.equal(urls.length, 1);
    assert.equal(urls[0].pathname, "/geocoder/geographies/coordinates");
    assert.equal(urls[0].searchParams.get("x"), "-97.7431");
    assert.equal(urls[0].searchParams.get("y"), "30.2712");
  } finally { globalThis.fetch = previous; }
});
