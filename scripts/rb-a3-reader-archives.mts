import { neon } from "@neondatabase/serverless";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { FIPS_TO_STATE } from "../lib/ocd/fips.ts";
import { selectedPointerSql } from "../lib/reader/selected-entry.ts";
import { MEETING_HELD_LOOKBACK_DAYS } from "../lib/meetings/constants.ts";
import { isOfficialUrl } from "../lib/facts/check.ts";
import { isSourceApiUrl } from "../lib/control-plane/scheduler/scout-api.ts";
import { bindReaderSources, loadReaderContext, readerReplayField, type ReaderSample, type ReaderSampleValue } from "./rb-a3-reader-sample.mts";

const directory = resolve(process.argv[2] ?? ".scratch/rb-a3/snapshots/reader");
if (!directory.includes("/.scratch/rb-a3/")) throw Error("Copies must stay in the approved ignored local directory");
const url = process.env.WTP_PRODUCTION_DATABASE_URL_READONLY;
if (!url || new URL(url).username !== "readonly") throw Error("The reader readonly connection is required");
const sql = neon(url);
const query = async (text: string, params: unknown[]) => (await sql.transaction([sql.query(text, params)], { readOnly: true }))[0] as Record<string, unknown>[];
const [connection] = await query("SELECT current_user AS role,current_setting('transaction_read_only') AS read_only", []);
if (connection.role !== "readonly" || connection.read_only !== "on") throw Error("The production connection must be read-only");
const held = JSON.parse(readFileSync(resolve(directory, "held-api-doors.json"), "utf8"));
const meetingSources = JSON.parse(readFileSync(resolve(directory, "meeting-source-hosts.json"), "utf8"));
const tenants = JSON.parse(readFileSync(resolve(directory, "legistar-tenants.json"), "utf8"));
const pointerSql = selectedPointerSql.replace("WHERE p.key=$1", "WHERE p.record_class='MEETING' AND p.scope ~* $1");
const at = (record: Record<string, unknown>, path: string): unknown => path.split(".").reduce<unknown>((value, key) =>
  value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined, record);
