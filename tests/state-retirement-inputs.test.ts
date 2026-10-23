import { retirementMemberKey } from "../lib/civic-data/state-retirement-proof.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareRetirementStateInputs, withRetirementSourceCursor, type StateRetirementOrigin } from "../lib/civic-data/state-retirement-inputs.ts";
import { partitionCivicPayload } from "../lib/civic-data/payload-codec.ts";
import { STATE_RETIREMENT_KEY_ENV, verifyStateRetirementUnitSeal } from "../lib/civic-data/state-retirement-proof.ts";
import { easternDay } from "../lib/db/transfer-by-caller.ts";
import { REGISTRY_STATES } from "../lib/civic-data/state-scopes.ts";

import type { GenericBallotProjection } from "../lib/ballot/generic-projection.ts";
import type { BallotSet } from "../lib/ballot/types.ts";

type Row = Record<string, unknown>;
test("retirement transfer accounting keeps Eastern calendar boundaries across daylight saving changes", () => {
  const cases = [
    ["2026-01-01T04:59:59.999Z", "2025-12-31"], ["2026-01-01T05:00:00Z", "2026-01-01"],
    ["2026-03-08T06:59:59Z", "2026-03-08"], ["2026-03-08T07:00:00Z", "2026-03-08"],
    ["2026-07-01T03:59:59Z", "2026-06-30"], ["2026-07-01T04:00:00Z", "2026-07-01"],
    ["2026-11-01T05:59:59Z", "2026-11-01"], ["2026-11-01T06:00:00Z", "2026-11-01"],
    ["2026-11-02T04:59:59Z", "2026-11-01"], ["2026-11-02T05:00:00Z", "2026-11-02"],
    ["2024-02-29T05:00:00Z", "2024-02-29"],
  ];
  for (const rows of [cases, [...cases].reverse()]) for (const [at, day] of rows) assert.equal(easternDay(new Date(at)), day);
});

async function preparedInput(state: string, candidate: Row, origin: StateRetirementOrigin,
  parts: readonly { hash: string; payload: unknown }[] = [], partCalls = new Map<string, number>()) {
  const directory = await mkdtemp(join(tmpdir(), "state-retirement-fixture-"));
  const at = (params: readonly unknown[], omit: boolean): unknown => {
    let value: unknown = candidate;
    for (const key of params.slice(1, omit ? -1 : undefined)) value = (value as Row | undefined)?.[String(key)];
    return omit && value && typeof value === "object" ? Object.fromEntries(Object.entries(value).filter(([key]) => !(params.at(-1) as string[]).includes(key))) : value;
  };
  try {
    const plan = await prepareRetirementStateInputs({ directory, origins: [origin], env: { NODE_ENV: "test", [STATE_RETIREMENT_KEY_ENV]: "ab".repeat(32) }, query: async (sql, params) => {
      if (sql.includes("record_class IN ('STATE_LEGISLATOR'")) return [];
      if (sql.startsWith("SELECT c.id FROM civic_data_promotions")) return [{ id: origin.versionId }];
      if (sql.includes("validation_receipt-'excludedFacts'")) return [{ receipt: { candidateId: origin.versionId, decision: "GOOD" } }];
      if (sql.includes("civic_data_candidate_events")) return [];
      if (sql.includes("civic_data_payload_parts")) return (params[0] as string[]).map(hash => { partCalls.set(hash, (partCalls.get(hash) ?? 0) + 1); return parts.find(part => part.hash === hash)!; });
      const value = at(params, sql.includes("::text[] AS value"));
      if (sql.startsWith("SELECT jsonb_typeof")) return [{ type: value == null ? null : Array.isArray(value) ? "array" : "object", value: value && typeof value === "object" && "$civicPayloadPart" in value ? value : null }];
      return [{ value }];
    }, streamRows: async (sql, params, onRow) => {
      const value = at(params, false);
      if (Array.isArray(value)) for (const row of value) await onRow({ value: row });
      else for (const [key, row] of Object.entries((value ?? {}) as Row)) await onRow({ key, value: row });
    } });
    assert.deepEqual(plan.unassigned, []);
    const unit = plan.units.find(unit => unit.state === state)!, bytes = await readFile(unit.inputFile);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), unit.fileSha256);
    return { units: plan.units, unit: JSON.parse(bytes.toString("utf8")) as {
      payload: GenericBallotProjection; members: { path: string[]; key: string; value: Row; patch?: "identity" }[];
    } };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
