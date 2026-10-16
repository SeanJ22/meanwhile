import { createHash } from "node:crypto";
import { access, mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { BALLOT_STATES, stateBallotContractId, stateBallotScope, type StateBallotFamily } from "../ballot/state-scopes.ts";
import { registryJurisdictions, REGISTRY_STATES, stateRegistryRuntimeContractId, stateRegistryRuntimeScope } from "../registry/state-scopes.ts";
import { StreamedCivicPayload } from "./streamed-payload.ts";
import type { RoutineRecordClass } from "./types.ts";

type Row = Record<string, unknown>;
export type StateBootstrapQuery = (text: string, params: readonly unknown[]) => Promise<readonly Row[]>;
type StateBootstrapRows = (text: string, params: readonly unknown[], onRow: (row: Row) => Promise<void>) => Promise<void>;
type StateBootstrapFamily = StateBallotFamily | "registry-runtime";
export interface StateBootstrapUnit {
  readonly family: StateBootstrapFamily; readonly state: string; readonly contractId: string;
  readonly recordClass: RoutineRecordClass; readonly scope: string; readonly originVersionId: string;
  readonly inputFile: string; readonly inputHash: string; readonly fileSha256: string;
}
type Origin = { family: StateBootstrapFamily; recordClass: RoutineRecordClass; scope: string; versionId: string; promotedAt: string; hash: string };
type SqlValue = string | number | null;
interface Statement { run(...params: SqlValue[]): void; get(...params: SqlValue[]): Record<string, SqlValue> | undefined; iterate(...params: SqlValue[]): Iterable<Record<string, SqlValue>> }
interface Database { exec(sql: string): void; prepare(sql: string): Statement; close(): void }
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new (path: string) => Database };
const object = (value: unknown): Row => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const text = (value: unknown) => typeof value === "string" ? value : "";
const arrays = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const ORIGINS: readonly [StateBootstrapFamily, RoutineRecordClass, string][] = [
  ["ballot-contests", "BALLOT_CANDIDACY", "US:state-election-ballots"],
  ["candidate-profiles", "CANDIDATE_PROFILE", "US-AZ+US-NH+US-NJ:2026-supported-candidates"],
  ["candidate-corpus", "CANDIDATE_PUBLICATION", "US-AZ+US-NH+US-NJ:2026-supported-candidates"],
  ["voting-sites", "VOTING_SITE", "US-AZ+US-NH+US-NJ:2026-general:supported-jurisdictions"],
  ["candidate-campaign-sites-derived", "CURATED_READER_RECORD", "US:candidate-campaign-sites-derived"],
  ["registry-runtime", "REGISTRY_RUNTIME_BINDING", "US:reader-registry-runtime-bindings"],
];


class Spool {
  readonly db: Database;
  private readonly statements = new Map<string, Statement>();
  statement(sql: string): Statement {
    let held = this.statements.get(sql);
    if (!held) { held = this.db.prepare(sql); this.statements.set(sql, held); }
    return held;
  }
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS members(origin TEXT,state TEXT,field TEXT,id TEXT,value TEXT,position INTEGER,PRIMARY KEY(origin,state,field,id)); CREATE TABLE IF NOT EXISTS bindings(id TEXT,state TEXT,evidence TEXT,PRIMARY KEY(id,state)); CREATE TABLE IF NOT EXISTS urls(origin TEXT,state TEXT,url TEXT,PRIMARY KEY(origin,state,url));");
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
    if (held && held.value !== serialized) throw new Error(`STATE_BOOTSTRAP_DUPLICATE_ID:${field}:${id}`);
    this.statement("INSERT OR IGNORE INTO members VALUES(?,?,?,?,?,?)").run(origin, state, field, id, serialized, position);
    const visit = (item: unknown) => {
      if (typeof item === "string" && /^https?:\/\//.test(item)) this.statement("INSERT OR IGNORE INTO urls VALUES(?,?,?)").run(origin, state, item);
      else if (Array.isArray(item)) item.forEach(visit);
      else if (item && typeof item === "object") Object.values(item).forEach(visit);
    };
    visit(value);
  }
  rows(origin: string, state: string, field: string): Iterable<Record<string, SqlValue>> {
    return this.statement("SELECT id,value FROM members WHERE origin=? AND state=? AND field=? ORDER BY position,id").iterate(origin, state, field);
  }
}

