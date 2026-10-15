import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(import.meta.dirname, "..");
const entry = fileURLToPath(import.meta.url);
const arg = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const directory = resolve(arg("directory") ?? "/tmp/ballot-scale");
const mode = arg("mode") ?? "run";
const now = new Date().toISOString();
const size = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
type Statement = { query: string; params: unknown[] };
type Transfer = { requests: number; receivedBytes: number; sentBytes: number; mutationRequestBytes: number };
const zero = (): Transfer => ({ requests: 0, receivedBytes: 0, sentBytes: 0, mutationRequestBytes: 0 });
interface SqlConnection {
  connect(): Promise<void>;
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; fields: { name: string; dataTypeID: number }[]; rowCount: number }>;
  query(options: { text: string; values: unknown[]; rowMode: "array" }): Promise<{ rows: unknown[][]; fields: { name: string; dataTypeID: number }[]; rowCount: number }>;
}

async function database() {
  const { Client } = await import(arg("pg-module") ?? "pg") as { Client: new (options: object) => SqlConnection };
  const pg = new Client({ host: "127.0.0.1", port: Number(arg("postgres-port") ?? 55430), user: "scale", password: "scale", database: "scale" });
  await pg.connect();
  const schema = arg("database-key") ?? "ballot_scale";
  assert.match(schema, /^ballot_scale[\w]*$/);
  await pg.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  await pg.query(`SET search_path TO ${schema}`);
  const initialized = (await pg.query("SELECT to_regclass('civic_data_candidates') AS name")).rows[0].name;
  if (!initialized) for (const file of ["0025_typical_fixer", "0028_wise_ikaris", "0031_civic_payload_parts", "0035_r1_fact_store"]) {
    await pg.query(await readFile(resolve(root, `lib/db/migrations/${file}.sql`), "utf8"));
  }
  if (!(await pg.query("SELECT to_regclass('database_transfer_daily') AS name")).rows[0].name) {
    await pg.query(await readFile(resolve(root, "lib/db/migrations/0030_database_transfer_daily.sql"), "utf8"));
  }
  const execute = async (statement: Statement) => {
    const result = await pg.query({ text: statement.query, values: statement.params, rowMode: "array" });
    return { command: statement.query.trim().split(/\s+/)[0].toUpperCase(), rowCount: result.rowCount,
      rowAsArray: true, fields: result.fields,
      rows: result.rows.map(row => row.map(value => {
        return value === null ? null : value instanceof Date ? value.toISOString() :
          typeof value === "object" ? JSON.stringify(value) : typeof value === "boolean" ? value ? "t" : "f" : String(value);
      })) };
  };
  let pending = Promise.resolve();
  const server = createServer(async (request, response) => {
    let release: (() => void) | undefined;
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString()) as Statement & { queries?: Statement[] };
      const prior = pending;
      pending = new Promise<void>(done => { release = done; });
      await prior;
      const result = body.queries ? await (async () => {
        await pg.query("BEGIN");
        const results = [];
        try { for (const statement of body.queries!) results.push(await execute(statement)); }
        catch (error) { await pg.query("ROLLBACK"); throw error; }
        await pg.query("COMMIT");
        return { results };
      })() : await execute(body);
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result));
    } catch (error) {
      await pg.query("ROLLBACK");
      response.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ message: String(error) }));
    } finally { release?.(); }
  });
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    console.log(`DATABASE_PORT=${address.port}`);
  });
}