async function preparedLegacyBallot(scope: string, payload: Row, aggregate?: BallotSet["sourceAggregates"]) {
  const state = ((payload.ballot as Row).election as Row).state as string, source = aggregate?.[0];
  const origin: StateRetirementOrigin = { family: "ballot-contests", recordClass: state === "NJ" ? "BALLOT_FILING" : "BALLOT_CANDIDACY", scope, versionId: source?.id ?? "legacy", promotedAt: "2026-10-01", hash: "legacy-hash" };
  const { unit } = await preparedInput(state, { id: origin.versionId, scope, sourceId: source?.sourceId ?? "official", readModel: payload, retrieval: source?.retrieval,
    normalizedPayload: { rawDocumentCount: source?.rawDocumentCount }, identities: [], excludedFacts: [] }, origin);
  const identityPatches: { ballotKey: string; identity: Row }[] = [];
  for (const member of unit.members) {
    if (member.patch === "identity") { identityPatches.push({ ballotKey: member.path[1], identity: member.value }); continue; }
    let parent = unit.payload as unknown as Row;
    for (const key of member.path.slice(0, -1)) parent = parent[key] as Row;
    (parent[member.path.at(-1)!] as unknown[]).push(member.value);
  }
  return { payload: unit.payload, identityPatches };
}
const provenance = { sourceOrg: "Official election office", sourceUrl: "https://official.example/filing.pdf", collectedAt: "2026-07-16" };
const ballot = (state: string) => ({ election: { id: `${state}-2026`, state, date: "2026-11-03", name: "General election" }, contests: [], candidacies: [], measures: [], absences: [] });

