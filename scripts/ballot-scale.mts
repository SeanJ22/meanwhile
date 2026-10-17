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
const edgeDirectory = resolve(arg("edge-directory") ?? resolve(directory, "edge"));
const mode = arg("mode") ?? "run";
const now = new Date().toISOString();
const size = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
type ProductionUnit = {
  state: string;
  family: "ballot-contests" | "candidate-profiles" | "candidate-corpus" | "voting-sites" | "candidate-campaign-sites-derived" | "registry-runtime";
  contractId: string;
  inputFile?: string;
};
type Statement = { query: string; params: unknown[] };
type Transfer = { requests: number; receivedBytes: number; sentBytes: number; mutationRequestBytes: number };
const zero = (): Transfer => ({ requests: 0, receivedBytes: 0, sentBytes: 0, mutationRequestBytes: 0 });
type StageMarker = { id: number; label: string; phase: "start" | "end"; at: number; rssBytes: number; heapBytes: number; externalBytes: number; highWaterBytes: number; transfer?: Transfer };
type StageMeasurement = { id: number; label: string; wallMs: number; peakRssBytes: number; startRssBytes: number; endRssBytes: number;
  startHeapBytes: number; endHeapBytes: number; startExternalBytes: number; endExternalBytes: number; transfer?: Transfer };