class Source {
  readonly origin: Origin;
  readonly query: StateBootstrapQuery;
  readonly decoder: StreamedCivicPayload;
  readonly streamRows: StateBootstrapRows;
  constructor(origin: Origin, query: StateBootstrapQuery, decoder: StreamedCivicPayload, streamRows: StateBootstrapRows) {
    this.origin = origin; this.query = query; this.decoder = decoder; this.streamRows = streamRows;
  }
  private expression(path: readonly string[]): { sql: string; params: unknown[] } {
    let sql = "c.candidate"; const params: unknown[] = [this.origin.versionId];
    for (const key of path) { params.push(key); sql = `reader_payload_node(${sql})->$${params.length}::text`; }
    return { sql, params };
  }
  async value(path: readonly string[], omit: readonly string[] = []): Promise<unknown> {
    const { sql, params } = this.expression(path); params.push(omit);
    const rows = await this.query(`SELECT reader_payload_node(${sql})-$${params.length}::text[] AS value FROM civic_data_candidates c WHERE c.id=$1`, params);
    return this.decoder.load(rows[0]?.value);
  }
  async *members(path: readonly string[]): AsyncGenerator<unknown> {
    const { sql, params } = this.expression(path);
    const rows = await this.query(`SELECT ${sql} AS value FROM civic_data_candidates c WHERE c.id=$1`, params);
    const value = rows[0]?.value;
    if (value === null || value === undefined) return;
    yield* this.decoder.members(value);
  }
  async entries(path: readonly string[], onEntry: (id: string, value: unknown) => void | Promise<void>): Promise<void> {
    const { sql, params } = this.expression(path);
    await this.streamRows(`SELECT e.key,e.value FROM civic_data_candidates c,LATERAL jsonb_each(reader_payload_node(${sql})) e WHERE c.id=$1 ORDER BY e.key`, params,
      async row => { await onEntry(String(row.key), await this.decoder.load(row.value)); });
  }
}

