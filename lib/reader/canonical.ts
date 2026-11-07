import { storedKeyValue } from "../core/keys-values.ts";
import { parseUnchangedConfirmation } from "../civic-data/unchanged-confirmation.ts";
import { canonicalCivicDataHash } from "../civic-data/canonical-hash.ts";
import type { ReadOnlyQuery, Statement, Row } from "../control-plane/admin-view/promoted-slices.ts";
import { readerDatabaseQuery } from "./database.ts";
import { currentReaderRoute, withReaderRoute } from "../db/reader-route.ts";
import { CivicPayloadParts } from "../civic-data/payload-parts.ts";
import { registerIntegrityCheckedEdgeEntries, type CivicDataReadStore, type PromotedEdgeEntry } from "../civic-data/read-model.ts";
import type { RoutineRecordClass } from "../civic-data/types.ts";
import { isCivicPayloadPart } from "../civic-data/payload-codec.ts";
import { serverReaderValue } from "./memory.ts";
import { createHash } from "node:crypto";
import { MEETING_HELD_LOOKBACK_DAYS } from "../meetings/constants.ts";
import { BALLOT_RESULT_VERSION_SQL, ballotResultFactsSql, withBallotResultFacts, type BallotResultFacts } from "../ballot/election-results.ts";
import type { GenericBallotProjection } from "../ballot/generic-projection.ts";
import type { Query } from "../facts/publish.ts";

const refuse = (reason: string) => async (): Promise<never> => { throw new Error(reason); };
type Pointer = { recordClass: RoutineRecordClass; scope: string };
type Additional = Statement & { readonly canonicalKeys?: true;
  readonly sharedSources?: { readonly keys: readonly string[]; readonly translations: string } };
type CanonicalRead = Awaited<ReturnType<typeof readCanonicalShelf>>;
type PublishedQuery = ReadOnlyQuery & { publicationFingerprints?: true; canonicalBody?: ReadOnlyQuery };

// Pointer and candidate row versions also cover admission and metadata changes.
// Immutable payload parts remain addressed by their source fingerprints.
const PUBLICATION_FINGERPRINT = `SELECT encode(sha256(convert_to(coalesce(string_agg(
  jsonb_build_array(p.key,p.xmin::text,c.xmin::text,
    (SELECT e.sequence::text FROM civic_data_candidate_events e WHERE e.candidate_id=p.current_version_id
      AND left(e.detail,26)='UNCHANGED_CONFIRMATION_V1 ' ORDER BY e.sequence DESC LIMIT 1))::text,
  '|' ORDER BY p.key),''),'UTF8')),'hex') AS value
  FROM civic_data_promotions p LEFT JOIN civic_data_candidates c ON c.id=p.current_version_id
  WHERE p.key=ANY($1::text[]) OR p.record_class='CURATED_READER_RECORD' AND p.scope LIKE $2`;
type SharedSnapshot = { readonly fingerprint: string; readonly rows: readonly Row[] };
type PendingSnapshot = { readonly expected: Promise<string>; readonly body: Promise<SharedSnapshot> };
const inFlight = serverReaderValue("canonical-in-flight-by-publication-v2", () => new Map<string, Set<PendingSnapshot>>());

const includesBallots = (keys: readonly string[]) => keys.some(key => key.startsWith("BALLOT_CANDIDACY:"));
const publicationFingerprintSql = (keys: readonly string[]) => !includesBallots(keys) ? PUBLICATION_FINGERPRINT
  : `SELECT encode(sha256(convert_to(versions.value||${BALLOT_RESULT_VERSION_SQL},'UTF8')),'hex') AS value
      FROM (${PUBLICATION_FINGERPRINT}) versions`;

async function publicationFingerprint(query: ReadOnlyQuery, params: readonly unknown[]): Promise<string> {
  const [[row]] = await query([{ text: publicationFingerprintSql(params[0] as readonly string[]), params }]);
  if (typeof row?.value !== "string" || !/^[a-f0-9]{64}$/.test(row.value)) throw new Error("READER_PUBLICATION_FINGERPRINT_MISSING");
  return row.value;
}

/** The version of these promoted entries: it moves when any is published, confirmed again or changed in any way. One small statement. */
export function publicationVersion(keys: readonly string[], query: ReadOnlyQuery | null = readerDatabaseQuery()): Promise<string> {
  if (!query) throw new Error("READER_STORE_NOT_CONFIGURED");
  return publicationFingerprint(query, [keys, ""]);
}

