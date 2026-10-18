import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createElement, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GET } from "../app/api/votes/route.ts";
import { POST } from "../app/api/ask/grounded/route.ts";
import { RecentVoteRecords, type MemberRollCall } from "../components/map/popup/official-popup.tsx";
import { CardSourcesContribution } from "../components/ui/card-sources-contribution.tsx";
import { CardSourcesList } from "../components/officials/card-sources-list.tsx";
import type { CardSource } from "../lib/officials/card-sources.ts";
import { PLURAL_STATES } from "../lib/sources/plural/targets.ts";
import { normalize, rowsToPeople } from "../lib/sources/plural/index.ts";
import { parsePluralBulkSession } from "../lib/sources/plural/vote-bulk.ts";
import { mergePluralVotes, pluralVotesScope, PLURAL_VOTES_SOURCE, type PluralVoteFact } from "../lib/sources/plural/votes.ts";
import { legiscanVotesScope } from "../lib/sources/legiscan/votes.ts";
import { readNativeMemberVotes, type NativeMemberVoteReaders } from "../lib/state-rollcalls/reader-votes.ts";
import { officialStateVotesRenderToReader, stateVoteStateForMember } from "../lib/state-rollcalls/reader-vote-visibility.ts";
import { voteEvidenceForIncludingHistory } from "../lib/ask/votes.ts";
import { composePersonVotes, readerPersonVotesQuestion, readerPersonVoteOfficials, topicTerms } from "../lib/ask/person-votes.ts";
import { resetGroundedState } from "../lib/ask/grounded-state.ts";
import type { SeatHolder } from "../lib/officials/lookup.ts";
import type { StateVotesSnapshot } from "../lib/sources/legiscan/types.ts";
import { withReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";
import { installAbsent, installPromotedValue, installRegistryAuthority, installFederalVotes } from "./helpers/promoted-fixtures.ts";
import { readerText } from "./helpers/reader-markup.ts";
import type { ReaderAuthorityEdgeBundle } from "../lib/registry/runtime-edge.ts";
import { currentReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";









function promotedFixtureBundle(extra: ReaderAuthorityEdgeBundle = {}): ReaderAuthorityEdgeBundle {
  const current: ReaderAuthorityEdgeBundle = currentReaderAuthorityEdge() ?? {};
  return { stateAuthorities: current.stateAuthorities,
    ...(current.stateLegislators ? { stateLegislators: current.stateLegislators } : {}),
    ...extra, promoted: new Map([...(current.promoted ?? []), ...(extra.promoted ?? [])]) };
}


interface Sample {
  state: string; session: string; sourceUrl: string; fixtureArchive: string; fixtureArchiveSha256: string;
  personSource?: { fixture: string; url: string; sha256: string };
  readerExample?: { personId: string; voterName: string; personName: string; district: string; chamber: string; position: string; billNumber: string; billTitle: string; date: string; voteId: string };
}
const fixtureRoot = new URL("./fixtures/state-votes/openstates/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", fixtureRoot), "utf8")) as { capturedAt: string; states: Sample[] };
const nativePerson = "ocd-person/11111111-1111-1111-1111-111111111111";

const emptyReaders = (): NativeMemberVoteReaders => ({ holder: async () => null, nh: async () => null,
  official: async () => null, plural: async () => [], legiscan: async () => [] });

function holder(id: string, nativeIds: SeatHolder["nativeIds"] = {}, officeTitle = "State Senator"): SeatHolder {
  return { id, nativeIds, name: "Synthetic exact-identity edge case", officeTitle, partyLabel: null,
    termEnd: null, birthDate: null, websiteUrl: null, sourceUrl: null, provenance: null, email: null,
    phone: null, contactFormUrl: null, photoUrl: null, campaignUrl: null };
}

function vote(id = "synthetic-vote", overrides: Partial<PluralVoteFact & { position: string }> = {}): PluralVoteFact & { position: string } {
  return { id, billId: "synthetic-bill", billNumber: "SB 1", billTitle: "Synthetic identity edge case",
    session: "2026", organizationId: "synthetic-organization", chamber: "upper", date: "2026-09-01",
    motion: "Third reading", result: "pass", counts: [], positions: [{ personId: nativePerson, option: "yes", retrievedAt: manifest.capturedAt }],
    unresolvedPositions: 0, sourceUrls: ["https://example.test/roll"], sourceApiUrl: "https://example.test/bill",
    retrievedAt: manifest.capturedAt, position: "yes", ...overrides };
}