test("terminal inputs stream state records, preserve cross-state bodies and retain original source clocks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "state-retirement-test-"));
  const az = "ocd-division/country:us/state:az", nh = "ocd-division/country:us/state:nh", body = `${az}/place:shared`;
  const payload = { formatVersion: 1, registry: { generatedAt: "2026-10-01", divisions: [{ ocdId: az }, { ocdId: nh }], bodies: [{ id: body, ocdId: az, alsoServesOcdIds: [nh] }] },
    bodyRosters: [{ bodyId: body, members: [{ id: "held-person", name: "Held Person" }] }], rosterReaderDispositions: [], statewideExecutives: [],
    officialCandidacies: { rows: [] }, officialPhotos: { photos: [{ officeholderId: "held-person", url: "https://official.example/photo.jpg" }] }, rosterPhotos: {} };
  const origin: StateRetirementOrigin = { family: "registry-runtime", recordClass: "REGISTRY_RUNTIME_BINDING", scope: "US:reader-registry-runtime-bindings", versionId: "origin", promotedAt: "2026-10-01T00:00:00.123Z", hash: "original-hash" };
  const candidate: Row = { id: origin.versionId, scope: origin.scope, sourceId: "registry-reviewed-bindings", recordClass: origin.recordClass, readModel: payload,
    identities: [{ subjectId: body, jurisdiction: "US" }], excludedFacts: [], retrieval: { succeeded: true, retrievedAt: origin.promotedAt } };
  const streams: string[] = [];
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test", [STATE_RETIREMENT_KEY_ENV]: "ab".repeat(32) };
  const at = (params: readonly unknown[], omit: boolean): unknown => {
    let value: unknown = candidate;
    for (const key of params.slice(1, omit ? -1 : undefined)) value = (value as Row | undefined)?.[String(key)];
    return omit && value && typeof value === "object" ? Object.fromEntries(Object.entries(value).filter(([key]) => !(params.at(-1) as string[]).includes(key))) : value;
  };
  try {
    const plan = await prepareRetirementStateInputs({ directory, origins: [origin], env, query: async (sql, params) => {
      if (sql.includes("record_class IN ('STATE_LEGISLATOR'")) return [];
      if (sql.startsWith("SELECT c.id FROM civic_data_promotions")) return [{ id: origin.versionId }];
      if (sql.includes("validation_receipt-'excludedFacts'")) return [{ receipt: { candidateId: origin.versionId, decision: "GOOD" } }];
      if (sql.includes("civic_data_candidate_events")) return [{ sequence: 4, state: "PROMOTED", at: origin.promotedAt, detail: null }];
      const value = at(params, sql.includes("::text[] AS value"));
      if (sql.startsWith("SELECT jsonb_typeof")) return [{ type: value == null ? null : Array.isArray(value) ? "array" : "object", value: null }];
      return [{ value }];
    }, streamRows: async (sql, params, onRow) => {
      streams.push(sql); assert.doesNotMatch(sql, /LIMIT|e\.key>/);
      const value = at(params, false);
      if (Array.isArray(value)) for (const row of value) await onRow({ value: row });
      else for (const [key, row] of Object.entries((value ?? {}) as Row)) await onRow({ key, value: row });
    } });
    assert.deepEqual(plan.unassigned, []); assert.equal(plan.units.length, 56);
    for (const state of ["AZ", "NH"]) {
      const unit = plan.units.find(row => row.state === state)!;
      const held = JSON.parse(await readFile(unit.inputFile, "utf8"));
      const signed = { fileSha256: unit.fileSha256, originId: origin.versionId, originRecordClass: origin.recordClass,
        originScope: origin.scope, originReadModelHash: origin.hash, state, contractId: unit.contractId };
      verifyStateRetirementUnitSeal(signed, unit.seal, env);
      assert.throws(() => verifyStateRetirementUnitSeal({ ...signed, state: "NJ" }, unit.seal, env));
      assert.equal(held.promotedAt, origin.promotedAt);
      assert.deepEqual(held.payload.registry.bodies, []);
      const rows = held.members as { path: string[]; key: string; value: Row }[];
      assert.deepEqual(rows.filter(row => row.path.join("/") === "registry/divisions").map(row => row.value.ocdId), [state === "AZ" ? az : nh]);
      assert.equal(rows.find(row => row.path.join("/") === "registry/bodies")?.key, body);
      const roster = rows.find(row => row.path.join("/") === "bodyRosters")!;
      assert.deepEqual(roster.value.members, []);
      assert.equal(rows.find(row => row.path.join("/") === `bodyRosters/${body}/members`)?.value.name, "Held Person");
      assert.equal(rows.find(row => row.path.join("/") === "officialPhotos/photos")?.value.officeholderId, "held-person");
    }
    assert.ok(streams.some(sql => sql.includes("jsonb_array_elements")), "inline country arrays use a cursor rather than a full query result");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("the national ballot origin emits every jurisdiction while empty territory units invent no ballot facts", async () => {
  const heldContest = { id: "held:az", ocdId: "ocd-division/country:us/state:az", title: "Held Governor", provenance };
  const heldCandidate = { id: "held:az:candidate", contestId: heldContest.id, givenName: "Held", familyName: "Candidate", provenance };
  const original = { kind: "ballot-contests", ballots: { "AZ:AZ-2026": { ...ballot("AZ"), contests: [heldContest], candidacies: [heldCandidate] } } };
  const origin: StateRetirementOrigin = { family: "ballot-contests", recordClass: "BALLOT_CANDIDACY", scope: "US:state-election-ballots",
    versionId: "national-ballot", promotedAt: "2026-10-01", hash: "national-ballot-hash" };
  const candidate = { id: origin.versionId, scope: origin.scope, readModel: original, identities: [], excludedFacts: [] };
  const { unit: empty, units } = await preparedInput("PR", candidate, origin);
  assert.deepEqual(units.map(unit => unit.state), [...REGISTRY_STATES]);
  assert.equal(units.length, 56);
  for (const state of ["PR", "VI", "AS", "GU", "MP"]) {
    const unit = units.find(unit => unit.state === state)!;
    assert.equal(unit.contractId, `ballot-contests:${state}`);
    assert.equal(unit.scope, `US-${state}:state-election-ballots`);
    assert.equal(unit.originVersionId, origin.versionId);
  }
  assert.deepEqual(empty.payload, { kind: "ballot-contests", ballots: {} });
  assert.deepEqual(empty.members, []);
  const { unit: populated } = await preparedInput("AZ", candidate, origin);
  assert.deepEqual(populated.members.map(member => member.value), [heldContest, heldCandidate]);
});

test("legacy NH primaries and NJ filing sources convert without claiming a general list or a new capture", async () => {
  const filing = { id: "nh:held", contestId: "nh:contest", givenName: "Held", familyName: "Candidate", partyLabel: "Example", provenance };
  const nh = await preparedLegacyBallot("US-NH:merrimack:2026-general", { ballot: { ...ballot("NH"), candidacies: [filing] } });
  const held = nh.payload.ballots["NH:NH-2026"];
  assert.deepEqual(held.filingCandidacies, [filing]); assert.deepEqual(held.candidacies, []);
  const capture = { id: "old-nj", sourceId: "morris", scope: "US-NJ:county:morris:2026-general", rawDocumentCount: 3,
    retrieval: { succeeded: true, rawHash: "original-aggregate", requestedUrl: provenance.sourceUrl, finalUrl: provenance.sourceUrl, retrievedAt: provenance.collectedAt, httpStatus: 200 } };
  const contact = { candidacyId: "nj:held", email: "public@example.com", sourceUrl: provenance.sourceUrl, sourceOrg: provenance.sourceOrg, collectedAt: provenance.collectedAt };
  const nj = await preparedLegacyBallot(capture.scope, { ballot: ballot("NJ"), contacts: { contacts: [{ ...contact, givenName: "Held", familyName: "Candidate", route: "filing-county" }] } }, [capture]);
  assert.deepEqual(nj.payload.ballots["NJ:NJ-2026"].contacts, [contact]);
  assert.deepEqual(nj.payload.ballots["NJ:NJ-2026"].sourceAggregates, [capture]);
});

test("AZ filing aliases remain exact and identity-only nominees become patches rather than invented candidates", async () => {
  const core = { id: "old-core", contestId: "old-contest", givenName: "Held", familyName: "Candidate", partyLabel: "Example", provenance };
  const identity = { identityId: "identity:held", contestIdentityId: "identity:contest", canonicalCandidacyId: core.id, givenName: "Held", familyName: "Candidate", displayName: "Held Candidate", partyLabel: "Example", nameForms: [{ form: "held candidate" }] };
  const unjoined = { ...identity, identityId: "identity:nominee", canonicalCandidacyId: null, givenName: null, familyName: null, displayName: "Published Nominee", nameForms: [{ form: "published nominee" }] };
  const converted = await preparedLegacyBallot("US-AZ:2026-general:supported-ballot", { ballot: { ...ballot("AZ"), contests: [{ id: "old-contest", ocdId: "ocd-division/country:us/state:az" }], candidacies: [core] },
    candidateFilings: { contests: [{ id: "filing-contest", title: "Governor", publishedTitle: "Governor", provenance }], candidacies: [{ ...core, id: "filing-candidate", contestId: "filing-contest", heldIdentityJoin: { heldCandidacyId: core.id }, signaturesFiled: 123 }] },
    identityRegistry: { contests: [{ identityId: "identity:contest", canonicalContestIds: ["old-contest", "filing-contest"] }], candidates: [identity, unjoined] },
    measureAnalyses: { analyses: [{ contestId: "measure", text: "Saved analysis", contentHash: "held" }] } });
  const held = converted.payload.ballots["AZ:AZ-2026"];
  assert.equal(held.filingCandidacies?.[0].id, core.id);
  assert.equal(held.filingCandidacies?.[0].filing?.id, "filing-candidate");
  assert.equal(held.filingCandidacies?.[0].identity?.identityId, identity.identityId);
  assert.equal(held.filingCandidacies?.length, 1);
  assert.deepEqual(converted.identityPatches, [{ ballotKey: "AZ:AZ-2026", identity: unjoined }]);
  assert.equal(held.measureAnalyses?.analyses[0].text, "Saved analysis");
  assert.equal(retirementMemberKey(["lineupReconciliation", "rows"], { cardKey: "nominee:one", contestId: "contest" }), "nominee:one");
  assert.equal(retirementMemberKey([], { bodyId: "body", members: [] }), "body");
  assert.equal(retirementMemberKey(["officialCandidacies", "rows"], { holder: { id: "source-person" }, canonicalId: "canonical" }), "source-person");
});

test("retirement cursor fetches bounded pages and rolls back its read-only transaction", async () => {
  const calls: string[] = [], seen: number[] = []; let fetches = 0;
  await withRetirementSourceCursor({ query: async sql => { calls.push(sql); return { rows: sql.startsWith("FETCH") && fetches++ < 2 ? [{ value: fetches * 2 - 1 }, { value: fetches * 2 }] : [] }; } },
    async source => { await source.streamRows("SELECT value FROM held", [], async row => { seen.push(Number(row.value)); }); });
  assert.deepEqual(seen, [1, 2, 3, 4]); assert.equal(calls[0], "BEGIN READ ONLY"); assert.equal(calls.at(-1), "ROLLBACK");
  assert.ok(calls.filter(sql => sql.startsWith("FETCH")).every(sql => sql.startsWith("FETCH FORWARD 128 ")));
});

test("inline retirement records reach the spool with their owned containers intact", async () => {
  const source = { id: "held-inline", candidateKey: "az:held", text: "A".repeat(65_532) + "🗳️é\n".repeat(24_000),
    evidence: { url: "https://official.example/record", quotations: [{ text: "Exact held source text." }] } };
  const expected = JSON.parse(JSON.stringify(source)), observed = new Set<object>(), containers: object[] = [];
  const observe = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    containers.push(value);
    for (const child of Object.values(value)) observe(child);
    Object.defineProperty(value, "toJSON", { value(this: object) { assert.equal(this, value); observed.add(this); return this; } });
  };
  observe(source);
  const origin: StateRetirementOrigin = { family: "candidate-corpus", recordClass: "CANDIDATE_PUBLICATION", scope: "US:candidate-publications", versionId: "inline-origin", promotedAt: "2026-10-01", hash: "inline-hash" };
  const { unit } = await preparedInput("AZ", { id: origin.versionId, scope: origin.scope,
    readModel: { documents: [source], failures: [] }, identities: [], excludedFacts: [] }, origin);
  assert.deepEqual(unit.members.map(row => row.value), [expected]);
  assert.equal(observed.size, containers.length);
  for (const container of containers) assert.ok(observed.has(container), "serialization must use the original owned record and nested containers");
});

test("encoded retirement records reuse source parts without retaining the whole array", async () => {
  const source = Array.from({ length: 16 }, (_, i) => ({ id: `held-${i}`, candidateKey: "az:held", text: "saved source ".repeat(1400),
    evidence: { url: `https://official.example/record/${i}`, names: ["Held Candidate"] } }));
  const encoded = partitionCivicPayload(source), calls = new Map<string, number>();
  const before = JSON.stringify(encoded.parts);
  const freeze = (value: unknown): void => {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  };
  encoded.parts.forEach(part => freeze(part.payload));
  const origin: StateRetirementOrigin = { family: "candidate-corpus", recordClass: "CANDIDATE_PUBLICATION", scope: "US:candidate-publications", versionId: "corpus-origin", promotedAt: "2026-10-01", hash: "corpus-hash" };
  const { unit } = await preparedInput("AZ", { id: origin.versionId, scope: origin.scope, readModel: { documents: encoded.value, failures: [] }, identities: [], excludedFacts: [] }, origin, encoded.parts, calls);
  assert.deepEqual(unit.members.map(row => row.value), source);
  assert.equal(JSON.stringify(encoded.parts), before);
  assert.ok(calls.size > 0);
  assert.ok([...calls.values()].every(count => count === 1));
});

test("terminal preparation refuses a source whose pinned hash no longer matches its GOOD pointer", async () => {
  const directory = await mkdtemp(join(tmpdir(), "state-retirement-pin-"));
  try {
    await assert.rejects(prepareRetirementStateInputs({ directory, origins: [{ family: "ballot-contests", recordClass: "BALLOT_CANDIDACY",
      scope: "US:state-election-ballots", versionId: "pinned", promotedAt: "2026-10-01", hash: "pinned-hash" }],
      query: async (sql, params) => {
        if (sql.includes("record_class IN ('STATE_LEGISLATOR'")) return [];
        assert.match(sql, /c\.normalized_hash=\$4/); assert.equal(params[3], "pinned-hash"); return [];
      }, streamRows: async () => { throw new Error("Unproven source records must not be read"); } }), /STATE_RETIREMENT_ORIGIN_PROOF_CHANGED/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("derived retirement inputs retain only exact state citations and shared upstream pointers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "state-retirement-derived-"));
  const origin: StateRetirementOrigin = { family: "candidate-campaign-sites-derived", recordClass: "CURATED_READER_RECORD", scope: "US:candidate-campaign-sites-derived", versionId: "derived-origin", promotedAt: "2026-10-01", hash: "derived-hash" };
  const shared = { kind: "PROMOTED_VERSION", scope: "US:candidate-profiles", versionId: "upstream", readModelSha256: "source-hash" };
  const approved = (state: string) => ({ kind: "PIPELINE_APPROVAL", itemId: `approval-${state}`, recordId: `approval-${state}:reviewed`, approvedAt: "2026-10-01" });
  const capture = (state: string) => ({ kind: "VAULTED_EVIDENCE", artifactId: `artifact-${state}`, contentHash: `sha256-${state}`, tier: "RAW", retrievedAt: "2026-10-01" });
  const retrieval = { succeeded: true, rawHash: "original-aggregate", requestedUrl: "derived:original-pass", retrievedAt: "2026-10-01", derived: { inputs: [shared, approved("AZ"), capture("AZ"), approved("NH"), capture("NH"), approved("unused")] } };
  const exclusions = [{ code: "HELD", record: { key: "az:held" } }, { code: "UNASSIGNED", detail: "A saved exclusion without any jurisdiction evidence" }];
  const candidate: Row = { id: origin.versionId, scope: origin.scope, sourceId: "candidate-campaign-site-chain", recordClass: origin.recordClass, retrieval, identities: [], excludedFacts: exclusions,
    readModel: { kind: "candidate-campaign-sites-derived", records: ["AZ", "NH"].map(state => ({ id: `${state.toLowerCase()}:held`, campaign: { evidence: { approvalItemId: approved(state).itemId, approvalRecordId: approved(state).recordId, artifactId: capture(state).artifactId } } })) }, normalizedPayload: { decisions: {} } };
  const at = (params: readonly unknown[], omit: boolean): unknown => {
    let value: unknown = candidate;
    for (const key of params.slice(1, omit ? -1 : undefined)) value = (value as Row | undefined)?.[String(key)];
    return omit && value && typeof value === "object" ? Object.fromEntries(Object.entries(value).filter(([key]) => !(params.at(-1) as string[]).includes(key))) : value;
  };
  try {
    const plan = await prepareRetirementStateInputs({ directory, origins: [origin], env: { NODE_ENV: "test", [STATE_RETIREMENT_KEY_ENV]: "ab".repeat(32) }, query: async (sql, params) => {
      if (sql.includes("record_class IN ('STATE_LEGISLATOR'")) return [];
      if (sql.startsWith("SELECT c.id FROM civic_data_promotions")) return [{ id: origin.versionId }];
      if (sql.includes("validation_receipt-'excludedFacts'")) return [{ receipt: { candidateId: origin.versionId, decision: "GOOD" } }];
      if (sql.includes("civic_data_candidate_events")) return [];
      const value = at(params, sql.includes("::text[] AS value"));
      if (sql.startsWith("SELECT jsonb_typeof")) return [{ type: value == null ? null : Array.isArray(value) ? "array" : "object", value: null }];
      if (params[1] === "retrieval" && params.length === 3) assert.ok((params.at(-1) as string[]).includes("derived"), "never fetch the whole input array with retrieval metadata");
      return [{ value }];
    }, streamRows: async (sql, params, onRow) => {
      const value = at(params, false);
      if (Array.isArray(value)) for (const row of value) await onRow({ value: row });
      else for (const [key, row] of Object.entries((value ?? {}) as Row)) await onRow({ key, value: row });
    } });
    assert.deepEqual(plan.unassigned, [{ family: origin.family, field: "excludedFacts", id: 1, originVersionId: origin.versionId }]);
    for (const state of ["AZ", "NH", "NJ"]) {
      const held = JSON.parse(await readFile(plan.units.find(unit => unit.state === state)!.inputFile, "utf8"));
      assert.deepEqual(held.candidate.retrieval, { ...retrieval, derived: { inputs: state === "NJ" ? [] : [shared, approved(state), capture(state)] } });
      assert.deepEqual(held.candidate.excludedFacts, state === "AZ" ? [exclusions[0]] : []);
      assert.equal(held.originReadModelHash, origin.hash);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