async function holderBindings(query: StateBootstrapQuery, spool: Spool): Promise<void> {
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
    for (const state of new Set(states)) spool.add(origin, state, field, id, row, position);
  };
  if (family === "ballot-contests") {
    metadata.payload = await source.value(payload, ["ballots"]);
    let position = 0;
    await source.entries([...payload, "ballots"], (id, value) => {
      const ballot = object(value), state = text(object(ballot.election).state).toUpperCase();
      if (!BALLOT_STATES.includes(state as typeof BALLOT_STATES[number])) throw new Error(`STATE_BOOTSTRAP_BALLOT_STATE_INVALID:${id}`);
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

async function evidence(source: Source, spool: Spool, states: readonly string[]): Promise<Row> {
  const origin = source.origin.versionId;
  const header = object(await source.value([], ["readModel", "normalizedPayload", "civicRecords", "changeSet", "identities", "excludedFacts", "retrieval", "manualPriorAuthority"]));
  const retrieval = object(await source.value(["retrieval"], ["manualSourceReceipt"]));
  const receiptMetadata = await source.value(["retrieval", "manualSourceReceipt"], ["sources"]);
  const priorMetadata = await source.value(["manualPriorAuthority"], ["retainedMembers"]);
  const bound = (value: unknown) => {
    const row = object(value), id = row.subjectId ?? row.key ?? row.candidateKey ?? row.id;
    const found = [...new Set([...spool.states(id), ...registryJurisdictions(row.jurisdiction)])];
    if (found.length) return found;
    const key = text(id), suffix = key.slice(key.indexOf(":") + 1);
    return spool.states(suffix);
  };
  for (const field of ["identities", "excludedFacts"]) {
    let position = 0;
    for await (const value of source.members([field])) {
      const row = object(value), owners = bound(value);
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
  const normalizedMetadata = ["voting-sites", "candidate-campaign-sites-derived"].includes(source.origin.family)
    ? object(await source.value(["normalizedPayload"], ["projection", "readModel", "decisions", "carriedJurisdictionIds"])) : {};
  const decisionFields: string[] = [];
  if (source.origin.family === "candidate-campaign-sites-derived") await source.entries(["normalizedPayload", "decisions"], (key, values) => {
    decisionFields.push(key);
    for (const [index, value] of arrays(values).entries()) for (const state of spool.states(text(value).replace(/^[A-Z_]+:/, "")))
      spool.add(origin, state, `decision:${key}`, String(index), value, index);
  });
  if (source.origin.family === "voting-sites") {
    let index = 0;
    for await (const value of source.members(["normalizedPayload", "carriedJurisdictionIds"])) {
      for (const state of spool.states(value)) spool.add(origin, state, "carriedJurisdictionIds", String(index), value, index);
      index++;
    }
  }
  return { header, retrieval, receiptMetadata, priorMetadata, normalizedMetadata, decisionFields };
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

function payloadEmitter(family: StateBootstrapFamily, metadata: Row, spool: Spool, origin: string, state: string): Emit {
  const rows = (field: string, keyed = false) => members(spool, origin, state, field, keyed);
  if (family === "ballot-contests") return record({ ...fields(metadata.payload), ballots: rows("ballots", true) });
  if (family === "candidate-profiles") return record(Object.fromEntries(["cards", "links"].map(field => [field,
    record({ ...fields(metadata[field]), [field]: rows(field, true), hunts: rows(`${field}Hunts`) })])));
  if (family === "registry-runtime") return record({ ...fields(metadata.payload),
    registry: record({ ...fields(metadata.registry), divisions: rows("divisions"), bodies: rows("bodies") }),
    bodyRosters: rows("bodyRosters"), rosterReaderDispositions: rows("rosterReaderDispositions"), statewideExecutives: rows("statewideExecutives"),
    officialCandidacies: record({ ...fields(metadata.officialCandidacies), rows: rows("officialCandidacies") }),
    officialPhotos: record({ ...fields(metadata.officialPhotos), photos: rows("officialPhotos") }), rosterPhotos: rows("rosterPhotos", true),
  });
  if (family === "candidate-corpus") {
    const candidates = new Set<string>();
    for (const field of ["documents", "failures"]) for (const row of spool.rows(origin, state, field)) candidates.add(text(object(JSON.parse(String(row.value))).candidateKey));
    return record({ ...fields(metadata.payload), attempted: json(candidates.size), documents: rows("documents"), failures: rows("failures") });
  }
  if (family === "voting-sites") return record({ ...fields(metadata.payload), jurisdictions: rows("jurisdictions") });
  return record({ ...fields(metadata.payload), records: rows("records"), ...(spool.statement("SELECT 1 present FROM members WHERE origin=? AND field='portraits' LIMIT 1").get(origin) ? { portraits: rows("portraits") } : {}) });
}

export async function prepareStateAuthorityBootstrap(input: { readonly directory: string; readonly query: StateBootstrapQuery; readonly streamRows: StateBootstrapRows }): Promise<{
  readonly origins: readonly Origin[]; readonly units: readonly StateBootstrapUnit[]; readonly unassigned: readonly Row[]; readonly missingOrigins: readonly StateBootstrapFamily[];
}> {
  await mkdir(input.directory, { recursive: true, mode: 0o700 });
  const origins: Origin[] = [], missingOrigins: StateBootstrapFamily[] = [];
  for (const [family, recordClass, scope] of ORIGINS) {
    const rows = await input.query(`SELECT p.current_version_id,p.promoted_at,c.normalized_hash FROM civic_data_promotions p JOIN civic_data_candidates c ON c.id=p.current_version_id
      WHERE p.record_class=$1 AND p.scope=$2 AND c.state='PROMOTED' AND c.validation_receipt->>'decision'='GOOD'`, [recordClass, scope]);
    if (rows[0]) origins.push({ family, recordClass, scope, versionId: String(rows[0].current_version_id), promotedAt: new Date(rows[0].promoted_at as string | Date).toISOString(), hash: String(rows[0].normalized_hash) });
    else missingOrigins.push(family);
  }
  const token = createHash("sha256").update(JSON.stringify({ formatVersion: 5, origins })).digest("hex"), planFile = join(input.directory, `${token}.plan.json`);
  try {
    const cached = JSON.parse(await readFile(planFile, "utf8"));
    if (Array.isArray(cached.origins) && Array.isArray(cached.units) && Array.isArray(cached.unassigned) && Array.isArray(cached.missingOrigins)
      && cached.units.every((unit: Row) => typeof unit.inputFile === "string" && typeof unit.fileSha256 === "string")) {
      for (const unit of cached.units) await access(unit.inputFile);
      return cached;
    }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const spool = new Spool(join(input.directory, `${token}.sqlite`)), unassigned: Row[] = [], units: (StateBootstrapUnit & { fileSha256: string })[] = [];
  const decoder = new StreamedCivicPayload(join(input.directory, "parts"), async hashes => (await input.query("SELECT hash,payload FROM civic_data_payload_parts WHERE hash=ANY($1::text[])", [hashes])).map(row => ({ hash: String(row.hash), payload: row.payload })));
  try {
    await holderBindings(input.query, spool);
    for (const origin of origins) {
      const originProof = await input.query(`SELECT c.id FROM civic_data_promotions p JOIN civic_data_candidates c ON c.id=p.current_version_id
        WHERE p.record_class=$1 AND p.scope=$2 AND c.id=$3 AND c.state='PROMOTED' AND c.validation_receipt->>'decision'='GOOD'
          AND p.payload=c.candidate->'readModel' AND p.validation_receipt=c.validation_receipt`, [origin.recordClass, origin.scope, origin.versionId]);
      if (!originProof.length) throw new Error(`STATE_BOOTSTRAP_ORIGIN_PROOF_CHANGED:${origin.scope}`);
      const source = new Source(origin, input.query, decoder, input.streamRows), metadata = await route(source, spool, unassigned);
      const states = origin.family === "registry-runtime" ? [...REGISTRY_STATES] : origin.family === "ballot-contests"
        ? Array.from(spool.statement("SELECT DISTINCT state FROM members WHERE origin=? AND field='ballots' ORDER BY state").iterate(origin.versionId), row => String(row.state)) : [...BALLOT_STATES];
      const proof = await evidence(source, spool, states);
      const headerFields = fields(proof.header), retrievalFields = fields(proof.retrieval);
      const receipts = await input.query("SELECT validation_receipt-'excludedFacts' AS receipt FROM civic_data_candidates WHERE id=$1", [origin.versionId]);
      const events = await input.query("SELECT sequence,state,at,detail FROM civic_data_candidate_events WHERE candidate_id=$1 AND (sequence<=4 OR detail LIKE 'UNCHANGED_CONFIRMATION_V1 %' OR detail LIKE 'UNCHANGED_CONFIRMATION_SOURCES_V1 %') ORDER BY sequence", [origin.versionId]);
      for (const state of states) {
        const normalizedMetadata = origin.family === "candidate-campaign-sites-derived" ? record({ ...fields(proof.normalizedMetadata),
          decisions: record(Object.fromEntries((proof.decisionFields as string[]).map(key => [key, members(spool, origin.versionId, state, `decision:${key}`)]))) })
          : origin.family === "voting-sites" ? record({ ...fields(proof.normalizedMetadata), carriedJurisdictionIds: members(spool, origin.versionId, state, "carriedJurisdictionIds") }) : json({});
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
        const candidate = { ...headerFields, retrieval: record({ ...retrievalFields, ...(proof.receiptMetadata ? { manualSourceReceipt: record({ ...fields(proof.receiptMetadata), sources: members(spool, origin.versionId, state, "sources") }) } : {}) }),
          identities: members(spool, origin.versionId, state, "identities"), excludedFacts: members(spool, origin.versionId, state, "excludedFacts"),
          ...(proof.priorMetadata ? { manualPriorAuthority: record({ ...fields(proof.priorMetadata), retainedMembers: members(spool, origin.versionId, state, "retainedMembers") }) } : {}) };
        const emitter = record({ family: json(origin.family), state: json(state), inputHash: json(inputHash), originId: json(origin.versionId), originScope: json(origin.scope),
          originReadModelHash: json(origin.hash), promotedAt: json(origin.promotedAt), candidate: record(candidate), receipt: record({ ...fields(receipts[0]?.receipt), excludedFacts: members(spool, origin.versionId, state, "excludedFacts") }),
          payload: payloadEmitter(origin.family, metadata, spool, origin.versionId, state), normalizedMetadata, events: json(stateEvents) });
        const file = await open(inputFile, "w", 0o600), fileHash = createHash("sha256");
        try { await emitter(async chunk => { fileHash.update(chunk); await file.write(chunk); }); } finally { await file.close(); }
        units.push({ family: origin.family, state, contractId: origin.family === "registry-runtime" ? stateRegistryRuntimeContractId(state) : stateBallotContractId(origin.family, state),
          recordClass: origin.recordClass, scope: origin.family === "registry-runtime" ? stateRegistryRuntimeScope(state) : stateBallotScope(origin.family, state),
          originVersionId: origin.versionId, inputFile, inputHash, fileSha256: fileHash.digest("hex") });
      }
    }
    const operationalAssignments = Array.from(spool.statement("SELECT id,state,evidence FROM bindings WHERE id LIKE 'promotion-0823:%' ORDER BY id,state").iterate(), row => ({ id: row.id, state: row.state, evidence: JSON.parse(String(row.evidence)) }));
    const plan = { origins, units, unassigned, missingOrigins, operationalAssignments };
    await writeFile(`${planFile}.tmp`, JSON.stringify(plan), { mode: 0o600 });
    await rename(`${planFile}.tmp`, planFile);
    return plan;
  } finally { spool.db.close(); }
}