function officialSnapshot(member: string, state: "AZ" | "NH" | "NJ", sourceId: "az-legislature" | "nh-general-court" | "nj-legislature"): StateVotesSnapshot {
  return { generatedAt: manifest.capturedAt, datasets: [], identifierMatch: { peopleSeen: 1, peopleMatched: 1, distinctOfficeholders: 1, byState: {} },
    positions: [{ officeholderId: member, legiscanPeopleId: 0, rollCallId: "official-roll", position: "NO", publisherPosition: "Nay" }],
    rollCalls: [{ id: "official-roll", sourceId, state, chamber: "Senate", session: "2026", sessionId: 1,
      billNumber: "SB 1", billTitle: "Official synthetic identity edge case", motion: "Third reading", date: "2026-09-01",
      yea: 0, nay: 1, absent: 0, nv: 0, result: "Failed", billUrl: "https://example.gov/bill",
      rollCallUrl: "https://example.gov/roll", retrievedAt: manifest.capturedAt }] };
}

function contributedSources(node: unknown): CardSource[] {
  if (Array.isArray(node)) return node.flatMap(contributedSources);
  if (!isValidElement<{ children?: unknown; sources?: CardSource[] }>(node)) return [];
  return node.type === CardSourcesContribution ? node.props.sources ?? [] : contributedSources(node.props.children);
}

test("every supported state accepts its exact Open States person ID and establishes one state boundary", () => {
  for (const state of PLURAL_STATES) {
    const member = `plural:${state}:${nativePerson.slice("ocd-person/".length)}`;
    assert.equal(officialStateVotesRenderToReader(member), true, state);
    assert.equal(stateVoteStateForMember(member), state.toUpperCase());
  }
  assert.equal(stateVoteStateForMember(nativePerson), null, "a global id needs the known seat's state");
  assert.equal(stateVoteStateForMember(nativePerson, "OH"), "OH");
  for (const member of ["plural:zz:11111111-1111-1111-1111-111111111111", "plural:ca:invalid", "body:county-council", "ballot-nj:senate:candidate"]) {
    assert.equal(officialStateVotesRenderToReader(member), false, member);
  }
});