/** Only borrow an in-flight snapshot after an independent current fingerprint check. */
async function sharedCanonicalRead(query: ReadOnlyQuery, statement: Statement, sources: NonNullable<Additional["sharedSources"]>) {
  const selection = createHash("sha256").update(JSON.stringify([storedKeyValue("DATABASE_URL"), statement, sources])).digest("hex");
  const params = [sources.keys, sources.translations];
  const current = () => publicationFingerprint(query, params);
  const candidates = [...inFlight.get(selection) ?? []];
  if (candidates.length) {
    let fingerprint = await current();
    for (const candidate of candidates) {
      // The producer checks metadata beside its body read, so neither map nor
      // ballot needs to wait for a preliminary network round trip.
      const expected = await candidate.expected.catch(() => null);
      if (expected !== fingerprint) continue;
      const result = await candidate.body;
      if (result.fingerprint === fingerprint) return [result.rows];
      fingerprint = await current();
      if (result.fingerprint === fingerprint) return [result.rows];
    }
  }
  const expected = current();
  void expected.catch(() => {});
  const offset = statement.params.length;
  const fingerprintSql = publicationFingerprintSql(sources.keys).replace(/\$(\d+)/g, (_, index: string) => `$${Number(index) + offset}`);
  const text = `${statement.text} UNION ALL SELECT 'publication-fingerprint',empty.*,NULL::text,to_jsonb(versions.value)
    FROM (${fingerprintSql}) versions LEFT JOIN LATERAL (${EMPTY_SHELF}) empty ON true`;
  const readBody = (query as PublishedQuery).canonicalBody ?? query;
  const body = readBody([{ text, params: [...statement.params, ...params] }]).then(([rows]) => {
    const actual = rows.find(row => row.row_kind === "publication-fingerprint")?.part_payload;
    if (typeof actual !== "string" || !/^[a-f0-9]{64}$/.test(actual)) throw new Error("READER_PUBLICATION_FINGERPRINT_MISSING");
    return { fingerprint: actual, rows: rows.filter(row => row.row_kind !== "publication-fingerprint") };
  });
  const pending = { expected, body };
  const active = inFlight.get(selection) ?? new Set<PendingSnapshot>();
  active.add(pending);
  inFlight.set(selection, active);
  try { return [(await body).rows]; }
  finally { active.delete(pending); if (!active.size) inFlight.delete(selection); }
}

/** One network read with independent group failures; accompanying geography belongs to the first group. */
export function readCanonicalPackages(groups: readonly (readonly Pointer[])[], query: ReadOnlyQuery | null = readerDatabaseQuery(), additional?: Additional): CivicDataReadStore & { readGroup(index: number): Promise<CanonicalRead> } {
  const keys = [...new Set(groups.flatMap(group => group.map(entry => `${entry.recordClass}:${entry.scope}`)))];
  const batch = (async () => {
    if (!query) throw new Error("READER_STORE_NOT_CONFIGURED");
    const statement = canonicalStatement(keys, additional);
    return additional?.sharedSources && (query as PublishedQuery).publicationFingerprints
      ? sharedCanonicalRead(query, statement, additional.sharedSources) : ((query as PublishedQuery).canonicalBody ?? query)([statement]);
  })();
  void batch.catch(() => undefined);
  const stores = new Map<string, Promise<CivicDataReadStore>>();
  const reads: Promise<CanonicalRead>[] = [];
  for (const [index,group] of groups.entries()) {
    const selected = new Set(group.map(entry => `${entry.recordClass}:${entry.scope}`));
    const read = readCanonicalShelf(group, async () => {
      const [rows] = await batch;
      const extra = index === 0 ? rows.find(row => row.row_kind === "additional") : undefined;
      if (extra && additional?.canonicalKeys) for (const row of extra.part_payload as readonly Row[]) {
        for (const key of row.canonical_keys as readonly string[] ?? []) selected.add(key);
      }
      const promotions = rows.filter(row => row.row_kind === "promotion" && selected.has(String(row.key)));
      const parts = new Map(rows.filter(row => row.row_kind === "part").map(row => [String(row.part_hash),row]));
      const needed = new Set<string>();
      const visit = (value: unknown): void => {
        if (isCivicPayloadPart(value)) {
          const hash = value.$civicPayloadPart;
          if (needed.has(hash)) return;
          needed.add(hash); visit(parts.get(hash)?.part_payload);
        } else if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === "object") Object.values(value).forEach(visit);
      };
      for (const row of promotions) { visit(row.payload); visit(row.validation_receipt); }
      const selectedRows: Row[] = [...promotions];
      for (const hash of needed) { const part = parts.get(hash); if (part) selectedRows.push(part); }
      selectedRows.push(...rows.filter(row => row.row_kind === "ballot-results" && selected.has(String(row.part_hash))));
      if (extra) selectedRows.push(extra);
      return [structuredClone(selectedRows)];
    }, index === 0 ? additional : undefined);
    reads.push(read);
    void read.catch(() => undefined);
    for (const entry of group) stores.set(`${entry.recordClass}:${entry.scope}`, read);
  }
  return {
    async readGroup(index) {
      const read = reads[index];
      if (!read) throw new Error("READER_GROUP_NOT_SELECTED");
      return read;
    },
    readPromotion: refuse("READER_USES_CANONICAL_ENTRY"), readCandidate: refuse("READER_USES_CANONICAL_ENTRY"),
    async readPromotedEntry(recordClass, scope) {
      const read = stores.get(`${recordClass}:${scope}`);
      if (!read) throw new Error(`READER_SCOPE_NOT_SELECTED:${recordClass}:${scope}`);
      return (await read).readPromotedEntry!(recordClass, scope);
    },
  };
}