async function generate() {
  const { parseCsv } = await import("../lib/reference/csv.ts");
  const { BALLOT_STATES } = await import("../lib/ballot/state-scopes.ts");
  const groups = new Map<string, Record<string, string>[]>();
  for (const file of ["census_govt_units_2022", "census_govt_units_2022_dependent_school_systems"]) {
    const [headers, ...records] = parseCsv(await readFile(resolve(root, `data/reference/${file}.csv`), "utf8"));
    for (const values of records) {
      const row = Object.fromEntries(headers.map((key, index) => [key, values[index]]));
      const state = row.state || (row.fips_state === "48" ? "TX" : "");
      assert.ok(BALLOT_STATES.includes(state as typeof BALLOT_STATES[number]));
      const held = groups.get(state) ?? [];
      held.push(row); groups.set(state, held);
    }
  }
  const counts = [];
  await mkdir(directory, { recursive: true });
  for (const state of BALLOT_STATES) {
    const input = JSON.parse(await readFile(resolve(root, `data/ballot/2026-general/${state.toLowerCase()}.json`), "utf8"));
    const ballot = Object.values(input.ballots)[0] as import("../lib/ballot/types.ts").BallotSet;
    const governments = groups.get(state)!;
    const sourceUrl = `https://scale.example.gov/${state.toLowerCase()}/official-ballot`;
    const provenance = { sourceUrl, sourceOrg: `Synthetic ${state} election authority`, collectedAt: now, verifiedAt: now };
    for (const government of governments) {
      const id = `scale-${state.toLowerCase()}-${government.census_id_pid6}`;
      const ocdId = `ocd-division/country:us/${state === "DC" ? "district" : "state"}:${state.toLowerCase()}/place:${id}`;
      ballot.contests.push({ id, electionId: ballot.election.id, ocdId, divisionVintage: "2022 Census benchmark",
        title: `${government.unit_name} Governing Board`, type: "CANDIDACY", candidateListComplete: true,
        voteFor: 5, termYears: 4, scopeNote: null, provenance });
      for (let index = 0; index < 10; index++) ballot.candidacies.push({ id: `${id}-candidate-${index}`, contestId: id,
        givenName: `Candidate ${index}`, familyName: `Government ${government.census_id_pid6}`, partyLabel: null,
        slogan: null, incumbent: index < 5, websiteUrl: null, provenance });
      const measure = `${id}-measure`;
      ballot.contests.push({ id: measure, electionId: ballot.election.id, ocdId, divisionVintage: "2022 Census benchmark",
        title: `${government.unit_name} Local Question`, type: "MEASURE", voteFor: 1, termYears: null, scopeNote: null, provenance });
      ballot.measures.push({ id: `${measure}-text`, contestId: measure, questionText: "Synthetic load input: " + "The district shall provide the services described in the adopted public plan. ".repeat(8),
        officialStatement: "Synthetic benchmark input; never published to a live service.", provenance });
    }
    input.sourceReceipt.sources.push({ requestedUrl: sourceUrl, finalUrl: sourceUrl, publisher: provenance.sourceOrg,
      sourceClass: "ELECTION_AUTHORITY", retrievedAt: now, httpStatus: 200, rawHash: createHash("sha256").update(state).digest("hex"),
      reviewedEvidence: "Synthetic benchmark: ten candidates for a five-seat board and one local measure per Census government or dependent school system." });
    input.sourceReceipt.reviewedAt = now;
    const encoded = JSON.stringify(input);
    await writeFile(resolve(directory, `${state.toLowerCase()}.json`), encoded);
    counts.push({ state, governments: governments.length, contests: ballot.contests.length, candidates: ballot.candidacies.length,
      measures: ballot.measures.length, bytes: Buffer.byteLength(encoded), division: `ocd-division/country:us/${state === "DC" ? "district" : "state"}:${state.toLowerCase()}/place:scale-${state.toLowerCase()}-${governments[0].census_id_pid6}` });
  }
  assert.equal(counts.reduce((total, row) => total + row.governments, 0), 92_150);
  await writeFile(resolve(directory, "input-counts.json"), JSON.stringify({ at: now, governments: 90_837, dependentSchoolSystems: 1_313,
    syntheticAssumption: "Every listed government or dependent school system: five-seat contest with ten candidates, plus one measure; retained official state samples are included unchanged.", states: counts }, null, 2));
  console.log(JSON.stringify({ states: counts.length, governments: 92_150, inputBytes: counts.reduce((sum, row) => sum + row.bytes, 0), largest: [...counts].sort((a, b) => b.bytes - a.bytes)[0] }));
}

