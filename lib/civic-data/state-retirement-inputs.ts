import { temporaryPath } from "./temporary-path.ts";
import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { REGISTRY_STATES, stateBallotContractId, stateBallotScope, type StateBallotFamily } from "./state-scopes.ts";
import { registryJurisdictions, stateRegistryRuntimeContractId, stateRegistryRuntimeScope } from "./state-scopes.ts";
import { retirementMemberKey, sealStateRetirementUnit } from "./state-retirement-proof.ts";
import type { RoutineRecordClass } from "./types.ts";
import type { GenericBallotProjection } from "../ballot/generic-projection.ts";
import type { BallotSet } from "../ballot/types.ts";

type Row = Record<string, unknown>;
type StateRetirementQuery = (text: string, params: readonly unknown[]) => Promise<readonly Row[]>;
type StateRetirementRows = (text: string, params: readonly unknown[], onRow: (row: Row) => Promise<void>) => Promise<void>;
type StateRetirementFamily = StateBallotFamily | "registry-runtime";
export interface StateRetirementUnit {
  readonly family: StateRetirementFamily; readonly state: string; readonly contractId: string;
  readonly recordClass: RoutineRecordClass; readonly scope: string; readonly originVersionId: string;
  readonly inputFile: string; readonly inputHash: string; readonly fileSha256: string; readonly seal: string;
}
export type StateRetirementOrigin = { family: StateRetirementFamily; recordClass: RoutineRecordClass | "BALLOT_FILING"; scope: string; versionId: string; promotedAt: string; hash: string };
type SqlValue = string | number | null;
interface Statement { run(...params: SqlValue[]): void; get(...params: SqlValue[]): Record<string, SqlValue> | undefined; iterate(...params: SqlValue[]): Iterable<Record<string, SqlValue>> }
interface Database { exec(sql: string): void; prepare(sql: string): Statement; close(): void }
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new (path: string) => Database };
const object = (value: unknown): Row => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const text = (value: unknown) => typeof value === "string" ? value : "";
const arrays = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
type Part = { readonly hash: string; readonly payload: unknown };
const reference = (value: unknown): string | null => typeof object(value).$civicPayloadPart === "string" ? String(object(value).$civicPayloadPart) : null;
const CACHED_PART_BYTES = 2 * 1024 * 1024;

class StreamedCivicPayload {
  private readonly cached = new Map<string, { value: unknown; size: number }>();
  private cachedBytes = 0;
  private readonly borrowed = new WeakSet<object>();
  private readonly directory: string;
  private readonly readParts: (hashes: readonly string[]) => Promise<readonly Part[]>;
  constructor(directory: string, readParts: (hashes: readonly string[]) => Promise<readonly Part[]>) { this.directory = directory; this.readParts = readParts; }

  private async part(hash: string): Promise<unknown> {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("STATE_RETIREMENT_PART_HASH_INVALID");
    if (this.cached.has(hash)) return this.cached.get(hash)!.value;
    let value: unknown, encoded: string;
    try { encoded = await readFile(join(this.directory, `${hash}.json`), "utf8"); value = JSON.parse(encoded); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const held = (await this.readParts([hash])).find(part => part.hash === hash);
      if (!held) throw new Error(`STATE_RETIREMENT_PART_MISSING:${hash}`);
      value = held.payload;
      await mkdir(temporaryPath(this.directory), { recursive: true, mode: 0o700 });
      encoded = JSON.stringify(value);
      await writeFile(temporaryPath(join(this.directory, `${hash}.json`)), encoded, { mode: 0o600, flag: "wx" });
    }
    const borrow = (value: unknown): void => {
      if (!value || typeof value !== "object" || this.borrowed.has(value)) return;
      this.borrowed.add(value);
      for (const child of Object.values(value)) borrow(child);
    };
    borrow(value);
    const size = Buffer.byteLength(encoded);
    if (size <= CACHED_PART_BYTES) {
      this.cached.set(hash, { value, size }); this.cachedBytes += size;
      for (const [key, held] of this.cached) {
        if (this.cached.size <= 8 && this.cachedBytes <= CACHED_PART_BYTES) break;
        this.cached.delete(key); this.cachedBytes -= held.size;
      }
    }
    return value;
  }

  async node(value: unknown): Promise<unknown> {
    const hash = reference(value);
    if (!hash) return value;
    const part = await this.part(hash);
    return object(part).kind === "object" ? object(part).value : part;
  }

  async load(value: unknown): Promise<unknown> {
    const hash = reference(value);
    if (hash) {
      const part = await this.part(hash), shape = object(part);
      if (shape.kind === "object") return this.load(shape.value);
      if (shape.kind === "string") {
        let text = "";
        for (const chunk of shape.chunks as unknown[]) text += String(await this.load(chunk));
        return text;
      }
      if (shape.kind === "array") {
        const rows: unknown[] = [];
        for await (const row of this.members(value)) rows.push(row);
        return rows;
      }
      return this.load(part);
    }
    if (Array.isArray(value)) {
      const rows = this.borrowed.has(value) ? [...value] : value;
      for (let index = 0; index < rows.length; index++) rows[index] = await this.load(rows[index]);
      return rows;
    }
    if (value !== null && typeof value === "object") {
      const rows = this.borrowed.has(value) ? { ...object(value) } : object(value);
      for (const key of Object.keys(rows)) rows[key] = await this.load(rows[key]);
      return rows;
    }
    return value;
  }

  async *members(value: unknown): AsyncGenerator<unknown> {
    const node = await this.node(value);
    if (Array.isArray(node)) { for (const row of node) yield await this.load(row); return; }
    const shape = object(node);
    if (shape.kind !== "array") throw new Error("STATE_RETIREMENT_ARRAY_INVALID");
    const groups = shape.groups as unknown[], positions = groups.map(() => 0);
    const order = JSON.parse(String(await this.load(shape.order))) as number[];
    const held = new Map<number, unknown[]>();
    for (const index of order) {
      if (!Number.isInteger(index) || index < 0 || index >= groups.length) throw new Error("STATE_RETIREMENT_ARRAY_ORDER_INVALID");
      let group = held.get(index);
      if (!group) {
        const rows = await this.node(groups[index]);
        if (!Array.isArray(rows)) throw new Error("STATE_RETIREMENT_ARRAY_GROUP_INVALID");
        group = rows; held.set(index, group);
        if (held.size > 4) held.delete(held.keys().next().value!);
      }
      if (positions[index] >= group.length) throw new Error("STATE_RETIREMENT_ARRAY_POSITION_INVALID");
      yield await this.load(group[positions[index]++]);
    }
  }

}