// Exclusion reasons belong to the read disposition; copies of rejected source rows stay in the audit store.
// Gives a summary row the shelf's column shape; it returns no shelf rows.
const EMPTY_SHELF = "SELECT * FROM shelf LIMIT 0";

const SHELF = `SELECT p.key,p.record_class,p.scope,p.source_id,p.current_version_id,p.last_known_good_version_id,p.promoted_at,
 CASE WHEN jsonb_typeof(p.validation_receipt->'excludedFacts')='array' THEN
  jsonb_set(p.validation_receipt,'{excludedFacts}',coalesce((SELECT jsonb_agg(f.value-'record') FROM jsonb_array_elements(p.validation_receipt->'excludedFacts') f(value)),'[]'::jsonb))
  ELSE p.validation_receipt END AS validation_receipt,
 p.payload,
 c.normalized_hash,c.retrieved_at,
 (SELECT e.detail FROM civic_data_candidate_events e WHERE e.candidate_id=p.current_version_id AND left(e.detail,26)='UNCHANGED_CONFIRMATION_V1 ' ORDER BY e.sequence DESC LIMIT 1) AS confirmation,
 (p.current_version_id=p.last_known_good_version_id AND c.id=p.current_version_id AND c.state='PROMOTED' AND c.acquisition_succeeded
  AND c.promoted_version_id=c.id AND c.last_known_good_version_id=c.id AND c.record_class=p.record_class AND c.scope=p.scope AND c.source_id=p.source_id
  AND p.payload_fingerprint IS NOT DISTINCT FROM c.read_model_fingerprint
  AND p.validation_receipt->>'decision'='GOOD' AND p.validation_receipt->>'candidateId'=c.id AND p.validation_receipt->>'sourceId'=c.source_id
  AND p.validation_receipt->>'recordClass'=p.record_class AND p.validation_receipt->>'scope'=p.scope) AS published
 FROM civic_data_promotions p LEFT JOIN civic_data_candidates c ON c.id=p.current_version_id WHERE p.key=ANY($1::text[])`;

