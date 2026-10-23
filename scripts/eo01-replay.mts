/** Read-only production inputs + local source verification; this never publishes to production. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { appendFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { neon } from "@neondatabase/serverless";
import { installDatabaseTransferCounter } from "../lib/db/transfer.ts";
import { processNeonBytes } from "../lib/db/transfer-by-caller.ts";
import { readStateReaderEntry } from "../lib/civic-data/state-reader-store.ts";
import { readVotingSitesProjection } from "../lib/ballot/voting-sites-server.ts";
import { answerVotingSites, type VotingReaderPlace } from "../lib/ballot/voting-answer.ts";
import { addCensusVotingGeographies, censusVotingAddress, votingInputZip, votingPlaceFromZip } from "../lib/ballot/voting-answer-geography.ts";
import { indexedZipDivisionEntry } from "../lib/geo/zip-division-index.ts";
import { postalArea } from "../lib/geo/postal.ts";
import { votingFailureDetail } from "../lib/ballot/voting-errors.ts";
import type { VotingSitesFile } from "../lib/ballot/voting-sites.ts";
import { stateBallotScope } from "../lib/civic-data/state-scopes.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { localElectionOfficesCandidate, prepareLocalElectionOfficeProjection } from "../lib/sources/local-election-offices/publication.ts";
import { LOCAL_ELECTION_OFFICE_FIELDS, assertLocalElectionOfficeFile, type LocalElectionOffice, type LocalElectionOfficeFile } from "../lib/sources/local-election-offices/model.ts";
import { LOCAL_ELECTION_OFFICES_STATES, localElectionOfficesContractId, requireLocalElectionOfficeState } from "../lib/sources/local-election-offices/targets.ts";
import { type LocalElectionOfficeDocument } from "../lib/sources/local-election-offices/extraction.ts";
import { decodeVotingBytes } from "../lib/ballot/voting-source-tables.ts";
import { localElectionOfficesForPlace, readLocalElectionOffices } from "../lib/reference/local-election-offices.ts";
import { isTransientControlPlaneConnectError, withControlPlaneConnectRetry } from "../lib/control-plane/repository/connect-retry.ts";
import { routineTaskDue, routineTaskFromContract } from "../lib/civic-data/runner.ts";
import { requiredRoutineContract } from "../lib/civic-data/contracts.ts";
import { localElectionOfficeProductionIdentity, type ProductionLocalOfficeGeography } from "./eo01-production-identity.mts";

export interface SourceDocument { url: string; path: string; contentType: string; checkedAt: string; sha256?: string; textPath?: string }
export interface ReplayPartition { state: string; file: string; expected: number; roster?: string; documents: SourceDocument[] }
interface ReplayAddress { id: string; state: string; address: string; officialAddressSource?: string }
interface ReplayAddressCapture {
  id: string; state: string; address: string;
  attempts: { requestedUrl: string; status: number; contentType: string; bytes: number; sha256: string; path: string; checkedAt: string }[];
}
type Geography = ProductionLocalOfficeGeography;
interface ProductionQueryRequest { key: string; state?: string; text: string; params: readonly unknown[] }
interface ProductionQueryCache {
  source: "Neon connector readonly transaction";
  productionProject: "tiny-hill-13996172";
  productionBranch: "br-delicate-lab-ax02xuo5";
  role: "readonly";
  transactionReadOnly: true;
  responseBytes?: number;
}

const argument = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const json = async <T,>(path: string): Promise<T> => JSON.parse(await readFile(path, "utf8")) as T;
const save = async (path: string, value: unknown) => writeFile(path, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const queryKey = (text: string, params: readonly unknown[]) => digest(new TextEncoder().encode(JSON.stringify([text, params])));
const emptyPlace = (state: string): VotingReaderPlace => ({ precision: "ADDRESS", point: null, divisionIds: [], states: [state], countyFips: [], countyNames: [], countySubdivisionGeoids: [], towns: [], wards: [], aiannhGeoids: [], precincts: [] });
const IDENTITY_SQL = `SELECT current_user AS role,current_setting('transaction_read_only') AS read_only,
   (SELECT count(*) FROM pg_tables WHERE schemaname='public' AND (has_table_privilege(current_user,quote_ident(schemaname)||'.'||quote_ident(tablename),'INSERT') OR has_table_privilege(current_user,quote_ident(schemaname)||'.'||quote_ident(tablename),'UPDATE') OR has_table_privilege(current_user,quote_ident(schemaname)||'.'||quote_ident(tablename),'DELETE'))) AS writable_public_tables`;

async function productionReader(out: string, cachePath?: string) {
  if (cachePath) {
    const cache = await json<ProductionQueryCache>(join(cachePath, "index.json"));
    if (cache.source !== "Neon connector readonly transaction" || cache.productionProject !== "tiny-hill-13996172" || cache.productionBranch !== "br-delicate-lab-ax02xuo5" || cache.role !== "readonly" || cache.transactionReadOnly !== true) throw new Error("Production query cache lacks the exact production readonly connector provenance.");
    const provenance = { source: cache.source, productionProject: cache.productionProject, productionBranch: cache.productionBranch, role: cache.role, transactionReadOnly: cache.transactionReadOnly, responseBytes: 0, unmeteredResponses: 0, sourceQueriesUsed: 0, replayNetworkRequests: 0, measurement: "Saved Neon connector tool-response bytes", cachePath };
    const counted = new Set<string>();
    return { provenance,
      query: async (text: string, params: readonly unknown[] = []): Promise<Record<string, unknown>[]> => {
        const key = queryKey(text, params), record = await json<ProductionQueryRequest & { rows: Record<string, unknown>[]; checkedAt: string; responseBytes?: number }>(join(cachePath, `${key}.json`));
        if (!record || record.key !== key || record.text !== text || JSON.stringify(record.params) !== JSON.stringify(params) || !Array.isArray(record.rows) || !Number.isFinite(Date.parse(record.checkedAt))) throw new Error(`No saved production connector result for exact query ${key}.`);
        if (!counted.has(key)) {
          counted.add(key); provenance.sourceQueriesUsed++;
          if (typeof record.responseBytes === "number" && Number.isSafeInteger(record.responseBytes) && record.responseBytes >= 0) provenance.responseBytes += record.responseBytes;
          else provenance.unmeteredResponses++;
        }
        return record.rows;
      } };
  }
  const connection = process.env.WTP_PRODUCTION_DATABASE_URL_READONLY;
  if (!connection || new URL(connection).username !== "readonly") throw new Error("EO-01 replay requires the production readonly connection.");
  process.env.DATABASE_URL = connection;
  process.env.WTP_VITAL_SIGNS_REPORT = "1";
  installDatabaseTransferCounter();
  const sql = neon(connection);
  return { provenance: { source: "Neon HTTP readonly transaction", role: "readonly", transactionReadOnly: true }, query: async (text: string, params: readonly unknown[] = []) => {
    const [rows] = await withControlPlaneConnectRetry(() => sql.transaction([sql.query(text, [...params])], { readOnly: true }), {
      isRetryable: error => isTransientControlPlaneConnectError(error) || error instanceof Error && /HTTP status 503/.test(error.message) && /upstream connect error or disconnect\/reset before headers/.test(error.message) && !/PROVIDER_CIRCUIT_BROKEN/.test(error.message),
      onRetry: ({ attempt, delayMs, error }) => {
        const failure = { at: new Date().toISOString(), attempt, delayMs, detail: votingFailureDetail(error) };
        appendFileSync(`${out}/production-read-retries.jsonl`, JSON.stringify(failure) + "\n", { mode: 0o600 });
        console.error(`Production readonly source retry ${attempt}; backoff ${delayMs} ms.`);
      },
    });
    return rows as Record<string, unknown>[];
  } };
}

export async function loadLocalElectionOfficeReplayDocuments(sources: SourceDocument[]): Promise<LocalElectionOfficeDocument[]> {
  const documents: LocalElectionOfficeDocument[] = [];
  for (const source of sources) {
    const held = await readFile(source.path), bytes = /\.gz$/i.test(source.path) ? gunzipSync(held) : held;
    const documentHash = digest(bytes);
    if (source.sha256 && documentHash !== source.sha256) throw new Error(`Source document hash differs: ${source.url}.`);
    const text = source.textPath ? await readFile(source.textPath, "utf8") : decodeVotingBytes(bytes);
    documents.push({ url: source.url, checkedAt: source.checkedAt, contentType: source.contentType, bytes, text, documentHash });
  }
  return documents;
}

function placeForOffice(office: LocalElectionOffice, divisions: Map<string, Geography>): VotingReaderPlace | null {
  const division = divisions.get(office.divisionId);
  if (!division) return null;
  const countyId = division.divisionType === "county" ? division.ocdId : /^(.*\/county:[^/]+)/.exec(division.ocdId)?.[1];
  const county = (countyId ? divisions.get(countyId) : undefined) ?? (office.countyFips ? [...divisions.values()].find(row => row.divisionType === "county" && row.geoid === office.countyFips) : undefined);
  const place = emptyPlace(office.state);
  place.divisionIds = [...new Set([division.ocdId, ...(county ? [county.ocdId] : [])])];
  if (county) {
    if (county.geoid) place.countyFips = [county.geoid];
    place.countyNames = [county.label];
  }
  if (["place", "cousub", "county_subdivision"].includes(division.divisionType)) {
    place.towns = [division.label];
    if (division.geoid?.length === 10) place.countySubdivisionGeoids = [division.geoid];
    if (!place.countyFips.length && /^\d{10}$/.test(division.geoid ?? "")) place.countyFips = [division.geoid!.slice(0, 5)];
  }
  return place;
}

/** The same published registration metadata used by the reader, selected by exact division IDs. */
const REGISTRATION_DIVISIONS = `WITH pointer AS MATERIALIZED (
 SELECT p.current_version_id,p.payload,
  (p.current_version_id=p.last_known_good_version_id AND c.state='PROMOTED' AND c.acquisition_succeeded
   AND c.promoted_version_id=c.id AND c.last_known_good_version_id=c.id AND c.record_class=p.record_class AND c.scope=p.scope AND c.source_id=p.source_id
   AND p.validation_receipt->>'decision'='GOOD' AND p.validation_receipt->>'candidateId'=c.id AND p.validation_receipt->>'sourceId'=c.source_id
   AND p.validation_receipt->>'recordClass'=p.record_class AND p.validation_receipt->>'scope'=p.scope) AS published
 FROM civic_data_promotions p LEFT JOIN civic_data_candidates c ON c.id=p.current_version_id WHERE p.key=$1
) SELECT current_version_id,published,CASE WHEN published THEN (
 SELECT COALESCE(jsonb_agg(jsonb_build_object('ocdId',header.value->'ocdId','label',reader_payload_value(header.value->'label'),
  'divisionType',header.value->'divisionType','geoid',header.value->'geoid','parentOcdId',header.value->'parentOcdId')),'[]'::jsonb)
 FROM reader_payload_members(reader_payload_node(payload)->'divisions') d,LATERAL (SELECT reader_payload_node(d.item) AS value) header
 WHERE header.value->>'ocdId'=ANY($2::text[])
) END AS divisions FROM pointer`;

