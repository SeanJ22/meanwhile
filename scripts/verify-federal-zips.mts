/** SH-01: read-only production check; no serving artifacts or acquisition writes.
 * WTP_PRODUCTION_DATABASE_URL_READONLY must name the production reader database.
 * Run with the repository's TypeScript/alias loader. An optional --output=PATH
 * saves the state summaries, failures and remaining data blanks for River.
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
import { installPlaceMapQuery, readStateZipPlaces } from "../lib/place-map/reader.ts";
import { readZipPostalAreas } from "../lib/place-map/locations.ts";

const connection = process.env.WTP_PRODUCTION_DATABASE_URL_READONLY;
if (!connection) throw new Error("WTP_PRODUCTION_DATABASE_URL_READONLY is required; refusing to use a local database.");
const sql = neon(connection);
const query = async (text: string, params: readonly unknown[] = []) =>
  (await sql.transaction([sql.query(text, [...params])], { readOnly: true }))[0];
const [identity] = await query("SELECT current_user, current_setting('transaction_read_only') AS read_only", []);
if (identity.current_user !== "readonly" || identity.read_only !== "on") throw new Error("A read-only production role and transaction are required.");
// The diagnostic's only database access is the explicit read-only transport above.
delete process.env.DATABASE_URL;
delete process.env.WTP_ASSET_STORE;
installPlaceMapQuery(query);
const failures: { state: string; zip?: string; member?: string; division?: string; problem: string }[] = [];
const blanks: typeof failures = [];
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
    const [canonical] = await query(`SELECT payload->'roster'->'officeholders' members FROM civic_data_promotions
      WHERE key=$1`, [`FEDERAL_DIRECTORY:US-${state}:current-congress-directory`]);
    const held = canonical?.members as typeof read.value.roster.officeholders | undefined;
    if (!held || JSON.stringify(held.map(row => row.id).sort()) !== JSON.stringify(read.value.roster.officeholders.map(row => row.id).sort()))
      failures.push({ state, problem: "A held federal member was lost between the canonical row and reader" });
    const index = indexByDivision([read.value.roster]);
    if (senatorsFor(index, [stateId]).length !== 2) failures.push({ state, problem: "Both senators were not returned" });
    for (const member of read.value.roster.officeholders) {
      const offices = await readMemberOffices(member.id, state);
      if (!offices.length) blanks.push({ state, member: member.name, problem: "No office records held" });
      const heldDistrict = read.value.directory.byMember[member.id.slice(9)]?.districtOffices ?? [];
      if (offices.length < heldDistrict.length + (member.offices?.length ?? 0)) failures.push({ state, member: member.name, problem: "Held office records were hidden" });
      if (!(await readOfficeLocations(member.id, state)).length) addressGaps.push({ state, member: member.name });
    }
    const entries = await readStateZipPlaces(state), zips = [...entries.keys()];
    const postal = await readZipPostalAreas(zips);
    let residentialZips = 0, addressRequired = 0;
    for (const zip of zips) {
      // The existing reader requires a residential address for mail-only ZIPs;
      // a postal destination never establishes someone's House district.
      if (postal.get(zip)?.type !== "standard") { addressRequired++; continue; }
      residentialZips++;
      const entry = entries.get(zip)!;
      const ids = entry.ids;
      const houseDistricts = ids.filter(id => id.startsWith(`${stateId}/cd:`));
      if (!houseDistricts.length) blanks.push({ state, zip, problem: "ZIP requires a point lookup; no published ZIP-to-House relationship" });
      for (const division of houseDistricts) if (!holdersFor(index, division).length)
        if (!read.value.vacancies?.some(row => row.ocdId === division)) blanks.push({ state, zip, division, problem: "Published House district has no stored holder or explicit vacancy record" });
    }
    const summary = { state, version: read.metadata.versionId, members: read.value.roster.officeholders.length,
      postalZips: zips.length, residentialZips, addressRequired };
    summaries.push(summary);
    console.log(JSON.stringify(summary));
  }));
}
const report = { checkedAt: new Date().toISOString(), states: summaries, failures, blanks, addressGaps };
const output = process.argv.find(arg => arg.startsWith("--output="))?.slice(9);
if (output) { mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + "\n"); }
console.log(JSON.stringify({ states: summaries.length, members: summaries.reduce((n, row) => n + row.members, 0),
  postalZips: summaries.reduce((n, row) => n + row.postalZips, 0), failures: failures.length, blanks: blanks.length, addressGaps }));
if (failures.length || summaries.length !== 50) process.exitCode = 1;