const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : [];
const omitted = (value: Row, keys: readonly string[]): Row => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
const nameForm = (value: string) => value.toLowerCase().normalize("NFC").replace(/\./g, "").replace(/[^\p{L}\p{N}_]+/gu, " ").trim();

function arizona(ballot: Row, legacy: Row): Row[] {
  const filings = object(legacy.candidateFilings), registry = object(legacy.identityRegistry);
  const contests = rows(ballot.contests), core = rows(ballot.candidacies), candidates = new Map(core.map(row => [text(row.id), row]));
  const contestIds = new Map<string, string>(), identityContests = new Map<string, string>();
  const vintages = new Set(contests.map(row => text(row.divisionVintage)).filter(Boolean));
  for (const filed of rows(filings.contests)) {
    const identities = rows(registry.contests).filter(row => Array.isArray(row.canonicalContestIds) && row.canonicalContestIds.includes(filed.id));
    if (identities.length !== 1) throw new Error(`STATE_RETIREMENT_AZ_CONTEST_IDENTITY_AMBIGUOUS:${filed.id}`);
    const identity = identities[0], aliases = identity.canonicalContestIds as string[];
    const matches = contests.filter(row => aliases.includes(text(row.id)));
    if (matches.length > 1) throw new Error(`STATE_RETIREMENT_AZ_CONTEST_ALIAS_AMBIGUOUS:${filed.id}`);
    if (!matches.length && vintages.size !== 1) throw new Error(`STATE_RETIREMENT_AZ_DIVISION_VINTAGE_AMBIGUOUS:${filed.id}`);
    const contest = matches[0] ?? { id: filed.id, electionId: object(ballot.election).id, ocdId: filed.ocdId,
      divisionVintage: [...vintages][0], title: filed.title, type: "CANDIDACY", voteFor: null, termYears: null, scopeNote: null, provenance: filed.provenance };
    if (!matches.length) contests.push(contest);
    contest.filing = { id: filed.id, publishedTitle: filed.publishedTitle, provenance: filed.provenance };
    contest.identity = { identityId: identity.identityId, level: identity.level, financeFilingAuthority: identity.financeFilingAuthority };
    contestIds.set(text(filed.id), text(contest.id)); identityContests.set(text(identity.identityId), text(contest.id));
  }
  const filingsByIdentity = new Map<string, Row>();
  for (const filed of rows(filings.candidacies)) {
    const contestId = contestIds.get(text(filed.contestId));
    if (!contestId) throw new Error(`STATE_RETIREMENT_AZ_FILING_CONTEST_MISSING:${filed.id}`);
    const matches = rows(registry.candidates).filter(identity => identityContests.get(text(identity.contestIdentityId)) === contestId
      && identity.partyLabel === filed.partyLabel && rows(identity.nameForms).some(form => nameForm(text(form.form)) === nameForm(`${text(filed.givenName)} ${text(filed.familyName)}`)));
    const heldId = text(object(filed.heldIdentityJoin).heldCandidacyId);
    const explicit = heldId ? rows(registry.candidates).filter(identity => identity.canonicalCandidacyId === heldId) : [];
    const identities = explicit.length ? explicit : matches;
    if (identities.length !== 1) throw new Error(`STATE_RETIREMENT_AZ_CANDIDATE_IDENTITY_AMBIGUOUS:${filed.id}`);
    const identity = identities[0], candidateId = text(identity.canonicalCandidacyId) || heldId || text(filed.id);
    let candidate = candidates.get(candidateId);
    if (!candidate) {
      candidate = { id: candidateId, contestId, givenName: filed.givenName, familyName: filed.familyName, partyLabel: filed.partyLabel,
        provenance: filed.provenance, slogan: null, incumbent: null, websiteUrl: null };
      candidates.set(candidateId, candidate);
    }
    if (candidate.contestId !== contestId) throw new Error(`STATE_RETIREMENT_AZ_CANDIDATE_CONTEST_MISMATCH:${filed.id}`);
    candidate.identity = omitted(identity, ["displayName", "givenName", "familyName", "partyLabel", "canonicalCandidacyId", "contestIdentityId"]);
    candidate.filing = omitted(filed, ["givenName", "familyName", "partyLabel", "contestId"]);
    const identityId = text(identity.identityId);
    if (filingsByIdentity.has(identityId)) throw new Error(`STATE_RETIREMENT_AZ_DUPLICATE_FILING_IDENTITY:${identityId}`);
    filingsByIdentity.set(identityId, filed);
  }
  const patches: Row[] = [];
  for (const identity of rows(registry.candidates)) {
    if (filingsByIdentity.has(text(identity.identityId))) continue;
    const candidate = candidates.get(text(identity.canonicalCandidacyId));
    if (candidate) candidate.identity = omitted(identity, ["displayName", "givenName", "familyName", "partyLabel", "canonicalCandidacyId", "contestIdentityId"]);
    else patches.push(identity);
  }
  ballot.contests = contests; ballot.candidacies = []; ballot.filingCandidacies = [...rows(ballot.filingCandidacies), ...candidates.values()];
  for (const field of ["generalLineup", "measureAnalyses", "lineupReconciliation"]) if (legacy[field] !== undefined) ballot[field] = legacy[field];
  return patches;
}

function retirementBallotPayload(scope: string, payload: Row, aggregate?: BallotSet["sourceAggregates"]): {
  payload: GenericBallotProjection; identityPatches: readonly { ballotKey: string; identity: Row }[];
} {
  const state = scope === "US-AZ:2026-general:supported-ballot" ? "AZ" : scope === "US-NH:merrimack:2026-general" ? "NH"
    : scope === "US-NJ:county:morris:2026-general" ? "NJ" : null;
  if (!state) throw new Error(`STATE_RETIREMENT_LEGACY_BALLOT_SCOPE_INVALID:${scope}`);
  const ballot = object(payload.ballot), election = object(ballot.election);
  if (election.state !== state || typeof election.id !== "string") throw new Error(`STATE_RETIREMENT_LEGACY_BALLOT_STATE_INVALID:${scope}`);
  const facts = omitted(ballot, ["formatVersion", "curatedAt", "curatorNote"]), ballotKey = `${state}:${election.id}`;
  const identityPatches = state === "AZ" ? arizona(facts, payload).map(identity => ({ ballotKey, identity })) : [];
  if (state === "NH") { facts.filingCandidacies = [...rows(facts.filingCandidacies), ...rows(facts.candidacies)]; facts.candidacies = []; }
  if (state === "NJ") {
    facts.contacts = rows(object(payload.contacts).contacts).map(contact => omitted(contact, ["givenName", "familyName", "route"]));
    if (aggregate?.length) facts.sourceAggregates = [...rows(facts.sourceAggregates), ...aggregate];
  }
  return { payload: { kind: "ballot-contests", ballots: { [ballotKey]: facts as unknown as BallotSet } }, identityPatches };
}

