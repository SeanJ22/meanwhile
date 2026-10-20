import assert from "node:assert/strict";
import test from "node:test";
import {statePackageStatement,zipPeopleEntry} from "../lib/reader/state.ts";
import {partitionCivicPayload} from "../lib/civic-data/payload-codec.ts";
import {canonicalCivicDataHash} from "../lib/civic-data/canonical-hash.ts";
import {migratedReaderDb} from "./helpers/migrated-reader-db.ts";

const AT="2026-10-19T12:00:00.000Z",DIVISION="ocd-division/country:us/state:nh/sldl:27";
test("the real migrated SQL retains complete ZIP people, aliases and name ambiguity without expanding through a shared organization",async()=>{
  const {pg,publish}=await migratedReaderDb();
  const person=(id:string,name:string,nativeIds:Record<string,string[]>={})=>({id:`plural:nh:${id}`,name,officeTitle:"State Representative",state:"NH",level:"STATE",nativeIds,
    memberships:[{id:`membership:${id}`,organizationId:"shared-house",current:true}],
    provenance:{sourceUrl:"https://gencourt.state.nh.us/",sourceOrg:"General Court",collectedAt:AT,verifiedAt:AT},
    futureSourceField:{quote:`The complete sourced record for ${id}`,contact:"603-555-0100"}});
  const people=[person("point","José Q Public",{openstates:["alias-a"]}),person("same-name","Jose Q Public"),
    person("bridge","Another Name",{openstates:["ocd-person/alias-a","alias-b"]}),person("bridge-again","Third Name",{openstates:["alias-b"]}),
    person("official-name","Évelyn Smith"),person("unrelated","Unrelated Person")];
  const payload={formatVersion:1,sourceId:"plural-openstates",jurisdiction:"US-NH",generatedAt:AT,
    roster:{scope:"33",generatedAt:AT,currentMembershipComplete:true,officeholders:people,
      divisions:people.map((p,i)=>({officeholderId:p.id,ocdId:i===0?DIVISION:`${DIVISION}-elsewhere`,bodyId:"shared-house"})),
      unmatched:people.map(p=>({officeholderId:p.id,reason:"Kept source detail"})),endedMemberships:[
        {id:"historical",current:false,sourceUrl:"https://gencourt.state.nh.us/"},
        {id:"selected-history",personId:people[0].id,current:false,sourceUrl:"https://gencourt.state.nh.us/"},
        {id:"former-point-holder",personId:"former:point",divisionId:DIVISION,current:false,sourceUrl:"https://gencourt.state.nh.us/"},
        {id:"other-district-history",personId:people[5].id,current:false,sourceUrl:"https://gencourt.state.nh.us/"}]},
    sourceNotes:"Source metadata ".repeat(4000)};
  const encoded=partitionCivicPayload(payload);assert.ok(encoded.parts.length);
  try {
    for(const part of encoded.parts)await pg.query("INSERT INTO civic_data_payload_parts(hash,payload) VALUES($1,$2)",[part.hash,JSON.stringify(part.payload)]);
    await publish({id:"zip-people-version",recordClass:"STATE_LEGISLATOR",scope:"US-NH:openstates-people:v1",sourceId:"plural-openstates",
      value:encoded.value,payloadHash:canonicalCivicDataHash(payload),at:AT});
    await publish({id:"zip-official-name",recordClass:"STATE_LEGISLATOR",scope:"US-NH",sourceId:"official-legislature",
      value:{roster:{officeholders:[person("official","Evelyn Smith")],divisions:[{officeholderId:"plural:nh:official",ocdId:DIVISION}]}},at:AT});
    const statement=statePackageStatement("NH",[DIVISION],"03046");
    const row=(await pg.query<{zip_people:Record<string,unknown>}>(statement.text,[...statement.params])).rows[0];
    const entry=zipPeopleEntry("NH",row.zip_people);assert.equal(entry.kind,"PROMOTED");
    if(entry.kind!=="PROMOTED")return;
    const ids=new Set(people.slice(0,5).map(p=>p.id));
    assert.deepEqual(entry.projection.payload,{...payload,roster:{...payload.roster,
      officeholders:people.filter(p=>ids.has(p.id)),divisions:payload.roster.divisions.filter(row=>ids.has(row.officeholderId)),
      unmatched:payload.roster.unmatched.filter(row=>ids.has(row.officeholderId)),endedMemberships:payload.roster.endedMemberships.slice(0,3)}});
    assert.equal(entry.attested.payloadSha256,canonicalCivicDataHash(entry.projection.payload));
    const absent=statePackageStatement("AZ",[DIVISION],"85701");
    assert.equal(zipPeopleEntry("AZ",(await pg.query<{zip_people:null}>(absent.text,[...absent.params])).rows[0].zip_people).kind,"NOT_RECORDED");
    assert.throws(()=>zipPeopleEntry("NH",{...row.zip_people,published:false}),/READER_PUBLISHED_POINTER_INVALID/);
  }finally{await pg.close();}
});