test("real retained roll calls reach API, popup rows and Ask by exact native people across regions and a unicameral state", async () => {
  await installRegistryAuthority();
  await installFederalVotes();
  const samples = manifest.states.filter((row): row is Sample & { readerExample: NonNullable<Sample["readerExample"]> } => Boolean(row.readerExample));
  assert.deepEqual(samples.map(row => row.state).sort(), ["AZ", "GA", "IL", "NE", "NH", "WA"]);
  for (const sample of samples) {
    const source = sample.readerExample;
    const bytes = readFileSync(new URL(sample.fixtureArchive, fixtureRoot));
    const parsed = await parsePluralBulkSession(sample.state, sample.session, bytes, {
      requestedUrl: sample.sourceUrl, finalUrl: sample.sourceUrl, body: "", sha256: sample.fixtureArchiveSha256, retrievedAt: manifest.capturedAt,
    });
    const projection = mergePluralVotes(sample.state, null, parsed.votes);
    assert.equal(projection.rollCalls.length, 1, `${sample.state}: ${JSON.stringify(parsed.held)}`);
    assert.ok(sample.personSource);
    const people = rowsToPeople(readFileSync(new URL(sample.personSource.fixture, fixtureRoot), "utf8"), sample.state.toLowerCase());
    const division = `ocd-division/country:us/state:${sample.state.toLowerCase()}/sldu:${source.district}`;
    const linkedChamber = source.chamber === "legislature" && ["NE", "DC"].includes(sample.state) ? "upper" : source.chamber;
    const roster = normalize(people, new Map([[`${sample.state.toLowerCase()}|${linkedChamber}|${source.district}`, division]]), manifest.capturedAt, sample.state);
    assert.equal(roster.officeholders[0].nativeIds?.["ocd-person"]?.[0], source.personId);
    installPromotedValue({ recordClass: "STATE_ROLL_CALL", scope: pluralVotesScope(sample.state), sourceId: PLURAL_VOTES_SOURCE,
      versionId: `real-fixture:${sample.state}`, value: projection, retrievedAt: manifest.capturedAt });
    installAbsent("STATE_ROLL_CALL", legiscanVotesScope(sample.state));
    const member = `plural:${sample.state.toLowerCase()}:${source.personId.slice("ocd-person/".length)}`;
    await withReaderAuthorityEdge(promotedFixtureBundle({ edgeOnly: true, stateLegislators: {
      load: async () => ({ versionId: `real-people-fixture:${sample.state}`, value: {
        formatVersion: 1, sourceId: "plural-openstates", jurisdiction: `US-${sample.state}` as `US-${string}`,
        term: sample.session, generatedAt: manifest.capturedAt, roster,
      } }),
    } }), async () => {
      const response = await GET(new Request(`https://meanwhile.test/api/votes?member=${member}`));
      assert.equal(response.status, 200, sample.state);
      const payload = await response.json() as { votes: MemberRollCall[]; count: number; authorityScope: string; attribution: { text: string; url: string } };
      assert.equal(payload.authorityScope, `US-${sample.state}`);
      assert.equal(payload.count, 1);
      assert.equal(payload.votes[0].id, source.voteId);
      assert.equal(payload.votes[0].position, source.position);
      assert.equal(payload.votes[0].title, source.billTitle);
      assert.equal(payload.votes[0].date, source.date);
      const props = { votes: payload.votes, attribution: payload.attribution, failed: false, reactionContext: null };
      const markup = readerText(renderToStaticMarkup(createElement(RecentVoteRecords, props)));
      assert.ok(markup.includes(source.billTitle), sample.state);
      assert.match(markup, /Voted yes|Voted no|Recorded/);
      const sources = contributedSources(RecentVoteRecords(props));
      const sourcesMarkup = readerText(renderToStaticMarkup(createElement(CardSourcesList, { sources })));
      assert.match(sourcesMarkup, /Plural \/ Open States/);
      assert.doesNotMatch(sourcesMarkup, /undefined licence/);
      const evidence = await voteEvidenceForIncludingHistory(source.personName, { officeholderId: member, withinStates: [sample.state] });
      assert.equal(evidence.identity.kind, "JOINED");
      assert.equal(evidence.records.length, 1);
      assert.equal(evidence.records[0].rollCall?.position, source.position);
      const topic = topicTerms(source.billTitle)[0];
      assert.ok(topic, sample.state);
      const answer = composePersonVotes({ name: source.personName, topic, records: evidence.records });
      assert.ok(answer?.answer.includes(source.billNumber), sample.state);
      assert.deepEqual(answer?.citedUrls, [payload.votes[0].rollCallUrl]);
      resetGroundedState();
      const fetchImpl = globalThis.fetch;
      globalThis.fetch = async () => { throw new Error("the retained-source reader journey requires no live fetch"); };
      try {
        const started = performance.now();
        const response = await POST(new Request("https://meanwhile.test/api/ask/grounded", { method: "POST",
          headers: { "content-type": "application/json", origin: "https://meanwhile.test", host: "meanwhile.test", "x-wtp-synthetic-run": "state-votes-reader-test" },
          body: JSON.stringify({ question: `How did my state senator vote on ${topic}?`, ocdIds: [division], today: "2026-10-13", surface: "MAP" }),
        }));
        const grounded = await response.json() as { mode: string; answer: string; subject: { id: string; name: string }; records: { rollCall?: { position: string } }[] };
        assert.equal(response.status, 200);
        assert.equal(grounded.mode, "GROUNDED_COMPOSED", `${sample.state}: ${JSON.stringify(grounded)}`);
        assert.equal(grounded.subject.id, member);
        assert.equal(grounded.subject.name, source.personName);
        assert.ok(grounded.answer.includes(source.billNumber));
        assert.ok(grounded.records.some(record => record.rollCall?.position === source.position));
        assert.ok(performance.now() - started < 3_000, `${sample.state}: the first requested Ask answer is usable within three seconds`);
        if (sample.state === "AZ") {
          const question = `How did my senator vote on ${topic}?`;
          const ask = async (activeSubjects: unknown[] = []) => {
            resetGroundedState();
            const response = await POST(new Request("https://meanwhile.test/api/ask/grounded", { method: "POST",
              headers: { "content-type": "application/json", origin: "https://meanwhile.test", host: "meanwhile.test", "x-wtp-synthetic-run": "state-votes-reader-test" },
              body: JSON.stringify({ question, ocdIds: [division], today: "2026-10-13", surface: "MAP", activeSubjects }),
            }));
            return response.json() as Promise<{ mode: string; subject?: { id: string }; answer?: string }>;
          };
          assert.equal((await ask()).mode, "CLARIFY", "two federal senators and one state senator require a choice");
          const focused = await ask([{ id: member, name: source.personName, kind: "PERSON", focused: true }]);
          assert.equal(focused.mode, "GROUNDED_COMPOSED");
          assert.equal(focused.subject?.id, member, "the exact focused state legislator supplies the context");
          assert.ok(focused.answer?.includes(source.billNumber));
        }
      } finally { globalThis.fetch = fetchImpl; }
      const stranger = await readNativeMemberVotes(`plural:${sample.state.toLowerCase()}:00000000-0000-4000-8000-000000000999`);
      assert.equal(stranger?.votes.length, 0, "a real roll call never transfers through a display name");
    });
  }
});

