/** Public Open States session CSV archives retain native person IDs. JSON
 * session exports contain names only, so they cannot provide these joins. */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { temporaryPath } from "../../civic-data/temporary-path.ts";
import { parseCsv } from "../../reference/csv.ts";
import { openZipFile, type FileArchiveMember } from "../archive.ts";
import { pluralVoteJurisdiction, pluralVoteState, type PluralBillEvidence, type PluralVoteFact } from "./votes.ts";

type Row = Record<string, string>;
const nativeId = (value: string | undefined, kind: string) => !!value && new RegExp(`^ocd-${kind}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`).test(value);
const text = (value: string | undefined) => value?.trim() ?? "";
const archiveLimits = { maxEntries: 64, maxMemberBytes: 512 * 1024 * 1024, maxTotalBytes: 1024 * 1024 * 1024 };

/** Decode a CSV record at a time: position files can be much larger than the
 * normalized votes. Embedded quoted newlines and chunk-split quotes survive. */
async function* rows(member: FileArchiveMember, required: readonly string[], signal?: AbortSignal): AsyncIterable<Row> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let record = "", quoted = false, headers: string[] | undefined;
  const decodeRecord = (): Row | null => {
    const parsed = parseCsv(record);
    record = "";
    if (!parsed.length) return null;
    if (parsed.length !== 1) throw new Error(`PLURAL_BULK_CSV_RECORD_INVALID:${member.name}`);
    const values = parsed[0]!;
    if (!headers) {
      headers = values.map(value => value.replace(/^\uFEFF/, ""));
      if (new Set(headers).size !== headers.length || headers.some(value => !value)) throw new Error(`PLURAL_BULK_CSV_HEADER_INVALID:${member.name}`);
      if (required.some(value => !headers!.includes(value))) throw new Error(`PLURAL_BULK_CSV_REQUIRED_HEADER_MISSING:${member.name}`);
      return null;
    }
    if (values.length !== headers.length) throw new Error(`PLURAL_BULK_CSV_COLUMNS_INVALID:${member.name}`);
    return Object.fromEntries(headers.map((header, index) => [header, values[index]!]));
  };
  for await (const bytes of member.stream()) {
    signal?.throwIfAborted();
    const chunk = decoder.decode(bytes, { stream: true });
    for (const character of chunk) {
      record += character;
      if (character === '"') quoted = !quoted;
      if (character === "\n" && !quoted) {
        const row = decodeRecord();
        if (row) yield row;
      }
    }
    if (record.length > 8 * 1024 * 1024) throw new Error(`PLURAL_BULK_CSV_RECORD_TOO_LARGE:${member.name}`);
  }
  record += decoder.decode();
  if (quoted) throw new Error(`PLURAL_BULK_CSV_QUOTE_INVALID:${member.name}`);
  if (record) { const row = decodeRecord(); if (row) yield row; }
  if (!headers) throw new Error(`PLURAL_BULK_CSV_HEADER_MISSING:${member.name}`);
}

function date(value: string | undefined, checkedAt: string): string | null {
  const raw = text(value), day = raw.slice(0, 10), stamp = Date.parse(day);
  return /^\d{4}-\d{2}-\d{2}(?:$|[ T])/.test(raw) && Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === day && day <= checkedAt.slice(0, 10) ? day : null;
}

interface SqlStatement {
  run(...values: (string | number | null)[]): { changes: number | bigint };
  get(...values: (string | number | null)[]): Record<string, string | number> | undefined;
  all(...values: (string | number | null)[]): Record<string, string | number>[];
  iterate(...values: (string | number | null)[]): Iterable<Record<string, string | number>>;
}
interface SqlDatabase { exec(sql: string): void; prepare(sql: string): SqlStatement; close(): void }
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new (path: string) => SqlDatabase };
export interface PluralBulkParseOptions { onVote?: (vote: PluralVoteFact) => Promise<void>; signal?: AbortSignal }
export interface PluralBulkSessionResult {
  votes: PluralVoteFact[]; held: { key: string; detail: string }[]; members: string[];
  rollCalls: number; memberVotes: number; unmatchedPositions: number;
}