interface CursorClient {
  query(text: string, params?: unknown[]): Promise<{ readonly rows: readonly Row[] }>;
}

export async function withRetirementSourceCursor<T>(client: CursorClient, read: (source: {
  query: (text: string, params: readonly unknown[]) => Promise<readonly Row[]>;
  streamRows: (text: string, params: readonly unknown[], onRow: (row: Row) => Promise<void>) => Promise<void>;
}) => Promise<T>): Promise<T> {
  await client.query("BEGIN READ ONLY");
  let sequence = 0;
  try {
    return await read({
      query: async (text, params) => (await client.query(text, [...params])).rows,
      streamRows: async (text, params, onRow) => {
        const cursor = `state_retirement_${++sequence}`;
        await client.query(`DECLARE ${cursor} NO SCROLL CURSOR FOR ${text}`, [...params]);
        try {
          while (true) {
            const { rows } = await client.query(`FETCH FORWARD 1 FROM ${cursor}`);
            if (!rows.length) break;
            if (rows.length !== 1) throw new Error("STATE_RETIREMENT_CURSOR_ROW_COUNT_INVALID");
            await onRow(rows[0]);
          }
        } finally { await client.query(`CLOSE ${cursor}`); }
      },
    });
  } finally { await client.query("ROLLBACK"); }
}

