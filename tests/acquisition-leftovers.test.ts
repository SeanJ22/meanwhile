import { installPlaceMapQuery } from "../lib/place-map/reader.ts";
import { fixturePlaceMapQuery } from "./helpers/place-map.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { zip } from "../scripts/xlsx.mjs";
import { divisionsFromCensusGeographies, censusVintageFor } from "../lib/geo/census-geographies.ts";
import { parseCensusGeographies, censusGeographiesUrl } from "../lib/geo/census-geocoder.ts";
import { fecFundingCandidate } from "../lib/civic-data/candidate-builders.ts";
import { processRegisteredRoutineCandidate, processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { parseFecBulk } from "../lib/funding/fec-bulk.ts";
import { projectFecDiscovery } from "../lib/funding/fec-collector.ts";
import { stateCampaignFinanceCandidate, STATE_CAMPAIGN_FINANCE_SOURCES } from "../lib/funding/data-plane.ts";
import type { FundingSnapshot, SecondHopCommittee } from "../lib/funding/types.ts";
import type { StateMoneySnapshot } from "../lib/funding/state-money.ts";
import { acquireStatePeople } from "../lib/sources/plural/acquisition.ts";
import { PLURAL_REVISION_URL } from "../lib/sources/plural/targets.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { LocalFileArchiveStore } from "../lib/sources/prl/archive-store-local.ts";
import { requiredPrlDataset } from "../lib/sources/prl/inventory.ts";
import { openPrlSource } from "../lib/sources/prl/fetch-source.ts";
import { ingestDataset } from "../lib/sources/prl/ingest.ts";
import { installRegistryAuthority } from "./helpers/promoted-fixtures.ts";
import { withFetch } from "./helpers/with-fetch.ts";

const fixture = (path: string) => readFileSync(new URL(`./fixtures/${path}`, import.meta.url), "utf8");
const at = "2026-10-13T12:00:00.000Z";

test("R2B money: second-hop facts and cursor-only progress survive the unchanged confirmation path", async () => {
  await installRegistryAuthority();
  const master = fixture("fec-national/cn-2026.txt"), summary = fixture("fec-national/weball-2026.txt");
  const candidates = projectFecDiscovery(parseFecBulk(master, summary, 2026, at), 2026).slice(0, 2);
  let snapshot: FundingSnapshot = { formatVersion: 1, fetchedAt: at, cycle: 2026, candidates, absences: [], secondHop: [],
    matchReport: { rosterMatched: 0, rosterTotal: 0, ballotMatched: 0, ballotTotal: 0 } };
  const store = new MemoryRoutineDataStore();
  const publish = async (time: string) => processRegisteredRoutineCandidate(store, "fec-funding", fecFundingCandidate({ snapshot,
    rawBodies: [master, summary], finalUrl: "https://www.fec.gov/files/bulk-downloads/2026/cn26.zip", retrievedAt: time, excludedFacts: [] }), time);
  assert.ok((await publish(at)).promoted);
  const hop = JSON.parse(fixture("fec-national/second-hop.json")) as SecondHopCommittee;
  snapshot = { ...snapshot, secondHop: [hop] };
  const enriched = await publish("2026-10-13T13:00:00.000Z");
  assert.ok(enriched.promoted && !enriched.confirmed, JSON.stringify(enriched.candidate.receipt));
  assert.ok(enriched.candidate.candidate.changeSet?.added.some(row => row.key === `second-hop:${hop.committeeId}`));
  snapshot = { ...snapshot, refreshAttempts: { [candidates[0].fecCandidateId]: "2026-10-13T14:00:00.000Z" } };
  const progressed = await publish("2026-10-13T14:00:00.000Z");
  assert.ok(progressed.promoted && !progressed.confirmed);
  assert.deepEqual((progressed.promoted.payload as FundingSnapshot).refreshAttempts, snapshot.refreshAttempts);
  assert.ok((await publish("2026-10-13T15:00:00.000Z")).confirmed);

  const state = JSON.parse(fixture("state-money-2026.json")).AZ as StateMoneySnapshot;
  const contract = STATE_CAMPAIGN_FINANCE_SOURCES.AZ, money = new MemoryRoutineDataStore();
  const publishState = async (value: StateMoneySnapshot, time: string) => processRegisteredManualCandidate(money, contract.contractId,
    stateCampaignFinanceCandidate({ jurisdiction: "AZ", snapshot: value, rawBodies: [fixture("campaign-finance/azsos-seethemoney-summary-2026.json")],
      requestedUrl: "https://seethemoney.az.gov/Reporting/", finalUrl: "https://seethemoney.az.gov/Reporting/", retrievedAt: time,
      query: "source fixture filings", paginationComplete: false }), time);
  assert.ok((await publishState(state, "2026-09-01T12:00:00.000Z")).promoted);
  const cursor = { ...state, acquisitionCursors: { "az:2026:page": 2 } };
  const moved = await publishState(cursor, "2026-09-01T13:00:00.000Z");
  assert.ok(moved.promoted && !moved.confirmed, JSON.stringify(moved.candidate.receipt));
  assert.equal(moved.candidate.candidate.changeSet?.outcome, "UNCHANGED");
  assert.deepEqual((moved.promoted.payload as StateMoneySnapshot).acquisitionCursors, cursor.acquisitionCursors);
});

test("R2B address: three real redrawn-state addresses use their representation and election vintages", async () => {
  await installRegistryAuthority();
  const { POST } = await import("../app/api/address/resolve/route.ts");
  const representation = { purpose: "representation" as const, asOf: "2026-10-13" };
  const election = { purpose: "election" as const, asOf: "2026-10-13", electionDate: "2026-11-03" };
  assert.equal(censusVintageFor(representation), "ACS2025_Current");
  assert.equal(censusVintageFor(election), "Current_Current");
  const available = JSON.parse(fixture("census-geocoder-vintages.json")).vintages.map((row: { vintageName: string }) => row.vintageName);
  for (const selection of [representation, election]) assert.ok(available.includes(censusVintageFor(selection)));
  for (const state of ["oh", "nc", "tx"]) {
    for (const selection of [representation, election]) {
      const raw = JSON.parse(fixture(`census-address-${state}${selection.purpose === "representation" ? "-representation" : ""}.json`));
      const point = parseCensusGeographies(raw);
      assert.ok(point?.geographies);
      const vintage = censusVintageFor(selection), url = censusGeographiesUrl("public building", vintage);
      const divisions = divisionsFromCensusGeographies(point.geographies, selection, url, at);
      const cd = divisions.find(row => row.divisionType === "cd");
      assert.ok(cd?.geoid && cd.state === state.toUpperCase());
      const congress = selection.purpose === "representation" ? 119 : 120;
      assert.equal(cd.geoid, point.geographies[`${congress}th Congressional Districts`][0].GEOID);
      assert.ok(divisions.some(row => row.divisionType === "sldu") && divisions.some(row => row.divisionType === "sldl"));
      assert.equal(new URL(url).searchParams.get("layers"), "all");
      const wrong = divisionsFromCensusGeographies(point.geographies, selection.purpose === "representation" ? election : representation, url, at);
      assert.ok(!wrong.some(row => row.divisionType === "cd"), "the other plan cannot inherit certainty from this vintage");
      const mapRows = [representation,election].flatMap(plan => {
        const reply=JSON.parse(fixture(`census-address-${state}${plan.purpose === "representation" ? "-representation" : ""}.json`));
        const located=parseCensusGeographies(reply)!;
        return [{ocdId:`ocd-division/country:us/state:${state}`,label:state,state:state.toUpperCase(),divisionType:"state"},...divisionsFromCensusGeographies(located.geographies!,plan,censusGeographiesUrl("public building",censusVintageFor(plan)),at)].map(division=>({
          place_id:division.ocdId,name:division.label,state:division.state,layer:division.divisionType,
          version:division.divisionType === "cd" ? `cd:${plan.purpose === "representation" ? 119 : 120}` : `${division.divisionType}:2024`,
          boundary_year:plan.purpose === "representation" ? 2024 : 2026,partial:false,
          geometry:{type:"Polygon",coordinates:[[[located.lng-.001,located.lat-.001],[located.lng+.001,located.lat-.001],
            [located.lng+.001,located.lat+.001],[located.lng-.001,located.lat+.001],[located.lng-.001,located.lat-.001]]]},
        }));
      });
      let mapReads=0;
      const otherMapReads=fixturePlaceMapQuery();
      installPlaceMapQuery(async(sql,params)=>{if(sql.includes("WITH candidates AS MATERIALIZED")){mapReads++;return mapRows;}return otherMapReads(sql,params);});
      const matched = raw.result.addressMatches[0];
      const number = raw.result.input.address.address.split(" ")[0];
      const street = [matched.addressComponents.preDirection, matched.addressComponents.streetName,
        matched.addressComponents.suffixType, matched.addressComponents.suffixDirection].filter(Boolean).join(" ");
      const response = await withFetch((async input => {
        const url = new URL(String(input));
        assert.equal(url.pathname, "/geocoder/geographies/onelineaddress");
        assert.ok([vintage, "Current_Current"].includes(url.searchParams.get("vintage")!));
        return Response.json(url.searchParams.get("vintage") === "Current_Current"
          ? JSON.parse(fixture(`census-address-${state}.json`)) : raw);
      }) as typeof fetch, () => POST(new Request("https://wtp.test/api/address/resolve", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ zip: matched.addressComponents.zip, street: `${street}, ${matched.addressComponents.city}, ${matched.addressComponents.state}`,
          houseNumber: number, selection }),
      })));
      assert.equal(response.status, 200);
      const answer = await response.json();
      assert.equal(answer.resolution.status, "RESOLVED");
      assert.ok(answer.resolution.levels.find((row: { level: string }) => row.level === "cd").divisionIds.includes(cd.ocdId));
      assert.ok(answer.resolution.levels.some((row: { level: string }) => row.level === "county"));
      assert.equal(mapReads,1,"each resolved address uses one selected point lookup");
      installPlaceMapQuery(fixturePlaceMapQuery());
    }
  }
});