// Keep payloads as individual rows: aggregating a large state payload into JSON adds avoidable copies.
// LIMIT 1 keeps each recursive hash lookup parameterized on the primary key. Without it,
// PostgreSQL can walk every stored part before joining the requested hashes at each level.
const SHELF_WITH_PARTS = `WITH RECURSIVE shelf AS MATERIALIZED (${SHELF}), hashes(hash) AS (
  SELECT ref#>>'{}' FROM shelf,
    LATERAL (VALUES (shelf.payload),(shelf.validation_receipt)) AS roots(value),
    LATERAL jsonb_path_query(roots.value,'strict $.**."$civicPayloadPart"','{}',true) ref WHERE shelf.published
  UNION
  SELECT ref#>>'{}' FROM hashes
    CROSS JOIN LATERAL (SELECT payload FROM civic_data_payload_parts WHERE hash=hashes.hash LIMIT 1) part,
    LATERAL jsonb_path_query(part.payload,'strict $.**."$civicPayloadPart"','{}',true) ref
)
SELECT 'promotion' AS row_kind,shelf.*,NULL::text AS part_hash,NULL::jsonb AS part_payload FROM shelf
UNION ALL
SELECT 'part',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,part.hash,part.payload
  FROM hashes CROSS JOIN LATERAL (
    SELECT hash,payload FROM civic_data_payload_parts WHERE hash=hashes.hash LIMIT 1
  ) part`;

function canonicalStatement(keys: readonly string[], additional?: Additional): Statement {
  const additionalSql = additional?.text.replace(/\$(\d+)/g, (_, index: string) => `$${Number(index) + 1}`);
  const shelfSql = additional?.canonicalKeys ? SHELF_WITH_PARTS
    .replace("WITH RECURSIVE shelf", () => `WITH RECURSIVE additional AS MATERIALIZED (${additionalSql}), shelf`)
    .replace("p.key=ANY($1::text[])", "p.key=ANY($1::text[] || ARRAY(SELECT DISTINCT unnest(canonical_keys) FROM additional))") : SHELF_WITH_PARTS;
  const extra = additional ? ` UNION ALL SELECT 'additional', empty.*, NULL::text, extra.rows
    FROM (SELECT coalesce(jsonb_agg(to_jsonb(item)), '[]'::jsonb) AS rows FROM (
      ${additional.canonicalKeys ? "SELECT * FROM additional" : additionalSql}
    ) item) extra LEFT JOIN LATERAL (${EMPTY_SHELF}) empty ON true` : "";
  const results = includesBallots(keys) ? ` UNION ALL SELECT 'ballot-results',empty.*,selected.key,
    ${ballotResultFactsSql("selected.payload")} FROM shelf selected
    LEFT JOIN LATERAL (${EMPTY_SHELF}) empty ON true WHERE selected.record_class='BALLOT_CANDIDACY' AND selected.published` : "";
  return {text:shelfSql+extra+results,params:[keys,...additional?.params ?? []]};
}

