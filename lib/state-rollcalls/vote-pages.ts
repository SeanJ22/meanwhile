import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { temporaryPath } from "../civic-data/temporary-path.ts";
import { join } from "node:path";
import { canonicalCivicDataHash } from "../civic-data/changes.ts";
import { getStore } from "@netlify/blobs";
import { NetlifyEvidenceStore, netlifyEvidenceStoreFromEnv } from "../control-plane/evidence/netlify-store.ts";
import type { RoutineDataStore } from "../civic-data/store.ts";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import type { PluralVoteFact } from "../sources/plural/votes.ts";

export interface VoteMemberPage { session: string; personId: string; key: string; sha256: string; count: number }
export interface VotePageProjection { formatVersion: 1 | 2; state: string; rollCalls: PluralVoteFact[]; memberPages?: VoteMemberPage[] }
type Row = Record<string, string | number>;
interface Statement { run(...values: (string | number | null)[]): unknown; get(...values: (string | number | null)[]): Row | undefined; iterate(...values: (string | number | null)[]): Iterable<Row> }
interface Database { exec(sql: string): void; prepare(sql: string): Statement; close(): void }
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new (path: string) => Database };
const digest = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const PERSON = /^ocd-person\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_PAGE_BYTES = 2 * 1024 * 1024, PAGE_ROWS = 1024;
const stores = new WeakMap<RoutineDataStore, EvidenceStore>();

/** The ordinary injected store remains usable in source/reader integration tests. */
export function bindVotePageVault(store: RoutineDataStore, vault: EvidenceStore): void { stores.set(store, vault); }
export function votePageVault(store?: unknown): EvidenceStore {
  if (store && typeof store === "object" && stores.has(store as RoutineDataStore)) return stores.get(store as RoutineDataStore)!;
  // Source workers use the explicit shared vault. Hosted reader Functions use
  // the same site store through Netlify's automatically injected credentials.
  return netlifyEvidenceStoreFromEnv() ?? new NetlifyEvidenceStore(getStore({ name: process.env.WTP_VAULT_STORE ?? "meanwhile-evidence", consistency: "strong" }));
}
function bodyOf(vote: PluralVoteFact) {
  const { positions: _positions, positionHash: _hash, positionCount: _count, firstPersonId: _first, ...body } = vote;
  return body;
}
export function votePagesIssue(projection: VotePageProjection): string | null {
  if (projection?.formatVersion !== 2 || !/^[A-Z]{2}$/.test(projection.state) || !Array.isArray(projection.rollCalls) || !Array.isArray(projection.memberPages)) return "VOTE_PAGE_INDEX_INVALID";
  const keys = new Set<string>(), totals = new Map<string, number>(), pages = new Map<string, number>();
  for (const vote of projection.rollCalls) {
    if (!vote || !Array.isArray(vote.positions) || vote.positions.length || !Number.isSafeInteger(vote.positionCount) || !vote.positionCount ||
        typeof vote.positionHash !== "string" || !/^[a-f0-9]{64}$/.test(vote.positionHash) || !PERSON.test(vote.firstPersonId ?? "")) return "VOTE_PAGE_ROLL_INVALID";
    totals.set(vote.session, (totals.get(vote.session) ?? 0) + vote.positionCount);
  }
  for (const page of projection.memberPages) {
    if (!page || !totals.has(page.session) || !PERSON.test(page.personId) || !/^[a-f0-9]{64}$/.test(page.sha256) ||
        !Number.isSafeInteger(page.count) || page.count <= 0 || page.count > PAGE_ROWS || keys.has(page.key)) return "VOTE_PAGE_REFERENCE_INVALID";
    const expected = new RegExp(`^project/state-votes/[a-z0-9-]+/${projection.state}/${digest(page.session)}/${page.personId.slice(11)}/${page.sha256}\\.json$`);
    if (!expected.test(page.key)) return "VOTE_PAGE_REFERENCE_INVALID";
    keys.add(page.key); pages.set(page.session, (pages.get(page.session) ?? 0) + page.count);
  }
  for (const [session, total] of totals) if (pages.get(session) !== total) return "VOTE_PAGE_POSITION_TOTAL_INVALID";
  return null;
}
async function readPage(vault: EvidenceStore, metadata: ReadonlyMap<string, PluralVoteFact>, page: VoteMemberPage): Promise<PluralVoteFact[]> {
  const object = await vault.get(page.key);
  if (!object || object.bytes.length > MAX_PAGE_BYTES || digest(object.bytes) !== page.sha256) throw new Error("VOTE_PAGE_EVIDENCE_INVALID");
  const votes: PluralVoteFact[] = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(object.bytes));
  if (!Array.isArray(votes) || votes.length !== page.count) throw new Error("VOTE_PAGE_COUNT_INVALID");
  for (const vote of votes) {
    const roll = metadata.get(vote.id), position = vote.positions?.[0];
    if (!roll || vote.session !== page.session || vote.positions?.length !== 1 || position.personId !== page.personId || !position.option ||
        !Number.isFinite(Date.parse(position.retrievedAt)) || position.retrievedAt > vote.retrievedAt) throw new Error("VOTE_PAGE_PERSON_INVALID");
    const { positions: _positions, ...actual } = vote;
    if (canonicalCivicDataHash(actual) !== canonicalCivicDataHash(bodyOf(roll))) throw new Error("VOTE_PAGE_ROLL_MISMATCH");
  }
  return votes;
}

