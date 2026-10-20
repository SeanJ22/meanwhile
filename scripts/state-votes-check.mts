import { votePagesIssue } from "../lib/state-rollcalls/vote-page-model.ts";
import { createVotePageSink } from "../lib/state-rollcalls/vote-page-writer.ts";
/** Each child owns one state/source. Production connections are read-only;
 * source captures and normalized member pages are written to the local audit
 * vault. No production refresh writer or promotion function is called. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";
import { neon } from "@neondatabase/serverless";
import { PLURAL_STATES } from "../lib/sources/plural/targets.ts";
import { currentPluralSessions, pluralJurisdictionsUrl } from "../lib/sources/plural/vote-acquisition.ts";
import { parsePluralBulkSessionFile } from "../lib/sources/plural/vote-bulk.ts";
import { acquireVoteSourceFile } from "../lib/state-rollcalls/source-file.ts";
import { acquireLegiscanVotes } from "../lib/sources/legiscan/vote-acquisition.ts";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { installDatabaseTransferCounter } from "../lib/db/transfer.ts";
import { keepNeonBytesInProcess, processNeonBytes } from "../lib/db/transfer-by-caller.ts";
import { readNativeMemberVotes, type NativeMemberVoteReaders } from "../lib/state-rollcalls/reader-votes.ts";
import { readVotePages } from "../lib/state-rollcalls/vote-pages.ts";
import type { Officeholder } from "../lib/officials/types.ts";
import type { PluralVoteFact } from "../lib/sources/plural/votes.ts";
import type { SeatHolder } from "../lib/officials/lookup.ts";

const argument = (key: string) => process.argv.find(value => value.startsWith(`--${key}=`))?.slice(key.length + 3);
const output = resolve(argument("out") ?? ".scratch/vt-01");
const writer = argument("phase") === "writer";
const bytesRead = () => processNeonBytes().reduce((sum, row) => sum + row.bytes.reader + row.bytes["control-plane"], 0);

async function prepareMetadata() {
  const directory = resolve(output, "metadata");
  try { for (const state of PLURAL_STATES) await readFile(resolve(directory, `${state}.json`)); return; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  await mkdir(directory, { recursive: true });
  if (!process.env.PLURAL_API_KEY) throw new Error("The existing Open States API key is required to discover public archives.");
  for (let page = 1, maximum = 1; page <= maximum; page++) {
    const response = await fetch(pluralJurisdictionsUrl(page), { headers: { "X-API-KEY": process.env.PLURAL_API_KEY }, signal: AbortSignal.timeout(60_000) });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Open States catalog HTTP ${response.status}; retry after ${response.headers.get("retry-after") ?? "publisher backoff"}.`);
    }
    const value = await response.json() as { results: { id: string }[]; pagination: { max_page: number } };
    maximum = value.pagination.max_page;
    for (const jurisdiction of value.results) {
      const state = /\/(?:state|district|territory):([a-z]{2})\/government$/.exec(jurisdiction.id)?.[1];
      if (state && PLURAL_STATES.includes(state)) await writeFile(resolve(directory, `${state}.json`), JSON.stringify(jurisdiction));
    }
  }
}

async function productionPriorIdentities(state: string, source: string) {
  if (source !== "openstates" || !["NC", "NM", "OK"].includes(state)) return new Map<string, { billId: string; session: string; organizationId: string }>();
  const snapshotPath = resolve(output, "prior-identities", `${state}-${source}.json`);
  let rows: { id: string; bill_id: string; session: string; organization_id: string }[];
  try { rows = JSON.parse(await readFile(snapshotPath, "utf8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const sql = neon(process.env.DATABASE_URL!);
    const result = await sql.transaction([sql.query(`WITH RECURSIVE root AS MATERIALIZED (
      SELECT p.payload FROM civic_data_promotions p JOIN civic_data_candidates c ON c.id=p.current_version_id
      WHERE p.record_class='STATE_ROLL_CALL' AND p.scope=$1 AND p.source_id='plural-openstates-votes'
        AND c.state='PROMOTED' AND p.current_version_id=p.last_known_good_version_id AND p.payload=c.candidate->'readModel'
    ), hashes(hash) AS (
      SELECT ref#>>'{}' FROM root,LATERAL jsonb_path_query(payload,'strict $.**."$civicPayloadPart"','{}',true) ref
      UNION SELECT ref#>>'{}' FROM hashes JOIN civic_data_payload_parts part USING(hash),
        LATERAL jsonb_path_query(part.payload,'strict $.**."$civicPayloadPart"','{}',true) ref
    ), nodes AS (
      SELECT payload AS node FROM root UNION ALL SELECT part.payload FROM hashes JOIN civic_data_payload_parts part USING(hash)
    ) SELECT DISTINCT vote->>'id' AS id,vote->>'billId' AS bill_id,vote->>'session' AS session,vote->>'organizationId' AS organization_id
      FROM nodes,LATERAL jsonb_path_query(node,'strict $.** ? (exists(@.billId) && exists(@.session) && exists(@.organizationId))','{}',true) vote`, [`US-${state}:openstates-votes:v1`])], { readOnly: true });
    rows = result[0] as typeof rows;
    await mkdir(resolve(output, "prior-identities"), { recursive: true }); await writeFile(snapshotPath, JSON.stringify(rows));
  }
  return new Map(rows.map(row => [row.id, { billId: row.bill_id, session: row.session, organizationId: row.organization_id }]));
}

async function productionRoster(state: string) {
  const snapshotPath = resolve(output, "rosters", `${state}.json`);
  try {
    const saved = JSON.parse(await readFile(snapshotPath, "utf8")) as { identity: { role: string; read_only: string; can_write: boolean }; versionId?: string; holders: Officeholder[] };
    assert.equal(saved.identity.role, "readonly"); assert.equal(saved.identity.read_only, "on"); assert.equal(saved.identity.can_write, false);
    return saved;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const sql = neon(process.env.DATABASE_URL!);
  const [identity, rows] = await sql.transaction([
    sql.query(`SELECT current_user AS role,current_setting('transaction_read_only') AS read_only,
      EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public' AND has_table_privilege(current_user,quote_ident(schemaname)||'.'||quote_ident(tablename),'INSERT,UPDATE,DELETE')) AS can_write`, []),
    sql.query(`WITH RECURSIVE root AS MATERIALIZED (
      SELECT p.current_version_id,p.payload FROM civic_data_promotions p JOIN civic_data_candidates c ON c.id=p.current_version_id
      WHERE p.record_class='STATE_LEGISLATOR' AND p.scope=$1 AND p.source_id='plural-openstates'
        AND c.state='PROMOTED' AND p.current_version_id=p.last_known_good_version_id
        AND p.payload=c.candidate->'readModel' AND p.validation_receipt->>'decision'='GOOD'
    ), hashes(hash) AS (
      SELECT ref#>>'{}' FROM root,LATERAL jsonb_path_query(payload,'strict $.**."$civicPayloadPart"','{}',true) ref
      UNION SELECT ref#>>'{}' FROM hashes JOIN civic_data_payload_parts part USING(hash),
        LATERAL jsonb_path_query(part.payload,'strict $.**."$civicPayloadPart"','{}',true) ref
    ), nodes AS (
      SELECT payload AS node FROM root UNION ALL SELECT part.payload FROM hashes JOIN civic_data_payload_parts part USING(hash)
    ), holders AS (
      SELECT DISTINCT holder FROM nodes,
        LATERAL jsonb_path_query(node,'strict $.** ? (@.level == "STATE" && exists(@.name) && exists(@.provenance.sourceUrl))','{}',true) holder
    ) SELECT root.current_version_id AS version_id,jsonb_build_object('id',holder->'id','personId',holder->'personId','name',holder->'name',
      'level',holder->'level','state',holder->'state','chamber',holder->'chamber','officeTitle',holder->'officeTitle',
      'nativeIds',holder->'nativeIds','websiteUrl',holder->'websiteUrl','profileUrls',holder->'profileUrls',
      'provenance',jsonb_build_object('sourceUrl',holder#>'{provenance,sourceUrl}')) AS holder FROM holders CROSS JOIN root`, [`US-${state}:openstates-people:v1`]),
  ], { readOnly: true });
  assert.equal(identity[0].role, "readonly"); assert.equal(identity[0].read_only, "on"); assert.equal(identity[0].can_write, false);
  const snapshot = { identity: identity[0], versionId: rows[0]?.version_id as string | undefined,
    holders: rows.map(row => row.holder as Officeholder) };
  await mkdir(resolve(output, "rosters"), { recursive: true });
  await writeFile(snapshotPath, JSON.stringify(snapshot));
  return snapshot;
}

async function auditState(state: string, source: string) {
  const started = performance.now(), databaseStart = bytesRead();
  const roster = await productionRoster(state);
  const priorIdentities = await productionPriorIdentities(state, source);
  const people = new Map(roster.holders.flatMap(holder => (holder.nativeIds?.["ocd-person"] ?? []).map(personId => [personId, holder] as const)));
  let sample: { holder: Officeholder; vote: PluralVoteFact; personId: string; position: string } | undefined;
  const missingPeople = new Set<string>();
  const vendorUnmatched = new Map<string, string>();
  const identityConflicts: string[] = [];
  const held = new Map<string, number>();
  const sessions: Record<string, unknown>[] = [];
  let rollCalls = 0, memberVotes = 0, unmatchedPositions = 0;
  const pageVault = new DurableEvidenceStore(resolve(output, "member-page-cache"));
  const sink = writer ? await createVotePageSink({ state, sourceId: source === "openstates" ? "plural-openstates-votes" : "legiscan", vault: pageVault, prior: null }) : null;
  const onVote = async (vote: PluralVoteFact) => {
    const prior = priorIdentities.get(vote.id);
    if (prior && (prior.billId !== vote.billId || prior.session !== vote.session || prior.organizationId !== vote.organizationId)) {
      const reason = "The native vote changed its bill, session or chamber identity; the earlier verified vote remains live.";
      identityConflicts.push(vote.id); held.set(reason, (held.get(reason) ?? 0) + 1); return;
    }
    const issue = await sink?.put(vote);
    if (issue) { held.set(issue, (held.get(issue) ?? 0) + 1); return; }
    rollCalls++; memberVotes += vote.positions.length;
    for (const position of vote.positions) {
      const holder = people.get(position.personId);
      if (!holder) missingPeople.add(position.personId);
      else if (!sample || vote.date > sample.vote.date) sample = { holder, vote, personId: position.personId, position: position.option };
    }
  };
  const store = new DurableEvidenceStore(resolve(output, "source-cache"));
  const { locks } = createMemoryRepositories();
  const signal = AbortSignal.timeout(30 * 60_000);
  const metadata = new Uint8Array(await readFile(resolve(output, "metadata", `${state.toLowerCase()}.json`)));
  if (source === "openstates") {
    for (const session of currentPluralSessions(metadata, state, new Date().toISOString())) {
      const sessionStarted = performance.now();
      if (!session.bulkUrl) {
        sessions.push({ session: session.identifier, status: "BULK_UNAVAILABLE", detail: "The publisher supplies no CSV archive for this session." });
        continue;
      }
      let release: Awaited<ReturnType<typeof acquireVoteSourceFile>> | undefined;
      try {
        release = await acquireVoteSourceFile({ sourceId: "plural-openstates-votes", releaseId: `${state.toLowerCase()}:session:${session.identifier}`,
          parserVersion: "plural-votes/2", url: session.bulkUrl, signal, maxBytes: 512 * 1024 * 1024, checkAfterMs: 86_400_000,
          allowedHosts: ["data.openstates.org"], store, locks });
        await release.capture();
        const evidence = { requestedUrl: release.requestedUrl, finalUrl: release.finalUrl, retrievedAt: release.retrievedAt, sha256: release.sha256, body: "" };
        const parsed = await parsePluralBulkSessionFile(state, session.identifier, release.path, evidence, { signal, onVote });
        await release.accept();
        unmatchedPositions += parsed.unmatchedPositions;
        for (const row of parsed.held) held.set(row.detail, (held.get(row.detail) ?? 0) + 1);
        sessions.push({ session: session.identifier, rollCalls: parsed.rollCalls, memberVotes: parsed.memberVotes,
          unmatchedPositions: parsed.unmatchedPositions, source: session.bulkUrl, sha256: release.sha256,
          runMs: Math.round(performance.now() - sessionStarted), status: "PARSED" });
      } catch (error) { sessions.push({ session: session.identifier, status: "FAILED", error: error instanceof Error ? error.message : String(error) }); }
      finally { await release?.dispose(); }
    }
  } else {
    try {
      const acquired = await acquireLegiscanVotes({ state, signal, holders: roster.holders, store, locks, onVote,
        onDataset: async result => {
          sessions.push({ session: result.session.sessionName, sessionId: result.session.sessionId, rollCalls: result.rollCalls, memberVotes: result.memberVotes,
            unmatchedPositions: result.unmatchedPositions, status: "PARSED", source: result.evidence.finalUrl });
        } });
      for (const result of acquired.completed) unmatchedPositions += result.unmatchedPositions;
      for (const row of acquired.held) {
        held.set(row.detail, (held.get(row.detail) ?? 0) + 1);
        if (row.key.startsWith("legiscan:people:")) vendorUnmatched.set(row.key, row.detail);
        if (row.key.startsWith("session:")) sessions.push({ session: row.key, status: "FAILED", error: row.detail });
      }
    } catch (error) { sessions.push({ session: "dataset-list", status: "FAILED", error: error instanceof Error ? error.message : String(error) }); }
  }
  let readerExample: unknown;
  if (sample) {
    const exact = sample;
    const projection = sink ? await sink.snapshot() : null;
    if (projection) assert.equal(votePagesIssue(projection), null);
    const rows = async () => projection
      ? (await readVotePages(pageVault, projection, exact.personId)).map(vote => ({ ...vote, position: vote.positions[0].option }))
      : [{ ...exact.vote, positions: [exact.vote.positions.find(row => row.personId === exact.personId)!], position: exact.position }];
    const readers: NativeMemberVoteReaders = { holder: async () => exact.holder as unknown as SeatHolder, nh: async () => null, official: async () => null,
      plural: source === "openstates" ? rows : async () => [], legiscan: source === "legiscan" ? rows : async () => [] };
    const readerStarted = performance.now();
    const rendered = await readNativeMemberVotes(exact.holder.id, readers, { state });
    const readerMs = performance.now() - readerStarted;
    assert.equal(rendered?.status, "HELD"); assert.ok(rendered.votes.length);
    const first = rendered.votes[0];
    assert.ok(first.title && first.question && first.date && first.position && first.result && first.rollCallUrl);
    readerExample = { member: exact.holder.id, personId: exact.personId, name: exact.holder.name, status: rendered.status, vote: first, readerMs,
      ...(projection ? { memberPages: projection.memberPages?.length, memberReadVotes: rendered.votes.length } : {}) };
  }
  if (sink && !sample) assert.equal(votePagesIssue(await sink.snapshot()), null);
  await sink?.close();
  const result = { state, source, phase: writer ? "writer" : "parse", at: new Date().toISOString(), productionReadOnly: roster.identity, rosterVersion: roster.versionId,
    rosterMembers: roster.holders.length, sessions, rollCalls, memberVotes, unmatchedPositions,
    unmatchedMembers: [
      ...[...missingPeople].map(personId => ({ personId, reason: "The source native person is absent from the held current Open States roster; its historical native vote remains publishable." })),
      ...[...vendorUnmatched].map(([personId, reason]) => ({ personId, reason })),
    ],
    held: [...held].map(([reason, records]) => ({ reason, records })), priorIdentityRows: priorIdentities.size, identityConflicts, readerExample,
    databaseBytes: bytesRead() - databaseStart, peakRssBytes: process.resourceUsage().maxRSS * 1024, runMs: Math.round(performance.now() - started) };
  await mkdir(resolve(output, "states"), { recursive: true });
  await writeFile(resolve(output, "states", `${state}-${source}${writer ? "-writer" : ""}.json`), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ state, source, sessions: sessions.length, rollCalls, memberVotes, unmatchedPositions,
    databaseBytes: result.databaseBytes, peakRssBytes: result.peakRssBytes, runMs: result.runMs, failed: sessions.filter(row => row.status !== "PARSED") }));
}

async function main() {
  const envFile = argument("env");
  if (!envFile) throw new Error("An existing production readonly env file is required (--env=...)");
  Object.assign(process.env, parseEnv(await readFile(envFile, "utf8")));
  if (new URL(process.env.DATABASE_URL!).username !== "readonly") throw new Error("The production readonly role is required");
  process.env.WTP_VITAL_SIGNS_REPORT = "1";
  keepNeonBytesInProcess(); installDatabaseTransferCounter();
  const state = argument("state"), source = argument("source") ?? "openstates";
  await prepareMetadata();
  if (state) { await auditState(state.toUpperCase(), source); return; }
  const states = PLURAL_STATES.map(state => state.toUpperCase()).sort();
  let next = 0, failures = 0;
  await Promise.all(Array.from({ length: 2 }, async () => {
    while (next < states.length) {
      const state = states[next++];
      if (process.argv.includes("--resume")) {
        try { await readFile(resolve(output, "states", `${state}-${source}${writer ? "-writer" : ""}.json`)); continue; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      }
      await new Promise<void>((resolveChild, reject) => {
        const child = spawn(process.execPath, ["--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs", process.argv[1], `--env=${envFile}`, `--out=${output}`, `--source=${source}`, `--state=${state}`, ...(writer ? ["--phase=writer"] : [])], { stdio: ["ignore", "pipe", "pipe"], env: process.env });
        let diagnostic = "";
        child.stdout.on("data", chunk => process.stdout.write(chunk)); child.stderr.on("data", chunk => { diagnostic += chunk; });
        child.on("error", reject);
        child.on("exit", code => {
          if (code) { failures++; console.error(JSON.stringify({ state, source, exitCode: code, diagnostic })); }
          resolveChild();
        });
      });
    }
  }));
  if (failures) throw new Error(`${failures} state/source audit jobs failed; inspect the per-state diagnostics.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