async function generateAuxiliary() {
  const inputs = JSON.parse(await readFile(resolve(directory, "input-counts.json"), "utf8"));
  const totals = [];
  for (const { state } of inputs.states as { state: string }[]) {
    const input = JSON.parse(await readFile(resolve(directory, `${state.toLowerCase()}.json`), "utf8"));
    const ballot = Object.values(input.ballots)[0] as import("../lib/ballot/types.ts").BallotSet;
    const candidates = ballot.candidacies.filter(row => row.id.startsWith("scale-"));
    const contests = ballot.contests.filter(row => row.id.startsWith("scale-") && row.type === "CANDIDACY");
    const sourceUrl = `https://scale.example.gov/${state.toLowerCase()}/candidate-profiles`;
    const profiles = { cards: { curatedAt: now, note: "Synthetic scale input", hunts: [], cards: Object.fromEntries(candidates.map(row =>
      [`ballot-${state.toLowerCase()}-${row.id}`, { photoUrl: null, photoSource: null, bio: "Synthetic biography: " + "Public service and community experience. ".repeat(12),
        bioSourceUrl: sourceUrl, bioSourceLabel: "Synthetic official biography", email: null, phone: null, phoneLabel: null, filedAddress: null, filedAddressSource: null }])) },
    links: { curatedAt: now, note: "Synthetic scale input", links: {}, hunts: [] } };
    const profileReceipt = { contractVersion: 1, reviewedAt: now, reviewedBy: "ballot-scale", sources: [{
      requestedUrl: sourceUrl, finalUrl: sourceUrl, publisher: "Synthetic official candidate biographies", sourceClass: "OFFICIAL_PUBLISHER",
      retrievedAt: now, httpStatus: 200, rawHash: createHash("sha256").update(state).digest("hex"), reviewedEvidence: "Synthetic benchmark biographies." }] };
    const documents = contests.map(row => {
      const key = `ballot-${state.toLowerCase()}-${row.id}-candidate-0`;
      const text = `Synthetic publication for ${key}: ` + "The candidate describes public services, budgets, schools and local responsibilities. ".repeat(30);
      const hash = createHash("sha256").update(text).digest("hex");
      return { id: `${key}@${hash}`, candidateKey: key, sourceClass: "OFFICIAL_SITE", basis: "STATED_IN_FILING", metaDescription: null,
        documentUrl: `https://scale.example.gov/${state.toLowerCase()}/publications/${row.id}`, contentHash: hash,
        retrievedAt: now, contentType: "text/html", text, extraction: "html", extractionNote: null };
    });
    const corpusReceipt = { contractVersion: 1, reviewedAt: now, reviewedBy: "ballot-scale", sources: documents.map(row => ({
      requestedUrl: row.documentUrl, finalUrl: row.documentUrl, publisher: "Synthetic official candidate publication", sourceClass: "OFFICIAL_PUBLISHER",
      retrievedAt: now, httpStatus: 200, rawHash: row.contentHash, reviewedEvidence: "Synthetic full-size candidate publication." })) };
    const voting = { generatedAt: now.slice(0, 10), jurisdictions: contests.map(row => ({ ocdId: row.ocdId,
      name: row.title, state, model: "ASSIGNED", election: "2026 General Election", sourceOrg: "Synthetic election authority",
      sourceUrl: `https://scale.example.gov/${state.toLowerCase()}/voting-sites`, collectedAt: now.slice(0, 10), refusal: null,
      sites: [0, 1].map(index => ({ id: `${row.id}-site-${index}`, name: `${row.title} Location ${index}`, address: `${index + 1} Public Plaza`,
        room: null, lat: null, lng: null, kind: "ELECTION_DAY", election: "2026 General Election", serves: row.title, hours: "7 a.m.–7 p.m." })) })) };
    const packages = {
      "candidate-profiles": { contractId: `candidate-profiles:${state}`, version: "2026-general", sourceThrough: now, sourceReceipt: profileReceipt, payload: profiles },
      "candidate-corpus": { contractId: `candidate-corpus:${state}`, version: "2026-general", sourceThrough: now, sourceReceipt: corpusReceipt,
        payload: { formatVersion: 1, fetchedAt: now, attempted: documents.length, documents, failures: [] } },
      "voting-sites": voting,
    };
    const counts: Record<string, number> = {};
    for (const [family, value] of Object.entries(packages)) {
      const encoded = JSON.stringify(value);
      await writeFile(resolve(directory, `${state.toLowerCase()}.${family}.json`), encoded);
      counts[family] = Buffer.byteLength(encoded);
    }
    const row = { state, profiles: candidates.length, publications: documents.length, votingSites: contests.length * 2, bytes: counts };
    totals.push(row);
    console.log(JSON.stringify(row));
  }
  await writeFile(resolve(directory, "auxiliary-counts.json"), JSON.stringify(totals, null, 2));
}

