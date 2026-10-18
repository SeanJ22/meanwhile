/** SH-01: read-only production check; no serving artifacts or acquisition writes.
 * WTP_PRODUCTION_DATABASE_URL_READONLY must name the production reader database.
 * Run with the repository's TypeScript/alias loader. An optional --output=PATH
 * saves the state summaries and every failed ZIP/office check for River.
 */
import { neon } from "@neondatabase/serverless";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { readStateAuthorityEntry, stateAuthorityPointers } from "../lib/civic-data/state-reader.ts";
import { readFederalDirectoryProjection } from "../lib/officials/federal-directory-read-model.ts";
import { readMemberOffices, readOfficeLocations } from "../lib/officials/member-offices-read.ts";
import { holdersFor, indexByDivision, senatorsFor } from "../lib/officials/lookup.ts";
import { withReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";
import { withReaderSelection } from "../lib/db/reader-route.ts";
import { REGISTRY_STATES } from "../lib/civic-data/state-scopes.ts";
import { zipDivisionEntry } from "../lib/geo/zip-division-index.ts";
import { withCensusDistricts } from "../lib/geo/zip-census-districts.ts";
import { buildCensusDistrictEdge, censusDistrictEdgeSlice } from "../lib/census-geography/district-edge.ts";
import type { BuiltDataset } from "../lib/census-geography/dataset.ts";
import type { PostalTable } from "../lib/geo/postal-core.ts";
import postal from "../lib/geo/postal-zips.json" with { type: "json" };

const connection = process.env.WTP_PRODUCTION_DATABASE_URL_READONLY;
if (!connection) throw new Error("WTP_PRODUCTION_DATABASE_URL_READONLY is required; refusing to use a local database.");
const sql = neon(connection);
const query = async (text: string, params: readonly unknown[]) =>
  (await sql.transaction([sql.query(text, [...params])], { readOnly: true }))[0];
const [identity] = await query("SELECT current_user, current_setting('transaction_read_only') AS read_only", []);
if (identity.current_user !== "readonly" || identity.read_only !== "on") throw new Error("A read-only production role and transaction are required.");
// The diagnostic's only database access is the explicit read-only transport above.
delete process.env.DATABASE_URL;
delete process.env.WTP_ASSET_STORE;
const postalRows = postal.zips as unknown as PostalTable;
const failures: { state: string; zip?: string; member?: string; division?: string; problem: string }[] = [];
const summaries: { state: string; version: string | null; members: number; postalZips: number; residentialZips: number; addressRequired: number }[] = [];
const addressGaps: { state: string; member: string }[] = [];

for (const state of REGISTRY_STATES.filter(state => !["DC", "PR", "VI", "AS", "GU", "MP"].includes(state))) {
  const stateId = `ocd-division/country:us/state:${state.toLowerCase()}`;
  await withReaderSelection({ states: [state], keys: new Set([stateId]) }, () => withReaderAuthorityEdge({
    stateAuthorities: { families: new Set(["federal-directory"]), load: async () => null },
  }, async () => {
    for (const pointer of stateAuthorityPointers("federal-directory", state))
      await readStateAuthorityEntry("federal-directory", state, pointer.recordClass, pointer.scope, query);
    const read = await readFederalDirectoryProjection([state]);
    if (read.kind !== "PROMOTED") { failures.push({ state, problem: `Directory read ${read.kind}` }); return; }
    const index = indexByDivision([read.value.roster]);
    if (senatorsFor(index, [stateId]).length !== 2) failures.push({ state, problem: "Both senators were not returned" });
    for (const member of read.value.roster.officeholders) {
      if (!(await readMemberOffices(member.id, state)).length) failures.push({ state, member: member.name, problem: "No office records" });
      if (!(await readOfficeLocations(member.id, state)).length) addressGaps.push({ state, member: member.name });
    }
    // Only this state's current/future Congressional plans and ZIP relationships
    // leave the database. Use the same plan selection and holder lookup as readers.
    const census = await query(`SELECT p.current_version_id, p.payload->'builtAt' built_at,
      s - 'groupings' scope, jsonb_agg(g) groupings
      FROM civic_data_promotions p CROSS JOIN LATERAL jsonb_array_elements(p.payload->'scopes') s
      CROSS JOIN LATERAL jsonb_array_elements(s->'groupings') g
      WHERE p.key='CENSUS_GEOGRAPHY:US:zcta-geography-overlaps'
        AND s->>'type'='congressional_district' AND g->>'stateAbbr'=$1
      GROUP BY p.current_version_id,p.payload->'builtAt',s - 'groupings'`, [state]);
    if (!census.length) { failures.push({ state, problem: "No published Congressional ZIP relationships" }); return; }
    const dataset = { formatVersion: 1, builtAt: census[0].built_at,
      scopes: census.map(row => ({ ...(row.scope as object), groupings: row.groupings })), zctaUniverse: [],
    } as unknown as BuiltDataset;
    const districts = buildCensusDistrictEdge(dataset, census[0].current_version_id as string);
    const zips = Object.keys(postalRows).filter(zip => postalRows[zip][5] === state);
    let residentialZips = 0, addressRequired = 0;
    for (const zip of zips) {
      // The existing reader requires a residential address for mail-only ZIPs;
      // a postal destination never establishes someone's House district.
      if (postalRows[zip][2] !== "standard") { addressRequired++; continue; }
      residentialZips++;
      const entry = await zipDivisionEntry(zip) ?? { ids: [], partial: [], samples: 0 };
      const zcta = postalRows[zip][3] ?? zip;
      const ids = withCensusDistricts(entry, censusDistrictEdgeSlice(districts, districts.versionId, zcta), zcta).ids;
      const houseDistricts = ids.filter(id => id.startsWith(`${stateId}/cd:`));
      if (!houseDistricts.length) failures.push({ state, zip, problem: "ZIP requires a point lookup; no published ZIP-to-House relationship" });
      for (const division of houseDistricts) if (!holdersFor(index, division).length)
        failures.push({ state, zip, division, problem: "Published House district has no stored holder" });
    }
    const summary = { state, version: read.metadata.versionId, members: read.value.roster.officeholders.length,
      postalZips: zips.length, residentialZips, addressRequired };
    summaries.push(summary);
    console.log(JSON.stringify(summary));
  }));
}
const report = { checkedAt: new Date().toISOString(), states: summaries, failures, addressGaps };
const output = process.argv.find(arg => arg.startsWith("--output="))?.slice(9);
if (output) { mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + "\n"); }
console.log(JSON.stringify({ states: summaries.length, members: summaries.reduce((n, row) => n + row.members, 0),
  postalZips: summaries.reduce((n, row) => n + row.postalZips, 0), failures: failures.length, addressGaps }));
if (failures.length || summaries.length !== 50) process.exitCode = 1;