mkdirSync(resolve(directory, "pre-archives"), { recursive: true, mode: 0o700 });
const states = process.argv[3] ? process.argv[3].split(",") : Object.values(FIPS_TO_STATE).map(s => s.postal).sort();
for (const state of states) {
  if (!Object.values(FIPS_TO_STATE).some(s => s.postal === state)) throw Error("Unknown state");
  const file = resolve(directory, `${state}.json`), backup = resolve(directory, "pre-archives", `${state}.json`);
  if (!existsSync(backup)) writeFileSync(backup, readFileSync(file), { mode: 0o600 });
  const sample = JSON.parse(readFileSync(backup, "utf8")) as ReaderSample;
  // Same public archived-version predicate and calendar age as readPlacePackage; no evidence or unpublished candidate is read.
  const rows = await query(`WITH pointer AS MATERIALIZED (${pointerSql}), versions AS MATERIALIZED (
    SELECT c.id,c.scope,c.retrieved_at,p.key FROM pointer p JOIN civic_data_candidates current ON current.id=p.current_version_id
    JOIN civic_data_candidates c ON c.record_class='MEETING' AND c.scope=p.scope AND c.source_id=current.source_id
    WHERE p.published AND right(p.scope,8)<>':history' AND c.id<>p.current_version_id
      AND c.state='PROMOTED' AND c.acquisition_succeeded AND c.promoted_version_id=c.id AND c.last_known_good_version_id=c.id
      AND c.normalized_hash ~ '^[a-f0-9]{64}$' AND c.validation_receipt->>'decision'='GOOD'
      AND c.validation_receipt->>'candidateId'=c.id AND c.validation_receipt->>'recordClass'=c.record_class
      AND c.validation_receipt->>'scope'=c.scope AND c.validation_receipt->>'sourceId'=c.source_id
  ), records AS (
    SELECT v.id,v.key,v.retrieved_at,m.item,reader_payload_node(m.item) AS header FROM versions v
    CROSS JOIN LATERAL (SELECT candidate->'readModel' AS payload FROM civic_data_candidates WHERE id=v.id LIMIT 1) c
    CROSS JOIN LATERAL reader_payload_members(reader_payload_node(c.payload)->'meetings') m
  ), visible AS (
    SELECT DISTINCT ON(header->>'id') * FROM records
    WHERE header->>'id' IS NOT NULL AND EXISTS(SELECT 1 FROM entity b WHERE b.id=header->>'bodyId' AND b.kind='body' AND b.state=$2)
      AND CASE WHEN header->>'startsAt' ~ '^\\d{4}-\\d{2}-\\d{2}T' THEN (header->>'startsAt')::timestamptz<now()-make_interval(days=>$3) ELSE false END
    ORDER BY header->>'id',retrieved_at DESC
  ) SELECT id,key,retrieved_at,reader_payload_value(item) AS record FROM visible ORDER BY key,header->>'id' LIMIT 12`,
  [`(^|[:+])(?:US-)?${state}(:|$|\\+)|(?:state|district|territory)%3A${state}(?:%2F|$)`, state, MEETING_HELD_LOOKBACK_DAYS]);
  const candidates: ReaderSampleValue[] = [];
  for (const row of rows) {
    const record = row.record as Record<string, unknown>, id = record.id;
    const sourceUrl = at(record, "provenance.sourceUrl") ?? record.sourceUrl ?? at(record, "source.url");
    if (typeof id !== "string" || typeof sourceUrl !== "string" || !URL.canParse(sourceUrl)) continue;
    for (const field of ["title", "startsAt", "location", "agendaUrl", "minutesUrl"]) {
      const value = record[field]; if (value == null || value === "" || typeof value === "object") continue;
      candidates.push({ table: "civic_data_candidates", pointer: String(row.key), version: String(row.id), recordClass: "MEETING",
        subjectId: id, subjectKind: "meeting", subjectName: String(record.title ?? record.bodyName ?? id), field, value,
        sourceUrl, observedAt: new Date((at(record, "provenance.retrievedAt") ?? row.retrieved_at) as string).toISOString(), sourceRecord: record, sourcePath: field });
    }
  }
  bindReaderSources({ values: candidates }, held, meetingSources, tenants);
  const context = await loadReaderContext([...sample.values, ...candidates], query);
  bindReaderSources({ values: candidates }, held, meetingSources, tenants);
  const ids = await query(`SELECT requested,coalesce((SELECT id FROM entity WHERE id=requested),reader_resolve_id(requested),requested) AS canonical
    FROM unnest($1::text[]) ids(requested)`, [[...new Set(candidates.map(v => v.subjectId))]]);
  const canonical = new Map(ids.map(row => [String(row.requested), String(row.canonical)]));
  const key = (v: ReaderSampleValue) => JSON.stringify([v.canonicalId ?? v.subjectId, readerReplayField(v)]);
  const seen = new Set(sample.values.map(key)), picked: ReaderSampleValue[] = [];
  for (const value of candidates) {
    value.canonicalId = canonical.get(value.subjectId);
    if (seen.has(key(value)) || !(isOfficialUrl(value.sourceUrl, value.hosts ?? []) || isSourceApiUrl(value.sourceUrl))) continue;
    picked.push(value); seen.add(key(value)); if (picked.length === 6) break;
  }
  sample.values = [...sample.values.slice(0, Math.max(0, sample.values.length - picked.length)), ...picked];
  sample.context = context;
  sample.families.push({ table: "civic_data_candidates", path: ["candidate", "readModel", "meetings"], selectedRecords: rows.length, selectedValues: picked.length });
  writeFileSync(file, JSON.stringify(sample), { mode: 0o600 });
  console.log(JSON.stringify({ state, sampledArchivedRecords: rows.length, archivedValues: picked.length, readerValues: sample.values.length }));
}