test("the migrated Census query keeps all scope metadata and only the ZIP's districts and overlaps",async()=>{
  const {stateContainersStatement}=await import("../lib/control-plane/admin-view/promoted-slices.ts");
  const {pg,publish}=await migratedReaderDb();
  const full=stateContainersStatement("NH"),scoped=stateContainersStatement("NH",[],"03046");
  const scope={type:"congressional_district",version:"2025",versionMeta:{plan:"119",states:["NH"],retrievalComplete:true,sourceUrls:["https://www.census.gov/"],observedAt:AT},
    groupings:[{geoid:"3302",ocdId:"ocd-division/country:us/state:nh/cd:2",label:"District 2",stateFips:"33",stateAbbr:"NH",
      overlaps:[{zcta5:"03046",whole:true,fraction:1},{zcta5:"03301",whole:true,fraction:1}]},
    {geoid:"3301",ocdId:"ocd-division/country:us/state:nh/cd:1",label:"District 1",stateFips:"33",stateAbbr:"NH",overlaps:[{zcta5:"03801",whole:true,fraction:1}]}]};
  try{
    await publish({id:"zip-geography",recordClass:full.params[0] as "CENSUS_GEOGRAPHY",scope:String(full.params[1]),sourceId:"census-geography",value:{scopes:[scope]},at:AT});
    const all=(await pg.query<{geography:Record<string,unknown>[]}>(full.text,[...full.params])).rows[0].geography;
    const row=(await pg.query<{geography:Record<string,unknown>[];canonical_keys:string[]}>(scoped.text,[...scoped.params])).rows[0];
    assert.deepEqual(row.geography,all.filter(g=>g.row_kind==="scope"||g.geoid==="3302").map(g=>g.row_kind==="scope"?g:{...g,overlaps:scope.groupings[0].overlaps.slice(0,1)}));
    assert.deepEqual(row.canonical_keys,["CURATED_READER_RECORD:US:plain-english-translations:ocd-division/country:us/state:nh/cd:2"]);
    const missing=stateContainersStatement("NH",[],"00000");
    assert.deepEqual((await pg.query<{geography:Record<string,unknown>[]}>(missing.text,[...missing.params])).rows[0].geography,all.filter(g=>g.row_kind==="scope"));
  }finally{await pg.close();}
});

test("ZIP people selection joins the held Census districts and official aliases in its own bounded read",async()=>{
  const {stateContainersStatement}=await import("../lib/control-plane/admin-view/promoted-slices.ts");
  const {pg,publish}=await migratedReaderDb();
  const geography=stateContainersStatement("NH",[],"03046");
  const person=(id:string,name:string,nativeIds:Record<string,string[]>={})=>({id,name,nativeIds});
  const people=[person("point","District Person"),person("alias","Old Name",{openstates:["ocd-person/exact-alias"]}),
    person("name","Renee Smith"),person("elsewhere","Another Person")];
  try{
    await publish({id:"parallel-geography",recordClass:geography.params[0] as "CENSUS_GEOGRAPHY",scope:String(geography.params[1]),sourceId:"census-geography",
      value:{scopes:[{type:"state_leg_lower",version:"2025",versionMeta:{plan:"2025"},groupings:[
        {geoid:"33027",stateFips:"33",stateAbbr:"NH",label:"District 27",overlaps:[{zcta5:"03046",whole:true,fraction:1}]}]}]},at:AT});
    await publish({id:"parallel-official",recordClass:"STATE_LEGISLATOR",scope:"US-NH",sourceId:"official-legislature",
      value:{roster:{officeholders:[person("official","Renée Smith",{openstates:["exact-alias"]})],divisions:[{officeholderId:"official",ocdId:DIVISION}]}},at:AT});
    await publish({id:"parallel-source",recordClass:"STATE_LEGISLATOR",scope:"US-NH:openstates-people:v1",sourceId:"plural-openstates",
      value:{roster:{officeholders:people,divisions:[{officeholderId:"point",ocdId:DIVISION}]}},at:AT});
    const statement=statePackageStatement("NH",[],"03046");
    const row=(await pg.query<{zip_people:Record<string,unknown>}>(statement.text,[...statement.params])).rows[0];
    const entry=zipPeopleEntry("NH",row.zip_people);assert.equal(entry.kind,"PROMOTED");
    if(entry.kind!=="PROMOTED")return;
    const payload=entry.projection.payload as {roster:{officeholders:unknown[]}};
    assert.deepEqual(payload.roster.officeholders,people.slice(0,3));
    const missing=statePackageStatement("NH",[],"00000");
    const absent=zipPeopleEntry("NH",(await pg.query<{zip_people:Record<string,unknown>}>(missing.text,[...missing.params])).rows[0].zip_people);assert.equal(absent.kind,"PROMOTED");
    if(absent.kind==="PROMOTED")assert.deepEqual((absent.projection.payload as typeof payload).roster.officeholders,[]);
  }finally{await pg.close();}
});