test("R2B outage: real OpenStates and PRL bytes remain usable without advancing their source checks", async () => {
  const revision = "5dce037cb7aa7aba1d6ebda5db9ae2bd4621e13d";
  const native = fixture("legiscan/openstates-alma-allen.yml");
  const archiveBytes = zip([{ name: `people-${revision}/data/tx/legislature/Alma-Allen.yml`, data: Buffer.from(native) }], "2026-10-13");
  const store = new MemoryEvidenceStore(), { locks } = createMemoryRepositories();
  let now = at, down = false;
  const options = { state: "tx", store, locks, divisions: [], now: () => now, signal: AbortSignal.timeout(30000),
    fetchImpl: (async url => down ? new Response("outage", { status: 503 }) : String(url) === PLURAL_REVISION_URL
      ? new Response(JSON.stringify([{ sha: revision }])) : new Response(archiveBytes)) as typeof fetch };
  const first = await acquireStatePeople(options);
  down = true; now = "2026-10-15T12:00:00.000Z";
  const held = await acquireStatePeople(options);
  assert.deepEqual(held.people, first.people);
  assert.equal(held.acquisitions[0].sourceCheck?.checkedAt, first.acquisitions[0].sourceCheck?.checkedAt);
  assert.ok(held.gaps.some(row => row.detail.includes("503")));
  const root = await mkdtemp(join(tmpdir(), "r2b-prl-"));
  try {
    const archive = new LocalFileArchiveStore(root), dataset = requiredPrlDataset("profiles-national");
    const bytes = zip([{ name: "profiles-all-national.csv", data: Buffer.from(fixture("prl/profiles-national.csv")) }], "2026-10-13");
    const first = await ingestDataset({ dataset, archive, now: Date.parse(at), priorReceipt: null,
      open: () => openPrlSource(dataset, (async () => new Response(bytes, { headers: { etag: '"source"' } })) as typeof fetch, archive) });
    let outage: string | undefined;
    const held = await ingestDataset({ dataset, archive, now: Date.parse(now), priorReceipt: first, open: async () => {
      const source = await openPrlSource(dataset, (async () => new Response("outage", { status: 503 })) as typeof fetch, archive, first.sourceSha256);
      outage = source.outage; return source;
    } });
    assert.ok(outage?.includes("503"));
    assert.equal(held.fetchedAt, first.fetchedAt);
    assert.deepEqual(held.profiles, first.profiles);
    assert.equal(held.rowsWritten, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});