function stageMarkers(transfer?: () => Transfer) {
  let nextId = 0;
  const active = new Map<string, number[]>();
  return (label: string, phase: "start" | "end", observedId?: number) => {
    const stack = active.get(label) ?? [];
    const id = phase === "start" ? ++nextId : observedId ?? stack.pop();
    assert.ok(id, `No matching stage start: ${label}`);
    if (phase === "start") stack.push(id);
    else if (observedId !== undefined) stack.splice(stack.indexOf(observedId), 1);
    active.set(label, stack);
    const memory = process.memoryUsage();
    const marker: StageMarker = { id, label, phase, at: performance.now(), rssBytes: memory.rss,
      heapBytes: memory.heapUsed, externalBytes: memory.external, highWaterBytes: process.resourceUsage().maxRSS * 1024,
      ...(transfer ? { transfer: transfer() } : {}) };
    process.stdout.write(`SCALE_STAGE=${JSON.stringify(marker)}\n`);
    return id;
  };
}
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
  if (!(await pg.query("SELECT to_regclass('civic_data_candidates_identity_idx') AS name")).rows[0].name) {
    for (const file of ["0026_lame_sunset_bain", "0027_pdc_candidate_history_shape", "0029_unchanged_confirmation_receipts"]) {
      const ddl = await readFile(resolve(root, `lib/db/migrations/${file}.sql`), "utf8");
      await pg.query(ddl.replaceAll('"public".', `"${schema}".`));
    }
  }
  if (!(await pg.query("SELECT to_regclass('database_transfer_daily') AS name")).rows[0].name) {
    await pg.query(await readFile(resolve(root, "lib/db/migrations/0030_database_transfer_daily.sql"), "utf8"));
  }
  if (!(await pg.query("SELECT to_regprocedure('reader_payload_node(jsonb)') AS name")).rows[0].name) {
    await pg.query(await readFile(resolve(root, "lib/db/migrations/0036_ne01.sql"), "utf8"));
  }
  const execute = async (statement: Statement) => {
    const result = await pg.query({ text: statement.query, values: statement.params, rowMode: "array" });
    return { command: statement.query.trim().split(/\s+/)[0].toUpperCase(), rowCount: result.rowCount,
      rowAsArray: true, fields: result.fields,
      rows: result.rows.map(row => row.map((value, index) => {
        return value === null ? null : [114, 3802].includes(result.fields[index].dataTypeID) ? JSON.stringify(value) : value instanceof Date ? value.toISOString().replace("T", " ").replace("Z", "+00") :
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
  const { REGISTRY_STATES } = await import("../lib/civic-data/state-scopes.ts");
  const groups = new Map<string, Record<string, string>[]>();
  for (const file of ["census_govt_units_2022", "census_govt_units_2022_dependent_school_systems"]) {
    const [headers, ...records] = parseCsv(await readFile(resolve(root, `data/reference/${file}.csv`), "utf8"));
    for (const values of records) {
      const row = Object.fromEntries(headers.map((key, index) => [key, values[index]]));
      const state = row.state || (row.fips_state === "48" ? "TX" : "");
      assert.ok(REGISTRY_STATES.includes(state as typeof REGISTRY_STATES[number]));
      const held = groups.get(state) ?? [];
      held.push(row); groups.set(state, held);
    }
  }
  const counts = [];
  await mkdir(directory, { recursive: true });
  for (const state of REGISTRY_STATES) {
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
      "candidate-profiles": { contractId: `candidate-profiles:${state}`, version: now, sourceThrough: now, sourceReceipt: profileReceipt, payload: profiles },
      "candidate-corpus": { contractId: `candidate-corpus:${state}`, version: now, sourceThrough: now, sourceReceipt: corpusReceipt,
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

async function generateWorkerFixture() {
  const state = arg("state")!;
  const sourceDirectory = resolve(arg("source-directory") ?? directory);
  const input = JSON.parse(await readFile(resolve(sourceDirectory, `${state.toLowerCase()}.json`), "utf8"));
  const ballot = Object.values(input.ballots)[0] as import("../lib/ballot/types.ts").BallotSet;
  const contests = ballot.contests.filter(row => row.id.startsWith("scale-") && row.type === "CANDIDACY");
  const divisions = contests.map(row => ({ state, label: `${row.title} ${row.id}`, ocdId: row.ocdId, sourceDataset: "2022 Census benchmark" }));
  const fields = ["election", "electionDate", "office", "jurisdictionName", "candidateName", "givenName", "familyName"];
  const names = ["Avery", "Blake", "Casey", "Drew", "Emery", "Finley", "Gray", "Harper", "Indigo", "Jordan"];
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const rows = contests.flatMap((contest, at) => names.map(name => ["2026 General Election", "2026-11-03", contest.title,
    divisions[at].label, `${name} Benchmark`, name, "Benchmark"].map(quote).join(",")));
  const source = `${fields.join(",")}\n${rows.join("\n")}\n`;
  ballot.contests = ballot.contests.filter(row => !row.id.startsWith("scale-") || row.type !== "CANDIDACY");
  ballot.candidacies = ballot.candidacies.filter(row => !row.id.startsWith("scale-"));
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, `${state.toLowerCase()}.json`), JSON.stringify(input));
  await writeFile(resolve(directory, `${state.toLowerCase()}.worker.csv`), source);
  await writeFile(resolve(directory, `${state.toLowerCase()}.worker-one.csv`), `${fields.join(",")}\n${rows.slice(0, 10).join("\n")}\n`);
  await writeFile(resolve(directory, `${state.toLowerCase()}.worker-divisions.json`), JSON.stringify(divisions));
  await writeFile(resolve(directory, "input-counts.json"), await readFile(resolve(sourceDirectory, "input-counts.json")));
  console.log(JSON.stringify({ state, workerContests: contests.length, workerCandidates: rows.length, sourceBytes: Buffer.byteLength(source) }));
}

async function generateDerived() {
  const inputs = JSON.parse(await readFile(resolve(directory, "input-counts.json"), "utf8"));
  const counts = [];
  for (const { state } of inputs.states as { state: string }[]) {
    const input = JSON.parse(await readFile(resolve(directory, `${state.toLowerCase()}.json`), "utf8"));
    const ballot = Object.values(input.ballots)[0] as import("../lib/ballot/types.ts").BallotSet;
    const candidates = ballot.candidacies.filter(row => row.id.startsWith("scale-") && (state === arg("all-candidates") || row.id.endsWith("-candidate-0")));
    const references: import("../lib/civic-data/derived-authority.ts").DerivedInputRef[] = [];
    const records = candidates.map(row => {
      const key = `ballot-${state.toLowerCase()}-${row.id}`, url = `https://scale.example.gov/campaign/${key}`;
      const name = `${row.givenName} ${row.familyName}`;
      const sha256 = createHash("sha256").update(key).digest("hex"), artifactId = `${key}:page`, approvalRecordId = `${key}:approval`;
      references.push({ kind: "VAULTED_EVIDENCE", artifactId, contentHash: `sha256-${sha256}`, tier: "RAW", retrievedAt: now },
        { kind: "PIPELINE_APPROVAL", itemId: key, recordId: approvalRecordId, approvedAt: now });
      return { id: key, candidacyId: row.id, candidateName: name, campaign: { url, attemptedAt: now.slice(0, 10),
        verification: `Fetched ${now.slice(0, 10)} (campaign-site-verifier/1): 'Synthetic benchmark' — names ${name}, the office ("Governing Board"), and the 2026 election.`,
        evidence: { verifierId: "campaign-site-verifier/1", artifactId, attemptId: `${key}:attempt`, sha256,
          requestedUrl: url, finalUrl: url, httpStatus: 200, readAt: now, approvalItemId: key, approvalRecordId, approvedAt: now } } };
    });
    const plan = { records, published: records.map(row => ({ key: row.id, candidacyId: row.candidacyId, url: row.campaign.url,
      approvalRecordId: row.campaign.evidence.approvalRecordId })), held: [], inputs: references };
    const encoded = JSON.stringify(plan);
    await writeFile(resolve(directory, `${state.toLowerCase()}.candidate-campaign-sites-derived.json`), encoded);
    counts.push({ state, records: records.length, bytes: Buffer.byteLength(encoded) });
  }
  await writeFile(resolve(directory, "derived-counts.json"), JSON.stringify(counts, null, 2));
  console.log(JSON.stringify({ states: counts.length, records: counts.reduce((sum, row) => sum + row.records, 0), largest: counts.sort((a, b) => b.bytes - a.bytes)[0] }));
}

async function changeInput() {
  const { requireBallotState } = await import("../lib/civic-data/state-scopes.ts");
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
    } else if (family === "candidate-campaign-sites-derived") {
      const record = input.records[0];
      const evidence = record.campaign.evidence;
      const priorArtifactId = evidence.artifactId;
      const priorApprovalId = evidence.approvalRecordId;
      evidence.artifactId = `${record.id}:page:${now}`;
      evidence.approvalRecordId = `${record.id}:approval:${now}`;
      evidence.readAt = evidence.approvedAt = now;
      evidence.sha256 = createHash("sha256").update(`${record.id}:${now}`).digest("hex");
      record.campaign.attemptedAt = now.slice(0, 10);
      input.published[0].approvalRecordId = evidence.approvalRecordId;
      for (const reference of input.inputs) {
        if (reference.kind === "VAULTED_EVIDENCE" && reference.artifactId === priorArtifactId) {
          reference.artifactId = evidence.artifactId;
          reference.contentHash = `sha256-${evidence.sha256}`;
          reference.retrievedAt = now;
        } else if (reference.kind === "PIPELINE_APPROVAL" && reference.recordId === priorApprovalId) {
          reference.recordId = evidence.approvalRecordId;
          reference.approvedAt = now;
        }
      }
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
  const { REGISTRY_STATES, requireBallotState } = await import("../lib/civic-data/state-scopes.ts");
  const { LocalFileArtifactStore } = await import("../lib/meetings/edge-store.ts");
  const authority = (await new LocalFileArtifactStore(edgeDirectory).readManifest())!.manifest.stateAuthorities!;
  assert.equal(Object.keys(authority["ballot-contests"]!).length, REGISTRY_STATES.length);
  const hashes: Record<string, string> = {};
  for (const state of REGISTRY_STATES) hashes[state] = await ballotInputHash(directory, state);
  const path = resolve(directory, "isolation-before.json");
  if (mode === "snapshot") {
    await writeFile(path, JSON.stringify({ hashes, authority }));
    console.log(JSON.stringify({ snapshottedStates: REGISTRY_STATES.length }));
    return;
  }
  const before = JSON.parse(await readFile(path, "utf8"));
  const state = requireBallotState(arg("state")!);
  const changedFiles = REGISTRY_STATES.filter(key => hashes[key] !== before.hashes[key]);
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
  assert.equal(latest.status, "PUBLISHED");
  assert.equal(ballotPublicationDue(`ballot-contests:${state}`, await ballotInputStamp(directory, state), latest,
    { lastSucceededAt: latest.at }), false);
  console.log(JSON.stringify({ states: REGISTRY_STATES.length, changedFiles, changedAuthorities,
    unchangedNextPoll: { publicationDue: false, workerLaunches: 0, workerDatabaseBytes: 0 } }));
}

async function worker() {
  const state = arg("state")!;
  const phase = arg("phase") ?? "publish";
  const family = arg("family") ?? "ballot-contests";
  const databasePort = arg("port");
  const transfer = zero();
  const markStage = stageMarkers(() => ({ ...transfer }));
  async function stage<T>(label: string, work: () => Promise<T>): Promise<T> {
    const id = markStage(label, "start");
    try { return await work(); } finally { markStage(label, "end", id); }
  }
  function synchronousStage<T>(label: string, work: () => T): T {
    const id = markStage(label, "start");
    try { return work(); } finally { markStage(label, "end", id); }
  }
  const { neonConfig } = await import("@neondatabase/serverless");
  const largestDatabaseRequest = { sentBytes: 0, receivedBytes: 0, mutationRequestBytes: 0 };
  const statements = new Map<string, Transfer>();
  const stateScopes = new Set<string>();
  const originalFetch = globalThis.fetch;
  function requestDetails(body: string) {
    const queries = [...body.matchAll(/"query"\s*:\s*("(?:[^"\\]|\\.)*")/g)].map(match => JSON.parse(match[1]) as string);
    assert.ok(queries.length, "The measured request must contain SQL.");
    for (const match of body.matchAll(/"(US-[A-Z]{2}:(?:state-election-ballots|candidate-profiles|candidate-publications|voting-sites|candidate-campaign-sites-derived|reader-registry-runtime))"/g)) {
      assert.ok(["unchanged", "artifact-all"].includes(phase) || match[1].startsWith(`US-${state}:`), `Another state's scope crossed this worker: ${match[1]}`);
      stateScopes.add(match[1]);
    }
    return { mutation: queries.some(query => /\b(?:insert|update|delete)\b/i.test(query)),
      key: queries.map(query => (query.match(/(?:from|into|update)\s+"?(\w+)/i)?.[1] ?? "other")).join(",") };
  }
  neonConfig.fetchFunction = async (_url: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]) => {
    assert.ok(databasePort);
    const body = String(init?.body);
    const { mutation, key } = requestDetails(body);
    const count = { requests: 1, receivedBytes: 0, sentBytes: Buffer.byteLength(body), mutationRequestBytes: mutation ? Buffer.byteLength(body) : 0 };
    largestDatabaseRequest.sentBytes = Math.max(largestDatabaseRequest.sentBytes, count.sentBytes);
    largestDatabaseRequest.mutationRequestBytes = Math.max(largestDatabaseRequest.mutationRequestBytes, count.mutationRequestBytes);
    for (const field of Object.keys(count) as (keyof Transfer)[]) transfer[field] += count[field];
    const held = statements.get(key) ?? zero();
    for (const field of Object.keys(count) as (keyof Transfer)[]) held[field] += count[field];
    statements.set(key, held);
    const response = await originalFetch(`http://127.0.0.1:${databasePort}`, { method: "POST", body });
    const counted = response.body?.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(bytes, controller) {
      transfer.receivedBytes += bytes.byteLength;
      held.receivedBytes += bytes.byteLength;
      count.receivedBytes += bytes.byteLength;
      controller.enqueue(bytes);
    }, flush() { largestDatabaseRequest.receivedBytes = Math.max(largestDatabaseRequest.receivedBytes, count.receivedBytes); } }));
    return new Response(counted, { status: response.status, headers: response.headers });
  };
  if (arg("production") === "1") {
    const { installDatabaseTransferCounter } = await import("../lib/db/transfer.ts");
    installDatabaseTransferCounter();
  }
  const started = performance.now();
  markStage("module-load", "start");
  const { requireBallotState, stateBallotScope, stateBallotContractId } = await import("../lib/civic-data/state-scopes.ts");
  const { LocalFileArtifactStore } = await import("../lib/meetings/edge-store.ts");
  const heldArtifactStore = new LocalFileArtifactStore(edgeDirectory);
  const artifactTransfer = { manifestReads: 0, manifestReadBytes: 0, manifestWrites: 0, manifestWriteBytes: 0,
    pointerReads: [] as { key: string; bytes: number }[], pointerWrites: [] as { key: string; bytes: number; modified: boolean }[],
    reads: [] as { key: string; bytes: number }[], writes: [] as { key: string; bytes: number }[] };
  const artifactStore: import("../lib/meetings/edge-store.ts").ReaderArtifactStore = {
    kind: heldArtifactStore.kind,
    async readManifest() {
      const held = await heldArtifactStore.readManifest();
      artifactTransfer.manifestReads++;
      artifactTransfer.manifestReadBytes += held ? size(held.manifest) : 0;
      return held;
    },
    async writeManifest(manifest, etag) {
      artifactTransfer.manifestWrites++;
      artifactTransfer.manifestWriteBytes += size(manifest);
      return heldArtifactStore.writeManifest(manifest, etag);
    },
    async readJsonPointer<T>(key: string) {
      const held = await heldArtifactStore.readJsonPointer<T>(key);
      artifactTransfer.pointerReads.push({ key, bytes: held ? size(held.value) : 0 });
      return held;
    },
    async writeJsonPointer<T>(key: string, value: T, expectedEtag: string | null) {
      const written = await heldArtifactStore.writeJsonPointer(key, value, expectedEtag);
      artifactTransfer.pointerWrites.push({ key, bytes: size(value), modified: written.modified });
      return written;
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
  const beforeManifest = (await heldArtifactStore.readManifest())?.manifest;
  const allowedArtifactKeys = new Set([beforeManifest?.stateAuthorities?.[authorityFamily as "ballot-contests"]?.[state]?.key]);
  const recordClassFor = { "ballot-contests": "BALLOT_CANDIDACY", "candidate-profiles": "CANDIDATE_PROFILE",
    "candidate-corpus": "CANDIDATE_PUBLICATION", "voting-sites": "VOTING_SITE", "candidate-campaign-sites-derived": "CURATED_READER_RECORD",
    "registry-runtime": "REGISTRY_RUNTIME_BINDING" } as const;
  const recordClass = recordClassFor[family as keyof typeof recordClassFor];
  const { stateRegistryRuntimeScope } = await import("../lib/civic-data/state-scopes.ts");
  const scope = family === "registry-runtime" ? stateRegistryRuntimeScope(state) : stateBallotScope(family as "ballot-contests", state);
  const division = arg("division") ?? `ocd-division/country:us/state:${state.toLowerCase()}`;
  const ids = [division.split("/place:")[0], division];
  const government = division.split("/place:")[1];
  markStage("module-load", "end");
  let result: unknown;
  if (phase === "baseline") {
    await stage("module-load:publication", () => import("../lib/civic-data/store.ts"));
    result = { loadedStatePayloads: 0 };
  } else if (phase === "baseline-artifact") {
    await stage("module-load:artifact", () => import("../lib/civic-data/state-artifact-dispatch.ts"));
    result = { loadedStatePayloads: 0 };
  } else if (phase === "derive-captures") {
    assert.equal(family, "candidate-campaign-sites-derived");
    const { deriveCampaignSitesFromCaptures } = await import("../lib/civic-data/derived-campaign-site-writer.ts");
    type Approval = import("../lib/civic-data/derived-campaign-site-writer.ts").PublishableCampaignSiteApproval;
    type HeldRead = import("../lib/civic-data/derived-campaign-site-writer.ts").HeldVerifyingRead;
    const counts = JSON.parse(await readFile(resolve(directory, "derived-counts.json"), "utf8")) as { state: string; records: number }[];
    const count = counts.find(row => row.state === state)!.records;
    const padding = "x".repeat(64 * 1024);
    const bodyFor = (id: string) => `<html><head><title>Alex Example for State Representative 2026</title></head><body><h1>Alex Example for State Representative 2026</h1><p>Alex Example is running for State Representative in the 2026 election. We will improve schools, protect drinking water, support local businesses and make government accountable to residents.</p><!--${id}:${padding}--></body></html>`;
    const approvals = synchronousStage("derived:approval-metadata", () => Array.from({ length: count }, (_, index): Approval => {
      const id = `ballot-${state.toLowerCase()}:scale-${index}`, url = `https://alexexample-${index}.example/`;
      return { itemId: `${id}:item`, recordId: `${id}:approval`, at: now, stage: "APPROVED_FOR_PROMOTION", campaignSite: {
        candidacyId: id, candidateName: "Alex Example", identity: { candidacyId: id, givenName: "Alex", familyName: "Example",
          officeTitle: "State Representative", ocdId: division, stateCode: state, cycle: 2026 }, readerKeys: [id], url,
        host: new URL(url).hostname, verification: "Saved generated capture", publicationDoor: "CANDIDATE_CAMPAIGN_SITES_DERIVED_CONTRACT",
        evidence: { verifierId: "campaign-site-verifier/1", artifactId: `${id}:capture`, attemptId: `${id}:attempt`,
          sha256: createHash("sha256").update(bodyFor(id)).digest("hex"), requestedUrl: url, finalUrl: url,
          httpStatus: 200, contentType: "text/html", readAt: now },
      } };
    }));
    let previous: Map<string, HeldRead> | undefined, captureBytes = 0, capturesRead = 0, maxHeldCaptures = 0;
    const derived = await stage("derived:read-captures-and-plan", () => deriveCampaignSitesFromCaptures({ state, now, approvals, profiles: null,
      async readCaptures(group) {
        assert.equal(previous?.size ?? 0, 0, "The prior candidacy's raw captures must be released before reading another.");
        const held = new Map<string, HeldRead>();
        for (const approval of group) {
          const body = bodyFor(approval.campaignSite.candidacyId);
          captureBytes += Buffer.byteLength(body); capturesRead++;
          held.set(approval.recordId, { body, sha256: approval.campaignSite.evidence.sha256, tier: "RAW", permission: "ALLOWED" });
        }
        maxHeldCaptures = Math.max(maxHeldCaptures, held.size); previous = held;
        return { held, linkedPublications: [] };
      },
    }));
    assert.equal(derived.plan?.held.length, 0, JSON.stringify(derived.plan?.held.slice(0, 2)));
    assert.equal(derived.plan?.records.length, count);
    assert.equal(previous?.size, 0);
    assert.deepEqual(derived.candidate.semantics.violations, []);
    const { publishCampaignSitePortraits } = await import("../lib/control-plane/promotion/campaign-site-portraits.ts");
    let portraitCaptures = 0, portraitCaptureBytes = 0, commonsReads = 0;
    const emptyCommons = new TextEncoder().encode('{"results":{"bindings":[]}}');
    const portraitPlan = await stage("derived:portrait-captures", () => publishCampaignSitePortraits({ plan: derived.plan!, approvals, now,
      async held(approval) {
        const body = bodyFor(approval.campaignSite.candidacyId);
        portraitCaptures++; portraitCaptureBytes += Buffer.byteLength(body);
        return { body, sha256: approval.campaignSite.evidence.sha256, tier: "RAW", permission: "ALLOWED" };
      },
      commonsRuntime: { async capture(url) {
        commonsReads++;
        return { sourceId: "scale-commons", releaseId: url, bytes: emptyCommons,
          sha256: createHash("sha256").update(emptyCommons).digest("hex"), requestedUrl: url, finalUrl: url,
          httpStatus: 200, retrievedAt: now, sourceObservedAt: now, checkedAt: now, lastCheckStatus: 200, etag: null,
          lastModified: null, contentType: "application/json", reused: false, vaultKey: "scale/commons-empty" };
      } },
    }));
    assert.equal(portraitPlan.portraits?.length ?? 0, 0);
    assert.equal(portraitCaptures, count);
    result = { records: count, capturesRead, captureBytes, maxHeldCaptures, portraitCaptures, portraitCaptureBytes, commonsReads,
      portraitFixture: "Generated HTML has no portrait; Commons responses are generated empty results.",
      outputRecords: derived.candidate.normalization.outputRecords };
  } else if (phase === "artifact-child") {
    const { PostgresRoutineDataStore } = await import("../lib/civic-data/store.ts");
    for (const method of ["readPromotion", "readCandidateProof", "readPromotionIdentities", "readPublishedCandidateMetadata"] as const) {
      const original = PostgresRoutineDataStore.prototype[method];
      Object.defineProperty(PostgresRoutineDataStore.prototype, method, { value: function(...args: unknown[]) {
        return stage(`artifact:${method}`, async () => Reflect.apply(original, this, args));
      }, configurable: true, writable: true });
    }
    const originalPut = LocalFileArtifactStore.prototype.putImmutable;
    LocalFileArtifactStore.prototype.putImmutable = async function(bytes, suffix) {
      const key = await originalPut.call(this, bytes, suffix);
      artifactTransfer.writes.push({ key, bytes: bytes.byteLength });
      return key;
    };
    LocalFileArtifactStore.prototype.readManifest = async () => { throw new Error("STATE_CHILD_READ_MANIFEST"); };
    LocalFileArtifactStore.prototype.writeManifest = async () => { throw new Error("STATE_CHILD_WRITE_MANIFEST"); };
    const args = process.argv;
    process.argv = [args[0], resolve(root, "scripts/publish-state-authority.mts"), `--state=${state}`, `--family=${authorityFamily}`,
      `--version=${arg("version")!}`, `--observed-at=${now}`];
    await stage("edge:artifact-child", () => import("./publish-state-authority.mts"));
    process.argv = args;
    assert.ok(!process.exitCode, "The actual state artifact CLI must succeed.");
    result = { entry: "scripts/publish-state-authority.mts" };
  } else if (phase === "artifact" || phase === "artifact-all" || phase === "unchanged") {
    const { publishSupervisorReaderEdge } = await import("../lib/civic-data/reader-edge-publication.ts");
    const { PostgresRoutineDataStore } = await import("../lib/civic-data/store.ts");
    const children: unknown[] = [];
    const { selectedStateEdgePointers } = await import("../lib/civic-data/promoted-edge-publication.ts");
    const selected = phase === "artifact" ? [{ recordClass, scope }] : selectedStateEdgePointers(null).flatMap(unit => unit.pointers);
    const published = await stage("edge:metadata-coordinator", () => publishSupervisorReaderEdge(new PostgresRoutineDataStore(), now,
      selected, { artifactStore, stateArtifactChildren: { launch: async command => {
        assert.notEqual(phase, "unchanged", "An unchanged national poll must launch no artifact child.");
        const version = command.args.find(value => value.startsWith("--version="))!;
        const authority = command.args.find(value => value.startsWith("--family="))!.slice("--family=".length);
        const childFamily = authority === "candidate-publications" ? "candidate-corpus" : authority;
        const childState = command.args.find(value => value.startsWith("--state="))!.slice("--state=".length);
        const measured = await child(["--mode=worker", `--directory=${directory}`, `--edge-directory=${edgeDirectory}`, `--state=${childState}`,
          `--family=${childFamily}`, "--phase=artifact-child", `--port=${databasePort}`, `--division=${division}`, version,
          ...(arg("production") === "1" ? ["--production=1"] : [])], command.env);
        const line = measured.output.split("\n").find(row => row.startsWith("SCALE_RESULT="));
        assert.ok(line, measured.output);
        children.push({ ...JSON.parse(line.slice("SCALE_RESULT=".length)), stages: measured.stages, sampledPeakRssBytes: measured.sampledPeakRssBytes });
        return { id: command.id, status: 0, signal: null, stdout: measured.output, stderr: "", termination: "EXITED", errorMessage: null };
      } } }));
    assert.ok(published.ok, JSON.stringify(published));
    if (phase === "unchanged") {
      assert.equal(artifactTransfer.writes.length, 0);
      assert.equal(artifactTransfer.reads.length, 0);
      assert.equal(artifactTransfer.manifestWrites, 0);
    }
    const after = (await heldArtifactStore.readManifest())!.manifest.stateAuthorities!;
    const changed: string[] = [], concurrentChanges: string[] = [];
    for (const [kind, states] of Object.entries(after)) for (const [key, ref] of Object.entries(states)) {
      if (JSON.stringify(beforeManifest?.stateAuthorities?.[kind as keyof typeof after]?.[key]) === JSON.stringify(ref)) continue;
      if (key !== state && phase !== "artifact-all") {
        assert.equal(arg("concurrent-coverage"), "1", "Only the selected state's artifacts may change in an isolated run.");
        concurrentChanges.push(`${kind}:${key}`);
        continue;
      }
      changed.push(`${kind}:${key}`);
    }
    assert.ok([...statements.keys()].every(key => !/(?:^|,)(?:fact|source_copy|civic_data_candidates|civic_data_payload_parts)(?:,|$)/.test(key)),
      "The artifact coordinator must read pointer metadata only.");
    result = { edge: published, children, changedAuthorities: changed, concurrentChanges };
  } else if (phase === "read" || phase === "state-read") {
    markStage("edge:read", "start");
    const { ensureReaderAuthorityEdge } = await import("../lib/meetings/edge-serving.ts");
    const { withReaderAuthorityEdge, readPromotedEdgeFirst } = await import("../lib/registry/runtime-edge.ts");
    const { readerBallotSourcesForDivisions } = await import("../lib/ballot/reader-sources.ts");
    const manifest = (await artifactStore.readManifest())!.manifest;
    const bundle = await ensureReaderAuthorityEdge(manifest, artifactStore, [authorityFamily as "ballot-contests"]);
    if (family === "ballot-contests" && phase === "read") {
      const sources = await withReaderAuthorityEdge(bundle, () => readerBallotSourcesForDivisions(ids));
      const ballots = await Promise.all(sources.map(async row => row.source.normalize(await row.source.fetch())));
      assert.ok(ballots.some(ballot => ballot.contests.some(row => row.id === government)), "The exact requested government must reach the reader.");
      result = { sources: sources.length, placeBytes: size(ballots), contests: ballots.reduce((sum, ballot) => sum + ballot.contests.length, 0) };
    } else {
      const { readPromotedCivicData } = await import("../lib/civic-data/read-model.ts");
      const read = await withReaderAuthorityEdge(bundle, async () => {
        if (phase !== "state-read") return readPromotedEdgeFirst(recordClass, scope,
          options => readPromotedCivicData(recordClass, scope, options), "Benchmark state's auxiliary records");
        const artifact = await bundle.stateAuthorities?.load(authorityFamily as "ballot-contests", state);
        const entry = artifact?.entries.find(row => row.kind === "PROMOTED" && row.projection.scope === scope);
        assert.ok(entry?.kind === "PROMOTED");
        return readPromotedCivicData(recordClass, scope, { edge: entry });
      });
      assert.equal(read.kind, "PROMOTED");
      const value = read.value as { cards?: { cards: Record<string, unknown> }; documents?: unknown[]; records?: unknown[];
        jurisdictions?: { sites: unknown[] }[]; registry?: { bodies: unknown[]; divisions: unknown[] }; ballots?: Record<string, { contests: unknown[] }> };
      result = { records: value.cards ? Object.keys(value.cards.cards).length : value.documents?.length ?? value.records?.length ??
        value.jurisdictions?.reduce((sum, row) => sum + row.sites.length, 0) ?? value.registry?.bodies.length ??
        Object.values(value.ballots ?? {}).reduce((sum, row) => sum + row.contests.length, 0) };
    }
    assert.equal(transfer.requests, 0, "Published edge readers must not contact the database.");
    markStage("edge:read", "end");
  } else {
    const { PostgresRoutineDataStore } = await stage("module-load:publication", () => import("../lib/civic-data/store.ts"));
    const store = new PostgresRoutineDataStore();
    for (const property of ["readPromotion", "readPromotions", "readStatePublicationBase", "readCandidate", "readCandidateSummary",
      "readCandidateProof", "readCandidateProofs", "readCandidates", "readPublishedCandidateMetadata", "readPromotionIdentity",
      "readPromotionIdentities", "eventObservedAt", "create", "transition", "promote", "appendEvidence", "confirmUnchanged"] as const) {
      const method = store[property];
      Object.defineProperty(store, property, { configurable: true,
        value: (...args: unknown[]) => stage(`store:${property}`, async () => Reflect.apply(method, store, args)) });
    }
    let publication: unknown;
    if (family === "candidate-profiles" && phase === "profile-findings") {
      const { neon } = await import("@neondatabase/serverless");
      const { runCandidateProfileFindingsJob } = await import("../lib/civic-data/candidate-profile-findings-job.ts");
      const { pgAggregateRepository } = await import("../lib/control-plane/repository/pg-store.ts");
      const { listedBoxRepository } = await import("../lib/control-plane/box.ts");
      const sql = neon(process.env.WTP_CONTROL_PLANE_DATABASE_URL!);
      type Repositories = import("../lib/control-plane/repository/types.ts").ControlPlaneRepositories;
      const repos: Pick<Repositories, "boxFindings" | "adminConfig"> = {
        boxFindings: listedBoxRepository(pgAggregateRepository(sql, "BoxFinding", "cp_box_findings")),
        adminConfig: pgAggregateRepository(sql, "AdminConfig", "cp_admin_config"),
      };
      const held = new Map((JSON.parse(await readFile(resolve(directory, "profile-findings-artifacts.json"), "utf8")) as
        import("../lib/control-plane/evidence/read-only-vault.ts").HeldVaultArtifact[]).map(row => [row.id, row]));
      const published = await stage("profiles:findings-job", () => runCandidateProfileFindingsJob({ state, store, repos,
        query: (query, params) => sql.query(query, params), now,
        readHeld: async ids => {
          assert.equal(new Set(ids).size, 500);
          return async id => held.get(id) ?? null;
        },
      }));
      assert.deepEqual(published.report, { published: { "CAN-16": 500 }, refused: {}, waiting: 0 });
      assert.equal(published.receipt?.state, "PROMOTED");
      publication = published;
    } else if (family === "ballot-contests" && phase.startsWith("worker-")) {
      const { parseCivicRecords } = await import("../lib/control-plane/workers/parser.ts");
      const { workerBallotContestsPackage } = await import("../lib/civic-data/worker-ballot-contests.ts");
      const { readManualProjectionPrior, manualProjectionCandidate } = await import("../lib/civic-data/manual-projections.ts");
      const { processRegisteredManualCandidate } = await import("../lib/civic-data/promotion.ts");
      const built = await (async () => {
        const prior = await stage("worker:prior-state", () => readManualProjectionPrior(stateBallotContractId("ballot-contests", state), store, now));
        const priorVersionId = prior?.versionId ?? null;
        const earlierReceipts = prior?.sourceReceipt?.sources.map(row => `${row.finalUrl}@${row.rawHash}`) ?? [];
        let source = await stage("worker:source-read", () => readFile(resolve(directory, `${state.toLowerCase()}.worker${phase === "worker-one" ? "-one" : ""}.csv`), "utf8"));
        if (phase !== "worker-seed") source = source.replaceAll("Avery", "Taylor");
        const sourceBytes = Buffer.byteLength(source);
        const artifactId = `${now}:${phase}`;
        const evidence: import("../lib/control-plane/workers/types.ts").WorkerEvidence = {
          artifactId, contentHash: `sha256-${createHash("sha256").update(source).digest("hex")}`, text: source,
          acquiredByAttemptId: artifactId, canonicalUrl: `https://scale.example.gov/${state.toLowerCase()}/${phase === "worker-one" ? "single-contest" : "full-candidate-list"}.csv`,
          retrievedAt: now, sourceId: "Synthetic state election authority", methodRouteId: "list" };
        const fields = ["election", "electionDate", "office", "jurisdictionName", "candidateName", "givenName", "familyName"];
        const contract: import("../lib/control-plane/workers/types.ts").GeneralizedCivicExtractionContract = {
          schemaVersion: 2, recordClass: "BALLOT_CONTEST", subjectId: `scale:${state}`, jurisdiction: { country: "US", state, canonicalId: `scale:${state}` },
          identity: { namespace: "scale-ballot", keyFields: ["election", "office", "jurisdictionName", "candidateName"] },
          sourceScope: { sourceId: evidence.sourceId, publisher: evidence.sourceId, routeIds: ["list"], canonicalUrls: [evidence.canonicalUrl], observationArtifactIds: [artifactId] },
          methodVersion: 1, requiredFields: ["election", "office", "candidateName"], completenessScope: "Every candidate row on this saved source", expectedSourceDate: null,
          extraction: { format: "DELIMITED_TEXT", delimiter: ",", headerRows: 1, fields: Object.fromEntries(fields.map((field, index) => [field, { source: index, type: "STRING" as const }])) },
          verification: { required: false, authorities: [] } };
        const parsed = synchronousStage("worker:parse", () => parseCivicRecords({ attemptId: artifactId,
          worker: { role: "PARSER", instance: "scale", provider: "deterministic", version: "2" }, evidence, contract }));
        assert.equal(parsed.verdict, "EXTRACTED", JSON.stringify(parsed.warnings));
        const divisions = JSON.parse(await readFile(resolve(directory, `${state.toLowerCase()}.worker-divisions.json`), "utf8"));
        const checked = synchronousStage("worker:verify-merge", () => workerBallotContestsPackage({ now, prior,
          plan: { contract, publication: { contractId: stateBallotContractId("ballot-contests", state), bodyId: `scale:${state}` } } as import("../lib/control-plane/workers/autonomous-plan.ts").AutonomousWorkPlan,
          parser: { id: artifactId, workItemId: "ballot", endedAt: now, result: parsed } as import("../lib/control-plane/workers/types.ts").WorkerResultRecord,
          registry: { payload: { registry: { divisions } } } as import("../lib/registry/runtime-data-plane.ts").RegistryRuntimePrior,
          captures: [{ evidence, observedAt: now, transport: "REACHABLE", partial: false, httpStatus: 200 }] }));
        assert.equal(checked.heldContests.length, 0, JSON.stringify(checked.heldContests));
        const candidate = synchronousStage("worker:candidate-build", () => manualProjectionCandidate(checked.package));
        const ballots = Object.values((checked.package.payload as import("../lib/ballot/generic-projection.ts").GenericBallotProjection).ballots);
        const receipts = checked.package.sourceReceipt.sources.map(row => `${row.finalUrl}@${row.rawHash}`);
        const superseded = earlierReceipts.filter(row => row.includes("scale.example.gov") && /\/(?:full-candidate-list|single-contest)\.csv@/.test(row) && !receipts.includes(row));
        if (phase === "worker-full") assert.equal(superseded.length, 2, "The replaced full list and single-contest receipt must both be pruned.");
        return { candidate, contractId: checked.package.contractId, priorVersionId, report: { sourceBytes, inputRecords: parsed.records.length,
          contests: ballots.reduce((sum, ballot) => sum + ballot.contests.length, 0), candidates: ballots.reduce((sum, ballot) => sum + ballot.candidacies.length, 0),
          sourceReceiptRows: receipts.length, supersededReceiptRowsRemoved: superseded.length, changes: checked.changes.records } };
      })();
      const published = await stage("generic:promotion", () => processRegisteredManualCandidate(store, built.contractId, built.candidate, now, built.priorVersionId));
      assert.ok(published.promoted, JSON.stringify({ state: published.candidate.state, reason: published.candidate.failureDetail }));
      publication = { versionId: published.promoted!.versionId, ...built.report };
    } else if (family === "ballot-contests") {
      const { runBallotPublication } = await stage("module-load:assembler", () => import("./assemble-ballot-package.mts"));
      const published = await stage("ballot-publication", () => runBallotPublication({ state: requireBallotState(state), directory, store, now, onStage: markStage }));
      assert.equal(published.report.status, "PUBLISHED", JSON.stringify(published.report));
      assert.equal(published.report.heldContests?.filter(row => row.contestId.startsWith("scale-")).length ?? 0, 0,
        "Every generated government must publish its complete contest.");
      publication = published.report;
    } else {
      const { prepareManualProjectionSuccessor } = await import("../lib/civic-data/manual-successor.ts");
      const { processRegisteredManualCandidate, processRegisteredRoutineCandidate } = await import("../lib/civic-data/promotion.ts");
      let encoded = await stage("auxiliary:read-file", () => readFile(arg("unit") ?? resolve(directory, `${state.toLowerCase()}.${family}.json`), "utf8"));
      const rawInputBytes = Buffer.byteLength(encoded);
      const rawInputHash = family === "voting-sites" ? synchronousStage("voting:input-hash", () => createHash("sha256").update(encoded).digest("hex")) : null;
      let input = synchronousStage("auxiliary:parse", () => JSON.parse(encoded));
      encoded = "";
      let candidate: import("../lib/civic-data/types.ts").RoutineCandidate;
      let expectedBaseVersionId: string | null;
      if (family === "registry-runtime") {
        const { readRegistryRuntimePrior, registryRuntimeCandidate } = await import("../lib/registry/runtime-data-plane.ts");
        const { stateRegistryRuntimeContractId } = await import("../lib/civic-data/state-scopes.ts");
        assert.equal(input.contractId, stateRegistryRuntimeContractId(state));
        let prior = await stage("registry:read-prior", () => readRegistryRuntimePrior(store, input.sourceReceipt.reviewedAt, state));
        expectedBaseVersionId = prior?.versionId ?? null;
        candidate = synchronousStage("registry:candidate-build", () => registryRuntimeCandidate(input, { prior }));
        prior = null;
      } else if (family === "candidate-campaign-sites-derived") {
        const { derivedCampaignSitesCandidate } = await import("../lib/civic-data/derived-campaign-site-writer.ts");
        expectedBaseVersionId = (await store.readPromotionIdentity(recordClass, scope))?.versionId ?? null;
        candidate = synchronousStage("derived:candidate-build", () => derivedCampaignSitesCandidate(state, input, now));
      } else if (family === "voting-sites") {
        const { votingSitesCandidate } = await import("../lib/ballot/voting-sites-data-plane.ts");
        const prior = await store.readPromotion<import("../lib/ballot/voting-sites.ts").VotingSitesFile>(recordClass, scope);
        expectedBaseVersionId = prior?.versionId ?? null;
        const rawHash = rawInputHash!;
        const url = input.jurisdictions[0].sourceUrl;
        candidate = synchronousStage("voting:candidate-build", () => votingSitesCandidate({ state, current: input, prior: prior?.payload ?? null, failures: [], successfulAuthorityReads: 1,
          carriedFromVersionId: expectedBaseVersionId,
          requestedUrl: url, finalUrl: url, retrievedAt: now,
          acquisition: [{ vaultKey: `scale/${rawHash}`, rawHash, byteLength: rawInputBytes, url, contentType: "application/json" }] }));
      } else ({ candidate, expectedBaseVersionId } = await stage("auxiliary:prepare-successor", () => prepareManualProjectionSuccessor(input, store, now)));
      const publishedAt = family === "registry-runtime" ? input.sourceReceipt.reviewedAt : now;
      input = null;
      assert.equal(recordClass, candidate.recordClass);
      if (phase === "construct") publication = { constructed: true, recordClass, records: candidate.normalization.outputRecords };
      else {
        const { stateRegistryRuntimeContractId } = await import("../lib/civic-data/state-scopes.ts");
        const outcome = await stage("generic:promotion", () => family === "candidate-campaign-sites-derived"
          ? processRegisteredRoutineCandidate(store, stateBallotContractId("candidate-campaign-sites-derived", state), candidate, now, expectedBaseVersionId)
          : processRegisteredManualCandidate(store, family === "registry-runtime" ? stateRegistryRuntimeContractId(state)
            : stateBallotContractId(family as "candidate-profiles" | "candidate-corpus" | "voting-sites", state), candidate, publishedAt, expectedBaseVersionId));
        assert.ok(outcome.promoted, JSON.stringify({ state: outcome.candidate.state, reason: outcome.candidate.failureDetail }));
        publication = { versionId: outcome.promoted.versionId, recordClass, records: candidate.normalization.outputRecords };
      }
    }
    result = { report: publication };
  }
  for (const read of artifactTransfer.reads) assert.ok(allowedArtifactKeys.has(read.key), `Unrelated artifact crossed this state worker: ${read.key}`);
  console.log("SCALE_RESULT=" + JSON.stringify({ state, family, phase, wallMs: performance.now() - started, peakRssBytes: process.resourceUsage().maxRSS * 1024,
    transfer, largestDatabaseRequest, artifactTransfer, stateScopes: [...stateScopes], byTable: Object.fromEntries(statements), result }));
}

async function child(args: string[], env: NodeJS.ProcessEnv = process.env) {
  return new Promise<{ output: string; stages: StageMeasurement[]; sampledPeakRssBytes: number }>((resolveResult, reject) => {
    const workerProcess = spawn(process.execPath, ["--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs", entry, ...args], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "", errors = "", pendingLine = "", sampling = false, sampledPeakRssBytes = 0;
    const active = new Map<number, { start: StageMarker; peakRssBytes: number }>();
    const stages: StageMeasurement[] = [];
    const sampler = setInterval(async () => {
      if (sampling) return;
      sampling = true;
      try {
        const status = await readFile(`/proc/${workerProcess.pid}/status`, "utf8");
        const rss = Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1] ?? 0) * 1024;
        sampledPeakRssBytes = Math.max(sampledPeakRssBytes, rss);
        for (const stage of active.values()) stage.peakRssBytes = Math.max(stage.peakRssBytes, rss);
      } catch { /* The worker can exit between samples. */ }
      finally { sampling = false; }
    }, 10);
    workerProcess.stdout.on("data", bytes => {
      const text = String(bytes);
      output += text;
      pendingLine += text;
      let end: number;
      while ((end = pendingLine.indexOf("\n")) !== -1) {
        const line = pendingLine.slice(0, end);
        pendingLine = pendingLine.slice(end + 1);
        if (!line.startsWith("SCALE_STAGE=")) continue;
        const marker = JSON.parse(line.slice("SCALE_STAGE=".length)) as StageMarker;
        if (marker.phase === "start") active.set(marker.id, { start: marker, peakRssBytes: marker.rssBytes });
        else {
          const held = active.get(marker.id);
          assert.ok(held, `No starting measurement for ${marker.label}`);
          stages.push({ id: marker.id, label: marker.label, wallMs: marker.at - held.start.at,
            peakRssBytes: Math.max(held.peakRssBytes, marker.rssBytes, marker.highWaterBytes > held.start.highWaterBytes ? marker.highWaterBytes : 0),
            startRssBytes: held.start.rssBytes, endRssBytes: marker.rssBytes,
            startHeapBytes: held.start.heapBytes, endHeapBytes: marker.heapBytes,
            startExternalBytes: held.start.externalBytes, endExternalBytes: marker.externalBytes,
            ...(marker.transfer && held.start.transfer ? { transfer: Object.fromEntries(Object.keys(marker.transfer).map(key =>
              [key, marker.transfer![key as keyof Transfer] - held.start.transfer![key as keyof Transfer]])) as Transfer } : {}) });
          active.delete(marker.id);
        }
      }
    });
    workerProcess.stderr.on("data", bytes => { errors += String(bytes); });
    workerProcess.once("error", error => { clearInterval(sampler); reject(error); });
    workerProcess.once("close", (code, signal) => {
      clearInterval(sampler);
      if (code === 0) resolveResult({ output, stages: stages.sort((a, b) => a.id - b.id), sampledPeakRssBytes });
      else {
        console.error("SCALE_FAILURE=" + JSON.stringify({ args, code, signal, sampledPeakRssBytes, stages,
          incompleteStages: [...active.values()].map(row => ({ label: row.start.label, peakRssBytes: row.peakRssBytes })) }));
        reject(new Error(`${args.join(" ")}: ${code ?? signal}\n${errors}\n${output}`));
      }
    });
  });
}

async function run() {
  const { admittedRuntimeChildEnvironment } = await import("../lib/civic-data/runtime-authority.ts");
  const inputs = JSON.parse(await readFile(resolve(directory, "input-counts.json"), "utf8")) as { states: { state: string; division: string; bytes: number }[] };
  const states = arg("states")?.split(",") ?? inputs.states.map(row => row.state);
  const results = arg("resume") === "1"
    ? JSON.parse(await readFile(resolve(directory, arg("result-file") ?? "results.json"), "utf8")).results as { state: string; family: string; phase: string }[] : [];
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
      const env = admittedRuntimeChildEnvironment({ capability: family === "candidate-campaign-sites-derived" ? "ROUTINE_CONTRACT" : "MANUAL_CONTRACT", contract: `${family}:${state}`,
        parentEnv: { ...process.env, NODE_ENV: "development", WTP_RUNTIME_MODE: "staging", WTP_DB_ROLE: "local",
          NODE_USE_ENV_PROXY: "0", WTP_READER_EDGE_DIR: edgeDirectory, WTP_READER_EDGE_LOCAL_OK: "1",
          DATABASE_URL: "postgresql://scale:scale@localhost/scale", WTP_CONTROL_PLANE_DATABASE_URL: "postgresql://scale:scale@localhost/scale" } });
      for (const phase of (arg("phases") ?? "publish,artifact,read").split(",")) {
        if (results.some(row => row.state === state && row.family === family && row.phase === phase)) continue;
        const measured = await child(["--mode=worker", `--directory=${directory}`, `--edge-directory=${edgeDirectory}`, `--state=${state}`, `--family=${family}`, `--phase=${phase}`, `--port=${port}`,
          ...(arg("concurrent-coverage") === "1" ? ["--concurrent-coverage=1"] : []),
          `--division=${inputs.states.find(row => row.state === state)!.division}`], env);
        const line = measured.output.split("\n").find(row => row.startsWith("SCALE_RESULT="));
        assert.ok(line, measured.output);
        const result = JSON.parse(line.slice("SCALE_RESULT=".length));
        result.stages = measured.stages;
        result.sampledPeakRssBytes = measured.sampledPeakRssBytes;
        results.push(result);
        console.log(JSON.stringify({ state, family, phase, wallMs: result.wallMs, peakRssBytes: result.peakRssBytes, transfer: result.transfer }));
        await writeFile(resolve(directory, arg("result-file") ?? "results.json"), JSON.stringify({ input: inputs, results }, null, 2));
      }
      }
    } finally { server.kill(); }
  }
}

async function production() {
  const { admittedRuntimeChildEnvironment } = await import("../lib/civic-data/runtime-authority.ts");
  assert.ok(arg("port"), "Production-copy measurements require an isolated local database bridge.");
  await mkdir(directory, { recursive: true });
  const phases = (arg("phases") ?? "artifact,state-read").split(",");
  const results: unknown[] = arg("resume") === "1"
    ? JSON.parse(await readFile(resolve(directory, arg("result-file") ?? "production-results.json"), "utf8")).results : [];
  const saved = new Set(results.map(value => {
    const row = value as { state: string; family: string; phase: string };
    return `${row.family}:${row.state}:${row.phase}`;
  }));
  assert.ok(arg("plan"), "Pass the actual accepted state unit plan with --plan.");
  const units: ProductionUnit[] = JSON.parse(await readFile(arg("plan")!, "utf8")).units;
  const concurrency = Number(arg("concurrency") ?? 1);
  assert.ok(Number.isSafeInteger(concurrency) && concurrency >= 1 && concurrency <= 4);
  let save = Promise.resolve();
  async function runUnit(unit: ProductionUnit) {
    if (arg("states") && !arg("states")!.split(",").includes(unit.state)) return;
    if (arg("families") && !arg("families")!.split(",").includes(unit.family)) return;
    const env = admittedRuntimeChildEnvironment({ capability: unit.family === "candidate-campaign-sites-derived" ? "ROUTINE_CONTRACT" : "MANUAL_CONTRACT",
      contract: unit.contractId, parentEnv: { ...process.env, NODE_ENV: "development", WTP_RUNTIME_MODE: "staging", WTP_DB_ROLE: "local",
        NODE_USE_ENV_PROXY: "0", WTP_READER_EDGE_DIR: edgeDirectory, WTP_READER_EDGE_LOCAL_OK: "1", WTP_VITAL_SIGNS_REPORT: "1",
        DATABASE_URL: "postgresql://scale:scale@localhost/scale", WTP_CONTROL_PLANE_DATABASE_URL: "postgresql://scale:scale@localhost/scale" } });
    for (const phase of phases) {
      if (saved.has(`${unit.family}:${unit.state}:${phase}`)) continue;
      const measured = await child(["--mode=worker", "--production=1", `--directory=${directory}`, `--edge-directory=${edgeDirectory}`, `--state=${unit.state}`,
        `--family=${unit.family}`, `--phase=${phase}`, `--port=${arg("port")}`,
        ...(unit.inputFile ? [`--unit=${unit.inputFile}`] : []),
        ...(arg("plan") ? [`--plan=${arg("plan")}`] : []),
        ...(concurrency > 1 ? ["--concurrent-coverage=1"] : [])], env);
      const line = measured.output.split("\n").find(row => row.startsWith("SCALE_RESULT="));
      assert.ok(line, measured.output);
      const result = { ...JSON.parse(line.slice("SCALE_RESULT=".length)), stages: measured.stages, sampledPeakRssBytes: measured.sampledPeakRssBytes };
      results.push(result);
      console.log(JSON.stringify({ state: unit.state, family: unit.family, phase, wallMs: result.wallMs, peakRssBytes: result.peakRssBytes, transfer: result.transfer }));
      save = save.then(() => writeFile(resolve(directory, arg("result-file") ?? "production-results.json"),
        JSON.stringify({ plan: arg("plan") ?? null, concurrency, results }, null, 2)));
      await save;
    }
  }
  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < units.length) await runUnit(units[next++]);
  }));
}

if (mode === "database") await database();
else if (mode === "generate") await generate();
else if (mode === "generate-auxiliary") await generateAuxiliary();
else if (mode === "generate-worker-fixture") await generateWorkerFixture();
else if (mode === "generate-derived") await generateDerived();
else if (mode === "change") await changeInput();
else if (mode === "snapshot" || mode === "verify-isolation") await isolationSnapshot();
else if (mode === "worker") await worker();
else if (mode === "run") await run();
else if (mode === "production") await production();
else throw new Error(`Unknown mode: ${mode}`);