test("NH Members.txt identities retain ZIP aliases and name candidates for House and Senate districts",async()=>{
  const {pg,publish}=await migratedReaderDb();
  const house="ocd-division/country:us/state:nh/sldl:627",senate="ocd-division/country:us/state:nh/sldu:15";
  const people=[{id:"source-alias",name:"Older Source Name",nativeIds:{"nh-general-court":["nh-person-1"]},contacts:[{email:"held@example.gov"}]},
    {id:"source-name",name:"Renee Senator",nativeIds:{},biography:"Preserve full sourced detail"},
    {id:"elsewhere",name:"Different Legislator",nativeIds:{}}];
  try{
    await publish({id:"nh-members-official",recordClass:"STATE_LEGISLATOR",scope:"US-NH",sourceId:"nh-general-court",at:AT,
      value:{members:[{chamber:"H",seatNo:"1",district:"27",county:"Merrimack",givenName:"New",middleName:"",familyName:"Name"},
        {chamber:"S",seatNo:"15",district:"15",county:"",givenName:"Renée",middleName:"",familyName:"Senator"},
        {chamber:"H",seatNo:"2",district:"28",county:"Merrimack",givenName:"Different",middleName:"",familyName:"Legislator"}],
      identities:[{chamber:"H",seatNo:"1",district:"27",officeholderId:"nh-general-court:1",officialPersonId:"nh-person-1"},
        {chamber:"S",seatNo:"15",district:"15",officeholderId:"nh-general-court:15",officialPersonId:"nh-person-15"},
        {chamber:"H",seatNo:"2",district:"28",officeholderId:"nh-general-court:2",officialPersonId:"nh-person-2"}]}});
    await publish({id:"nh-members-source",recordClass:"STATE_LEGISLATOR",scope:"US-NH:openstates-people:v1",sourceId:"plural-openstates",at:AT,
      value:{roster:{officeholders:people,divisions:[],unmatched:people.map(p=>({officeholderId:p.id,reason:"No source district link"}))}}});
    const statement=statePackageStatement("NH",[house,senate],"03046");
    const row=(await pg.query<{zip_people:{payload:{roster:{officeholders:unknown[];unmatched:unknown[]}}}}>(statement.text,[...statement.params])).rows[0];
    assert.deepEqual(row.zip_people.payload.roster.officeholders,people.slice(0,2));
    assert.deepEqual(row.zip_people.payload.roster.unmatched,people.slice(0,2).map(p=>({officeholderId:p.id,reason:"No source district link"})));
  }finally{await pg.close();}
});

