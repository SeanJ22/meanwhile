import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { CardGapContribution } from "../components/ui/card-gap-context.tsx";
import { ballotPlaceDivisions } from "../lib/ballot/reader-place.ts";
import { readRegistryRuntimeProjection } from "../lib/registry/runtime-read-model.ts";
import { currentGenericBallotProjection } from "../lib/ballot/generic-projection.ts";

import { getCandidateTargetIds } from "../lib/ballot/candidate-targets.ts";
import { readerBallotSourceForTargetId, readerBallotSourcesForDivisions } from "../lib/ballot/reader-sources.ts";
import { getSingleCandidateTargetIds } from "../lib/ballot/uncontested.ts";
import { composeSelectedBallots } from "../lib/ask/ballot-only-answer.ts";
import { loadBallotForDivisions } from "../lib/ask/server-sources.ts";
import { displayFor } from "../lib/questionnaire/candidacy-display.ts";
import { validReactionTargetsFor } from "../lib/reactions/authority-targets.ts";
import {
  ballotAuxiliaryPreloadSucceeded,
  settleBallotAuxiliaryPreloads,
  type BallotAuxiliaryFamily,
} from "../lib/ballot/auxiliary-preloads.ts";
import { installAbsent, installRegistryAuthority } from "./helpers/promoted-fixtures.ts";
import type { StateAuthorityFamily } from "../lib/meetings/edge-artifacts.ts";
import { stateBallotScope } from "../lib/civic-data/state-scopes.ts";
import { withReaderAuthorityEdge, type ReaderAuthorityEdgeBundle } from "../lib/registry/runtime-edge.ts";