/** Arbitrarily ordered CSVs join on disk. Only one roll's positions enter memory;
 * the consumer must finish it before the next verified roll is assembled. */
export async function parsePluralBulkSessionFile(state: string, session: string, path: string, evidence: PluralBillEvidence,
  options: PluralBulkParseOptions = {}): Promise<PluralBulkSessionResult> {
  const normalizedState = pluralVoteState(state), stateCode = normalizedState.toUpperCase();
  if (!session.trim() || /[\/\\\u0000-\u001f\u007f]/.test(session) || session === "." || session === "..") throw new Error("PLURAL_BULK_SESSION_INVALID");
  const source = new URL(evidence.finalUrl);
  let sourcePath: string;
  try { sourcePath = decodeURIComponent(source.pathname); } catch { throw new Error("PLURAL_BULK_SOURCE_ROUTE_INVALID"); }
  if (source.origin !== "https://data.openstates.org" || source.username || source.password ||
      !sourcePath.startsWith(`/csv/latest/${stateCode}_${session}_csv_`) || !sourcePath.endsWith(".zip")) throw new Error("PLURAL_BULK_SOURCE_ROUTE_INVALID");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) { options.signal?.throwIfAborted(); hash.update(chunk); }
  if (hash.digest("hex") !== evidence.sha256 || !Number.isFinite(Date.parse(evidence.retrievedAt))) throw new Error("PLURAL_BULK_SOURCE_EVIDENCE_INVALID");
  const directory = await mkdtemp(temporaryPath(join(tmpdir(), "meanwhile-openstates-join-")));
  let db: SqlDatabase | undefined;
  try {
    db = new DatabaseSync(temporaryPath(join(directory, "session.sqlite")));
    db.exec(`PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA temp_store=FILE; PRAGMA cache_size=-8192; PRAGMA mmap_size=0;
      CREATE TABLE bills(id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE organizations(id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE seen_votes(id TEXT PRIMARY KEY);
      CREATE TABLE votes(id TEXT PRIMARY KEY, data TEXT NOT NULL, rejected INTEGER NOT NULL DEFAULT 0, unresolved INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE positions(vote_id TEXT, person_id TEXT, option TEXT, conflicted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(vote_id,person_id));
      CREATE TABLE counts(vote_id TEXT, option TEXT, value INTEGER, PRIMARY KEY(vote_id,option));
      CREATE TABLE sources(vote_id TEXT, url TEXT, PRIMARY KEY(vote_id,url));
      CREATE TABLE held(sequence INTEGER PRIMARY KEY, key TEXT, detail TEXT);
      BEGIN;`);
    const query = (sql: string) => db!.prepare(sql);
    const addBill = query("INSERT OR IGNORE INTO bills VALUES(?,?)"), getBill = query("SELECT data FROM bills WHERE id=?");
    const addOrg = query("INSERT OR IGNORE INTO organizations VALUES(?,?)"), getOrg = query("SELECT data FROM organizations WHERE id=?");
    const seeVote = query("INSERT OR IGNORE INTO seen_votes VALUES(?)"), addVote = query("INSERT INTO votes(id,data) VALUES(?,?)");
    const getVote = query("SELECT rejected FROM votes WHERE id=?"), rejectVote = query("UPDATE votes SET rejected=1 WHERE id=?");
    const unresolved = query("UPDATE votes SET unresolved=unresolved+1 WHERE id=?"), addHeld = query("INSERT INTO held(key,detail) VALUES(?,?)");
    const hold = (key: string, detail: string) => { addHeld.run(key, detail); };
    const live = (id: string) => getVote.get(id)?.rejected === 0;
    const entries = await openZipFile(path, archiveLimits), prefix = `${stateCode}/${session}/${stateCode}_${session}_`;
    if (entries.some(entry => entry.name !== "README" && !entry.name.startsWith(prefix))) throw new Error("PLURAL_BULK_ARCHIVE_SCOPE_INVALID");
    const readme = entries.find(entry => entry.name === "README");
    if (!readme || readme.size > 4096) throw new Error("PLURAL_BULK_ARCHIVE_METADATA_MISSING");
    const metadataChunks: Uint8Array[] = [];
    for await (const chunk of readme.stream()) metadataChunks.push(chunk);
    const metadata = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(metadataChunks));
    if (!metadata.split(/\r?\n/).includes(`State: ${stateCode}`) || !metadata.split(/\r?\n/).includes(`Session: ${session}`)) throw new Error("PLURAL_BULK_ARCHIVE_METADATA_SCOPE_INVALID");
    const selected: string[] = [], consumed = new Set(["README"]);
    const member = (suffix: string, required = false) => {
      const entry = entries.find(entry => entry.name === `${prefix}${suffix}.csv`);
      if (!entry && required) throw new Error(`PLURAL_BULK_MEMBER_MISSING:${suffix}`);
      if (entry) selected.push(entry.name);
      return entry;
    };
    const billFile = member("bills", true)!, voteFile = member("votes"), orgFile = member("organizations");
    const peopleFile = member("vote_people"), countFile = member("vote_counts"), sourceFile = member("vote_sources");
    const readRows = (entry: FileArchiveMember, required: readonly string[]) => { consumed.add(entry.name); return rows(entry, required, options.signal); };
    let jurisdictionName: string | undefined;
    for await (const bill of readRows(billFile, ["id", "identifier", "title", "session_identifier", "jurisdiction"])) {
      if (!nativeId(bill.id, "bill") || bill.session_identifier !== session || !text(bill.jurisdiction) || !text(bill.identifier) || !text(bill.title) ||
          !addBill.run(bill.id!, JSON.stringify({ id: bill.id, identifier: bill.identifier, title: bill.title, jurisdiction: bill.jurisdiction })).changes) throw new Error("PLURAL_BULK_BILL_IDENTITY_INVALID");
      jurisdictionName ??= bill.jurisdiction;
      if (bill.jurisdiction !== jurisdictionName) throw new Error("PLURAL_BULK_BILL_JURISDICTION_CONFLICT");
    }
    if (voteFile) {
      if (!orgFile) throw new Error("PLURAL_BULK_MEMBER_MISSING:organizations");
      for await (const org of readRows(orgFile, ["id", "jurisdiction_id", "classification"])) {
        if (!nativeId(org.id, "organization") || org.jurisdiction_id !== pluralVoteJurisdiction(normalizedState) ||
            !addOrg.run(org.id!, JSON.stringify({ id: org.id, classification: org.classification })).changes) throw new Error("PLURAL_BULK_ORGANIZATION_IDENTITY_INVALID");
      }
      for await (const row of readRows(voteFile, ["id", "bill_id", "organization_id", "session_identifier", "jurisdiction", "start_date", "motion_text", "result"])) {
        const key = text(row.id), savedBill = getBill.get(row.bill_id!), savedOrg = getOrg.get(row.organization_id!);
        const bill = savedBill ? JSON.parse(String(savedBill.data)) as Row : null, org = savedOrg ? JSON.parse(String(savedOrg.data)) as Row : null;
        const day = date(row.start_date, evidence.retrievedAt), fresh = seeVote.run(key).changes;
        if (!nativeId(key, "vote") || !fresh || !bill || !org || !["upper", "lower", "legislature"].includes(text(org.classification)) ||
            row.session_identifier !== session || row.jurisdiction !== bill.jurisdiction || !day || !text(row.motion_text) || !text(row.result)) {
          rejectVote.run(key); hold(key, "native vote identity, session, date, motion or legislative chamber is unresolved"); continue;
        }
        addVote.run(key, JSON.stringify({ id: key, billId: bill.id!, billNumber: bill.identifier!, billTitle: bill.title!, session,
          organizationId: org.id!, chamber: org.classification, date: day, motion: row.motion_text!, result: row.result!,
          sourceApiUrl: evidence.finalUrl, retrievedAt: evidence.retrievedAt }));
      }
      const getPosition = query("SELECT option,conflicted FROM positions WHERE vote_id=? AND person_id=?");
      const addPosition = query("INSERT INTO positions(vote_id,person_id,option) VALUES(?,?,?)");
      const conflictPosition = query("UPDATE positions SET conflicted=1 WHERE vote_id=? AND person_id=?");
      if (peopleFile) for await (const row of readRows(peopleFile, ["vote_event_id", "voter_id", "option"])) {
        const voteId = row.vote_event_id!;
        if (!live(voteId)) continue;
        if (!nativeId(row.voter_id, "person") || !text(row.option)) { unresolved.run(voteId); continue; }
        const previous = getPosition.get(voteId, row.voter_id!);
        if (previous?.conflicted || previous?.option === row.option) continue;
        if (previous) {
          conflictPosition.run(voteId, row.voter_id!); unresolved.run(voteId);
          hold(`${voteId}:${row.voter_id}`, "the native person has conflicting publisher positions");
        } else addPosition.run(voteId, row.voter_id!, row.option!);
      }
      const addCount = query("INSERT OR IGNORE INTO counts VALUES(?,?,?)");
      if (countFile) for await (const row of readRows(countFile, ["vote_event_id", "option", "value"])) {
        const voteId = row.vote_event_id!;
        if (!live(voteId)) continue;
        if (!text(row.option) || !/^\d+$/.test(text(row.value)) || !Number.isSafeInteger(Number(row.value)) ||
            !addCount.run(voteId, row.option!, Number(row.value)).changes) {
          rejectVote.run(voteId); hold(voteId, "publisher count is invalid or repeats an option");
        }
      }
      const addSource = query("INSERT OR IGNORE INTO sources VALUES(?,?)");
      if (sourceFile) for await (const row of readRows(sourceFile, ["vote_event_id", "url"])) {
        if (!live(row.vote_event_id!)) continue;
        try { const url = new URL(row.url!);
          if (url.protocol === "https:" && !url.username && !url.password) addSource.run(row.vote_event_id!, url.href);
        } catch { /* A missing official link does not hide a verified native vote. */ }
      }
    }
    // Every ZIP member finishes its CRC check before a consumer sees any facts.
    for (const entry of entries) if (!consumed.has(entry.name)) for await (const _chunk of entry.stream()) options.signal?.throwIfAborted();
    db.exec("COMMIT;");
    const positions = query("SELECT person_id,option FROM positions WHERE vote_id=? AND conflicted=0 ORDER BY rowid");
    const counts = query("SELECT option,value FROM counts WHERE vote_id=? ORDER BY rowid"), sources = query("SELECT url FROM sources WHERE vote_id=? ORDER BY rowid");
    const votes: PluralVoteFact[] = [];
    let rollCalls = 0, memberVotes = 0, unmatchedPositions = 0;
    for (const row of query("SELECT id,data,unresolved FROM votes WHERE rejected=0 ORDER BY rowid").iterate()) {
      options.signal?.throwIfAborted();
      const vote = { ...JSON.parse(String(row.data)), unresolvedPositions: Number(row.unresolved),
        positions: positions.all(String(row.id)).map(position => ({ personId: String(position.person_id), option: String(position.option), retrievedAt: evidence.retrievedAt })),
        counts: counts.all(String(row.id)).map(count => ({ option: String(count.option), value: Number(count.value) })),
        sourceUrls: sources.all(String(row.id)).map(source => String(source.url)) } as PluralVoteFact;
      unmatchedPositions += vote.unresolvedPositions;
      if (!vote.positions.length) { hold(vote.id, "no exact native person position was acquired"); continue; }
      rollCalls++; memberVotes += vote.positions.length;
      if (options.onVote) await options.onVote(vote); else votes.push(vote);
    }
    const held = query("SELECT key,detail FROM held ORDER BY sequence").all().map(row => ({ key: String(row.key), detail: String(row.detail) }));
    return { votes, held, members: selected, rollCalls, memberVotes, unmatchedPositions };
  } finally { db?.close(); await rm(temporaryPath(directory), { recursive: true, force: true }); }
}
