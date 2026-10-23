/** Read-only production replay: saved sources -> publication -> reader offices/cards, then the next scheduled day.
 * NODE_USE_ENV_PROXY=1 node --env-file=<readonly.env> --experimental-strip-types
 *   --import ./scripts/register-test-loader.mjs scripts/sp-01-check.mts
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DirectoryRecordsContent } from "../components/officials/member-directory.tsx";
import { readCanonicalShelf } from "../lib/reader/canonical.ts";
import { installReaderDatabaseQuery } from "../lib/reader/database.ts";
import { readerStateResponse } from "../lib/reader/state-response.ts";
import { readerCacheScopeForPublication, readerCacheTags, invalidateReaderCache } from "../lib/reader/cache.ts";
import { ballotCacheHeaders } from "../lib/reader/ballot-cache.ts";
import type { ReaderStateResponse } from "../lib/reader/client.ts";
import { zipMemberDirectories } from "../lib/reader/member-directories.ts";
import { directoryOffices, officeOwners } from "../lib/map/office-pins.ts";
import { CivicPayloadParts } from "../lib/civic-data/payload-parts.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { processRegisteredManualCandidate, processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { statePeopleCandidate, type StatePeopleCapture } from "../lib/civic-data/state-people-publication.ts";
import { readOpenStatesPeopleProjection } from "../lib/state-rollcalls/legislators.ts";
import { AUTOMATIC_REFRESH_TASKS } from "../lib/civic-data/automatic-refresh.ts";
import { routineTaskDue } from "../lib/civic-data/runner.ts";
import { federalDirectoryScope, federalDirectoryContractId, heldDirectoryCandidate, type FederalDirectoryCapture } from "../lib/officials/federal-directory-data-plane.ts";
import { readStateFederalDirectory } from "../lib/officials/federal-directory-read-model.ts";
import { publishDirectoryOfficePoints, publishRosterOfficePoints } from "../lib/officials/office-points-publication.ts";
import type { RoutineCandidate } from "../lib/civic-data/types.ts";
import type { ReadOnlyQuery } from "../lib/control-plane/admin-view/promoted-slices.ts";
import type { MemberDirectoryEntry } from "../lib/officials/directory.ts";

const connection = process.env.WTP_PRODUCTION_DATABASE_URL_READONLY;
if (!connection) throw Error("WTP_PRODUCTION_DATABASE_URL_READONLY is required");
const target = new URL(connection);
assert.equal(target.username, "readonly");
assert.match(target.hostname, /^ep-dry-river-axwtolzc(?:-pooler)?\./);
const db = neon(connection);
let statements = 0;
const query: ReadOnlyQuery = async batch => {
  statements += batch.length;
  return db.transaction(batch.map(row => db.query(row.text, [...row.params])), { readOnly: true });
};
const rows = async (text: string, params: readonly unknown[] = []) => (await query([{text,params}]))[0];
const [identity] = await rows("SELECT current_user, current_setting('transaction_read_only') read_only");
assert.equal(identity.current_user, "readonly"); assert.equal(identity.read_only, "on");
// Any accidental default database path must fail; only the explicit READ ONLY transport is installed.
delete process.env.DATABASE_URL;
delete process.env.WTP_ASSET_STORE;
installReaderDatabaseQuery(query);
const parts = new CivicPayloadParts({ existing: async () => [], write: async () => { throw Error("Replay cannot write payloads"); },
  read: async hashes => await rows("SELECT hash,payload FROM civic_data_payload_parts WHERE hash=ANY($1::text[])",[hashes]) as {hash:string;payload:unknown}[] });
const output = ".scratch/sp-01";
await mkdir(output,{recursive:true});
const today = new Date().toISOString(), tomorrow = new Date(Date.parse(today)+86_400_000).toISOString();
const results: object[] = [];

for (const [state,zip] of [["NH","03301"],["NJ","07102"]]) {
  const response = await readerStateResponse(new Request(`https://meanwhileusa.com/api/reader/state?state=${state}&zip=${zip}`));
  assert.equal(response.status,200);
  const page = await response.json() as ReaderStateResponse;
  const scope = federalDirectoryScope(state);
  const canonical = await readCanonicalShelf([{recordClass:"FEDERAL_DIRECTORY",scope}],query);
  const original = await readStateFederalDirectory(state,{store:canonical});
  assert.equal(original.kind,"PROMOTED");
  const [stored] = await rows("SELECT candidate FROM civic_data_candidates WHERE id=$1",[original.metadata.versionId]);
  const source = await parts.loadOwned(stored.candidate) as RoutineCandidate;
  const acquisitions = (source.normalizedPayload as {acquisitions:FederalDirectoryCapture[]}).acquisitions;
  const roster = await publishRosterOfficePoints(original.value.roster,null);
  const byMember: Record<string,MemberDirectoryEntry> = Object.fromEntries(await Promise.all(Object.entries(original.value.directory.byMember).map(async ([id,entry])=>
    [id,{...entry,districtOffices:await publishDirectoryOfficePoints(entry.districtOffices)}])));
  const projection = {...original.value,roster,directory:{...original.value.directory,byMember}};
  const candidate = heldDirectoryCandidate({state,projection,acquisitions,retrievedAt:source.retrieval.retrievedAt});
  const memory = new MemoryRoutineDataStore();
  const outcome = await processRegisteredManualCandidate(memory,federalDirectoryContractId(state),candidate,today);
  assert.ok(outcome.promoted,outcome.candidate.failureDetail ?? "Replay publication failed");
  const read = await readStateFederalDirectory(state,{store:memory,now:today});
  assert.equal(read.kind,"PROMOTED");
  let nativePeople: Awaited<ReturnType<typeof readOpenStatesPeopleProjection>> | null = null;
  let savedNativePoints=0;
  if(state==="NJ") {
    const nativeScope=`US-${state}:openstates-people:v1`;
    const nativeShelf=await readCanonicalShelf([{recordClass:"STATE_LEGISLATOR",scope:nativeScope}],query);
    const native=await readOpenStatesPeopleProjection("US-NJ",{store:nativeShelf});
    assert.equal(native.kind,"PROMOTED");
    const [row]=await rows("SELECT candidate FROM civic_data_candidates WHERE id=$1",[native.metadata.versionId]);
    const old=await parts.loadOwned(row.candidate)as RoutineCandidate;
    const captures=(old.normalizedPayload as {captures:StatePeopleCapture[]}).captures;
    const located=await publishRosterOfficePoints(native.value.roster,null);
    savedNativePoints=new Set(located.officeholders.flatMap(holder=>holder.offices??[]).flatMap(office=>office.geocodedPoint?.address??[])).size;
    assert.ok(savedNativePoints,"Real state offices must save computed points before readers use them");
    const built=statePeopleCandidate({state,roster:located,captures,releaseId:native.value.term,now:today});
    const published=await processRegisteredRoutineCandidate(memory,"openstates-people-nj",built,today);
    assert.ok(published.promoted,published.candidate.failureDetail??"State-office replay publication failed");
    nativePeople=await readOpenStatesPeopleProjection("US-NJ",{store:memory,now:today});
    assert.equal(nativePeople.kind,"PROMOTED");
    const next=await publishRosterOfficePoints(native.value.roster,located,async()=>null);
    assert.deepEqual(next,located,"The next source refresh reuses the state offices' published points");
  }
  const owners = officeOwners(page.coverage);
  const directories = zipMemberDirectories(nativePeople?.kind==="PROMOTED"?nativePeople.value.roster:null,[],read.value,owners.map(owner=>owner.holder));
  const rendered: {member:string;address:string;point:{lat:number;lng:number};source:string}[] = [];
  const cards: string[] = [];
  for(const owner of owners) {
    const entry=directories.find(row=>row.ids.includes(owner.holder.id));if(!entry)continue;
    const offices=directoryOffices(owner,entry.directory);
    cards.push(renderToStaticMarkup(createElement(DirectoryRecordsContent,{holderId:owner.holder.id,state,only:"offices",directory:entry.directory,failed:false})));
    for(const office of offices)if(office.point)rendered.push({member:owner.holder.name,address:office.address,point:office.point,source:office.sourceUrl});
  }
  assert.ok(rendered.length,`${zip}: no published office points reached the page`);
  await writeFile(`${output}/${zip}-offices.html`,`<!doctype html><html><body>${cards.join("")}</body></html>`);
  const task=AUTOMATIC_REFRESH_TASKS.find(task=>task.id===federalDirectoryContractId(state))!;
  const clock={lastAttemptedAt:today,lastSucceededAt:today,lastSucceededObservedAt:today,lastSucceededParserVersion:task.parserVersion};
  assert.equal(routineTaskDue(task,clock,Date.parse(today)+300_000),false);
  assert.equal(routineTaskDue(task,clock,Date.parse(tomorrow)),true);
  let freshLookups=0;
  // A source reread without computed fields must recover every saved point from the prior publication.
  const nextByMember: Record<string,MemberDirectoryEntry> = Object.fromEntries(await Promise.all(Object.entries(original.value.directory.byMember).map(async([id,entry])=>[id,{
    ...entry,districtOffices:await publishDirectoryOfficePoints(entry.districtOffices,read.value.directory.byMember[id]?.districtOffices,
      async()=>{freshLookups++;return null;})}])));
  for(const [id,entry]of Object.entries(read.value.directory.byMember))for(const office of entry.districtOffices)if(office.geocodedPoint)
    assert.deepEqual(nextByMember[id].districtOffices.find(row=>row.geocodedPoint?.address===office.geocodedPoint!.address)?.geocodedPoint,office.geocodedPoint);
  const nextRoster=await publishRosterOfficePoints(original.value.roster,read.value.roster,async()=>{freshLookups++;return null;});
  const nextCandidate=heldDirectoryCandidate({state,projection:{...read.value,roster:nextRoster,directory:{...read.value.directory,byMember:nextByMember}},
    acquisitions,retrievedAt:tomorrow});
  const nextOutcome=await processRegisteredManualCandidate(memory,task.id as ReturnType<typeof federalDirectoryContractId>,nextCandidate,tomorrow,read.metadata.versionId);
  assert.ok(nextOutcome.confirmed || nextOutcome.promoted,nextOutcome.candidate.failureDetail ?? "Tomorrow's replay publication failed");
  const nextRead=await readStateFederalDirectory(state,{store:memory,now:tomorrow});
  assert.equal(nextRead.kind,"PROMOTED");
  assert.deepEqual(nextRead.value,read.value,"Tomorrow's typed reader keeps every saved office and point");
  const purges:string[][]=[];
  await invalidateReaderCache(readerCacheScopeForPublication(scope),async tags=>{purges.push([...tags]);return{purged:true}});
  assert.deepEqual(purges,[[`reader-state:${state}`]]);
  const presidentTags=readerCacheTags(readerCacheScopeForPublication("US:people:statewide-executive-sources:v1"));
  assert.ok(presidentTags.some(tag=>response.headers.get("Netlify-Cache-Tag")!.split(",").includes(tag)));
  for(const day of [today,tomorrow])assert.ok(ballotCacheHeaders(new Request(`https://meanwhileusa.com/ballot?zip=${zip}`),Date.parse(day))["Netlify-Cache-Tag"].includes(`reader-state:${state}`));
  results.push({state,zip,productionVersion:original.metadata.versionId,replayedVersion:read.metadata.versionId,
    directoryCards:cards.length,rendered,savedNativePoints,scheduledNow:today,scheduledNext:tomorrow,nextRunDue:true,nextPublicationConfirmed:!!nextOutcome.confirmed,
    nextReaderVersion:nextRead.metadata.versionId,freshLookupsForPreviouslyMissingPoints:freshLookups,
    presidentInvalidatesPage:true,statePurge:purges[0]});
}
const scopes=await rows("SELECT key,scope,current_version_id FROM civic_data_promotions WHERE key=ANY($1::text[])",[[
  "STATE_LEGISLATOR:US:people:statewide-executive-sources:v1","CURATED_READER_RECORD:US-AZ+US-NH+US-NJ:meeting-body-crosswalk"]]);
const scopeReplay=scopes.map(row=>({key:row.key,scope:String(row.scope),version:row.current_version_id,tags:readerCacheTags(readerCacheScopeForPublication(String(row.scope)))}));
assert.deepEqual(scopeReplay.find(row=>String(row.scope).includes("+"))?.tags,["reader-state:AZ","reader-state:NH","reader-state:NJ"]);
assert.deepEqual(scopeReplay.find(row=>String(row.scope).includes("US:people:"))?.tags,["reader-national-people"]);
const transfer=await rows("SELECT day,database_name,client,requests,response_bytes FROM database_transfer_daily WHERE client='reader' ORDER BY day DESC LIMIT 3");
const report={productionHost:target.hostname,identity,productionWrites:0,statements,scopeReplay,results,transferBaseline:transfer};
await writeFile(`${output}/production-replay.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