async function changeInput() {
  const { requireBallotState } = await import("../lib/ballot/state-scopes.ts");
  const state = requireBallotState(arg("state")!);
  const family = arg("family") ?? "ballot-contests";
  const path = resolve(directory, `${state.toLowerCase()}${family === "ballot-contests" ? "" : `.${family}`}.json`);
  const input = JSON.parse(await readFile(path, "utf8"));
  if (family !== "ballot-contests") {
    if (family === "candidate-profiles") {
      const key = Object.keys(input.payload.cards.cards)[0];
      input.payload.cards.cards[key].bio += ` Updated ${now}.`;
      input.sourceThrough = now;
      input.sourceReceipt.reviewedAt = now;
      input.sourceReceipt.sources[0].retrievedAt = now;
      input.sourceReceipt.sources[0].rawHash = createHash("sha256").update(JSON.stringify(input.payload)).digest("hex");
    } else if (family === "candidate-corpus") {
      const document = input.payload.documents[0];
      document.text += ` Updated ${now}.`;
      document.contentHash = createHash("sha256").update(document.text).digest("hex");
      document.id = `${document.candidateKey}@${document.contentHash}`;
      document.retrievedAt = now;
      const source = input.sourceReceipt.sources.find((row: { finalUrl: string }) => row.finalUrl === document.documentUrl);
      source.rawHash = document.contentHash;
      source.retrievedAt = now;
      input.sourceThrough = now;
      input.sourceReceipt.reviewedAt = now;
    } else {
      assert.equal(family, "voting-sites");
      input.jurisdictions[0].sites[0].room = `Updated ${now}`;
    }
    await writeFile(path, JSON.stringify(input));
    console.log(JSON.stringify({ state, family, changedRecords: 1 }));
    return;
  }
  const ballot = Object.values(input.ballots)[0] as import("../lib/ballot/types.ts").BallotSet;
  const contest = ballot.contests.find(row => row.id.startsWith("scale-") && row.type === "CANDIDACY")!;
  const sourceUrl = `https://scale.example.gov/${state.toLowerCase()}/updates/${contest.id}/${Date.now()}`;
  const priorSource = input.sourceReceipt.sources.find((row: { requestedUrl: string }) => row.requestedUrl === contest.provenance.sourceUrl);
  contest.provenance = { ...contest.provenance, sourceUrl, collectedAt: now, verifiedAt: now };
  const candidate = ballot.candidacies.find(row => row.contestId === contest.id)!;
  candidate.familyName += " Updated";
  for (const row of ballot.candidacies) if (row.contestId === contest.id) row.provenance = contest.provenance;
  input.sourceReceipt.sources.push({ ...priorSource, requestedUrl: sourceUrl, finalUrl: sourceUrl, retrievedAt: now,
    rawHash: createHash("sha256").update(JSON.stringify(candidate)).digest("hex") });
  input.sourceReceipt.reviewedAt = now;
  await writeFile(path, JSON.stringify(input));
  console.log(JSON.stringify({ state, changedContest: contest.id, changedCandidate: candidate.id }));
}