/** Read canonical promotions once; source evidence was checked when each fact was published. */
export async function readCanonicalShelf(entries: readonly { recordClass: RoutineRecordClass; scope: string }[], query: ReadOnlyQuery | null = readerDatabaseQuery(), additional?: Additional): Promise<CivicDataReadStore & { additionalRows: readonly Row[]; additionalEntries: readonly Pointer[] }> {
  if (!query) throw new Error("READER_STORE_NOT_CONFIGURED");
  const keys = entries.map(entry => `${entry.recordClass}:${entry.scope}`);
  // A read outside any reader route names the kinds of record it takes, so the meter shows who is reading.
  const read = () => ((query as PublishedQuery).canonicalBody ?? query)([canonicalStatement(keys,additional)]);
  const [loaded] = await (currentReaderRoute() === "unattributed"
    ? withReaderRoute(`shelf:${[...new Set(entries.map(entry => entry.recordClass))].join("+")}`, read) : read());
  const additionalRows = loaded.find(row => row.row_kind === "additional")?.part_payload as readonly Row[] | undefined;
  const additionalEntries: Pointer[] = additional?.canonicalKeys ? [...new Set((additionalRows ?? []).flatMap(row => row.canonical_keys as readonly string[] ?? []))]
    .map(key => { const colon = key.indexOf(":"); return { recordClass: key.slice(0, colon) as RoutineRecordClass, scope: key.slice(colon + 1) }; }) : [];
  keys.push(...additionalEntries.map(entry => `${entry.recordClass}:${entry.scope}`));
  const rows = loaded.filter(row => row.row_kind === "promotion");
  const preloaded = Object.fromEntries(loaded.filter(row => row.row_kind === "part").map(row => [String(row.part_hash),row.part_payload]));
  if (rows.some(row => row.published !== true)) throw new Error("READER_PUBLISHED_POINTER_INVALID");
  const parts = new CivicPayloadParts({ existing: refuse("READER_IS_READ_ONLY"), write: refuse("READER_IS_READ_ONLY"), read: refuse("READER_PARTS_MISSING") });
  const values = await parts.loadOwned(rows, preloaded) as typeof rows;
  const decoded: { root: PromotedEdgeEntry }[] = values.map(row => ({ root: { kind: "PROMOTED", projection: {
    key: String(row.key), recordClass: row.record_class as RoutineRecordClass, scope: String(row.scope), sourceId: String(row.source_id),
    versionId: String(row.current_version_id), lastKnownGoodVersionId: String(row.last_known_good_version_id), promotedAt: String(row.promoted_at),
    receipt: row.validation_receipt as import("../civic-data/types.ts").ValidationReceipt, payload: row.payload,
  }, attested: { recordClass: row.record_class as RoutineRecordClass, scope: String(row.scope), versionId: String(row.current_version_id),
    payloadSha256: String(row.normalized_hash), retrievedAt: String(row.retrieved_at), staleAtRetrieval: false, version: null, sourceThrough: null,
  } } }));
  for (let index = 0; index < decoded.length; index++) {
    const entry = decoded[index].root;
    const serialized = values[index].confirmation;
    const confirmation = typeof serialized === "string" ? parseUnchangedConfirmation(serialized) : null;
    if (entry.kind === "PROMOTED" && confirmation?.versionId === entry.projection.versionId && confirmation.pointerKey === entry.projection.key) Object.assign(entry.projection, { latestConfirmation: confirmation });
  }
  const held = new Map(decoded.map(({ root }) => [root.kind === "PROMOTED" ? root.projection.key : `${root.recordClass}:${root.scope}`, root]));
  for (const entry of held.values()) if (entry.kind === "PROMOTED") {
    if (canonicalCivicDataHash(entry.projection.payload) !== entry.attested.payloadSha256) throw new Error("READER_PUBLISHED_PAYLOAD_HASH_MISMATCH");
    const results = loaded.find(row => row.row_kind === "ballot-results" && row.part_hash === entry.projection.key)?.part_payload;
    if (entry.projection.recordClass === "BALLOT_CANDIDACY" && results) {
      const payload = withBallotResultFacts(entry.projection.payload as GenericBallotProjection, results as BallotResultFacts);
      Object.assign(entry.projection, { payload });
      Object.assign(entry.attested, { payloadSha256: canonicalCivicDataHash(payload) });
    }
  }
  registerIntegrityCheckedEdgeEntries([...held.values()]);
  return {
    additionalRows: additionalRows ?? [], additionalEntries,
    readPromotion: refuse("READER_USES_CANONICAL_ENTRY"), readCandidate: refuse("READER_USES_CANONICAL_ENTRY"),
    async readPromotedEntry(recordClass, scope) {
      const key = `${recordClass}:${scope}`;
      if (!keys.includes(key)) throw new Error(`READER_SCOPE_NOT_SELECTED:${key}`);
      return held.get(key) ?? { kind: "NOT_RECORDED", recordClass, scope };
    },
  };
}

/** The calendar partitions of these boards (by the family keys and the boards' encoded ids), with their headers and members when `$3` asks and their last unchanged confirmation, in scope order. */
export const MEETING_PARTITIONS_SQL = `SELECT p.scope,p.key,p.current_version_id AS version,
    CASE WHEN $3::boolean THEN reader_payload_value(CASE WHEN p.scope LIKE 'source:derived:family:%'
      THEN (header-'meetings'-'agendaDocuments'-'derivedMembers'-'sources') || jsonb_build_object('sources',coalesce((
        SELECT jsonb_agg(reader_payload_node(s.item)-'acquisitions' ORDER BY s.ordinal_index) FROM reader_payload_members(header->'sources') s),'[]'::jsonb))
      ELSE header-'meetings'-'agendaDocuments'-'derivedMembers' END) END AS header,
    CASE WHEN $3::boolean AND header ? 'derivedMembers' THEN coalesce((SELECT jsonb_agg(reader_payload_value(d.item) ORDER BY d.ordinal_index)
      FROM reader_payload_members(header->'derivedMembers') d),'[]'::jsonb) END AS members,
    (SELECT e.detail FROM civic_data_candidate_events e WHERE e.candidate_id=p.current_version_id AND left(e.detail,26)='UNCHANGED_CONFIRMATION_V1 '
      ORDER BY e.sequence DESC LIMIT 1) AS confirmation
  FROM civic_data_promotions p CROSS JOIN LATERAL (SELECT reader_payload_node(p.payload) AS header) h
  WHERE p.record_class='MEETING' AND (p.key=ANY($1::text[]) OR left(p.scope,7)='source:' AND split_part(p.scope,':',3)='body' AND split_part(p.scope,':',4)=ANY($2::text[])) ORDER BY p.scope`;