/** Produce exact bounded reads for the connected Neon tool when the executor's database route is unavailable. */
export async function localElectionOfficeProductionQueryRequests(manifestPath: string, addressesPath?: string): Promise<ProductionQueryRequest[]> {
  const manifest = await json<ReplayPartition[]>(manifestPath);
  const requests: ProductionQueryRequest[] = [{ key: queryKey(IDENTITY_SQL, []), text: IDENTITY_SQL, params: [] }];
  for (const entry of manifest) {
    const state = requireLocalElectionOfficeState(entry.state), projection = await json<LocalElectionOfficeFile>(entry.file);
    const ids = [...new Set(projection.offices.flatMap(office => [office.divisionId, /^(.*\/county:[^/]+)/.exec(office.divisionId)?.[1] ?? office.divisionId]))].sort();
    if (!ids.length) continue;
    const params = [`REGISTRATION:US-${state}:registration:v1`, ids];
    requests.push({ key: queryKey(REGISTRATION_DIVISIONS, params), state, text: REGISTRATION_DIVISIONS, params });
  }
  if (addressesPath) {
    const addresses = await json<ReplayAddress[]>(addressesPath);
    for (const state of [...new Set(addresses.map(address => requireLocalElectionOfficeState(address.state)))]) {
      await readStateReaderEntry(async (text, params) => {
        requests.push({ key: queryKey(text, params), state, text, params });
        return [];
      }, "VOTING_SITE", stateBallotScope("voting-sites", state));
    }
  }
  return requests;
}

