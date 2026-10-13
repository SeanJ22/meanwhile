import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { indexDivisions, normalize, yamlToPeople, type PluralPerson } from "../lib/sources/plural/index.ts";
import { statePeopleDivisions } from "../lib/sources/plural/acquisition.ts";
import { censusWorkDivision } from "../lib/census-geography/division-id.ts";
import { indexByDivision } from "../lib/officials/lookup.ts";
import { representationDivisionsAt } from "../lib/geo/representation-geography.ts";
import { geographyOfRows, type Row } from "../lib/control-plane/admin-view/promoted-slices.ts";
import type { BuiltScope } from "../lib/census-geography/dataset.ts";
import { realOverlayScope, realTribalScope, SOURCE_FIXTURE_NOW } from "./helpers/representation-source-fixtures.ts";

function rows(scope: BuiltScope): Row[] {
  return [{row_kind:"scope",type:scope.type,version:scope.version,plan:scope.versionMeta.plan,version_meta:scope.versionMeta},
    ...scope.groupings.map(group=>({row_kind:"container",type:scope.type,version:scope.version,plan:scope.versionMeta.plan,
      geoid:group.geoid,label:group.label,state_abbr:group.stateAbbr,state_fips:group.stateFips,ocd_id:group.ocdId,representation_geography:group,member_states:group.memberStates}))];
}

function sourcePerson(row: Record<string,string>): PluralPerson {
  return {...row,state:"nh",email:"",image:"",links:"",sources:"",capitol_address:"",capitol_voice:"",district_address:"",district_voice:"",
    sourceUrl:"https://data.openstates.org/people/current/nh.csv"} as PluralPerson;
}
const source = JSON.parse(readFileSync(new URL("./fixtures/geography/openstates-candia.json",import.meta.url),"utf8"));
const nativeSources = new Map([
  ["aaron-dana","https://raw.githubusercontent.com/openstates/people/main/data/me/legislature/Aaron-Dana-906cd606-c6ff-41e5-87a6-e038b711fa61.yml"],
  ["brian-reynolds","https://raw.githubusercontent.com/openstates/people/main/data/me/legislature/Brian-Reynolds-81ab0331-83cd-4551-bf74-b732623c86b8.yml"],
]);

test("Rockingham 31 links through its reference code to the agreeing real overlay, and CH16 keeps its exact source disagreement",async()=>{
  const scope = await realOverlayScope();
  const held = await statePeopleDivisions("NH",SOURCE_FIXTURE_NOW,async()=>[[{version_id:"actual-source-overlay"}],rows(scope)]);
  assert.equal(held.kind,"HELD");
  if(held.kind!=="HELD")return;
  const index = indexDivisions(held.value);
  assert.equal(index.get("nh|lower|RO31"),"ocd-division/country:us/state:nh/sldl:ro31");
  const people = source.people.filter((person:Record<string,string>)=>["Rockingham 31","Cheshire 16"].includes(person.current_district)).map(sourcePerson);
  const roster = normalize(people,index,SOURCE_FIXTURE_NOW,"US-NH");
  const linked = roster.officeholders.filter(person=>person.memberships?.[0].representation === "overlay");
  assert.deepEqual(linked.map(person=>person.name).sort(),["Jess Edwards","Terry Roy"]);
  for(const person of linked){
    assert.deepEqual(roster.divisions.filter(link=>link.officeholderId===person.id).map(link=>link.ocdId),["ocd-division/country:us/state:nh/sldl:ro31"]);
    assert.equal(roster.unmatched.some(gap=>gap.officeholderId===person.id),false);
  }
  assert.equal(roster.unmatched.length,1);
  assert.equal(roster.officeholders.find(person=>person.id===roster.unmatched[0].officeholderId)?.name,"Jim Gruber");
  assert.match(roster.unmatched[0].reason,/Cheshire 16.*District towns differ.*keene ward 2/);
  assert.ok(!roster.unmatched[0].reason.includes("area not in the Census district file"));
});

test("the real Houlton trust-land point returns its full seat, Passamaquoddy links every referenced area, and Portland returns none",async()=>{
  const scope = realTribalScope();
  const held = await statePeopleDivisions("ME",SOURCE_FIXTURE_NOW,async()=>[[{version_id:"actual-source-aiannh"}],rows(scope)]);
  assert.equal(held.kind,"HELD");
  if(held.kind!=="HELD")return;
  const people = ["aaron-dana","brian-reynolds"].flatMap(file=>yamlToPeople(readFileSync(new URL(`./fixtures/geography/openstates-tribal/${file}.yml`,import.meta.url),"utf8"),"me",nativeSources.get(file)!,SOURCE_FIXTURE_NOW));
  const roster = normalize(people,indexDivisions(held.value),SOURCE_FIXTURE_NOW,"US-ME");
  assert.deepEqual(roster.unmatched,[]);
  const holders = indexByDivision([roster]);
  const slice = geographyOfRows(rows(scope),false);
  const seats = (point:[number,number])=>representationDivisionsAt(point,slice).flatMap(hit=>holders.get(hit.ocdId)??[]);
  assert.deepEqual(seats([-67.8072179,46.1888323]).map(holder=>[holder.name,holder.nation]),[["Brian Reynolds","Houlton Band of Maliseet Indians"]]);
  assert.deepEqual(seats([-70.2568,43.6591]),[]);
  const dana = roster.officeholders.find(person=>person.name==="Aaron Dana")!;
  const links = roster.divisions.filter(link=>link.officeholderId===dana.id);
  assert.equal(new Set(links.map(link=>link.membershipId)).size,1,"separate Census areas are one nation seat, not duplicate memberships");
  assert.deepEqual(links.map(link=>link.ocdId).sort(),["1575","2695","2850"].map(area=>`ocd-division/country:us/state:me/aiannh:${area}`));
  assert.equal(links.length,3);
});

test("a reference alone cannot link a tribal seat to an unpublished area; independently held areas survive a partial older scope",()=>{
  const scope = realTribalScope();
  const data = readFileSync(new URL("./fixtures/geography/openstates-tribal/aaron-dana.yml",import.meta.url),"utf8");
  const people = yamlToPeople(data,"me",nativeSources.get("aaron-dana")!,SOURCE_FIXTURE_NOW);
  const missing = normalize(people,new Map(),SOURCE_FIXTURE_NOW,"US-ME");
  assert.deepEqual(missing.divisions,[]);
  assert.match(missing.unmatched[0].reason,/Referenced Census tribal areas have not been published/);
  const first = scope.groupings.find(group=>group.geoid==="1575")!;
  const ocdId = censusWorkDivision({...first,type:scope.type,version:scope.version})!;
  const partial = normalize(people,indexDivisions([{ocdId,label:first.label,divisionType:"aiannh"}]),SOURCE_FIXTURE_NOW,"US-ME");
  assert.deepEqual(partial.divisions.map(link=>link.ocdId),[ocdId]);
  assert.match(partial.unmatched[0].reason,/unlinked areas.*Referenced Census tribal areas/);
});
