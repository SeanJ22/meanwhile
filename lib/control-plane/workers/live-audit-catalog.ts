import { createHash } from "node:crypto";
import { requiredManualProductionContract } from "../../civic-data/manual-contracts.ts";
import { PUBLISHED_ARRAY_SLICE_SQL, readPublishedArraySlice } from "../../civic-data/published-array-slice.ts";
import { REGISTRY_STATES } from "../../civic-data/state-scopes.ts";
import type { ReadOnlyQuery } from "../admin-view/promoted-slices.ts";
import { readerDatabaseQuery } from "../../reader/database.ts";
import { curatedReaderCatalog, type LiveFact, type LiveFactCatalog } from "./live-audit.ts";
import { withHistoryIndex } from "./streamed-history.ts";

type Record = Readonly<{id: string; [key: string]: unknown}>;
export interface AuditPublication { readonly family: string; readonly scope: string }
/** Fixed family/state pointer inventory; source records are paged independently of the country's size. */
export function auditPublications(): AuditPublication[] {
  return [
    ...(["official-filings", "ballot-navigation", "stances", "campaign-sites", "meeting-body-crosswalk"] as const).map(family => ({family, scope: requiredManualProductionContract(family).scope})),
    {family: "member-offices", scope: "US:state-legislator-member-offices"},
    {family: "venue-resolutions", scope: "US-AZ+US-NH+US-NJ:reviewed-venue-resolutions"},
    ...REGISTRY_STATES.flatMap(state => [
      {family: "member-offices", scope: `US-${state}:state-legislator-member-offices`},
      {family: "venue-resolutions", scope: `US-${state}:venue-resolutions`},
      {family: "meeting-body-crosswalk", scope: `US-${state}:meeting-body-crosswalk`},
    ]),
  ];
}

/** Each page retains only its selected members and their payload parts, with the same GOOD-pointer validation as a reader. */
async function visitPublication(publication: AuditPublication, query: ReadOnlyQuery, visit: (record: Record) => Promise<void>): Promise<boolean> {
  let after: readonly number[] | null = null;
  let version: string | null = null;
  for (;;) {
    let last: readonly number[] | null = null;
    const paged: ReadOnlyQuery = async statements => {
      if (statements.length !== 1 || statements[0].text !== PUBLISHED_ARRAY_SLICE_SQL) return query(statements);
      const statement = statements[0];
      const cursor = `$${statement.params.length + 1}`;
      const result = await query([{text: `WITH selected_source AS (${statement.text})
        SELECT * FROM selected_source WHERE row_kind='publication' OR (${cursor}::bigint[] IS NULL OR ordinal>${cursor}::bigint[])
        ORDER BY ordinal NULLS FIRST LIMIT 33`, params: [...statement.params, after]}]);
      const records = result[0].filter(row => row.row_kind === "record");
      last = records.length ? (records.at(-1)!.ordinal as (number|string)[]).map(Number) : null;
      return result;
    };
    const read = await readPublishedArraySlice<Record>({recordClass: "CURATED_READER_RECORD", scope: publication.scope,
      path: ["records"], statePath: ["id"], statePattern: ".", query: paged});
    if (!read) return false;
    if (version !== null && read.input.versionId !== version) throw new Error("AUDIT_PUBLICATION_MOVED_DURING_READ");
    version = read.input.versionId;
    for (const record of read.records) await visit(record);
    if (read.records.length < 32 || last === null) return true;
    after = last;
  }
}

/** Holds the audit inventory on scratch disk. Only the pass's chosen area names and one area's pool leave it. */
export async function withLiveAuditCatalog<T>(work: (input: {catalog: LiveFactCatalog; readable: number; unread: readonly string[]}) => Promise<T>,
  options: {readonly query?: ReadOnlyQuery | null; readonly publications?: readonly AuditPublication[]} = {}): Promise<T> {
  const query = options.query === undefined ? readerDatabaseQuery() : options.query;
  if (!query) throw new Error("AUDIT_READER_STORE_NOT_CONFIGURED");
  return withHistoryIndex(async db => {
    db.exec(`CREATE TABLE facts(id TEXT PRIMARY KEY, area TEXT NOT NULL, sequence INTEGER NOT NULL, body TEXT NOT NULL);
      CREATE INDEX facts_by_area ON facts(area,sequence);
      CREATE TABLE staging(id TEXT PRIMARY KEY, area TEXT NOT NULL, sequence INTEGER NOT NULL, body TEXT NOT NULL);
      CREATE TABLE areas(id TEXT PRIMARY KEY, rank TEXT NOT NULL)`);
    const insert = db.prepare("INSERT OR REPLACE INTO staging VALUES(?,?,?,?)");
    const unread: string[] = []; let readable = 0, sequence = 0;
    for (const publication of options.publications ?? auditPublications()) {
      db.exec("DELETE FROM staging");
      try {
        const present = await visitPublication(publication, query, async record => {
          // The adapter sees one source member, never an entire publication.
          const catalog = curatedReaderCatalog(publication.family, [record]);
          for (const area of await catalog.areas()) for (const fact of await catalog.factsInArea(area, 1)) insert.run(fact.id, fact.area, sequence++, JSON.stringify(fact));
        });
        if (!present) continue;
        readable++;
        db.exec(`INSERT INTO facts SELECT * FROM staging WHERE true ON CONFLICT(id) DO UPDATE SET area=excluded.area,body=excluded.body`);
      } catch (error) { unread.push(`${publication.family} (${publication.scope}: ${error instanceof Error ? error.name : "error"})`); }
    }
    db.exec("INSERT INTO areas SELECT DISTINCT area,'' FROM facts");
    const catalog: LiveFactCatalog = {
      areas: async () => { throw new Error("AUDIT_REQUIRES_BOUNDED_AREA_SELECTION"); },
      areasForPass: async (passId, policy) => {
        const rank = db.prepare("UPDATE areas SET rank=? WHERE id=?");
        for (const row of db.prepare("SELECT id FROM areas").iterate()) rank.run(createHash("sha256").update(`${passId}\0${row.id}`).digest("hex"), row.id);
        return [...db.prepare("SELECT id FROM areas ORDER BY rank LIMIT ?").iterate(Math.max(0, policy.areasPerPass))].map(row => row.id);
      },
      factsInArea: async (area, limit) => [...db.prepare("SELECT body FROM facts WHERE area=? ORDER BY sequence LIMIT ?").iterate(area, Math.max(0, limit))]
        .map(row => JSON.parse(row.body) as LiveFact),
    };
    return work({catalog, readable, unread});
  });
}