async function isolationSnapshot() {
  const { ballotInputHash, ballotInputStamp } = await import("../lib/civic-data/ballot-input.ts");
  const { ballotPublicationDue } = await import("../lib/civic-data/ballot-publication.ts");
  const { BALLOT_STATES, requireBallotState } = await import("../lib/ballot/state-scopes.ts");
  const { LocalFileArtifactStore } = await import("../lib/meetings/edge-store.ts");
  const authority = (await new LocalFileArtifactStore(resolve(directory, "edge")).readAuthorityManifest())!.manifest.stateAuthorities!;
  assert.equal(Object.keys(authority["ballot-contests"]!).length, 51);
  const hashes: Record<string, string> = {};
  for (const state of BALLOT_STATES) hashes[state] = await ballotInputHash(directory, state);
  const path = resolve(directory, "isolation-before.json");
  if (mode === "snapshot") {
    await writeFile(path, JSON.stringify({ hashes, authority }));
    console.log(JSON.stringify({ snapshottedStates: 51 }));
    return;
  }
  const before = JSON.parse(await readFile(path, "utf8"));
  const state = requireBallotState(arg("state")!);
  const changedFiles = BALLOT_STATES.filter(key => hashes[key] !== before.hashes[key]);
  assert.deepEqual(changedFiles, [state]);
  const changedAuthorities: string[] = [];
  for (const [family, states] of Object.entries(authority)) for (const [key, ref] of Object.entries(states)) {
    if (JSON.stringify(ref) !== JSON.stringify(before.authority[family]?.[key])) changedAuthorities.push(`${family}:${key}`);
  }
  assert.deepEqual(changedAuthorities, [`ballot-contests:${state}`]);
  const results = JSON.parse(await readFile(resolve(directory, arg("result-file")!), "utf8"));
  const latest = results.results.findLast((row: { state: string; family: string; phase: string }) =>
    row.state === state && row.family === "ballot-contests" && row.phase === "publish").result.report;
  assert.equal(latest.inputHash, hashes[state]);
  assert.equal(ballotPublicationDue(`ballot-contests:${state}`, await ballotInputStamp(directory, state), latest), false);
  console.log(JSON.stringify({ states: 51, changedFiles, changedAuthorities,
    unchangedNextPoll: { publicationDue: false, workerLaunches: 0, workerDatabaseBytes: 0 } }));
}

