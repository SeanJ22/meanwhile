import assert from "node:assert/strict";
import test from "node:test";
import { prepareBodyIdentities } from "../lib/registry/body-identity.ts";
import { readerGovernmentName } from "../lib/text/reader-names.ts";
import type { Body, Division } from "../lib/registry/types.ts";

const county = "ocd-division/country:us/state:az/county:pima";
const city = "ocd-division/country:us/state:wi/place:milwaukee";
const school = "ocd-division/country:us/state:az/school_district:tucson";
const divisions = new Map([ [county,{ocdId:county,label:"Pima County",divisionType:"county"}],
  [city,{ocdId:city,label:"Milwaukee city",divisionType:"place"}],
  [school,{ocdId:school,label:"Tucson Unified District",divisionType:"school_district"}] ] as [string,Division][]);
const body = (name:string|null, id:string, ocdId=county, extra:Partial<Body>={}):Body => ({
  id,ocdId,name,bodyClass:"body",bodyOrigin:"SOURCED",...extra,
} as Body);

test("semantic classes keep governments, advisory bodies, courts, staff and sitting types separate",()=>{
  const rows=[body("Board of Supervisors","one"),body("Board of Supervisors Worksession","two"),
    body("Briefings and Roundtables","three"),body("Clerk of the Board",`${county}#governing`),body("City Court",`${city}#board`,city),
    body("Business Parks & Developable County Properties","four"),body("Planning Commission","five"),
    body("Common Council","six",city),body("Board","seven",school),body("Joint","eight")];
  const ids=prepareBodyIdentities(rows,divisions);
  assert.deepEqual(rows.map(row=>ids.get(row.id)?.bodyClass),["GOVERNING","MEETING_TYPE","MEETING_TYPE","EXECUTIVE_AGENCY","COURT","EXECUTIVE_AGENCY","ADVISORY","GOVERNING","GOVERNING","MEETING_TYPE"]);
  assert.equal(ids.get("two")?.meetingBodyId,"one");
  assert.equal(ids.get("three")?.meetingBodyId,"one");
  assert.equal(ids.get("eight")?.meetingBodyId,"one");
  assert.equal(ids.get("one")?.name,"Pima County Board of Supervisors");
  assert.equal(ids.get("six")?.name,"City of Milwaukee Common Council");
  assert.equal(ids.get("seven")?.name,"Tucson Unified School District Board");
});

test("special district boards own their government despite a host county or conflicting parent",()=>{
  const rows=[body("Pima County Free Library District Board of Directors","library"),
    body("Central Arizona Water Conservation District Board of Directors","water",county,{governmentName:"Pima County Regional Transportation Authority",governmentId:"az:special:transport"}),
    body("Flowing Wells Irrigation District","irrigation",county,{bodyOrigin:"PROMOTED_FROM_CENSUS_OF_GOVERNMENTS",bodyClass:"GOVERNING"})];
  const ids=prepareBodyIdentities(rows,divisions);
  for(const row of ids.values())assert.equal(row.governmentType,"special_district");
  assert.equal(ids.get("library")?.governmentName,"Pima County Free Library District");
  assert.equal(ids.get("water")?.governmentName,"Central Arizona Water Conservation District");
  assert.equal(ids.get("water")?.bodyClass,"GOVERNING");
  assert.equal(ids.get("irrigation")?.bodyClass,"GOVERNING");
});

test("the government class and complete governing phrase distinguish school boards and subject councils",()=>{
  const rows=[body("Milwaukee County Council on Emergency Medical Services","ems",county),body("Plan Commission","plan",county),
    body("School District Board of Education","education",school),body("Wisconsin Center District Board of Directors","center",city),
    body("Board of Supervisors Addendum","addendum"),body("Joint Session","joint"),body("Joint City Council and School Board","joint-council",city),
    body("Board of Supervisors","county",county,{governmentName:"Transport Authority",governmentId:"az:special:transport",registeredName:"Pima County governing board"})];
  const ids=prepareBodyIdentities(rows,divisions);
  assert.equal(ids.get("ems")?.bodyClass,"ADVISORY");
  assert.equal(ids.get("plan")?.bodyClass,"ADVISORY");
  assert.equal(ids.get("education")?.governmentType,"school_district");
  assert.equal(ids.get("center")?.governmentType,"special_district");
  for(const key of ["addendum","joint","joint-council"])assert.equal(ids.get(key)?.bodyClass,"MEETING_TYPE");
});

test("Census labels are readable and unknown boards do not gain authority from suffixes",()=>{
  assert.equal(readerGovernmentName("County Of Multnomah","county"),"Multnomah County");
  assert.equal(readerGovernmentName("PORTLAND CMTY COLLEGE",null),"Portland Community College");
  assert.equal(readerGovernmentName("Sch Dist 1j",null),"School District 1J");
  const rows=[body("Board",`${city}#governing`,city),body("Council","council",city),body(null,"census-board",county,{bodyOrigin:"REGISTERED_FROM_CENSUS_OF_GOVERNMENTS",bodyClass:"GOVERNING"})];
  const ids=prepareBodyIdentities(rows,divisions);
  assert.equal(ids.get(rows[0].id)?.bodyClass,"ADVISORY");
  assert.equal(ids.get("census-board")?.bodyClass,"GOVERNING");
  assert.equal(ids.size,rows.length);
});

test("all historical body addresses survive and every displayed row has a unique government-qualified name",()=>{
  const rows=[body("Board of Supervisors","original"),body("Board of Supervisors","second"),body("Joint","joint-one"),body("Joint","joint-two")];
  const ids=prepareBodyIdentities(rows,divisions);
  assert.deepEqual([...ids.keys()],rows.map(row=>row.id));
  assert.equal(new Set([...ids.values()].map(row=>row.name)).size,rows.length);
  assert.ok([...ids.values()].every(row=>row.name.includes(row.governmentName)));
});