async function censusAddressFromCapture(example: ReplayAddress, captures: ReplayAddressCapture[]) {
  const capture = captures.find(capture => capture.id === example.id && capture.state === example.state && capture.address === example.address);
  if (!capture || capture.attempts.length !== 1) throw new Error("No single native Census response was saved for the exact acceptance address.");
  const held = capture.attempts[0], bytes = await readFile(held.path);
  if (held.status !== 200 || held.bytes !== bytes.byteLength || held.sha256 !== digest(bytes) || !Number.isFinite(Date.parse(held.checkedAt))) throw new Error("The saved Census response failed its HTTP, byte hash, or checked-date proof.");
  const located = await censusVotingAddress(example.address, async request => {
    if (String(request) !== held.requestedUrl) throw new Error("The normal Census request differs from the captured acceptance request.");
    return new Response(new Uint8Array(bytes), { status: held.status, headers: { "content-type": held.contentType } });
  });
  return { located, source: { url: held.requestedUrl, checkedAt: held.checkedAt, documentHash: held.sha256, responseBytes: held.bytes, source: "Saved native Census HTTP response" } };
}

export async function replayLocalElectionOffices(input: { manifest: string; out: string; addresses?: string; addressCaptures?: string; states?: readonly string[]; sourceOnly?: boolean; productionQueryCache?: string }) {
  const manifest = await json<ReplayPartition[]>(input.manifest), addresses = input.addresses ? await json<ReplayAddress[]>(input.addresses) : [];
  const addressCaptures = input.addressCaptures ? (await json<{ results: ReplayAddressCapture[] }>(input.addressCaptures)).results : null;
  await mkdir(input.out, { recursive: true });
  const production = input.sourceOnly ? null : await productionReader(input.out, input.productionQueryCache);
  const query = production?.query ?? null;
  const identity = query ? (await query(IDENTITY_SQL))[0] : { mode: "SOURCE_ONLY", productionRead: "NOT_RUN" };
  if (query && (identity?.role !== "readonly" || identity?.read_only !== "on" || Number(identity?.writable_public_tables) !== 0)) throw new Error("Production readonly identity check failed.");
  const summaries: Record<string, unknown>[] = [];
  for (const state of input.states?.map(requireLocalElectionOfficeState) ?? LOCAL_ELECTION_OFFICES_STATES) {
    const entry = manifest.find(entry => entry.state.toUpperCase() === state);
    const failures: { office?: string; stage: string; detail: string }[] = [];
    const summary: Record<string, unknown> = { state, expected: entry?.expected ?? null, acquired: 0, sourceVerified: 0, distinctJurisdictions: 0, productionGeographyMatched: input.sourceOnly ? null : 0, usableReaderMatched: input.sourceOnly ? null : 0, productionGeographyConnection: input.sourceOnly ? "NOT_RUN_SOURCE_ONLY" : "PENDING", missingFields: {}, typedRead: "NOT_RECORDED", tomorrow: { status: "NOT_RUN_NO_USABLE_ROWS" }, zeroSitePageConnection: "PENDING_LV_01" };
    try {
      if (!entry) throw new Error("No acquired state partition was supplied.");
      requireLocalElectionOfficeState(entry.state);
      const projection = await json<LocalElectionOfficeFile>(entry.file);
      assertLocalElectionOfficeFile(projection);
      summary.acquired = projection.offices.length;
      summary.distinctJurisdictions = new Set(projection.offices.map(office => office.divisionId)).size;
      summary.acquiredMissingFields = Object.fromEntries(LOCAL_ELECTION_OFFICE_FIELDS.map(field => [field, projection.offices.filter(office => !office[field]).length]));
      if (entry.roster) {
        const roster = await json<{ divisions: { divisionId: string; name: string }[] }>(entry.roster);
        const held = new Set(projection.offices.map(office => office.divisionId));
        summary.expectedJurisdictions = roster.divisions.length;
        summary.missingJurisdictions = roster.divisions.filter(division => !held.has(division.divisionId));
      }
      const documents = await loadLocalElectionOfficeReplayDocuments(entry.documents), vault = new MemoryEvidenceStore();
      const prepared = prepareLocalElectionOfficeProjection({ projection, documents }), verified = prepared.projection.offices;
      for (const issue of prepared.issues.filter(issue => issue.id.endsWith(":source"))) failures.push({ office: issue.officeId, stage: "source-verification", detail: `${issue.field}: ${issue.reason}` });
      summary.sourceVerified = verified.length;
      summary.fullyVerifiedOffices = verified.filter(office => !prepared.issues.some(issue => issue.officeId === office.id && issue.id.endsWith(":source"))).length;
      summary.sourceVerifiedFields = verified.reduce((count, office) => count + Object.keys(office.fields).length, 0);
      summary.missingFields = Object.fromEntries(LOCAL_ELECTION_OFFICE_FIELDS.map(field => [field, verified.filter(office => !office[field]).length]));
      if (!verified.length) throw new Error("No acquired offices passed source verification.");
      const store = new MemoryRoutineDataStore(), candidate = await localElectionOfficesCandidate({ vault, projection: prepared.projection, documents });
      const at = new Date().toISOString();
      const outcome = await processRegisteredRoutineCandidate(store, localElectionOfficesContractId(state), candidate, at, undefined, { vault });
      if (!outcome.promoted && !outcome.confirmed) throw new Error(`Local replay promotion failed: ${outcome.candidate.failureDetail ?? outcome.candidate.state}.`);
      const typed = await readLocalElectionOffices(state, { store, now: at, bypassCache: true });
      summary.typedRead = typed.kind;
      if (typed.kind !== "PROMOTED") throw new Error(`Local typed read is ${typed.kind}.`);
      summary.localOfficeVersionId = typed.projection.versionId;
      summary.localOfficeSourceCheckedAt = typed.metadata.checkedAt ?? typed.metadata.retrievedAt;
      const task = routineTaskFromContract(requiredRoutineContract(localElectionOfficesContractId(state)));
      const clock = await store.clock(task.sourceId, task.recordClass, task.scope, task.parserVersion);
      const tomorrowAt = new Date(Date.parse(at) + 86_400_000).toISOString(), dueTomorrow = routineTaskDue(task, clock, Date.parse(tomorrowAt));
      const tomorrowRead = await readLocalElectionOffices(state, { store, now: tomorrowAt, bypassCache: true });
      const fieldDates = (file: LocalElectionOfficeFile) => JSON.stringify(file.offices.map(office => [office.id, office.directorySource?.checkedAt, ...LOCAL_ELECTION_OFFICE_FIELDS.map(field => [field, office.fields[field]?.checkedAt])]));
      const tomorrow = { at: tomorrowAt, task: task.id, sourceClock: clock, due: dueTomorrow, sourceFetchRequested: false, typedRead: tomorrowRead.kind,
        versionId: tomorrowRead.kind === "PROMOTED" ? tomorrowRead.projection.versionId : null,
        samePointer: tomorrowRead.kind === "PROMOTED" && tomorrowRead.projection.versionId === typed.projection.versionId,
        sameSourceCheckedAt: tomorrowRead.kind === "PROMOTED" && (tomorrowRead.metadata.checkedAt ?? tomorrowRead.metadata.retrievedAt) === (typed.metadata.checkedAt ?? typed.metadata.retrievedAt),
        sameFieldDates: tomorrowRead.kind === "PROMOTED" && fieldDates(tomorrowRead.value) === fieldDates(typed.value),
        usableReaderMatched: input.sourceOnly ? null as number | null : 0, status: "PENDING_PRODUCTION_GEOGRAPHY" };
      summary.tomorrow = tomorrow;
      if (dueTomorrow || !tomorrow.samePointer || !tomorrow.sameSourceCheckedAt || !tomorrow.sameFieldDates) failures.push({ stage: "tomorrow-scheduled-pass", detail: "The ordinary next-day clock or typed reader did not preserve the held source version and field check dates." });
      if (!query) {
        await save(`${input.out}/${state.toLowerCase()}.json`, { capturedAt: at, summary, failures, productionRead: "NOT_RUN_SOURCE_ONLY" });
      } else {
      const ids = [...new Set(projection.offices.flatMap(office => [office.divisionId, /^(.*\/county:[^/]+)/.exec(office.divisionId)?.[1] ?? office.divisionId]))].sort();
      const [registered] = await query(REGISTRATION_DIVISIONS, [`REGISTRATION:US-${state}:registration:v1`, ids]);
      if (registered?.published !== true) throw new Error("The production registration pointer is absent or invalid.");
      summary.productionRegistrationVersionId = registered.current_version_id;
      summary.productionGeographyConnection = production?.provenance.source;
      const divisions = new Map((registered.divisions as Geography[]).map(division => [division.ocdId, division]));
      const rowResults = [];
      for (const office of verified) {
        const place = placeForOffice(office, divisions);
        if (!place) { failures.push({ office: office.id, stage: "production-geography", detail: "Exact division was not found in the production registration." }); continue; }
        const division = divisions.get(office.divisionId)!;
        const countyId = division.divisionType === "county" ? division.ocdId : /^(.*\/county:[^/]+)/.exec(division.ocdId)?.[1];
        const county = (countyId ? divisions.get(countyId) : undefined) ?? (office.countyFips ? [...divisions.values()].find(row => row.divisionType === "county" && row.geoid === office.countyFips) : undefined);
        const identityProof = localElectionOfficeProductionIdentity(office, division, county);
        if (!identityProof.matched) {
          failures.push({ office: office.id, stage: "production-jurisdiction-identity", detail: JSON.stringify(identityProof) });
          rowResults.push({ office: office.id, divisionId: office.divisionId, identityMatched: false, identityProof, productionGeography: place, matched: false });
          continue;
        }
        summary.productionGeographyMatched = Number(summary.productionGeographyMatched) + 1;
        const matched = localElectionOfficesForPlace(typed.value, place).some(value => value.id === office.id);
        if (tomorrowRead.kind === "PROMOTED" && localElectionOfficesForPlace(tomorrowRead.value, place).some(value => value.id === office.id)) tomorrow.usableReaderMatched = Number(tomorrow.usableReaderMatched) + 1;
        if (matched) summary.usableReaderMatched = Number(summary.usableReaderMatched) + 1;
        else failures.push({ office: office.id, stage: "reader-lookup", detail: "Published office was not selected for its production geography." });
        rowResults.push({ office: office.id, divisionId: office.divisionId, identityMatched: true, identityProof, productionGeography: place, matched });
      }
      tomorrow.status = !dueTomorrow && tomorrow.samePointer && tomorrow.sameSourceCheckedAt && tomorrow.sameFieldDates && tomorrow.usableReaderMatched === verified.length
        ? "PROVEN_HELD_OFFICE_AND_SOURCE_CLOCKS" : "FAILED";
      const addressResults = [];
      for (const example of addresses.filter(example => example.state.toUpperCase() === state)) {
        try {
          const addressRead = addressCaptures ? await censusAddressFromCapture(example, addressCaptures) : { located: await censusVotingAddress(example.address), source: { source: "Live native Census HTTP response" } };
          const located = addressRead.located;
          let place: VotingReaderPlace, zipFallback: unknown;
          if (located) place = addCensusVotingGeographies({ ...emptyPlace(state), point: located.point }, located.payload);
          else {
            const zip = votingInputZip(example.address);
            if (!zip) throw new Error("The normal Census address reader returned no unique match and no ZIP fallback is available.");
            const direct = await indexedZipDivisionEntry(zip), selectedZip = direct ? zip : postalArea(zip)?.zcta ?? null;
            const entry = direct ?? await indexedZipDivisionEntry(selectedZip);
            place = votingPlaceFromZip(entry?.ids ?? []);
            place.precision = "ADDRESS";
            if (!entry || !selectedZip || !place.states.length) throw new Error("The ordinary ZIP fallback has no held membership for the acceptance address.");
            const shardPath = join(process.cwd(), "data", "derived", "zip-divisions", `${selectedZip.slice(0, 2)}.json`);
            zipFallback = { zip, selectedZip, entry, shardPath, shardSha256: digest(await readFile(shardPath)), source: "Ordinary reader indexedZipDivisionEntry fallback after native Census no-match", uniqueCounty: place.countyFips.length === 1 };
          }
          const scope = stateBallotScope("voting-sites", state), edge = await readStateReaderEntry(query, "VOTING_SITE", scope);
          const held = await readVotingSitesProjection(state, { edge });
          if (held.kind !== "PROMOTED") throw new Error(`Production voting-site read is ${held.kind}.`);
          const answer = await answerVotingSites(held.value as VotingSitesFile, place), offices = localElectionOfficesForPlace(typed.value, place);
          if (!offices.length) throw new Error("The reader's geography selected no acquired local election office.");
          addressResults.push({ id: example.id, officialAddressSource: example.officialAddressSource, addressGeographySource: addressRead.source, ...(zipFallback ? { zipFallback } : {}), place, productionVotingEntry: edge, heldAnswer: answer, matchedOffices: offices, zeroSitePageConnection: "PENDING_LV_01" });
        } catch (error) { failures.push({ office: example.id, stage: "address-example", detail: votingFailureDetail(error, example.address) }); }
      }
      await save(`${input.out}/${state.toLowerCase()}.json`, { capturedAt: at, summary, rowResults, addressResults, failures });
      }
    } catch (error) { failures.push({ stage: "state", detail: votingFailureDetail(error) }); }
    summary.failures = failures;
    summaries.push(summary);
    await save(`${input.out}/summary.json`, { checkedAt: new Date().toISOString(), identity, production: production?.provenance ?? null, localOfficePublication: "Local in-memory rehearsal of saved acquired evidence; no production local-office pointer exists yet", states: summaries, bytes: processNeonBytes(), wholeReaderPageProof: "PENDING_LV_01" });
    const { failures: _failures, ...counts } = summary;
    console.log(JSON.stringify({ ...counts, failureCount: failures.length, firstFailure: failures[0] }));
  }
  return summaries;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const manifest = argument("manifest"), out = argument("out");
  const requestsPath = argument("production-query-requests");
  if (manifest && requestsPath) {
    await save(requestsPath, await localElectionOfficeProductionQueryRequests(manifest, argument("addresses")));
    console.log(`Saved exact production readonly query requests: ${requestsPath}`);
  } else {
  if (!manifest || !out) throw new Error("Use --manifest=<state acquisition manifest> --out=<evidence directory> [--addresses=<public address examples>].");
  await replayLocalElectionOffices({ manifest, out, addresses: argument("addresses"), addressCaptures: argument("address-captures"), states: argument("states")?.split(","), sourceOnly: process.argv.includes("--source-only"), productionQueryCache: argument("production-query-cache") });
  }
}