/** Only one person's immutable pages cross the object-store connection, four at a time. */
export async function readVotePages(vault: EvidenceStore, projection: VotePageProjection, personId: string): Promise<PluralVoteFact[]> {
  const issue = votePagesIssue(projection); if (issue) throw new Error(issue);
  if (!PERSON.test(personId)) return [];
  const metadata = new Map(projection.rollCalls.map(vote => [vote.id, vote]));
  const pages = projection.memberPages!.filter(page => page.personId === personId), groups: PluralVoteFact[][] = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, pages.length) }, async () => {
    while (next < pages.length) { const at = next++; groups[at] = await readPage(vault, metadata, pages[at]); }
  }));
  const result: PluralVoteFact[] = [], seen = new Set<string>();
  for (const votes of groups) for (const vote of votes) {
    if (seen.has(vote.id)) throw new Error("VOTE_PAGE_PERSON_INVALID");
    seen.add(vote.id); result.push(vote);
  }
  return result;
}

/** Disk owns normalized positions; the projection keeps roll metadata and
 * immutable per-person page references. Partial source reads only upsert facts. */
export async function createVotePageSink(input: { state: string; sourceId: string; vault: EvidenceStore; prior: VotePageProjection | null; signal?: AbortSignal }) {
  const { state, sourceId, vault, signal } = input;
  let prior = input.prior; input.prior = null;
  if (prior?.state !== undefined && prior.state !== state) throw new Error("VOTE_PAGE_PREDECESSOR_STATE_INVALID");
  if (prior?.formatVersion === 2) { const issue = votePagesIssue(prior); if (issue) throw new Error(issue); }
  const directory = await mkdtemp(temporaryPath(join(tmpdir(), "meanwhile-vote-pages-")));
  const db = new DatabaseSync(temporaryPath(join(directory, "votes.sqlite")));
  db.exec("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA cache_size=-8192; PRAGMA mmap_size=0; PRAGMA temp_store=FILE; CREATE TABLE rolls(id TEXT PRIMARY KEY,session TEXT NOT NULL,body TEXT NOT NULL); CREATE TABLE positions(roll_id TEXT,person_id TEXT,option TEXT,retrieved_at TEXT,PRIMARY KEY(roll_id,person_id)); CREATE INDEX people ON positions(person_id,roll_id); CREATE INDEX sessions ON rolls(session,id); BEGIN");
  const metadata = new Map<string, PluralVoteFact>();
  let memberPages: VoteMemberPage[] = prior?.formatVersion === 2 ? [...prior.memberPages!] : [];
  const loadedSessions = new Set<string>(), dirtyRolls = new Set<string>(), dirtyPeople = new Map<string, Set<string>>();
  const getRoll = db.prepare("SELECT body FROM rolls WHERE id=?"), putRoll = db.prepare("INSERT INTO rolls VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body");
  const getPosition = db.prepare("SELECT option,retrieved_at FROM positions WHERE roll_id=? AND person_id=?");
  const putPosition = db.prepare("INSERT INTO positions VALUES(?,?,?,?) ON CONFLICT(roll_id,person_id) DO UPDATE SET option=excluded.option,retrieved_at=excluded.retrieved_at WHERE excluded.retrieved_at>=positions.retrieved_at");
  const positionsForRoll = db.prepare("SELECT person_id,option,retrieved_at FROM positions WHERE roll_id=? ORDER BY person_id");
  const memberVotes = db.prepare("SELECT r.body,p.option,p.retrieved_at FROM rolls r JOIN positions p ON p.roll_id=r.id WHERE r.session=? AND p.person_id=? ORDER BY r.id");
  const markPerson = (session: string, person: string) => { const people = dirtyPeople.get(session) ?? new Set<string>(); people.add(person); dirtyPeople.set(session, people); };
  const importVote = (vote: PluralVoteFact) => {
    putRoll.run(vote.id, vote.session, JSON.stringify(bodyOf(vote)));
    for (const position of vote.positions) { putPosition.run(vote.id, position.personId, position.option, position.retrievedAt); markPerson(vote.session, position.personId); }
    dirtyRolls.add(vote.id);
  };
  try {
    if (prior?.formatVersion === 2) for (const vote of prior.rollCalls) metadata.set(vote.id, vote);
    else if (prior) for (const vote of prior.rollCalls) { signal?.throwIfAborted(); importVote(vote); loadedSessions.add(vote.session); }
  } catch (error) { db.close(); await rm(temporaryPath(directory), { recursive: true, force: true }); throw error; }
  prior = null;
  const loadSession = async (session: string) => {
    if (loadedSessions.has(session)) return;
    db.exec("SAVEPOINT load_session");
    try {
      for (const page of memberPages.filter(page => page.session === session)) {
        signal?.throwIfAborted();
        for (const vote of await readPage(vault, metadata, page)) {
          if (!getRoll.get(vote.id)) putRoll.run(vote.id, vote.session, JSON.stringify(bodyOf(vote)));
          const position = vote.positions[0]; putPosition.run(vote.id, position.personId, position.option, position.retrievedAt);
        }
      }
      db.exec("RELEASE load_session"); loadedSessions.add(session);
    } catch (error) { db.exec("ROLLBACK TO load_session; RELEASE load_session"); throw error; }
  };
  return {
    async put(vote: PluralVoteFact): Promise<string | null> {
      signal?.throwIfAborted();
      if (Buffer.byteLength(JSON.stringify(bodyOf(vote))) + 512 > MAX_PAGE_BYTES) return "the sourced roll metadata exceeds a bounded reader page; earlier verified votes remain live";
      await loadSession(vote.session);
      const persisted = getRoll.get(vote.id), old = metadata.get(vote.id);
      const previous = persisted ? JSON.parse(String(persisted.body)) as PluralVoteFact : old;
      if (previous && (previous.billId !== vote.billId || previous.session !== vote.session || previous.organizationId !== vote.organizationId)) return "the native vote changed its bill, session or chamber identity; the earlier verified vote remains live";
      if (previous && previous.retrievedAt > vote.retrievedAt) return null;
      if (persisted && canonicalCivicDataHash(JSON.parse(String(persisted.body))) === canonicalCivicDataHash(bodyOf(vote)) && vote.positions.every(position => {
        const held = getPosition.get(vote.id, position.personId);
        return held?.option === position.option && String(held.retrieved_at) >= position.retrievedAt;
      })) return null;
      if (persisted) for (const position of positionsForRoll.iterate(vote.id)) markPerson(vote.session, String(position.person_id));
      importVote(vote); return null;
    },
    async snapshot(): Promise<VotePageProjection> {
      for (const id of dirtyRolls) {
        signal?.throwIfAborted(); const body = JSON.parse(String(getRoll.get(id)!.body)) as PluralVoteFact;
        const positions = [...positionsForRoll.iterate(id)].map(row => ({ personId: String(row.person_id), option: String(row.option) }));
        metadata.set(id, { ...body, positions: [], positionCount: positions.length, positionHash: canonicalCivicDataHash(positions), firstPersonId: positions[0]?.personId });
      }
      for (const [session, people] of dirtyPeople) for (const personId of people) {
        const refs: VoteMemberPage[] = []; let batch: string[] = [], batchBytes = 2;
        const flush = async () => {
          if (!batch.length) return;
          const bytes = new TextEncoder().encode(`[${batch.join(",")}]`), sha256 = digest(bytes);
          const key = `project/state-votes/${sourceId}/${state}/${digest(session)}/${personId.slice(11)}/${sha256}.json`;
          await vault.put(key, bytes, { contentType: "application/json", contentHash: `sha256-${sha256}`, byteLength: bytes.length });
          refs.push({ session, personId, key, sha256, count: batch.length }); batch = []; batchBytes = 2;
        };
        for (const row of memberVotes.iterate(session, personId)) {
          signal?.throwIfAborted(); const body = JSON.parse(String(row.body)) as PluralVoteFact;
          const record = JSON.stringify({ ...body, positions: [{ personId, option: String(row.option), retrievedAt: String(row.retrieved_at) }] });
          const bytes = Buffer.byteLength(record) + (batch.length ? 1 : 0);
          if (batch.length && (batchBytes + bytes > MAX_PAGE_BYTES || batch.length >= PAGE_ROWS)) await flush();
          batch.push(record); batchBytes += Buffer.byteLength(record) + (batch.length > 1 ? 1 : 0);
        }
        await flush(); memberPages = memberPages.filter(page => page.session !== session || page.personId !== personId).concat(refs);
      }
      db.exec("COMMIT; BEGIN"); dirtyRolls.clear(); dirtyPeople.clear();
      return { formatVersion: 2, state, rollCalls: [...metadata.values()].sort((a,b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)),
        memberPages: [...memberPages].sort((a,b) => a.session.localeCompare(b.session) || a.personId.localeCompare(b.personId) || a.key.localeCompare(b.key)) };
    },
    async close() { db.close(); await rm(temporaryPath(directory), { recursive: true, force: true }); },
  };
}