test("exact linked official roll calls retain precedence in AZ, NH and NJ", async () => {
  for (const [state, source] of [["AZ", "az-legislature"], ["NH", "nh-general-court"], ["NJ", "nj-legislature"]] as const) {
    const member = `plural:${state.toLowerCase()}:${nativePerson.slice("ocd-person/".length)}`;
    const native = `${source}:123`;
    const readers = emptyReaders();
    readers.holder = async () => holder(member, { "ocd-person": [nativePerson], [source]: ["123"] });
    readers.nh = async id => { assert.equal(id, native); return { snapshot: officialSnapshot(native, state, source), versionId: "official-held" }; };
    readers.official = async scope => { assert.equal(scope, `US-${state}`); return { snapshot: officialSnapshot(native, state, source), versionId: "official-held" }; };
    readers.plural = async (scope, person) => { assert.equal(scope, state); assert.equal(person, nativePerson); return [vote()]; };
    readers.legiscan = async () => [vote("legiscan:roll")];
    const read = await readNativeMemberVotes(member, readers);
    assert.equal(read?.votes.length, 1, state);
    assert.equal(read?.votes[0].position, "Nay", state);
    assert.equal(read?.votes[0].rollCallUrl, "https://example.gov/roll");
    assert.equal(read?.attribution, null);
  }
});

test("one national source failure preserves the other source's votes and CC BY attribution", async () => {
  const readers = emptyReaders();
  readers.plural = async () => { throw new Error("unavailable Open States store"); };
  readers.legiscan = async () => [vote("legiscan:roll", { position: "Yea" })];
  const member = `plural:ca:${nativePerson.slice("ocd-person/".length)}`;
  const read = await readNativeMemberVotes(member, readers);
  assert.equal(read?.status, "HELD");
  assert.deepEqual(read?.unavailableScopes, [pluralVotesScope("CA")]);
  assert.equal(read?.votes[0].position, "Yea");
  assert.equal(read?.attribution && "licence" in read.attribution ? read.attribution.licence : null, "CC BY 4.0");
  const evidence = await voteEvidenceForIncludingHistory("Synthetic legislator", { officeholderId: member }, readers);
  assert.equal(evidence.records.length, 1);
  assert.ok(evidence.gaps.some(row => row.statement.includes("Some sources")));
  readers.legiscan = async () => { throw new Error("unavailable LegiScan store"); };
  assert.equal((await readNativeMemberVotes(member, readers))?.status, "HOLDING_UNAVAILABLE");
});

test("same-day repeated roll calls stay distinct and ambiguous person crosswalks never attach votes", async () => {
  const readers = emptyReaders();
  readers.plural = async () => [vote("roll:first"), vote("roll:second")];
  readers.legiscan = async () => [vote("legiscan:roll")];
  const read = await readNativeMemberVotes(`plural:oh:${nativePerson.slice("ocd-person/".length)}`, readers);
  assert.equal(read?.votes.length, 3, "matching event text cannot disambiguate a repeated roll");
  readers.holder = async () => holder("az-legislature:123", { "ocd-person": [nativePerson, nativePerson.replace(/1/g, "2")] });
  readers.plural = async () => { assert.fail("ambiguous native person identity"); };
  readers.legiscan = async () => { assert.fail("ambiguous native person identity"); };
  assert.equal((await readNativeMemberVotes("az-legislature:123", readers))?.votes.length, 0);
});

test("my legislative-office vote questions use held district seats and keep ambiguous senators separate", () => {
  const ask = readerPersonVotesQuestion("How did my state senator vote on the budget?");
  assert.deepEqual(ask?.office.keys, ["state_senator"]);
  assert.equal(ask?.topic, "budget");
  const held = [holder("state-one"), holder("federal-one", {}, "U.S. Senator"), holder("federal-two", {}, "U.S. Senator")]
    .map(seat => ({ seat, divisionIds: ["ocd-division/country:us/state:ca/sldu:1"], bodyId: null, bodyName: null }));
  assert.deepEqual(readerPersonVoteOfficials(ask!, held).map(row => row.seat.id), ["state-one"]);
  const broad = readerPersonVotesQuestion("How did my senator vote on the budget?");
  assert.equal(readerPersonVoteOfficials(broad!, held).length, 3, "the reader must choose, unless an exact focused senator supplies context");
  for (const question of ["How did she vote on the budget?", "How did my governor vote on the budget?", "How did my state senator vote on the budget and schools?"]) {
    assert.equal(readerPersonVotesQuestion(question), null, question);
  }
});