test("ZIP registry SQL preserves held rosters, their definitions, statewide bodies, aliases and source metadata",async()=>{
  const {pg,publish}=await migratedReaderDb();
  const state="ocd-division/country:us/state:nh",town=`${state}/place:dunbarton`,county=`${state}/county:merrimack`,
    alias=`${state}/cousub:alias`,outside=`${state}/place:elsewhere`,unrelated=`${state}/place:unrelated`;
  const division=(ocdId:string,tier="local",canonicalOcdId=ocdId)=>({ocdId,tier,canonicalOcdId,label:ocdId,provenance:{sourceUrl:"https://www.census.gov/"}});
  const body=(id:string,ocdId:string|null,alsoServesOcdIds?:string[]|null)=>({id,ocdId,...(alsoServesOcdIds===undefined?{}:{alsoServesOcdIds}),name:id,source:{full:"Preserve complete record"}});
  const divisions=[division("ocd-division/country:us","national"),division(state,"state"),division(town),division(county),division(alias,"local",town),division(outside),division(unrelated)];
  const bodies=[body("federal","ocd-division/country:us"),body("state",state),body("town",town),body("county",county),body("alias",alias),
    body("cross",outside,[town]),body("held",outside,null),body("unknown",null),body("unrelated",unrelated)];
  const payload={formatVersion:1,registry:{generatedAt:AT,divisions,bodies,sourceNotes:"Held metadata"},
    bodyRosters:[{bodyId:"held",members:[{id:"member",name:"Held Official",officeTitle:"Board Member"}],sourceUrl:"https://www.nh.gov/",sourceOrg:"NH",collectedAt:AT}],
    rosterReaderDispositions:[],statewideExecutives:[],officialPhotos:{photos:[{officeholderId:"member",url:"/officials/member.jpg",name:"Held Official",sourceDetail:{keep:true}},
      {officeholderId:"unrelated",url:"/officials/elsewhere.jpg",name:"Other Official"}]},rosterPhotos:{},
    officialCandidacies:{formatVersion:1,rule:"EXACT_SEAT_CONSERVATIVE_NAME_OFFLINE_UNIQUE",rows:[{holder:{id:"member",divisions:[town]},sourceDetail:{keep:true}},
      {holder:{id:"unrelated",divisions:[unrelated]}}]},futureSourceField:{keep:"everything outside the selected definition arrays"}};
  const encoded=partitionCivicPayload({...payload,padding:"Source metadata ".repeat(4000)});
  try{
    for(const part of encoded.parts)await pg.query("INSERT INTO civic_data_payload_parts(hash,payload) VALUES($1,$2)",[part.hash,JSON.stringify(part.payload)]);
    await publish({id:"zip-registry",recordClass:"REGISTRY_RUNTIME_BINDING",scope:"US-NH:reader-registry-runtime",sourceId:"registry-reviewed-bindings",at:AT,
      value:encoded.value,payloadHash:canonicalCivicDataHash({...payload,padding:"Source metadata ".repeat(4000)})});
    const statement=statePackageStatement("NH",[town,county],"03046");
    const row=(await pg.query<{zip_registry:{published:boolean;payload:typeof payload}}>(statement.text,[...statement.params])).rows[0];
    assert.equal(row.zip_registry.published,true);
    assert.deepEqual(row.zip_registry.payload,{...payload,padding:"Source metadata ".repeat(4000),
      officialPhotos:{...payload.officialPhotos,photos:payload.officialPhotos.photos.slice(0,1)},
      officialCandidacies:{...payload.officialCandidacies,rows:payload.officialCandidacies.rows.slice(0,1)},registry:{...payload.registry,
      divisions:divisions.filter(d=>d.ocdId!==unrelated),bodies:bodies.filter(b=>b.id!=="unrelated")}});
    assert.equal(statePackageStatement("NH").text.includes("AS zip_registry"),false,"whole-state callers retain the complete canonical registry");
  }finally{await pg.close();}
});

test("the official ZIP roster keeps all selected source details and membership links while other districts stay on the server",async()=>{
  const {pg,publish}=await migratedReaderDb();
  const people=[{id:"official:first",name:"First Person",nativeIds:{official:["first"]},contacts:{email:"first@example.gov"}},
    {id:"official:second",name:"Second Person",nativeIds:{official:["second"]},contacts:{email:"second@example.gov"}},
    {id:"official:same-name",name:"First Person",nativeIds:{official:["same-name"]},contacts:{email:"namesake@example.gov"}}];
  const links=[{officeholderId:people[0].id,ocdId:DIVISION},{officeholderId:people[0].id,ocdId:`${DIVISION}-additional`},
    {officeholderId:people[1].id,ocdId:`${DIVISION}-elsewhere`},{officeholderId:people[2].id,ocdId:`${DIVISION}-namesake`}];
  const payload={formatVersion:1,jurisdiction:"US-NJ",sourceId:"nj-legislature",roster:{officeholders:people,divisions:links,
    unmatched:[{officeholderId:people[0].id,reason:"Held additional source note"}],currentMembershipComplete:true,generatedAt:AT},sourceAudit:{keep:"The complete audit metadata"}};
  try{
    await publish({id:"zip-official-selected",recordClass:"STATE_LEGISLATOR",scope:"US-NJ",sourceId:"nj-legislature",value:payload,at:AT});
    const statement=statePackageStatement("NJ",[DIVISION],"07005");
    const row=(await pg.query<{zip_official:{published:boolean;payload:typeof payload}}>(statement.text,[...statement.params])).rows[0];
    assert.equal(row.zip_official.published,true);
    assert.deepEqual(row.zip_official.payload,{...payload,roster:{...payload.roster,officeholders:[people[0],people[2]],divisions:[...links.slice(0,2),links[3]]}});
  }finally{await pg.close();}
});