async function worker() {
  const state = arg("state")!;
  const phase = arg("phase") ?? "publish";
  const family = arg("family") ?? "ballot-contests";
  const { neonConfig } = await import("@neondatabase/serverless");
  const transfer = zero();
  const statements = new Map<string, Transfer>();
  const stateScopes = new Set<string>();
  const originalFetch = globalThis.fetch;
  neonConfig.fetchFunction = async (_url: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]) => {
    assert.ok(arg("port"));
    const body = String(init?.body);
    const parsed = JSON.parse(body) as Statement & { queries?: Statement[] };
    const queries = parsed.queries ?? [parsed];
    for (const statement of queries) for (const param of statement.params) if (typeof param === "string" &&
      /^US-[A-Z]{2}:(?:state-election-ballots|candidate-profiles|candidate-publications|voting-sites)$/.test(param)) {
      assert.ok(param.startsWith(`US-${state}:`), `Another state's scope crossed this worker: ${param}`);
      stateScopes.add(param);
    }
    const response = await originalFetch(`http://127.0.0.1:${arg("port")}`, { method: "POST", body });
    const bytes = new Uint8Array(await response.arrayBuffer());
    const mutation = queries.some(row => /\b(?:insert|update|delete)\b/i.test(row.query));
    const key = queries.map(row => (row.query.match(/(?:from|into|update)\s+"?(\w+)/i)?.[1] ?? "other")).join(",");
    const count = { requests: 1, receivedBytes: bytes.byteLength, sentBytes: Buffer.byteLength(body), mutationRequestBytes: mutation ? Buffer.byteLength(body) : 0 };
    for (const field of Object.keys(count) as (keyof Transfer)[]) transfer[field] += count[field];
    const held = statements.get(key) ?? zero();
    for (const field of Object.keys(count) as (keyof Transfer)[]) held[field] += count[field];
    statements.set(key, held);
    return new Response(bytes, { status: response.status, headers: { "content-type": "application/json" } });
  };
  const started = performance.now();
  const { requireBallotState, stateBallotScope, stateBallotContractId } = await import("../lib/ballot/state-scopes.ts");
  const { LocalFileArtifactStore } = await import("../lib/meetings/edge-store.ts");
  const heldArtifactStore = new LocalFileArtifactStore(resolve(directory, "edge"));
  const artifactTransfer = { manifestReads: 0, manifestReadBytes: 0, manifestWrites: 0, manifestWriteBytes: 0,
    meetingManifestReads: 0, meetingManifestReadBytes: 0, meetingManifestWrites: 0,
    reads: [] as { key: string; bytes: number }[], writes: [] as { key: string; bytes: number }[] };
  const artifactStore: import("../lib/meetings/edge-store.ts").ReaderArtifactStore = {
    kind: heldArtifactStore.kind,
    async readManifest() {
      const held = await heldArtifactStore.readManifest();
      artifactTransfer.meetingManifestReads++;
      artifactTransfer.meetingManifestReadBytes += held ? size(held.manifest) : 0;
      return held;
    },
    async readAuthorityManifest() {
      const held = await heldArtifactStore.readAuthorityManifest();
      artifactTransfer.manifestReads++;
      artifactTransfer.manifestReadBytes += held ? size(held.manifest) : 0;
      return held;
    },
    async writeManifest(manifest, etag) {
      artifactTransfer.meetingManifestWrites++;
      return heldArtifactStore.writeManifest(manifest, etag);
    },
    async writeAuthorityManifest(manifest, etag) {
      artifactTransfer.manifestWrites++;
      artifactTransfer.manifestWriteBytes += size(manifest);
      return heldArtifactStore.writeAuthorityManifest(manifest, etag);
    },
    async readBytes(key) {
      const bytes = await heldArtifactStore.readBytes(key);
      artifactTransfer.reads.push({ key, bytes: bytes?.byteLength ?? 0 });
      return bytes;
    },
    async readArtifact(key) {
      const artifact = await heldArtifactStore.readArtifact(key);
      artifactTransfer.reads.push({ key, bytes: artifact ? size(artifact) : 0 });
      return artifact;
    },
    async putImmutable(bytes, suffix) {
      const key = await heldArtifactStore.putImmutable(bytes, suffix);
      artifactTransfer.writes.push({ key, bytes: bytes.byteLength });
      return key;
    },
  };
  const authorityFamily = family === "candidate-corpus" ? "candidate-publications" : family;
  const beforeManifest = (await heldArtifactStore.readAuthorityManifest())?.manifest;
  const allowedArtifactKeys = new Set([beforeManifest?.stateAuthorities?.[authorityFamily as "ballot-contests"]?.[state]?.key]);
  const recordClassFor = { "ballot-contests": "BALLOT_CANDIDACY", "candidate-profiles": "CANDIDATE_PROFILE",
    "candidate-corpus": "CANDIDATE_PUBLICATION", "voting-sites": "VOTING_SITE" } as const;
  const recordClass = recordClassFor[family as keyof typeof recordClassFor];
  const scope = stateBallotScope(family as "ballot-contests", state);
  const division = arg("division")!;
  const ids = [division.split("/place:")[0], division];
  const government = division.split("/place:")[1];
  const targets = Array.from({ length: 10 }, (_, index) => `ballot-${state.toLowerCase()}-${government}-candidate-${index}`);
  let result: unknown;
  if (phase === "read") {
    const { ensureReaderAuthorityEdge } = await import("../lib/meetings/edge-serving.ts");
    const { withReaderAuthorityEdge, readPromotedEdgeFirst } = await import("../lib/registry/runtime-edge.ts");
    const { readerBallotSourcesForDivisions } = await import("../lib/ballot/reader-sources.ts");
    const manifest = (await artifactStore.readAuthorityManifest())!.manifest;
    const bundle = await ensureReaderAuthorityEdge(manifest, artifactStore, [authorityFamily as "ballot-contests"]);
    if (family === "ballot-contests") {
      const sources = await withReaderAuthorityEdge(bundle, () => readerBallotSourcesForDivisions(ids));
      const ballots = await Promise.all(sources.map(async row => row.source.normalize(await row.source.fetch())));
      assert.ok(ballots.some(ballot => ballot.contests.some(row => row.id === government)), "The exact requested government must reach the reader.");
      result = { sources: sources.length, placeBytes: size(ballots), contests: ballots.reduce((sum, ballot) => sum + ballot.contests.length, 0) };
    } else {
      const { readPromotedCivicData } = await import("../lib/civic-data/read-model.ts");
      const read = await withReaderAuthorityEdge(bundle, () => readPromotedEdgeFirst(recordClass, scope,
        options => readPromotedCivicData(recordClass, scope, options), "Benchmark state's auxiliary records"));
      assert.equal(read.kind, "PROMOTED");
      result = { statePayloadBytes: read.kind === "PROMOTED" ? size(read.value) : 0 };
    }
    assert.equal(transfer.requests, 0, "Published edge readers must not contact the database.");
  } else if (phase === "slice") {
    const { readPlacePointerSlice } = await import("../lib/civic-data/held-place-slices.ts");
    const read = await readPlacePointerSlice(recordClass, scope, ids, [], targets);
    assert.equal(read.kind, "PROMOTED");
    assert.ok(read.value);
    result = { placeBytes: size(read.value) };
  } else {
    const before = beforeManifest?.stateAuthorities ?? {};
    const { PostgresRoutineDataStore } = await import("../lib/civic-data/store.ts");
    const store = new PostgresRoutineDataStore();
    let publication: unknown;
    if (family === "ballot-contests") {
      const { runBallotPublication } = await import("./assemble-ballot-package.mts");
      const published = await runBallotPublication({ state: requireBallotState(state), directory, store, now });
      assert.equal(published.report.status, "PUBLISHED", JSON.stringify(published.report));
      assert.equal(published.report.heldContests?.filter(row => row.contestId.startsWith("scale-")).length ?? 0, 0,
        "Every generated government must publish its complete contest.");
      publication = published.report;
    } else {
      const { prepareManualProjectionSuccessor } = await import("../lib/civic-data/manual-successor.ts");
      const { processRegisteredManualCandidate } = await import("../lib/civic-data/promotion.ts");
      const input = JSON.parse(await readFile(resolve(directory, `${state.toLowerCase()}.${family}.json`), "utf8"));
      let candidate: import("../lib/civic-data/types.ts").RoutineCandidate;
      let expectedBaseVersionId: string | null;
      if (family === "voting-sites") {
        const { votingSitesCandidate } = await import("../lib/ballot/voting-sites-data-plane.ts");
        const prior = await store.readPromotion<import("../lib/ballot/voting-sites.ts").VotingSitesFile>(recordClass, scope);
        expectedBaseVersionId = prior?.versionId ?? null;
        const rawHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
        const url = input.jurisdictions[0].sourceUrl;
        candidate = votingSitesCandidate({ state, current: input, prior: prior?.payload ?? null, failures: [], successfulAuthorityReads: 1,
          carriedFromVersionId: expectedBaseVersionId,
          requestedUrl: url, finalUrl: url, retrievedAt: now,
          acquisition: [{ vaultKey: `scale/${rawHash}`, rawHash, byteLength: size(input), url, contentType: "application/json" }] });
      } else ({ candidate, expectedBaseVersionId } = await prepareManualProjectionSuccessor(input, store, now));
      assert.equal(recordClass, candidate.recordClass);
      const outcome = await processRegisteredManualCandidate(store, stateBallotContractId(family as "candidate-profiles" | "candidate-corpus" | "voting-sites", state), candidate, now, expectedBaseVersionId);
      assert.ok(outcome.promoted, JSON.stringify({ state: outcome.candidate.state, reason: outcome.candidate.failureDetail }));
      publication = { versionId: outcome.promoted.versionId, recordClass, records: candidate.civicRecords?.length };
    }
    const { publishRoutineReaderEdgeOutcome } = await import("../lib/civic-data/reader-edge-publication.ts");
    const published = await publishRoutineReaderEdgeOutcome(store, now, [{ recordClass, scope: stateBallotScope(family as "ballot-contests", state) }], { artifactStore });
    assert.ok(published.ok, JSON.stringify(published));
    const after = (await heldArtifactStore.readAuthorityManifest())!.manifest.stateAuthorities!;
    allowedArtifactKeys.add(after[authorityFamily as "ballot-contests"]?.[state]?.key);
    const changed: string[] = [];
    for (const [kind, states] of Object.entries(after)) for (const [key, ref] of Object.entries(states)) {
      if (JSON.stringify(before[kind as keyof typeof before]?.[key]) === JSON.stringify(ref)) continue;
      assert.equal(`${kind}:${key}`, `${authorityFamily}:${state}`, "Only the selected state's artifact may change.");
      changed.push(`${kind}:${key}`);
    }
    result = { report: publication, edge: published, changedAuthorities: changed };
  }
  assert.equal(artifactTransfer.meetingManifestReads, 0, "A state ballot worker must not read the national meeting manifest.");
  assert.equal(artifactTransfer.meetingManifestWrites, 0, "A state ballot worker must not write the national meeting manifest.");
  for (const read of artifactTransfer.reads) assert.ok(allowedArtifactKeys.has(read.key), `Unrelated artifact crossed this state worker: ${read.key}`);
  console.log("SCALE_RESULT=" + JSON.stringify({ state, family, phase, wallMs: performance.now() - started, peakRssBytes: process.resourceUsage().maxRSS * 1024,
    transfer, artifactTransfer, stateScopes: [...stateScopes], byTable: Object.fromEntries(statements), result }));
}

async function child(args: string[], env: NodeJS.ProcessEnv = process.env) {
  return new Promise<string>((resolveResult, reject) => {
    const process = spawn(globalThis.process.execPath, ["--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs", entry, ...args], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "", errors = "";
    process.stdout.on("data", bytes => { output += String(bytes); });
    process.stderr.on("data", bytes => { errors += String(bytes); });
    process.once("error", reject);
    process.once("exit", (code, signal) => code === 0 ? resolveResult(output) : reject(new Error(`${args.join(" ")}: ${code ?? signal}\n${errors}\n${output}`)));
  });
}

async function run() {
  const { admittedRuntimeChildEnvironment } = await import("../lib/civic-data/runtime-authority.ts");
  const inputs = JSON.parse(await readFile(resolve(directory, "input-counts.json"), "utf8")) as { states: { state: string; division: string; bytes: number }[] };
  const states = arg("states")?.split(",") ?? inputs.states.map(row => row.state);
  const results = [];
  for (const state of states) {
    const server = spawn(process.execPath, ["--experimental-strip-types", entry, "--mode=database",
      ...process.argv.slice(2).filter(value => /^--(?:pg-module|postgres-port|database-key)=/.test(value))], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    const port = await new Promise<string>((done, reject) => {
      let errors = "";
      server.stderr.on("data", value => { errors += String(value); });
      server.once("exit", code => reject(new Error(`Database exited ${code}: ${errors}`)));
      server.stdout.on("data", value => { const match = /DATABASE_PORT=(\d+)/.exec(String(value)); if (match) done(match[1]); });
    });
    try {
      for (const family of (arg("families") ?? "ballot-contests").split(",")) {
      const env = admittedRuntimeChildEnvironment({ capability: "MANUAL_CONTRACT", contract: `${family}:${state}`,
        parentEnv: { ...process.env, NODE_ENV: "development", WTP_RUNTIME_MODE: "staging", WTP_DB_ROLE: "local",
          NODE_USE_ENV_PROXY: "0", DATABASE_URL: "postgresql://scale:scale@localhost/scale", WTP_CONTROL_PLANE_DATABASE_URL: "postgresql://scale:scale@localhost/scale" } });
      for (const phase of (arg("phases") ?? "publish,read,slice").split(",")) {
        const output = await child(["--mode=worker", `--directory=${directory}`, `--state=${state}`, `--family=${family}`, `--phase=${phase}`, `--port=${port}`,
          `--division=${inputs.states.find(row => row.state === state)!.division}`], env);
        const line = output.split("\n").find(row => row.startsWith("SCALE_RESULT="));
        assert.ok(line, output);
        const result = JSON.parse(line.slice("SCALE_RESULT=".length));
        results.push(result);
        console.log(JSON.stringify({ state, family, phase, wallMs: result.wallMs, peakRssBytes: result.peakRssBytes, transfer: result.transfer }));
        await writeFile(resolve(directory, arg("result-file") ?? "results.json"), JSON.stringify({ input: inputs, results }, null, 2));
      }
      }
    } finally { server.kill(); }
  }
}

if (mode === "database") await database();
else if (mode === "generate") await generate();
else if (mode === "generate-auxiliary") await generateAuxiliary();
else if (mode === "change") await changeInput();
else if (mode === "snapshot" || mode === "verify-isolation") await isolationSnapshot();
else if (mode === "worker") await worker();
else if (mode === "run") await run();
else throw new Error(`Unknown mode: ${mode}`);