import { POST as ballotScope } from "../app/api/ballot/scope/route.ts";
import { resolveZip } from "../lib/geo/zcta.ts";
import type { BallotSet } from "../lib/ballot/types.ts";
import type { GenericBallotProjection } from "../lib/ballot/generic-projection.ts";
import type { Contest } from "../lib/ballot/types.ts";
import type { LineupOutcome } from "../lib/identity/types.ts";
import { requireBallotState } from "../lib/civic-data/state-scopes.ts";
import { currentReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";

import { ballotElectionKey } from "../lib/ballot/generic-projection.ts";
import { installManualValue } from "./helpers/promoted-fixtures.ts";
import { stateBallotContractId } from "../lib/civic-data/state-scopes.ts";
import type { CivicDataReadResult } from "../lib/civic-data/read-model.ts";
import { readGenericBallotProjection } from "../lib/ballot/generic-projection.ts";


const TEST_BALLOT_PROVENANCE = { sourceUrl: "https://example.test/ballot", sourceOrg: "Synthetic test ballot", collectedAt: "2026-09-25", verifiedAt: null };

function rawBallot(state: string, races: readonly TestRace[]): BallotSet {
  const electionId = `${state.toLowerCase()}-2026-general-test`;
  return {
    election: { id: electionId, date: "2026-11-03", name: "2026 General Election (test)", state },
    contests: races.map((race) => ({
      id: race.id, electionId, ocdId: race.ocdId, divisionVintage: "2026", title: race.title, type: race.type ?? (race.measure ? "MEASURE" : "CANDIDACY"),
      voteFor: 1, termYears: race.measure ? null : 4, scopeNote: null, provenance: TEST_BALLOT_PROVENANCE,
    })),
    candidacies: races.flatMap((race) => (race.candidacies ?? []).map((row) => ({
      id: row.id, contestId: race.id, givenName: row.givenName, familyName: row.familyName, partyLabel: row.partyLabel ?? null,
      slogan: null, incumbent: null, websiteUrl: null, provenance: TEST_BALLOT_PROVENANCE,
    }))),
    measures: races.flatMap((race) => race.measure ? [{
      id: `${race.id}#measure`, contestId: race.id, ...(race.measure.officialNumber ? { officialNumber: race.measure.officialNumber } : {}),
      questionText: race.measure.questionText, officialStatement: null, provenance: TEST_BALLOT_PROVENANCE,
    }] : []),
    absences: [],
  };
}

interface TestRace {
  readonly id: string;
  readonly title: string;
  readonly ocdId: string;
  readonly type?: Contest["type"];
  readonly candidacies?: readonly { readonly id: string; readonly givenName: string; readonly familyName: string; readonly partyLabel?: string | null }[];
  readonly measure?: { readonly questionText: string; readonly officialNumber?: string };
}

function nhBallot(races: readonly TestRace[]): BallotSet {
  return rawBallot("NH", races);
}





function promotedFixtureBundle(extra: ReaderAuthorityEdgeBundle = {}): ReaderAuthorityEdgeBundle {
  const current: ReaderAuthorityEdgeBundle = currentReaderAuthorityEdge() ?? {};
  return { stateAuthorities: current.stateAuthorities,
    ...(current.federalDirectory ? { federalDirectory: current.federalDirectory } : {}),
    ...(current.stateLegislators ? { stateLegislators: current.stateLegislators } : {}),
    ...extra, promoted: new Map([...(current.promoted ?? []), ...(extra.promoted ?? [])]) };
}

function served<T>(read: CivicDataReadResult<T>, what: string): T {
  if (read.kind !== "PROMOTED" && read.kind !== "BOOTSTRAP") throw new Error(`${what} fixture did not install: ${read.kind} ${"detail" in read ? read.detail : ""}`);
  return read.value as T;
}



interface SyntheticLineupNominee {
  readonly name: string;
  readonly partyLabel: string;
  readonly outcome: LineupOutcome;
  readonly candidacyId?: string;
  readonly filingParty?: string;
}

interface SyntheticContest {
  readonly id: string;
  readonly title: string;
  readonly ocdId?: string;
  readonly type?: Contest["type"];
  readonly candidacies?: readonly { readonly id: string; readonly givenName: string; readonly familyName: string; readonly partyLabel?: string | null }[];
  readonly lineup?: readonly SyntheticLineupNominee[];
}

function syntheticAzBallot(contests?: readonly SyntheticContest[]): BallotSet {
  const fixtures = JSON.parse(readFileSync(new URL("./fixtures/synthetic-az-ballots.json", import.meta.url), "utf8")) as Record<string, BallotSet>;
  const ballot = fixtures[JSON.stringify(contests ?? null)];
  if (!ballot) throw new Error("The synthetic Arizona ballot input has no recorded fixture");
  return ballot;
}

async function installBallots(...ballots: BallotSet[]): Promise<GenericBallotProjection> {
  const installed: GenericBallotProjection = { kind: "ballot-contests", ballots: {} };
  for (const ballot of ballots.length ? ballots : [syntheticAzBallot()]) {
    const state = requireBallotState(ballot.election.state);
    const previous = currentReaderAuthorityEdge()?.promoted?.get(`BALLOT_CANDIDACY:${stateBallotScope("ballot-contests", state)}`);
    const current = previous?.kind === "PROMOTED" ? previous.projection.payload as GenericBallotProjection : null;
    const value: GenericBallotProjection = { kind: "ballot-contests", ballots: {
      ...(current?.ballots ?? {}), [ballotElectionKey(ballot)]: ballot,
    } };
    installManualValue(stateBallotContractId("ballot-contests", state), value, `test:ballot-contests:${state}`);
    served(await readGenericBallotProjection(state), `${state} ballot`);
    Object.assign(installed.ballots, value.ballots);
  }
  return installed;
}


await installBallots(syntheticAzBallot([{
  id: "ballot-az-pima:governor", title: "Governor",
  candidacies: [{ id: "ballot-az-pima:governor:candidate-a", givenName: "Alex", familyName: "Candidate" }],
}]), nhBallot([{
  id: "ballot-nh-merrimack:governor", title: "Governor", ocdId: "ocd-division/country:us/state:nh",
  candidacies: [{ id: "ballot-nh-merrimack:governor:candidate-b", givenName: "Blair", familyName: "Candidate" }],
}]));

installAbsent("BALLOT_CANDIDACY", stateBallotScope("ballot-contests", "NJ"));

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

test("a question naming two states keeps both candidate lists and their exact source states", async () => {
  const read = await loadBallotForDivisions([...DIVISIONS.az, ...DIVISIONS.nh]);
  assert.deepEqual(read.sets.map(ballot => ballot.election.state), ["AZ", "NH"]);
  assert.deepEqual(read.set?.candidacies.map(candidate => candidate.id).sort(), [TARGETS.az, TARGETS.nh].sort());
  assert.equal(read.setForTarget(TARGETS.az)?.election.state, "AZ");
  assert.equal(read.setForTarget(TARGETS.nh)?.election.state, "NH");
  assert.equal(read.setForTarget(TARGETS.nj), null);
  for (const shape of [{ kind: "SUMMARY" }, { kind: "OFFICE", key: "governor", phrase: "governor" }] as const) {
    const composed = composeSelectedBallots(read, shape)!;
    assert.match(composed.answer, /AZ:/);
    assert.match(composed.answer, /NH:/);
    for (const set of read.sets) for (const contest of set.contests) {
      const evidence = composed.records.find(row => row.kind === "CONTEST" && row.id === contest.id)!;
      assert.ok(evidence.text.includes(set.election.name));
      assert.equal(evidence.occurredAt, set.election.date);
    }
  }
});

function failedBallotEdge(states: readonly string[]): ReaderAuthorityEdgeBundle {
  const base = promotedFixtureBundle();
  return { ...base, edgeOnly: true as const,
    promoted: new Map([...base.promoted!].filter(([key]) => !states.some(state => key === `BALLOT_CANDIDACY:${stateBallotScope("ballot-contests", state)}`))),
    stateAuthorities: { states: { "ballot-contests": new Set(states.map(state => state.toUpperCase())) },
      load: async (family: StateAuthorityFamily, state: string) => { if (family === "ballot-contests" && states.includes(state)) throw new Error("PLANTED_STATE_BALLOT_FAILURE"); return base.stateAuthorities!.load(family, state); } } };
}

test("a failed state ballot leaves another state readable and refuses its own exact target", async () => {
  const edge = failedBallotEdge(["AZ"]);
  await withReaderAuthorityEdge(edge, async () => {
    const result = await loadBallotForDivisions(DIVISIONS.az);
    assert.equal(result.set, null);
    assert.deepEqual(result.loaderFailures, ["az"]);
    assert.throws(() => currentGenericBallotProjection("AZ"), /Ballot for AZ is UNREAD/);
    await assert.rejects(() => getCandidateTargetIds(DIVISIONS.az, TARGETS.az), /not on the reader edge/);
    await assert.rejects(() => getSingleCandidateTargetIds(DIVISIONS.az, TARGETS.az), /not on the reader edge/);
    await assert.rejects(() => displayFor("AZ", TARGETS.az), /not on the reader edge/);
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
    page.indexOf("readerBallotSourcesForDivisions(ocdIds") < page.indexOf("settleBallotAuxiliaryPreloads(auxiliaryPreloads)"),
    "supporting authorities were opened before the requested ballot authority was selected",
  );
  assert.match(page, /data-ballot-canonical-holding-gaps/);
  assert.match(page, /<CardGapContribution id=\{`ballot-holding:\$\{family\}`\} label=\{HOLDING_LABEL\[family\]\}/,
    "supporting authority failures contribute to the card footer");
  assert.match(page, /matched\.contests\.some\(nhLegislativeRosterAppliesTo\)/);
  assert.match(page, /auxiliaryPreloads\.set\("nh-members", settleNhSeatHolders\)/);

  const reactions = readFileSync(join(process.cwd(), "app/api/reactions/route.ts"), "utf8");
  assert.match(reactions, /candidateTargets:\s*targetId => getCandidateTargetIds\(divisions, targetId\)/);
  assert.match(reactions, /validReactionTargetsFor\(\s*submission\.targetType,\s*submission\.targetId/);
  assert.doesNotMatch(reactions, /Promise\.all\(\[refreshFundingFromPromoted\(\),\s*refreshFederalVotesFromPromoted\(\)\]\)/);

  const demand = readFileSync(join(process.cwd(), "app/api/demand-signal/route.ts"), "utf8");
  assert.match(demand, /getCandidateTargetIds\(divisions, submission\.subjectId\)/);
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

test("state registry requests retain their state's photos and never expose a neighboring state", async () => {
  await installRegistryAuthority();
  for (const state of ["AZ", "NH"]) {
    await withReaderAuthorityEdge(promotedFixtureBundle(), async () => {
      const read = await readRegistryRuntimeProjection([state]);
      assert.equal(read.kind, "PROMOTED");
      if (read.kind !== "PROMOTED") return;
      assert.ok(read.value.registry.divisions.length);
      assert.ok(read.value.registry.divisions.every(row => row.state === state));
      assert.ok(read.value.officialPhotos.photos.every(row => !row.officeholderId.startsWith(`statewide:${state === "AZ" ? "nh" : "az"}/`)));
    });
  }
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