class Spool {
  readonly db: Database;
  private readonly statements = new Map<string, Statement>();
  statement(sql: string): Statement {
    let held = this.statements.get(sql);
    if (!held) { held = this.db.prepare(sql); this.statements.set(sql, held); }
    return held;
  }
  constructor(path: string) {
    this.db = new DatabaseSync(temporaryPath(path));
    this.db.exec("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS members(origin TEXT,state TEXT,field TEXT,id TEXT,value TEXT,position INTEGER,PRIMARY KEY(origin,state,field,id)); CREATE TABLE IF NOT EXISTS transfer_rows(origin TEXT,state TEXT,path TEXT,id TEXT,value TEXT,position INTEGER,patch TEXT,PRIMARY KEY(origin,state,position)); CREATE TABLE IF NOT EXISTS bindings(id TEXT,state TEXT,evidence TEXT,PRIMARY KEY(id,state)); CREATE TABLE IF NOT EXISTS urls(origin TEXT,state TEXT,url TEXT,PRIMARY KEY(origin,state,url)); CREATE TABLE IF NOT EXISTS evidence_refs(origin TEXT,state TEXT,id TEXT,PRIMARY KEY(origin,state,id));");
    this.db.exec("CREATE INDEX IF NOT EXISTS members_order ON members(origin,state,field,position,id)");
  }
  bind(id: string, states: readonly string[], evidence: unknown): void {
    if (!id) return;
    for (const state of states) this.statement("INSERT OR IGNORE INTO bindings VALUES(?,?,?)").run(id, state, JSON.stringify(evidence));
  }
  states(id: unknown): string[] {
    if (typeof id !== "string") return [];
    const direct = registryJurisdictions(id);
    return [...new Set([...direct, ...Array.from(this.statement("SELECT state FROM bindings WHERE id=? ORDER BY state").iterate(id), row => String(row.state))])];
  }
  add(origin: string, state: string, field: string, id: string, value: unknown, position: number): void {
    const serialized = JSON.stringify(value);
    const held = this.statement("SELECT value FROM members WHERE origin=? AND state=? AND field=? AND id=?").get(origin, state, field, id);
    if (held && held.value !== serialized) throw new Error(`STATE_RETIREMENT_DUPLICATE_ID:${field}:${id}`);
    this.statement("INSERT OR IGNORE INTO members VALUES(?,?,?,?,?,?)").run(origin, state, field, id, serialized, position);
    const visit = (item: unknown) => {
      if (typeof item === "string" && /^https?:\/\//.test(item)) this.statement("INSERT OR IGNORE INTO urls VALUES(?,?,?)").run(origin, state, item);
      else if (Array.isArray(item)) item.forEach(visit);
      else if (item && typeof item === "object") Object.values(item).forEach(visit);
    };
    visit(value);
  }
  bindEvidence(origin: string, state: string, value: unknown): void {
    const references = new Set(["approvalItemId", "approvalRecordId", "artifactId", "sourceArtifactId", "attemptId", "recordId", "doorId", "fingerprint", "versionId", "memberKey"]);
    const visit = (item: unknown) => {
      if (Array.isArray(item)) item.forEach(visit);
      else if (item && typeof item === "object") for (const [key, child] of Object.entries(item)) {
        if (references.has(key) && typeof child === "string") this.statement("INSERT OR IGNORE INTO evidence_refs VALUES(?,?,?)").run(origin, state, child);
        else if (child && typeof child === "object") visit(child);
      }
    };
    visit(value);
  }
  rows(origin: string, state: string, field: string): Iterable<Record<string, SqlValue>> {
    return this.statement("SELECT id,value FROM members WHERE origin=? AND state=? AND field=? ORDER BY position,id").iterate(origin, state, field);
  }
}

class Source {
  readonly origin: StateRetirementOrigin;
  readonly query: StateRetirementQuery;
  readonly decoder: StreamedCivicPayload;
  readonly streamRows: StateRetirementRows;
  constructor(origin: StateRetirementOrigin, query: StateRetirementQuery, decoder: StreamedCivicPayload, streamRows: StateRetirementRows) {
    this.origin = origin; this.query = query; this.decoder = decoder; this.streamRows = streamRows;
  }
  private expression(path: readonly string[]): { sql: string; params: unknown[] } {
    let sql = "c.candidate"; const params: unknown[] = [this.origin.versionId];
    for (const key of path) { params.push(key); sql = `reader_payload_node(${sql})->$${params.length}::text`; }
    return { sql, params };
  }
  async value(path: readonly string[], omit: readonly string[] = []): Promise<unknown> {
    const { sql, params } = this.expression(path);
    let value = `reader_payload_node(${sql})`;
    if (omit.length) { params.push(omit); value += `-$${params.length}::text[]`; }
    const rows = await this.query(`SELECT ${value} AS value FROM civic_data_candidates c WHERE c.id=$1`, params);
    return this.decoder.load(rows[0]?.value);
  }
  async *members(path: readonly string[]): AsyncGenerator<unknown> {
    const { sql, params } = this.expression(path);
    const rows = await this.query(`SELECT jsonb_typeof(${sql}) AS type,CASE WHEN ${sql} ? '$civicPayloadPart' THEN ${sql} ELSE NULL END AS value FROM civic_data_candidates c WHERE c.id=$1`, params);
    if (!rows[0]?.type || rows[0].type === "null") return;
    if (rows[0].value) { yield* this.decoder.members(rows[0].value); return; }
    let pending: Row | undefined, resume: (() => void) | undefined, wake: (() => void) | undefined, finished = false, cancelled = false, failure: unknown;
    const stop = new Error("STATE_RETIREMENT_CURSOR_CONSUMER_CLOSED");
    const producer = this.streamRows(`SELECT e.value FROM civic_data_candidates c,LATERAL jsonb_array_elements(${sql}) WITH ORDINALITY e(value,position) WHERE c.id=$1 ORDER BY e.position`, params,
      row => new Promise<void>((resolve, reject) => {
        if (cancelled) { reject(stop); return; }
        pending = row; resume = resolve; wake?.(); wake = undefined;
      })).catch(error => { if (error !== stop) failure = error; }).finally(() => { finished = true; wake?.(); wake = undefined; });
    try {
      while (!finished || pending) {
        if (!pending) { await new Promise<void>(resolve => { wake = resolve; }); continue; }
        const row = pending; pending = undefined;
        yield await this.decoder.load(row.value);
        resume?.(); resume = undefined;
      }
      if (failure) throw failure;
    } finally { cancelled = true; resume?.(); await producer; }
  }
  async entries(path: readonly string[], onEntry: (id: string, value: unknown) => void | Promise<void>): Promise<void> {
    const { sql, params } = this.expression(path);
    await this.streamRows(`SELECT e.key,e.value FROM civic_data_candidates c,LATERAL jsonb_each(reader_payload_node(${sql})) e WHERE c.id=$1 ORDER BY e.key`, params,
      async row => { await onEntry(String(row.key), await this.decoder.load(row.value)); });
  }
}

async function holderBindings(query: StateRetirementQuery, spool: Spool): Promise<void> {
  const sources = await query("SELECT record_class,scope,current_version_id FROM civic_data_promotions WHERE record_class IN ('STATE_LEGISLATOR','FEDERAL_DIRECTORY') ORDER BY scope", []);
  for (const source of sources) {
    const state = registryJurisdictions(source.scope)[0];
    if (source.record_class === "STATE_LEGISLATOR" && state) {
      const rows = await query("SELECT h->>'id' id,h->>'personId' person_id FROM civic_data_promotions p,LATERAL jsonb_array_elements(p.payload->'roster'->'officeholders') h WHERE p.record_class=$1 AND p.scope=$2 AND p.current_version_id=$3", [source.record_class, source.scope, source.current_version_id]);
      for (const row of rows) {
        spool.bind(text(row.id), [state], source); spool.bind(text(row.person_id), [state], source);
        const uuid = /^plural:[a-z]{2}:([0-9a-f-]+)$/i.exec(text(row.id))?.[1];
        if (uuid) spool.bind(`plural:${uuid}`, [state], source);
      }
    } else if (source.scope === "US:current-congress-directory") {
      const rows = await query("SELECT h->>'officeholderId' id,h->>'ocdId' division FROM civic_data_promotions p,LATERAL jsonb_array_elements(p.payload->'roster'->'divisions') h WHERE p.record_class=$1 AND p.scope=$2 AND p.current_version_id=$3", [source.record_class, source.scope, source.current_version_id]);
      for (const row of rows) spool.bind(text(row.id), registryJurisdictions(row.division), source);
    }
  }
}

async function profileHuntBindings(source: Source, spool: Spool): Promise<Map<string, string>> {
  const identities = new Set<string>();
  for await (const value of source.members(["identities"])) {
    const row = object(value);
    if (row.jurisdiction === "US-NJ") identities.add(text(row.subjectId));
  }
  const contacts = await source.query("SELECT p.current_version_id,reader_payload_node(reader_payload_node(p.payload)->'contacts') AS contacts FROM civic_data_promotions p WHERE p.record_class='BALLOT_FILING' AND p.scope='US-NJ:county:morris:2026-general'", []);
  const contactRows = contacts[0]?.contacts ? await source.decoder.load(contacts[0].contacts) : [];
  const emails = new Map(arrays(object(contactRows).contacts).map(value => [text(object(value).candidacyId), text(object(value).email)]));
  const accepted = new Map<string, string>();
  const bind = (name: string, host: string, evidence: unknown) => {
    const key = `promotion-0823:${name}`;
    spool.bind(key, ["NJ"], evidence); accepted.set(key, host);
  };
  const alice = "ballot-nj-morris:dover-town-member-of-the-town-council-ward-3-place-dover:plastoris-alice";
  if (emails.get(alice)?.toLowerCase() === "aplastoris@plastoris.com") bind("Alice Plastoris", "plastoris.com", { kind: "OFFICIAL_FILING_CONTACT_HOST", versionId: contacts[0].current_version_id, candidacyId: alice, host: "plastoris.com" });
  const rita = "ballot-nj-morris:harding-township-member-of-the-township-committee-place-harding-township:chipperson-rita-c";
  if (identities.has(rita) && emails.get(rita)?.toLowerCase() === "rcc@chippersonlaw.com") bind("Rita C. Chipperson", "chippersonlaw.com", { kind: "HELD_PROFILE_AND_FILING_CONTACT_HOST", versionId: contacts[0].current_version_id, candidacyId: rita, host: "chippersonlaw.com" });
  const meghan = "ballot-nj-morris:randolph-township-member-of-the-township-council-place-randolph-township:lynch-meghan";
  if (identities.has(meghan)) bind("Meghan Lynch", "meghan-lynch-njsn.squarespace.com", { kind: "HELD_PROFILE_JURISDICTION", versionId: source.origin.versionId, candidacyId: meghan });
  const notes = JSON.parse(await readFile(new URL("../control-plane/field-manual-notes.json", import.meta.url), "utf8")) as Row[];
  const note = notes.find(row => row.id === "fm-5f5795dfd54939d619397c01");
  if (note && arrays(note.states).length === 1 && note.states instanceof Array && note.states[0] === "nj" && note.url === "https://dawkinswarrington.com")
    bind("Clifford D. Dawkins", "dawkinswarrington.com", { kind: "EXISTING_OPERATIONAL_JURISDICTION", noteId: note.id, url: note.url, observedAt: note.observedAt });
  return accepted;
}

async function route(source: Source, spool: Spool, unassigned: Row[]): Promise<Row> {
  const { family, versionId: origin } = source.origin, payload = ["readModel"], metadata: Row = {};
  const add = (field: string, id: string, row: unknown, states: readonly string[], position: number) => {
    if (!states.length) { unassigned.push({ family, field, id, originVersionId: origin }); return; }
    for (const state of new Set(states)) {
      spool.add(origin, state, field, id, row, position);
      if (family === "candidate-campaign-sites-derived") spool.bindEvidence(origin, state, row);
    }
  };
  if (family === "ballot-contests" && source.origin.scope !== "US:state-election-ballots") {
    const legacy = object(await source.value(payload));
    const aggregate = source.origin.recordClass === "BALLOT_FILING" ? [{ id: origin, scope: source.origin.scope,
      sourceId: String(await source.value(["sourceId"])), rawDocumentCount: Number(await source.value(["normalizedPayload", "rawDocumentCount"])),
      retrieval: await source.value(["retrieval"]) as import("./types.ts").RetrievalEvidence }] : undefined;
    const converted = retirementBallotPayload(source.origin.scope, legacy, aggregate);
    metadata.payload = { kind: "ballot-contests" };
    for (const [id, ballot] of Object.entries(converted.payload.ballots)) {
      const state = ballot.election.state;
      add("ballots", id, ballot, [state], 0);
      for (const field of ["contests", "candidacies", "filingCandidacies", "measures", "heldContests"] as const)
        for (const row of ballot[field] ?? []) spool.bind(row.id, [state], { origin, field });
    }
    for (const [position, patch] of converted.identityPatches.entries()) {
      const state = object(legacy.ballot).election as { state: string };
      add("identityPatches", text(patch.identity.identityId), patch, [state.state], position);
    }
  } else if (family === "ballot-contests") {
    metadata.payload = await source.value(payload, ["ballots"]);
    let position = 0;
    await source.entries([...payload, "ballots"], (id, value) => {
      const ballot = object(value), state = text(object(ballot.election).state).toUpperCase();
      if (!REGISTRY_STATES.includes(state as typeof REGISTRY_STATES[number])) throw new Error(`STATE_RETIREMENT_BALLOT_STATE_INVALID:${id}`);
      add("ballots", id, value, [state], position++);
      for (const field of ["contests", "candidacies", "filingCandidacies", "measures", "heldContests"])
        for (const row of arrays(ballot[field])) spool.bind(text(object(row).id), [state], { origin, field });
    });
  } else if (family === "candidate-profiles") {
    const operational = await profileHuntBindings(source, spool);
    for (const field of ["cards", "links"]) {
      metadata[field] = await source.value([...payload, field], [field, "hunts"]);
      let position = 0;
      await source.entries([...payload, field, field], (id, value) => add(field, id, value, spool.states(id), position++));
      position = 0;
      for await (const value of source.members([...payload, field, "hunts"])) {
        const row = object(value), id = `${text(row.key) || field}:${position}`;
        const host = operational.get(text(row.key));
        const states = host && !text(row.note).includes(host) ? [] : spool.states(row.key);
        add(`${field}Hunts`, id, value, states, position++);
      }
    }
  } else if (family === "registry-runtime") {
    metadata.payload = await source.value(payload, ["registry", "bodyRosters", "rosterReaderDispositions", "statewideExecutives", "officialPhotos", "rosterPhotos", "officialCandidacies"]);
    metadata.registry = await source.value([...payload, "registry"], ["divisions", "bodies"]);
    metadata.officialPhotos = await source.value([...payload, "officialPhotos"], ["photos"]);
    metadata.officialCandidacies = await source.value([...payload, "officialCandidacies"], ["rows"]);
    for (const field of ["divisions", "bodies"]) {
      let position = 0;
      for await (const value of source.members([...payload, "registry", field])) {
        const row = object(value), id = text(row.id) || text(row.ocdId);
        const states = [...new Set([row.ocdId, row.id, ...arrays(row.alsoServesOcdIds)].flatMap(registryJurisdictions))];
        const selected = id === "ocd-division/country:us" ? [...REGISTRY_STATES] : states;
        add(field, id, value, selected, position++); spool.bind(id, selected, { origin, field });
      }
    }
    for (const field of ["bodyRosters", "statewideExecutives", "officialCandidacies", "officialPhotos", "rosterReaderDispositions"]) {
      const path = field === "officialPhotos" ? [field, "photos"] : field === "officialCandidacies" ? [field, "rows"] : [field];
      let position = 0;
      for await (const value of source.members([...payload, ...path])) {
        const row = object(value), holder = object(row.holder);
        const id = text(row.bodyId) || text(holder.id) || text(row.officeholderId) || text(row.sourceId) || text(row.id);
        let states = [...new Set([row.stateOcdId, ...arrays(holder.divisions)].flatMap(registryJurisdictions))];
        if (!states.length) states = spool.states(id);
        if (!states.length) states = spool.states(row.personId);
        if (!states.length) states = spool.states(row.canonicalId);
        if (!states.length && field === "rosterReaderDispositions") states = spool.states(id.split("#")[0]);
        if (!states.length && typeof row.sourceUrl === "string") {
          const state = /\.([a-z]{2})\.gov$/i.exec(new URL(row.sourceUrl).hostname)?.[1]?.toUpperCase();
          if (state && REGISTRY_STATES.includes(state as typeof REGISTRY_STATES[number])) states = [state];
        }
        add(field, id, value, states, position++); spool.bind(id, states, { origin, field });
        for (const member of arrays(row.members)) {
          const memberId = text(object(member).id);
          spool.bind(memberId, states, { origin, bodyId: id });
          spool.bind(memberId.split("#")[0], states, { origin, bodyId: id });
        }
      }
    }
    let position = 0;
    await source.entries([...payload, "rosterPhotos"], (id, value) => add("rosterPhotos", id, value, spool.states(id), position++));
  } else {
    const fields = family === "candidate-corpus" ? ["documents", "failures"] : family === "voting-sites" ? ["jurisdictions"] : ["records", "portraits"];
    metadata.payload = await source.value(payload, fields);
    for (const field of fields) {
      let position = 0;
      for await (const value of source.members([...payload, field])) {
        const row = object(value), id = field === "failures" ? `${text(row.candidateKey)}:${position}` : text(row.id) || text(row.ocdId) || text(row.candidateKey) || `${field}:${position}`;
        const states = family === "voting-sites" ? registryJurisdictions(`US-${text(row.state)}`) : spool.states(row.candidateKey ?? row.id);
        add(field, id, value, states, position++);
      }
    }
  }
  return metadata;
}

async function evidence(source: Source, spool: Spool, states: readonly string[], unassigned: Row[]): Promise<Row> {
  const origin = source.origin.versionId;
  const header = object(await source.value([], ["readModel", "normalizedPayload", "civicRecords", "changeSet", "identities", "excludedFacts", "retrieval", "manualPriorAuthority"]));
  const scopedDerived = source.origin.family === "candidate-campaign-sites-derived";
  const retrieval = object(await source.value(["retrieval"], ["manualSourceReceipt", ...(scopedDerived ? ["derived"] : [])]));
  const derivedMetadata = scopedDerived ? await source.value(["retrieval", "derived"], ["inputs"]) : null;
  const receiptMetadata = await source.value(["retrieval", "manualSourceReceipt"], ["sources"]);
  const priorMetadata = await source.value(["manualPriorAuthority"], ["retainedMembers"]);
  const bound = (value: unknown) => {
    const row = object(value), nested = object(row.record), id = row.subjectId ?? row.key ?? row.candidateKey ?? row.id
      ?? nested.subjectId ?? nested.key ?? nested.candidateKey ?? nested.id;
    const found = [...new Set([...spool.states(id), ...registryJurisdictions(row.jurisdiction)])];
    if (found.length) return found;
    const key = text(id), suffix = key.slice(key.indexOf(":") + 1);
    return spool.states(suffix);
  };
  for (const field of ["identities", "excludedFacts"]) {
    let position = 0;
    for await (const value of source.members([field])) {
      const row = object(value), owners = bound(value);
      if (!owners.some(state => states.includes(state))) unassigned.push({ family: source.origin.family, field, id: row.key ?? row.subjectId ?? position, originVersionId: origin });
      for (const state of owners) if (states.includes(state)) spool.add(origin, state, field, `${position}`, field === "identities" ? { ...row, jurisdiction: `US-${state}` } : value, position);
      position++;
    }
  }
  let position = 0;
  for await (const value of source.members(["retrieval", "manualSourceReceipt", "sources"])) {
    const row = object(value);
    for (const match of spool.statement("SELECT DISTINCT state FROM urls WHERE origin=? AND url IN (?,?)").iterate(origin, text(row.requestedUrl), text(row.finalUrl))) {
      const state = String(match.state);
      if (states.includes(state)) spool.add(origin, state, "sources", `${position}`, value, position);
    }
    position++;
  }
  position = 0;
  for await (const value of source.members(["manualPriorAuthority", "retainedMembers"])) {
    for (const state of bound(value)) if (states.includes(state)) spool.add(origin, state, "retainedMembers", `${position}`, value, position);
    position++;
  }
  const activeStates = Array.from(spool.statement("SELECT DISTINCT state FROM members WHERE origin=? AND field IN ('records','portraits') ORDER BY state").iterate(origin), row => String(row.state));
  position = 0;
  if (scopedDerived) for await (const value of source.members(["retrieval", "derived", "inputs"])) {
    const row = object(value);
    const references = [row.itemId, row.recordId, row.artifactId, row.attemptId, row.fingerprint, row.versionId, row.memberKey, row.doorId].filter((id): id is string => typeof id === "string");
    const owners = row.kind === "PROMOTED_VERSION" ? activeStates : [...new Set(references.flatMap(id =>
      Array.from(spool.statement("SELECT state FROM evidence_refs WHERE origin=? AND id=? ORDER BY state").iterate(origin, id), match => String(match.state))))];
    for (const state of owners) if (states.includes(state)) spool.add(origin, state, "derivedInputs", String(position), value, position);
    position++;
  }
  const normalizedMetadata = ["voting-sites", "candidate-campaign-sites-derived"].includes(source.origin.family)
    ? object(await source.value(["normalizedPayload"], ["projection", "readModel", "decisions", "carriedJurisdictionIds", "acquisition"])) : {};
  const decisionFields: string[] = [];
  if (source.origin.family === "candidate-campaign-sites-derived") await source.entries(["normalizedPayload", "decisions"], (key, values) => {
    decisionFields.push(key);
    for (const [index, value] of arrays(values).entries()) for (const state of spool.states(text(value).replace(/^[A-Z_]+:/, "")))
      spool.add(origin, state, `decision:${key}`, String(index), value, index);
  });
  if (source.origin.family === "voting-sites") {
    let index = 0;
    for await (const value of source.members(["normalizedPayload", "acquisition"])) {
      const capture = object(value);
      for (const match of spool.statement("SELECT DISTINCT state FROM urls WHERE origin=? AND url IN (?,?,?)").iterate(origin, text(capture.url), text(capture.requestedUrl), text(capture.finalUrl)))
        if (states.includes(String(match.state))) spool.add(origin, String(match.state), "acquisition", String(index), value, index);
      index++;
    }
    index = 0;
    for await (const value of source.members(["normalizedPayload", "carriedJurisdictionIds"])) {
      for (const state of spool.states(value)) spool.add(origin, state, "carriedJurisdictionIds", String(index), value, index);
      index++;
    }
  }
  return { header, retrieval, derivedMetadata, receiptMetadata, priorMetadata, normalizedMetadata, decisionFields };
}

type Write = (text: string) => Promise<void>;
type Emit = (write: Write) => Promise<void>;
const json = (value: unknown): Emit => {
  const serialized = JSON.stringify(value ?? null);
  return async write => { await write(serialized); };
};
const record = (fields: Readonly<Record<string, Emit>>): Emit => async write => {
  await write("{"); let first = true;
  for (const [key, emit] of Object.entries(fields)) { if (!first) await write(","); first = false; await write(`${JSON.stringify(key)}:`); await emit(write); }
  await write("}");
};
const members = (spool: Spool, origin: string, state: string, field: string, keyed = false): Emit => async write => {
  await write(keyed ? "{" : "["); let first = true;
  for (const row of spool.rows(origin, state, field)) {
    if (!first) await write(","); first = false;
    if (keyed) await write(`${JSON.stringify(row.id)}:`);
    await write(String(row.value));
  }
  await write(keyed ? "}" : "]");
};
const fields = (value: unknown): Record<string, Emit> => Object.fromEntries(Object.entries(object(value)).map(([key, child]) => [key, json(child)]));


function splitPayload(family: StateRetirementFamily, metadata: Row, spool: Spool, origin: string, state: string): Row {
  let position = 0;
  spool.statement("DELETE FROM transfer_rows WHERE origin=? AND state=?").run(origin, state);
  const add = (path: readonly string[], value: unknown, key = retirementMemberKey(path, value), patch: string | null = null) => {
    if (!key) throw new Error(`STATE_RETIREMENT_MEMBER_ID_MISSING:${path.join("/")}`);
    spool.statement("INSERT INTO transfer_rows VALUES(?,?,?,?,?,?,?)").run(origin, state, JSON.stringify(path), key, JSON.stringify(value), position++, patch);
  };
  const split = (parent: Row, field: string, path: readonly string[]) => {
    if (!Array.isArray(parent[field])) return;
    const values = parent[field]; parent[field] = [];
    for (const value of values) add([...path, field], value);
  };
  const copyRows = (field: string, path: readonly string[], keyed = false, children?: string) => {
    for (const stored of spool.rows(origin, state, field)) {
      const value = JSON.parse(String(stored.value)), row = object(value), key = keyed ? String(stored.id) : retirementMemberKey(path, value);
      const nested = children ? row[children] : undefined;
      if (Array.isArray(nested)) row[children!] = [];
      add(path, value, key);
      if (Array.isArray(nested)) for (const child of nested) add([...path, key, children!], child);
    }
  };
  if (family === "ballot-contests") {
    const ballots: Row = {};
    for (const stored of spool.rows(origin, state, "ballots")) {
      const ballot = object(JSON.parse(String(stored.value))), path = ["ballots", String(stored.id)];
      for (const field of ["contests", "candidacies", "filingCandidacies", "measures", "absences", "removals", "heldContests", "measureRecords", "contacts", "sourceAggregates"])
        split(ballot, field, path);
      for (const [field, rows] of [["generalLineup", "contests"], ["measureAnalyses", "analyses"], ["lineupReconciliation", "rows"]])
        if (ballot[field]) split(object(ballot[field]), rows, [...path, field]);
      ballots[String(stored.id)] = ballot;
    }
    for (const stored of spool.rows(origin, state, "identityPatches")) {
      const row = object(JSON.parse(String(stored.value)));
      add(["ballots", String(row.ballotKey), "candidacies"], row.identity, String(stored.id), "identity");
    }
    return { ...object(metadata.payload), ballots };
  }
  if (family === "candidate-profiles") {
    const payload: Row = {};
    for (const field of ["cards", "links"]) {
      payload[field] = { ...object(metadata[field]), [field]: {}, hunts: [] };
      copyRows(field, [field, field], true); copyRows(`${field}Hunts`, [field, "hunts"]);
    }
    return payload;
  }
  if (family === "registry-runtime") {
    for (const field of ["divisions", "bodies"]) copyRows(field, ["registry", field]);
    copyRows("bodyRosters", ["bodyRosters"], false, "members");
    for (const field of ["rosterReaderDispositions", "statewideExecutives"]) copyRows(field, [field]);
    copyRows("officialCandidacies", ["officialCandidacies", "rows"]); copyRows("officialPhotos", ["officialPhotos", "photos"]);
    copyRows("rosterPhotos", ["rosterPhotos"], true);
    return { ...object(metadata.payload), registry: { ...object(metadata.registry), divisions: [], bodies: [] }, bodyRosters: [],
      rosterReaderDispositions: [], statewideExecutives: [], officialCandidacies: { ...object(metadata.officialCandidacies), rows: [] },
      officialPhotos: { ...object(metadata.officialPhotos), photos: [] }, rosterPhotos: {} };
  }
  if (family === "voting-sites") {
    copyRows("jurisdictions", ["jurisdictions"], false, "sites");
    return { ...object(metadata.payload), jurisdictions: [] };
  }
  const payload = { ...object(metadata.payload) };
  for (const field of family === "candidate-corpus" ? ["documents", "failures"] : ["records", "portraits"]) {
    if (field === "portraits" && !spool.statement("SELECT 1 present FROM members WHERE origin=? AND field='portraits' LIMIT 1").get(origin)) continue;
    payload[field] = []; copyRows(field, [field]);
  }
  if (family === "candidate-corpus") {
    const candidates = new Set<string>();
    for (const field of ["documents", "failures"]) for (const row of spool.rows(origin, state, field)) candidates.add(text(object(JSON.parse(String(row.value))).candidateKey));
    payload.attempted = candidates.size;
  }
  return payload;
}

function transferMembers(spool: Spool, origin: string, state: string): Emit {
  return async write => {
    await write("["); let first = true;
    for (const row of spool.statement("SELECT path,id,value,patch FROM transfer_rows WHERE origin=? AND state=? ORDER BY position").iterate(origin, state)) {
      if (!first) await write(","); first = false;
      await write(`{"path":${row.path},"key":${JSON.stringify(row.id)},"value":${row.value}${row.patch ? `,"patch":${JSON.stringify(row.patch)}` : ""}}`);
    }
    await write("]");
  };
}

async function writeStateInput(path: string, emit: Emit, buffer: Buffer): Promise<string> {
  const file = await open(temporaryPath(path), "w", 0o600), hash = createHash("sha256"), encoder = new TextEncoder();
  let size = 0;
  const flush = async () => {
    if (!size) return;
    hash.update(buffer.subarray(0, size));
    for (let offset = 0; offset < size;) {
      const { bytesWritten } = await file.write(buffer, offset, size - offset);
      if (!bytesWritten) throw new Error("STATE_RETIREMENT_INPUT_WRITE_STALLED");
      offset += bytesWritten;
    }
    size = 0;
  };
  try {
    await emit(async chunk => {
      for (let offset = 0; offset < chunk.length;) {
        const { read, written } = encoder.encodeInto(chunk.slice(offset), buffer.subarray(size));
        offset += read; size += written;
        if (!read || size === buffer.length) await flush();
      }
    });
    await flush();
  } finally { await file.close(); }
  return hash.digest("hex");
}

export async function prepareRetirementStateInputs(input: {
  readonly directory: string; readonly query: StateRetirementQuery; readonly streamRows: StateRetirementRows;
  readonly origins: readonly StateRetirementOrigin[]; readonly env?: NodeJS.ProcessEnv;
}): Promise<{ readonly origins: readonly StateRetirementOrigin[]; readonly units: readonly StateRetirementUnit[]; readonly unassigned: readonly Row[] }> {
  await mkdir(temporaryPath(input.directory), { recursive: true, mode: 0o700 });
  const order = ["ballot-contests", "registry-runtime", "candidate-profiles", "candidate-corpus", "voting-sites", "candidate-campaign-sites-derived"];
  const origins = [...input.origins].sort((a, b) => order.indexOf(a.family) - order.indexOf(b.family) || a.scope.localeCompare(b.scope));
  const token = createHash("sha256").update(JSON.stringify({ formatVersion: 1, origins })).digest("hex"), planFile = join(input.directory, `${token}.plan.json`);
  const spool = new Spool(join(input.directory, `${token}.sqlite`)), unassigned: Row[] = [], units: (StateRetirementUnit & { fileSha256: string })[] = [];
  const outputBuffer = Buffer.allocUnsafe(65_536);
  try {
    await holderBindings(input.query, spool);
    for (const origin of origins) {
      const originProof = await input.query(`SELECT c.id FROM civic_data_promotions p JOIN civic_data_candidates c ON c.id=p.current_version_id
        WHERE p.record_class=$1 AND p.scope=$2 AND c.id=$3 AND c.state='PROMOTED' AND c.validation_receipt->>'decision'='GOOD'
          AND c.normalized_hash=$4 AND p.payload=c.candidate->'readModel' AND p.validation_receipt=c.validation_receipt`, [origin.recordClass, origin.scope, origin.versionId, origin.hash]);
      if (!originProof.length) throw new Error(`STATE_RETIREMENT_ORIGIN_PROOF_CHANGED:${origin.scope}`);
      const decoder = new StreamedCivicPayload(join(input.directory, "parts"), async hashes => (await input.query("SELECT hash,payload FROM civic_data_payload_parts WHERE hash=ANY($1::text[])", [hashes])).map(row => ({ hash: String(row.hash), payload: row.payload })));
      const source = new Source(origin, input.query, decoder, input.streamRows), metadata = await route(source, spool, unassigned);
      const states: readonly string[] = origin.family === "ballot-contests" && origin.scope !== "US:state-election-ballots"
        ? Array.from(spool.statement("SELECT DISTINCT state FROM members WHERE origin=? AND field='ballots' ORDER BY state").iterate(origin.versionId), row => String(row.state)) : REGISTRY_STATES;
      const proof = await evidence(source, spool, states, unassigned);
      const headerFields = fields(proof.header), retrievalFields = fields(proof.retrieval);
      const receipts = await input.query("SELECT validation_receipt-'excludedFacts' AS receipt FROM civic_data_candidates WHERE id=$1", [origin.versionId]);
      const events = await input.query("SELECT sequence,state,at,detail FROM civic_data_candidate_events WHERE candidate_id=$1 AND (sequence<=4 OR detail LIKE 'UNCHANGED_CONFIRMATION_V1 %' OR detail LIKE 'UNCHANGED_CONFIRMATION_SOURCES_V1 %') ORDER BY sequence", [origin.versionId]);
      for (const state of states) {
        const payload = splitPayload(origin.family, metadata, spool, origin.versionId, state);
        const normalizedMetadata = origin.family === "candidate-campaign-sites-derived" ? record({ ...fields(proof.normalizedMetadata),
          decisions: record(Object.fromEntries((proof.decisionFields as string[]).map(key => [key, members(spool, origin.versionId, state, `decision:${key}`)]))) })
          : origin.family === "voting-sites" ? record({ ...fields(proof.normalizedMetadata), acquisition: members(spool, origin.versionId, state, "acquisition"), carriedJurisdictionIds: members(spool, origin.versionId, state, "carriedJurisdictionIds") }) : json({});
        const stateEvents = events.flatMap(event => {
          const prefix = "UNCHANGED_CONFIRMATION_SOURCES_V1 ";
          if (!text(event.detail).startsWith(prefix)) return [event];
          const confirmation = object(JSON.parse(text(event.detail).slice(prefix.length)));
          const retainedSourceResponses = arrays(confirmation.retainedSourceResponses).filter(value => {
            const row = object(value);
            return [row.requestedUrl, row.finalUrl, row.url, row.sourceUrl].some(url => typeof url === "string" &&
              spool.statement("SELECT 1 present FROM urls WHERE origin=? AND state=? AND url=?").get(origin.versionId, state, url));
          });
          return retainedSourceResponses.length ? [{ ...event, detail: prefix + JSON.stringify({ ...confirmation, retainedSourceResponses }) }] : [];
        });
        const stableMetadata = (value: unknown): unknown => Array.isArray(value) ? value.map(stableMetadata) : value && typeof value === "object"
          ? Object.fromEntries(Object.entries(value).filter(([key]) => !["generatedAt", "fetchedAt", "curatedAt", "version", "sourceThrough", "attempted"].includes(key)).map(([key, child]) => [key, stableMetadata(child)])) : value;
        const factHash = createHash("sha256").update(JSON.stringify(stableMetadata(metadata)));
        for (const row of spool.statement("SELECT field,id,value FROM members WHERE origin=? AND state=? AND field NOT IN ('identities','excludedFacts','sources','retainedMembers') ORDER BY field,position,id").iterate(origin.versionId, state)) factHash.update(`${row.field}\n${row.id}\n${row.value}\n`);
        const inputHash = factHash.digest("hex"), inputFile = join(input.directory, `${token}-${origin.family}-${state}-${inputHash}.json`);
        const candidate = { ...headerFields, retrieval: record({ ...retrievalFields, ...(proof.derivedMetadata ? { derived: record({ ...fields(proof.derivedMetadata), inputs: members(spool, origin.versionId, state, "derivedInputs") }) } : {}), ...(proof.receiptMetadata ? { manualSourceReceipt: record({ ...fields(proof.receiptMetadata), sources: members(spool, origin.versionId, state, "sources") }) } : {}) }),
          identities: members(spool, origin.versionId, state, "identities"), excludedFacts: members(spool, origin.versionId, state, "excludedFacts"),
          ...(proof.priorMetadata ? { manualPriorAuthority: record({ ...fields(proof.priorMetadata), retainedMembers: members(spool, origin.versionId, state, "retainedMembers") }) } : {}) };
        const emitter = record({ family: json(origin.family), state: json(state), inputHash: json(inputHash), originId: json(origin.versionId), originRecordClass: json(origin.recordClass), originScope: json(origin.scope),
          originReadModelHash: json(origin.hash), promotedAt: json(origin.promotedAt), candidate: record(candidate), receipt: record({ ...fields(receipts[0]?.receipt), excludedFacts: members(spool, origin.versionId, state, "excludedFacts") }),
          payload: json(payload), members: transferMembers(spool, origin.versionId, state), normalizedMetadata, events: json(stateEvents) });
        const fileSha256 = await writeStateInput(inputFile, emitter, outputBuffer);
        const contractId = origin.family === "registry-runtime" ? stateRegistryRuntimeContractId(state) : stateBallotContractId(origin.family, state);
        const seal = sealStateRetirementUnit({ fileSha256, originId: origin.versionId, originRecordClass: origin.recordClass,
          originScope: origin.scope, originReadModelHash: origin.hash, state, contractId }, input.env);
        units.push({ family: origin.family, state, contractId,
          recordClass: origin.recordClass === "BALLOT_FILING" ? "BALLOT_CANDIDACY" : origin.recordClass, scope: origin.family === "registry-runtime" ? stateRegistryRuntimeScope(state) : stateBallotScope(origin.family, state),
          originVersionId: origin.versionId, inputFile, inputHash, fileSha256, seal });
      }
    }
    const operationalAssignments = Array.from(spool.statement("SELECT id,state,evidence FROM bindings WHERE id LIKE 'promotion-0823:%' ORDER BY id,state").iterate(), row => ({ id: row.id, state: row.state, evidence: JSON.parse(String(row.evidence)) }));
    const plan = { origins, units, unassigned, operationalAssignments };
    await writeFile(temporaryPath(`${planFile}.tmp`), JSON.stringify(plan), { mode: 0o600 });
    await rename(temporaryPath(`${planFile}.tmp`), temporaryPath(planFile));
    return plan;
  } finally { spool.db.close(); }
}