test("point source SQL preserves exact cross-source aliases, name ambiguity, selected disputes and full directories without unrelated state people",async()=>{
  const {pg,publish}=await migratedReaderDb();
  const cd="ocd-division/country:us/state:nj/cd:11",elsewhere="ocd-division/country:us/state:nj/cd:2";
  const person=(id:string,name:string,nativeIds:Record<string,string[]>={})=>({id,name,nativeIds,officeTitle:"U.S. Representative",state:"NJ",level:"FEDERAL",
    provenance:{sourceUrl:"https://www.congress.gov/member",sourceOrg:"Congress",collectedAt:AT,verifiedAt:AT},futureSourceField:{keep:"every selected field"}});
  const official=person("congress:A000001","Jordan Point"),other=person("congress:A000002","Elsewhere");
  const senator={...person("congress:S000001","State Senator"),officeTitle:"U.S. Senator"};
  const point=person("source:point","Jordan Point",{bioguide:["A000001"],wikidata:["42"]}),sameName=person("source:same-name","Jordan Point"),
    wrongNamespace=person("source:unrelated","Unrelated Name",{legiscan:["42"]}),bridge=person("govinfo:bridge","Publisher Name",{congress:["A000001"]});
  const roster=(people:unknown[],links:unknown[])=>({scope:"34",generatedAt:AT,currentMembershipComplete:true,officeholders:people,divisions:links,unmatched:[],endedMemberships:[]});
  const directory={source:{sha:"a".repeat(40)},counts:{members:3},committees:{},byMember:{A000001:{districtOffices:[{address:"Selected office",phone:"202-555-0100"}],committees:[]},A000002:{districtOffices:[{address:"Elsewhere office"}],committees:[]},S000001:{districtOffices:[{address:"Statewide office"}],committees:[]}}};
  const disputes=[{personId:point.id,field:"phone",selected:{value:"202-555-0100"},alternative:{value:"202-555-0199"}},
    {personId:wrongNamespace.id,field:"phone",selected:{value:"Unrelated"},alternative:{value:"Also unrelated"}}];
  try{
    await publish({id:"point-source-directory",recordClass:"FEDERAL_DIRECTORY",scope:"US-NJ:current-congress-directory",sourceId:"congress-directory-project",at:AT,
      value:{formatVersion:1,sourceSha:"a".repeat(40),roster:roster([official,other,senator],[{officeholderId:official.id,ocdId:cd},{officeholderId:other.id,ocdId:elsewhere},{officeholderId:senator.id,ocdId:"ocd-division/country:us/state:nj"}]),directory}});
    await publish({id:"point-source-congress",recordClass:"FEDERAL_DIRECTORY",scope:"US-NJ:people:congress-api:v1",sourceId:"congress-api",at:AT,
      value:{formatVersion:1,sourceId:"congress-api",jurisdiction:"US-NJ",sourceNotes:"Complete source metadata",roster:{...roster([point,sameName,wrongNamespace],[{officeholderId:point.id,ocdId:cd},{officeholderId:sameName.id,ocdId:elsewhere},{officeholderId:wrongNamespace.id,ocdId:elsewhere}]),disagreements:disputes}}});
    await publish({id:"point-source-govinfo",recordClass:"FEDERAL_DIRECTORY",scope:"US-NJ:people:govinfo:v1",sourceId:"govinfo",at:AT,
      value:{formatVersion:1,sourceId:"govinfo",jurisdiction:"US-NJ",roster:roster([bridge],[])}});
    const statement=statePackageStatement("NJ",[cd],"07005");
    const row=(await pg.query<{zip_sources:{key:string;payload:{directory?:typeof directory;roster:ReturnType<typeof roster>&{disagreements?:unknown[]}}}[]}>(statement.text,[...statement.params])).rows[0];
    const sources=new Map(row.zip_sources.map(source=>[source.key,source.payload]));
    assert.deepEqual(sources.get("FEDERAL_DIRECTORY:US-NJ:current-congress-directory")?.roster.officeholders,[official,senator],"A ZIP shard does not need an explicit state row to retain its U.S. senators");
    assert.deepEqual(sources.get("FEDERAL_DIRECTORY:US-NJ:current-congress-directory")?.directory,{...directory,byMember:{A000001:directory.byMember.A000001,S000001:directory.byMember.S000001}});
    assert.deepEqual(sources.get("FEDERAL_DIRECTORY:US-NJ:people:congress-api:v1")?.roster.officeholders,[point,sameName]);
    assert.deepEqual(sources.get("FEDERAL_DIRECTORY:US-NJ:people:congress-api:v1")?.roster.disagreements,disputes.slice(0,1));
    assert.deepEqual(sources.get("FEDERAL_DIRECTORY:US-NJ:people:govinfo:v1")?.roster.officeholders,[bridge]);
  }finally{await pg.close();}
});