/** Sittings an earlier, good version of a calendar still carries past the held window, newest version first; their agenda papers follow the sittings. */
export const ARCHIVED_MEETINGS_SQL = (collection: "meetings" | "agendaDocuments") => `WITH held AS (
    SELECT p.scope,p.current_version_id AS id,c.source_id FROM civic_data_promotions p JOIN civic_data_candidates c ON c.id=p.current_version_id WHERE p.key=ANY($1::text[])
  ), versions AS (
    SELECT c.id,c.retrieved_at FROM held JOIN civic_data_candidates c ON c.record_class='MEETING' AND c.scope=held.scope AND c.source_id=held.source_id
    WHERE c.id<>held.id AND c.state='PROMOTED' AND c.acquisition_succeeded AND c.promoted_version_id=c.id AND c.last_known_good_version_id=c.id
      AND c.normalized_hash ~ '^[a-f0-9]{64}$' AND c.validation_receipt->>'decision'='GOOD' AND c.validation_receipt->>'candidateId'=c.id
      AND c.validation_receipt->>'recordClass'=c.record_class AND c.validation_receipt->>'scope'=c.scope AND c.validation_receipt->>'sourceId'=c.source_id
  ), sittings AS (
    SELECT DISTINCT ON (header->>'id') header->>'id' AS id,header->>'bodyId' AS body,header AS value,v.retrieved_at
    FROM versions v CROSS JOIN LATERAL (SELECT candidate->'readModel' AS payload FROM civic_data_candidates WHERE id=v.id LIMIT 1) model
      CROSS JOIN LATERAL reader_payload_members(reader_payload_node(model.payload)->'meetings') m
      CROSS JOIN LATERAL (SELECT reader_payload_value(m.item) AS header) h
    WHERE header->>'bodyId'=ANY($2::text[]) AND header->>'id' IS NOT NULL AND header->>'startsAt' ~ '^\\d{4}-\\d{2}-\\d{2}T'
      AND (header->>'startsAt')::timestamptz < now()-make_interval(days=>${MEETING_HELD_LOOKBACK_DAYS})
    ORDER BY header->>'id',v.retrieved_at DESC
  )${collection === "meetings" ? "SELECT id,body,value FROM sittings ORDER BY id" : `, papers AS (
    SELECT DISTINCT ON (reader_payload_node(d.item)->>'id') s.body,reader_payload_value(d.item) AS value
    FROM versions v CROSS JOIN LATERAL (SELECT candidate->'readModel' AS payload FROM civic_data_candidates WHERE id=v.id LIMIT 1) model
      CROSS JOIN LATERAL reader_payload_members(reader_payload_node(model.payload)->'agendaDocuments') d
      JOIN sittings s ON s.id=reader_payload_node(d.item)->>'meetingId'
    ORDER BY reader_payload_node(d.item)->>'id',v.retrieved_at DESC
  ) SELECT body,value FROM papers`}`;

/** Source-clock fingerprints and the current ballot version, without reading any ballot record. */
export function electionResultClockRows(query: Query, scopes: readonly { readonly name: string; readonly scope: string | null; readonly hashMD5?: string }[]) {
  return query(`SELECT requested.name,md5(c.position) AS clock_hash,
    CASE WHEN md5(c.position)=requested.hash THEN NULL ELSE c.position END AS position,p.current_version_id AS ballot_version
    FROM unnest($1::text[],$2::text[],$3::text[]) requested(name,scope,hash) LEFT JOIN pass_cursor c ON c.name=requested.name
    LEFT JOIN civic_data_promotions p ON p.record_class='BALLOT_CANDIDACY' AND p.scope=requested.scope`,
    [scopes.map(row => row.name), scopes.map(row => row.scope), scopes.map(row => row.hashMD5 ?? null)]);
}
