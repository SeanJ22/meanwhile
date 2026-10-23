import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { after, test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import sharp from "sharp";

import { launchGuarded } from "../scripts/browser.mts";
import type { BallotSet } from "../lib/ballot/types.ts";
import { stateBallotContractId } from "../lib/civic-data/state-scopes.ts";
import { ballotElectionKey, genericBallotProblems } from "../lib/ballot/generic-projection.ts";
import { reconcileOfficialCandidacies } from "../lib/registry/runtime-data-plane.ts";
import { normalizePortrait } from "../lib/photos/decode.ts";
import type { PortraitVerification } from "../lib/photos/binding.ts";
import { installReaderValues, installCanonicalEntries, activateCanonicalFixture } from "./helpers/canonical-reader-fixtures.ts";
type PublishAuthorityValue = { readonly value: unknown; readonly versionId: string };
import type { GlobalAuthorityFamily, StateAuthorityFamily } from "../lib/meetings/edge-artifacts.ts";
import { requiredRoutineContract } from "../lib/civic-data/contracts.ts";
import { requiredManualProductionContract } from "../lib/civic-data/manual-contracts.ts";
import { PRL_CONTRACT } from "../lib/sources/prl/data-plane.ts";
import { PRL_RHETORIC_ATTRIBUTION, type PrlSnapshot } from "../lib/sources/prl/types.ts";
import type { CandidateCorpus } from "../lib/candidates/corpus.ts";
import type { FundingSnapshot } from "../lib/funding/types.ts";
import { FEDERAL_ROLLCALL_SCOPE, FEDERAL_KEY_VOTE_SCOPE, FEDERAL_VOTES_SOURCE_ID, federalMemberVotesScope } from "../lib/votes/data-plane.ts";
import { absentEdgeEntry, manualEdgeEntry, promotedFamily, provenEdgeEntry } from "./helpers/promoted-edge-entry.ts";
import { registryTransferImport, syntheticCandidateProfiles, syntheticFederalDirectory, syntheticFederalRollCalls, syntheticFederalKeyVotes, syntheticOfficeholderStatements, stateMoneyFixture, stateFederalDirectoryArtifacts } from "./helpers/promoted-fixtures.ts";
import { azDistricts } from "./helpers/ballot-district-fixtures.ts";
import { STATE_CAMPAIGN_FINANCE_SOURCES, type StateCampaignFinanceJurisdiction } from "../lib/funding/data-plane.ts";
import { DERIVED_CAMPAIGN_SITES_RECORD_CLASS, derivedCampaignSitesScope, DERIVED_CAMPAIGN_SITES_SOURCE_ID, derivedCampaignSitesProjectionIssue, type DerivedCampaignSitesProjection } from "../lib/civic-data/derived-campaign-sites.ts";
import type { SeatHolder } from "../lib/officials/lookup.ts";
import type { CandidateBattlecard } from "../components/ballot/candidate-battlecard.tsx";
import type { CardSource } from "../lib/officials/card-sources.ts";
import type { RegistryRuntimeReadModel } from "../lib/registry/runtime-data-plane.ts";
import { stateRegistryRuntimeScope } from "../lib/civic-data/state-scopes.ts";
import { registryJurisdictions } from "../lib/civic-data/state-scopes.ts";









const azBallot = Object.values(JSON.parse(readFileSync(join(import.meta.dirname, "../data/ballot/2026-general/az.json"), "utf8")).ballots)[0] as BallotSet;

function registryFixtureForState(state: string, value: RegistryRuntimeReadModel = registryTransferImport().projection.payload): RegistryRuntimeReadModel {
  const own = (id: string | null) => registryJurisdictions(id).includes(state.toUpperCase());
  const bodies = value.registry.bodies.filter(row => own(row.id) || own(row.ocdId) || row.alsoServesOcdIds?.some(own));
  const bodyIds = new Set(bodies.map(row => row.id));
  const bodyRosters = value.bodyRosters.filter(row => bodyIds.has(row.bodyId));
  const statewideExecutives = value.statewideExecutives.filter(row => own(row.stateOcdId));
  const bridge = value.officialCandidacies.rows.filter(row => row.holder.divisions.some(own));
  const holders = new Set([...bodyRosters.flatMap(row => row.members.map(member => member.id)),
    ...statewideExecutives.map(row => row.holder.id), ...bridge.map(row => row.holder.id)]);
  return { ...value, registry: { ...value.registry, bodies,
    divisions: value.registry.divisions.filter(row => row.ocdId === "ocd-division/country:us" || own(row.ocdId)) },
    bodyRosters, statewideExecutives, officialCandidacies: { ...value.officialCandidacies, rows: bridge },
    officialPhotos: { photos: value.officialPhotos.photos.filter(row => holders.has(row.officeholderId)) },
    rosterPhotos: Object.fromEntries(Object.entries(value.rosterPhotos).filter(([id]) => holders.has(id) || own(id))),
    rosterReaderDispositions: value.rosterReaderDispositions.filter(row => own(row.sourceId) || holders.has(row.sourceId) || (row.canonicalId !== null && holders.has(row.canonicalId)) ||
      [...holders].some(id => id.startsWith("roster:") && id.split("#")[0] === row.sourceId.split("#")[0])) };
}

function stateRegistryArtifacts(versionId: string, states: readonly string[], value: RegistryRuntimeReadModel = registryTransferImport().projection.payload) {
  return Object.fromEntries(states.map(state => [state, { versionId: `${versionId}:${state}`, value: { kind: "PROMOTED_POINTERS" as const,
    entries: [provenEdgeEntry({ recordClass: "REGISTRY_RUNTIME_BINDING", scope: stateRegistryRuntimeScope(state), sourceId: "registry-reviewed-bindings",
      versionId: `${versionId}:${state}`, value: registryFixtureForState(state, value) })] } }]));
}


for (const key of ["DATABASE_URL", "DATABASE_URL_UNPOOLED", "NEON_DATABASE_URL", "NETLIFY", "NETLIFY_BLOBS_CONTEXT", "NETLIFY_SITE_ID"]) delete process.env[key];

const checkedAt = "2026-10-12T00:00:00.000Z";
const cases = [
  { state: "OH", zip: "44113", incumbent: "congress:H001104", name: "Jon Husted", challenger: "Casey Ohio", title: "United States Senator", voteFor: null },
  { state: "MI", zip: "48201", incumbent: "congress:S001208", name: "Elissa Slotkin", challenger: "Casey Michigan", title: "U.S. Senator", voteFor: 1 },
] as const;

function nationalBallot(item: typeof cases[number]): BallotSet {
  const contestId = `national-election:${item.state}:senator`;
  const election = { id: `fixture-${item.state}-2026-general`, date: "2026-11-03", name: "Synthetic general election", state: item.state };
  const provenance = { sourceUrl: `https://${item.state.toLowerCase()}-elections.example.gov/certified-candidates`, sourceOrg: `${item.state} election authority fixture`, collectedAt: checkedAt, verifiedAt: checkedAt };
  return {
    election,
    contests: [{ id: contestId, electionId: election.id, title: item.title, ocdId: `ocd-division/country:us/state:${item.state.toLowerCase()}`,
      divisionVintage: "2026", type: "CANDIDACY", voteFor: item.voteFor, termYears: 6, scopeNote: null, candidateListComplete: true, provenance }],
    candidacies: [item.name, item.challenger].map((name, index) => ({ id: `${contestId}:candidate-${index}`, contestId,
      givenName: name.split(" ")[0]!, familyName: name.split(" ").slice(1).join(" "), partyLabel: null,
      slogan: null, incumbent: null, websiteUrl: index ? `https://casey-${item.state.toLowerCase()}.example.org/` : null, provenance })),
    measures: [], absences: [],
  };
}

type BattlecardProps = React.ComponentProps<typeof CandidateBattlecard>;
interface RenderedBallot {
  cards: Map<string, BattlecardProps>;
  names: Map<string, SeatHolder>;
  sources: Map<string, CardSource[]>;
  text: string;
}

async function renderBallot(zip: string): Promise<RenderedBallot> {
  const { default: BallotPage } = await import("../app/ballot/page.tsx");
  const result: RenderedBallot = { cards: new Map(), names: new Map(), sources: new Map(), text: "" };
  let elementNumber = 0;
  const resolve = async (node: unknown, subject?: string): Promise<unknown> => {
    node = await node;
    if (typeof node === "string") { result.text += ` ${node}`; return node; }
    if (!node || typeof node !== "object") return node;
    if (Array.isArray(node)) return Promise.all(node.map(child => resolve(child, subject)));
    if (!React.isValidElement<Record<string, unknown>>(node)) {
      if (Object.getPrototypeOf(node) !== Object.prototype) return node;
      return Object.fromEntries(await Promise.all(Object.entries(node).map(async ([key, value]) => [key, await resolve(value, subject)])));
    }
    const name = typeof node.type === "function" ? node.type.name : "";
    if (name === "IncumbentNameLink") result.names.set(String(node.props.name), node.props.holder as SeatHolder);
    if (name === "CardSourcesContribution" && subject) result.sources.set(subject, [...(result.sources.get(subject) ?? []), ...(node.props.sources as CardSource[])]);
    if (typeof node.type === "function" && (node.type.constructor.name === "AsyncFunction" || ["CandidateSources", "CandidateContactSources", "FundingDisplay", "CandidatePositions", "CandidatePortraitSources"].includes(name))) {
      return resolve(await (node.type as (props: unknown) => unknown)(node.props), subject);
    }
    const cardId = name === "CandidateBattlecard" ? String(node.props.subjectId) : subject;
    const props = Object.fromEntries(await Promise.all(Object.entries(node.props).map(async ([key, value]) => [key, await resolve(value, cardId)])));
    if (Array.isArray(props.children)) props.children = React.Children.toArray(props.children as React.ReactNode[]);
    if (name === "CandidateBattlecard") result.cards.set(cardId!, props as unknown as BattlecardProps);
    return React.cloneElement(node, { ...props, key: node.key ?? elementNumber++ });
  };
  await resolve(await BallotPage({ searchParams: Promise.resolve({ zip }) }));
  return result;
}

test("BL-20: Ohio and Michigan national ballots render the same incumbent record and challenger portrait as Arizona", async () => {
  const encoded = await sharp({ create: { width: 128, height: 144, channels: 3, background: "#456789" } }).png().toBuffer();
  const portrait = await normalizePortrait(encoded);
  assert.ok("bytes" in portrait && portrait.verdict.ok);
  const imageHash = `sha256-${createHash("sha256").update(portrait.bytes).digest("hex")}`;
  const sourceHash = `sha256-${createHash("sha256").update(encoded).digest("hex")}`;
  const portraitPath = `/api/portraits/officials/${imageHash.slice(7)}.webp`;
  const ballots = cases.map(nationalBallot);
  for (const ballot of [...ballots, azBallot]) assert.deepEqual(genericBallotProblems({ kind: "ballot-contests", ballots: { [ballotElectionKey(ballot)]: ballot } }, ballot.election.state), []);
  const registry = registryTransferImport().projection.payload;
  const federal = syntheticFederalDirectory(registry);
  for (const item of cases) {
    const holder = federal.roster.officeholders.find(holder => holder.id === item.incumbent)!;
    const sourceUrl = `https://${item.state.toLowerCase()}-senator.example.gov/about`;
    const verification: PortraitVerification = { personId: holder.id, name: holder.name, imageUrl: `${sourceUrl}/portrait.png`,
      basis: "OWN_PAGE", ownPageUrl: sourceUrl, attribution: { sourceUrl, name: holder.name }, checkedAt, imageHash, sourceImageHash: sourceHash,
      sources: [{ url: sourceUrl, artifactId: `fixture:${holder.id}`, contentHash: sourceHash, retrievedAt: checkedAt }] };
    holder.photo = { url: portraitPath, sourceUrl: verification.imageUrl, attribution: `${item.name}'s official office`, license: null, collectedAt: checkedAt, verification };
  }
  const linkedRegistry = { ...registry, officialCandidacies: reconcileOfficialCandidacies({ bridge: registry.officialCandidacies, ballots }),
    officialPhotos: { photos: registry.officialPhotos.photos.filter(photo => !cases.some(item => item.incumbent === photo.officeholderId)) } };
  for (const [index, item] of cases.entries()) assert.equal(linkedRegistry.officialCandidacies.rows.find(row => row.holder.id === item.incumbent)?.candidacy?.candidacyId, ballots[index]!.candidacies[0]!.id);
  const corpus: CandidateCorpus = { formatVersion: 1, attempted: 2, fetchedAt: checkedAt, failures: [], documents: cases.map(item => {
    const text = `I will protect drinking water for every family in our state. ${"Our communities need schools, safe roads, and public services that everyone can reach. ".repeat(5)}`;
    const contentHash = createHash("sha256").update(text).digest("hex");
    return { id: `${item.incumbent}@${contentHash}`, candidateKey: item.incumbent, sourceClass: "OFFICIAL_SITE" as const, basis: "HUNTED_AND_VERIFIED" as const, metaDescription: null,
      documentUrl: `https://${item.state.toLowerCase()}-senator.example.gov/clean-water`, contentHash, retrievedAt: checkedAt, contentType: "text/html", text, extraction: "html" as const, extractionNote: null };
  }) };
  const funding: FundingSnapshot = { formatVersion: 1, fetchedAt: checkedAt, cycle: 2026, matchReport: { rosterMatched: 2, rosterTotal: 2, ballotMatched: 0, ballotTotal: 4 }, absences: [], candidates: cases.map((item, index) => ({
    dataClass: "FEC_COMMITTEE", fecCandidateId: index ? "S0MI00001" : "S0OH00001", name: item.name, state: item.state, office: "S", district: null,
    targetKeys: [item.incumbent], matchRoutes: ["EXACT_BIOGUIDE"], principalCommitteeId: null, cycle: 2026,
    totals: { receipts: 120000, disbursements: 45000, cashOnHand: 75000, individualItemized: 70000, individualUnitemized: 50000, smallDonorShare: null, coverageEndDate: "2026-09-30" },
    topContributions: [], acquisition: { totalsComplete: true, contributionsComplete: true, checkedAt },
    provenance: { sourceUrl: `https://www.fec.gov/data/candidate/${index ? "S0MI00001" : "S0OH00001"}/`, sourceOrg: "Federal Election Commission", collectedAt: checkedAt, verifiedAt: checkedAt },
  })) };
  const challengerPhoto = `/api/portraits/candidates/${imageHash.slice(7)}.webp`;
  const derivedRecords = ballots.map(ballot => {
    const challenger = ballot.candidacies[1]!;
    const name = `${challenger.givenName} ${challenger.familyName}`;
    return { id: challenger.id, candidacyId: challenger.id, candidateName: name,
      campaign: { url: challenger.websiteUrl!, attemptedAt: checkedAt.slice(0, 10),
        verification: `Fetched ${checkedAt.slice(0, 10)} (campaign-site-verifier/1): '${name} for Senate' — names ${name}, the office ("${ballot.contests[0]!.title}"), and the 2026 election.`,
        evidence: { verifierId: "campaign-site-verifier/1", artifactId: `fixture:${challenger.id}`, attemptId: `attempt:${challenger.id}`, sha256: sourceHash.slice(7),
          requestedUrl: challenger.websiteUrl!, finalUrl: challenger.websiteUrl!, httpStatus: 200, readAt: checkedAt,
          approvalItemId: `item:${challenger.id}`, approvalRecordId: `approval:${challenger.id}`, approvedAt: checkedAt } },
      portrait: { personId: challenger.id, photoUrl: challengerPhoto, photoSource: `Portrait from ${name}'s campaign site`,
      photoVerification: { personId: challenger.id, name: `${challenger.givenName} ${challenger.familyName}`, imageUrl: `${challenger.websiteUrl}portrait.png`,
        basis: "OWN_PAGE" as const, ownPageUrl: challenger.websiteUrl!, attribution: { sourceUrl: challenger.websiteUrl!, name: `${challenger.givenName} ${challenger.familyName}` },
        checkedAt, imageHash, sourceImageHash: sourceHash, sources: [{ url: challenger.websiteUrl!, artifactId: `fixture:${challenger.id}`, contentHash: sourceHash, retrievedAt: checkedAt }] } } };
  });
  const derived: DerivedCampaignSitesProjection = { kind: "candidate-campaign-sites-derived", formatVersion: 1,
    records: derivedRecords.map(({ id, candidacyId, candidateName, campaign }) => ({ id, candidacyId, candidateName, campaign })),
    portraits: derivedRecords.map(({ id, candidacyId, candidateName, portrait }) => ({ id, candidacyId, candidateName, portrait })) };
  assert.equal(derivedCampaignSitesProjectionIssue(derived), null);
  const prl: PrlSnapshot = { formatVersion: 1, fetchedAt: checkedAt, sourceFile: "profiles-all-national.zip", sourceUrl: "https://americaspoliticalpulse.com/data/elite/profiles-all-national.zip",
    rowsInFile: 2, rowsWithStatements: 2, attribution: PRL_RHETORIC_ATTRIBUTION, rosterMisses: [], profiles: cases.map(item => ({ bioguideId: item.incumbent.slice(9), prlName: item.name,
      statementCount: 100, shares: { policy: 60, bipartisanship: 10, creditclaiming: 20, "attack-policy": 15, "attack-personal": 5 }, sources: ["all"], measuredAt: "2026-09-30" })) };
  const fec = requiredRoutineContract("fec-funding");
  const authority: Partial<Record<GlobalAuthorityFamily, PublishAuthorityValue>> = {
    "census-districts": { value: azDistricts, versionId: azDistricts.versionId },
    "official-filings": promotedFamily([absentEdgeEntry("CURATED_READER_RECORD", requiredManualProductionContract("official-filings").scope)], "BL-20:filings"),
    "federal-funding": promotedFamily([provenEdgeEntry({ recordClass: "FEC_FUNDING", scope: fec.scope, sourceId: fec.sourceId, versionId: "BL-20:fec", value: funding }), manualEdgeEntry("campaign-finance", { kind: "campaign-finance", records: [] }, "BL-20:generic-money")], "BL-20:money"),
    "state-money": promotedFamily((Object.keys(STATE_CAMPAIGN_FINANCE_SOURCES) as StateCampaignFinanceJurisdiction[]).map(state => provenEdgeEntry({ recordClass: "STATE_CAMPAIGN_FINANCE", ...STATE_CAMPAIGN_FINANCE_SOURCES[state], versionId: `BL-20:state-money:${state}`, value: stateMoneyFixture(state) })), "BL-20:state-money"),
    "federal-votes": promotedFamily([provenEdgeEntry({ recordClass: "FEDERAL_ROLL_CALL", scope: FEDERAL_ROLLCALL_SCOPE, sourceId: FEDERAL_VOTES_SOURCE_ID, versionId: "BL-20:votes", value: syntheticFederalRollCalls(federal, 2).window })], "BL-20:votes"),
    "federal-key-votes": promotedFamily([provenEdgeEntry({ recordClass: "FEDERAL_KEY_VOTE", scope: FEDERAL_KEY_VOTE_SCOPE, sourceId: FEDERAL_VOTES_SOURCE_ID, versionId: "BL-20:key-votes", value: syntheticFederalKeyVotes(federal) })], "BL-20:key-votes"),
    "officeholder-statements": promotedFamily([manualEdgeEntry("officeholder-statements", syntheticOfficeholderStatements(cases.map(item => item.incumbent)), "BL-20:statements")], "BL-20:statements"),
    "prl-archives": promotedFamily([provenEdgeEntry({ recordClass: PRL_CONTRACT.recordClass, scope: PRL_CONTRACT.scope, sourceId: PRL_CONTRACT.sourceId, versionId: "BL-20:prl", value: prl })], "BL-20:prl"),
  };
  const stateAuthorities: Partial<Record<StateAuthorityFamily, Record<string, PublishAuthorityValue>>> = {
    "registry-runtime": stateRegistryArtifacts("BL-20:registry", ["AZ", "OH", "MI"], linkedRegistry),
    "federal-directory": stateFederalDirectoryArtifacts("BL-20:federal", federal),
    "ballot-contests": Object.fromEntries([...ballots, azBallot].map(ballot => [ballot.election.state,
      promotedFamily([manualEdgeEntry(stateBallotContractId("ballot-contests", ballot.election.state),
        { kind: "ballot-contests", ballots: { [ballotElectionKey(ballot)]: ballot } }, `BL-20:ballots:${ballot.election.state}`)], `BL-20:ballots:${ballot.election.state}`)])),
    "candidate-profiles": Object.fromEntries(ballots.map(ballot => [ballot.election.state,
      promotedFamily([manualEdgeEntry(stateBallotContractId("candidate-profiles", ballot.election.state), syntheticCandidateProfiles(ballot.candidacies[1]!.id),
        `BL-20:profiles:${ballot.election.state}`)], `BL-20:profiles:${ballot.election.state}`)])),
    "candidate-publications": Object.fromEntries(cases.map(item => [item.state, promotedFamily([
      manualEdgeEntry(stateBallotContractId("candidate-corpus", item.state), { ...corpus, documents: corpus.documents.filter(row => row.candidateKey === item.incumbent) },
        `BL-20:publications:${item.state}`)], `BL-20:publications:${item.state}`)])),
    "candidate-campaign-sites-derived": Object.fromEntries(ballots.map(ballot => [ballot.election.state, promotedFamily([
      provenEdgeEntry({ recordClass: DERIVED_CAMPAIGN_SITES_RECORD_CLASS, scope: derivedCampaignSitesScope(ballot.election.state), sourceId: DERIVED_CAMPAIGN_SITES_SOURCE_ID,
        value: { ...derived, records: derived.records.filter(row => row.id === ballot.candidacies[1]!.id), portraits: derived.portraits?.filter(row => row.id === ballot.candidacies[1]!.id) },
        versionId: `BL-20:derived-portraits:${ballot.election.state}` })], `BL-20:derived-portraits:${ballot.election.state}`)])),
    "voting-sites": Object.fromEntries(["AZ", "OH", "MI"].map(state => [state, promotedFamily([absentEdgeEntry("VOTING_SITE", `US-${state}:voting-sites`)], `BL-20:absent-voting:${state}`)])),
  };
  for (const [family, recordClass, scope] of [
    ["candidate-profiles", "CANDIDATE_PROFILE", "candidate-profiles"],
    ["candidate-publications", "CANDIDATE_PUBLICATION", "candidate-publications"],
    ["candidate-campaign-sites-derived", "CURATED_READER_RECORD", "candidate-campaign-sites-derived"],
  ] as const) stateAuthorities[family] = { ...stateAuthorities[family], AZ: promotedFamily([absentEdgeEntry(recordClass, `US-AZ:${scope}`)], `BL-20:absent-${family}:AZ`) };
  const dir = mkdtempSync(join(tmpdir(), "wtp-national-ballot-parity-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const none = { value: null, versionId: "none" };
  installReaderValues({ authority, stateAuthorities, registrations: { az: none, oh: none, mi: none },
    stateLegislators: { "US-AZ": none, "US-OH": none, "US-MI": none } }, dir);
  installCanonicalEntries(syntheticFederalRollCalls(federal, 2).members.map(record => provenEdgeEntry({
    recordClass: "FEDERAL_ROLL_CALL", scope: federalMemberVotesScope(record.officeholderId), sourceId: FEDERAL_VOTES_SOURCE_ID,
    versionId: `BL-20:votes:${record.officeholderId}`, value: record })), dir);
  activateCanonicalFixture(dir);
  const browserCards: Record<string, unknown>[] = [];
  for (const [index, item] of cases.entries()) {
    const rendered = await renderBallot(item.zip);
    const ballot = ballots[index]!;
    const incumbent = rendered.cards.get(ballot.candidacies[0]!.id)!;
    const challenger = rendered.cards.get(ballot.candidacies[1]!.id)!;
    assert.ok(incumbent, `${item.state} national contest rendered`);
    assert.equal(incumbent.photoUrl, portraitPath);
    assert.equal(incumbent.incumbency, "INCUMBENT");
    assert.equal(incumbent.contactHolder?.id, item.incumbent);
    assert.equal(rendered.names.get(item.name)?.id, item.incumbent);
    assert.equal(challenger.incumbency, "CHALLENGER");
    assert.equal(challenger.photoUrl, challengerPhoto);
    assert.ok(incumbent.sections?.office, `${item.title} has its held office explanation`);
    assert.match(renderToStaticMarkup(incumbent.sections?.positions), /protect drinking water/);
    assert.match(renderToStaticMarkup(incumbent.sections?.money), /120,000/);
    assert.ok(rendered.sources.get(incumbent.subjectId)?.some(source => source.provenance.sourceUrl?.includes("senator.example.gov")), "the incumbent's official portrait is credited");
    for (const card of [incumbent, challenger]) browserCards.push({ subjectId: card.subjectId, name: card.name, photoUrl: card.photoUrl, incumbency: card.incumbency,
      contactHolder: card.contactHolder, tier: card.tier, divisionIds: [`ocd-division/country:us/state:${item.state.toLowerCase()}`], sections: { office: renderToStaticMarkup(card.sections?.office), positions: renderToStaticMarkup(card.sections?.positions),
        money: renderToStaticMarkup(card.sections?.money) }, sources: rendered.sources.get(card.subjectId) ?? [] });
  }
  const arizona = await renderBallot("85701");
  for (const title of ["State Senator, District 20", "State Representative, District 20", "U.S. Representative, District 7"]) assert.ok(arizona.text.includes(title), `85701 retains ${title}`);

  const { GET: votesGET } = await import("../app/api/votes/route.ts");
  const { GET: profileGET } = await import("../app/api/profile/[subject]/route.ts");
  const { GET: positionsGET } = await import("../app/api/positions/[subject]/[topic]/route.ts");
  const answers = new Map<string, string>();
  for (const item of cases) {
    const votes = await votesGET(new Request(`https://fixture.test/api/votes?member=${item.incumbent}`));
    assert.equal(votes.status, 200);
    answers.set(`/api/votes?member=${encodeURIComponent(item.incumbent)}&state=${item.state}`, await votes.text());
    const profile = await profileGET(new Request("https://fixture.test/"), { params: Promise.resolve({ subject: item.incumbent }) });
    assert.equal(profile.status, 200);
    const profileBody = await profile.json();
    assert.equal(profileBody.profile?.subjectId, item.incumbent);
    answers.set(`/api/profile/${encodeURIComponent(item.incumbent)}`, JSON.stringify(profileBody));
    const positions = await positionsGET(new Request(`https://fixture.test/?${new URLSearchParams({ division: `ocd-division/country:us/state:${item.state.toLowerCase()}` })}`), { params: Promise.resolve({ subject: item.incumbent, topic: "water" }) });
    assert.equal(positions.status, 200);
    answers.set(`/api/positions/${encodeURIComponent(item.incumbent)}/water?${new URLSearchParams({ division: `ocd-division/country:us/state:${item.state.toLowerCase()}` })}`, await positions.text());
  }
  const output = await build({ stdin: { contents: `
    import React from "react"; import {createRoot} from "react-dom/client";
    import {CandidateBattlecard} from "./components/ballot/candidate-battlecard.tsx";
    import {RecentVotes} from "./components/map/popup/official-popup.tsx";
    import {CardSourcesContribution} from "./components/ui/card-sources-contribution.tsx";
    const cards=${JSON.stringify(browserCards)};
    createRoot(document.getElementById("root")).render(cards.map(card=><section key={card.subjectId} data-fixture-candidate={card.subjectId}>
      <h2>{card.name}</h2><CandidateBattlecard {...card} sections={{office:<div dangerouslySetInnerHTML={{__html:card.sections.office}}/>,
      positions:<div dangerouslySetInnerHTML={{__html:card.sections.positions}}/>,money:<div dangerouslySetInnerHTML={{__html:card.sections.money}}/>,
      record:card.contactHolder?<RecentVotes holder={card.contactHolder} reactionContext={null} contentOnly/>:null,
      sources:<CardSourcesContribution id={card.subjectId} sources={card.sources}/>}}/></section>));`, resolveDir: process.cwd(), sourcefile: "ballot-parity-fixture.tsx", loader: "tsx" },
    bundle: true, write: false, outfile: ".scratch/ci/ballot-parity-fixture.js", platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent" });
  const javascript = output.outputFiles.find(file => file.path.endsWith(".js"))!.text;
  const stylesheet = readFileSync("app/globals.css", "utf8") + readFileSync("app/reader.css", "utf8") + (output.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? "");
  const requests: string[] = [];
  const server = createServer((request, response) => {
    const path = request.url ?? "/";
    requests.push(path);
    if (path === "/fixture.js") response.writeHead(200, { "content-type": "application/javascript" }).end(javascript);
    else if (path === "/fixture.css") response.writeHead(200, { "content-type": "text/css" }).end(stylesheet);
    else if (path.startsWith("/api/portraits/")) response.writeHead(200, { "content-type": "image/webp" }).end(portrait.bytes);
    else if (answers.has(path)) response.writeHead(200, { "content-type": "application/json" }).end(answers.get(path));
    else if (path === "/") response.writeHead(200, { "content-type": "text/html" }).end('<!doctype html><html lang="en"><link rel="stylesheet" href="/fixture.css"><body class="mw-reader"><main id="root"></main><script src="/fixture.js"></script></body></html>');
    else response.writeHead(503, { "content-type": "application/json" }).end("{}");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  let browser: Awaited<ReturnType<typeof launchGuarded>> | null = null;
  try {
    browser = await launchGuarded({ label: "BL-20-national-ballot-parity", blockWrites: true });
    const context = await browser.context({ viewport: { width: 1100, height: 1000 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${address.port}/`);
    mkdirSync(".scratch/ci", { recursive: true });
    for (const [index, item] of cases.entries()) {
      const incumbentId = ballots[index]!.candidacies[0]!.id;
      await page.locator(`[data-fixture-candidate="${incumbentId}"]`).getByRole("button", { name: "View Battlecard", exact: true }).click();
      const card = page.getByRole("dialog", { name: item.name, exact: true });
      const statements = card.getByRole("button", { name: "Public statements", exact: true });
      await statements.waitFor({ timeout: 5000 }).catch(async error => {
        await page.screenshot({ path: ".scratch/ci/BL-20-browser-failure.png", fullPage: true });
        throw new Error(JSON.stringify({ requests, errors, page: await page.locator("body").innerText() }), { cause: error });
      });
      if (await statements.getAttribute("aria-expanded") !== "true") await statements.click();
      await card.getByRole("group", { name: "Public statements by category" }).waitFor();
      await card.getByRole("button", { name: "Voting record", exact: true }).click();
      await card.getByText("Synthetic Test Act 2", { exact: true }).waitFor();
      assert.match(await card.innerText(), /Incumbent/);
      await card.getByRole("button", { name: "Campaign money", exact: true }).click();
      assert.match(await card.innerText(), /120,000/);
      assert.equal(await card.locator("img").evaluate(async image => { const img = image as HTMLImageElement; await img.decode(); return img.naturalWidth; }), 128);
      await card.getByRole("button", { name: "Positions", exact: true }).click();
      await card.locator("[data-positions-section] input").fill("water");
      await card.locator("[data-positions-section] input").press("Enter");
      await card.getByText(/We must protect our water supply/).waitFor();
      await card.getByRole("button", { name: /^Sources/ }).click();
      await card.getByText("Federal Election Commission", { exact: false }).first().waitFor();
      await page.screenshot({ path: `.scratch/ci/BL-20-${item.state.toLowerCase()}-incumbent-sources.png`, fullPage: true });
      await card.locator(".account-modal, .reader-card-body").evaluateAll(elements => elements.forEach(element => { element.scrollTop = 0; }));
      await page.screenshot({ path: `.scratch/ci/BL-20-${item.state.toLowerCase()}-incumbent.png`, fullPage: true });
      await page.keyboard.press("Escape");
      const challengerId = ballots[index]!.candidacies[1]!.id;
      await page.locator(`[data-fixture-candidate="${challengerId}"]`).getByRole("button", { name: "View Battlecard", exact: true }).click();
      const challenger = page.getByRole("dialog", { name: item.challenger, exact: true });
      assert.match(await challenger.innerText(), /Challenger/);
      assert.equal(await challenger.locator("img").evaluate(async image => { const img = image as HTMLImageElement; await img.decode(); return img.naturalWidth; }), 128);
      await page.screenshot({ path: `.scratch/ci/BL-20-${item.state.toLowerCase()}-challenger.png`, fullPage: true });
      await page.keyboard.press("Escape");
      assert.ok(requests.includes(`/api/profile/${encodeURIComponent(item.incumbent)}`));
      assert.ok(requests.includes(`/api/positions/${encodeURIComponent(item.incumbent)}/water?${new URLSearchParams({ division: `ocd-division/country:us/state:${item.state.toLowerCase()}` })}`));
      assert.ok(requests.includes(`/api/official-actions/${encodeURIComponent(item.incumbent)}?${new URLSearchParams({ division: `ocd-division/country:us/state:${item.state.toLowerCase()}` })}`));
    }
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser?.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
