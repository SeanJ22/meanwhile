import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseExecutiveProfile, executiveProfileLinks, parseVicePresidentDirectory } from "../lib/sources/white-house/profile.ts";
import { currentCabinet, ADMINISTRATION_URL } from "../lib/sources/white-house/president.ts";
const at = "2026-10-23T00:00:00.000Z";
const fixture = (name: string) => readFileSync(new URL(`./fixtures/white-house/${name}.html`, import.meta.url), "utf8");
const page = (name: string) => ({url:`https://www.whitehouse.gov/administration/${name}/`,html:fixture(name),retrievedAt:at});

test("held President and Vice President profiles yield their own named portrait and biography", () => {
  const president = parseExecutiveProfile({person:{name:"Donald J. Trump",officeTitle:"President of the United States"},page:page("donald-j-trump")});
  assert.match(president.patch.portraitCandidate!.imageUrl,/Official-Presidential-Portrait/);
  assert.match(president.biography!.text,/University of Pennsylvania/);
  assert.equal(president.patch.partyLabel,undefined);
  assert.equal(president.patch.termStart,undefined);
  assert.equal(president.patch.social,undefined,"White House footer accounts do not become the person's accounts");
  assert.ok(president.gaps.includes("took-office"));
  const vice = parseExecutiveProfile({person:{name:"JD Vance",officeTitle:"Vice President of the United States"},page:page("jd-vance")});
  assert.match(vice.patch.portraitCandidate!.imageUrl,/JD-Vance/);
  assert.match(vice.biography!.text,/Middletown/);
  assert.equal(vice.patch.partyLabel,"Republican");
  assert.ok(vice.priorOffices.some(row=>row.text.includes("U.S. Senate")));
  assert.equal(vice.biography!.collectedAt,at);
  assert.equal(vice.patch.fieldSources!.partyLabel.sourceUrl,page("jd-vance").url);
});

test("every held Cabinet profile is isolated from its neighbors and has its own portrait and biography", () => {
  const cabinetPage=page("cabinet");
  const cabinet=currentCabinet({url:ADMINISTRATION_URL,html:fixture("administration")},cabinetPage);
  assert.equal(cabinet.members.length,21);
  for (const member of cabinet.members) {
    const result=parseExecutiveProfile({person:{name:member.name,officeTitle:member.title},page:cabinetPage});
    assert.ok(result.biography,member.name);
    assert.ok(result.patch.portraitCandidate,member.name);
    assert.equal(result.patch.portraitCandidate!.sourceUrl,cabinetPage.url);
    assert.match(result.patch.fieldSources!.portraitCandidate.quote!,new RegExp(member.name.split(" ")[0]));
  }
  const bessent=parseExecutiveProfile({person:{name:"Scott Bessent",officeTitle:"Secretary of the Treasury"},page:cabinetPage});
  assert.ok(!bessent.biography!.text.includes("Todd Blanche"));
  assert.equal(bessent.patch.termStart,undefined,"Clayton's swearing-in date cannot become Bessent's start");
  const clayton=parseExecutiveProfile({person:{name:"Jay Clayton",officeTitle:"Director of National Intelligence"},page:cabinetPage});
  assert.equal(clayton.patch.termStart,"2026-08-03");
  const kennedy=parseExecutiveProfile({person:{name:"Robert F. Kennedy, Jr.",officeTitle:"Secretary of Health and Human Services"},page:cabinetPage});
  assert.equal(kennedy.patch.partyLabel,undefined,"a past Democratic affiliation is not a current party");
});

test("department's real saved biography accepts unquoted image attributes", () => {
  const url="https://home.treasury.gov/about/general-information/officials/scott-bessent";
  const html=readFileSync(new URL("./fixtures/nx-executive/profiles/treasury-bessent.html",import.meta.url),"utf8");
  const result=parseExecutiveProfile({person:{name:"Scott Bessent",officeTitle:"Secretary of the Treasury"},page:{url,html,retrievedAt:at}});
  assert.equal(result.patch.portraitCandidate!.imageUrl,"https://home.treasury.gov/system/files/136/Secretary_Bessent.jpg");
  assert.match(result.biography!.text,/79th Secretary of the Treasury/);
  assert.throws(()=>parseExecutiveProfile({person:{name:"Howard Lutnick",officeTitle:"Secretary of Commerce"},page:{url,html,retrievedAt:at}}),/PERSON_HEADING/);
});

test("Senate's current Vice President directory supplies party without inventing a full date", () => {
  const url="https://www.senate.gov/about/officers-staff/vice-president/vice-presidents.htm";
  const html=readFileSync(new URL("./fixtures/nx-executive/profiles/senate-vp-history.html",import.meta.url),"utf8");
  const result=parseVicePresidentDirectory({name:"JD Vance"},{url,html,retrievedAt:at});
  assert.equal(result.patch.partyLabel,"Republican");
  assert.equal(result.serviceStartYear,2025);
  assert.equal(result.patch.termStart,undefined);
  assert.throws(()=>parseVicePresidentDirectory({name:"Kamala D. Harris"},{url,html,retrievedAt:at}),/CURRENT_SENATE/);
});

test("wrong person, wrong office, and nonofficial profiles are refused", () => {
  assert.throws(()=>parseExecutiveProfile({person:{name:"JD Vance",officeTitle:"Vice President of the United States"},page:page("donald-j-trump")}),/PERSON_HEADING/);
  assert.throws(()=>parseExecutiveProfile({person:{name:"Donald J. Trump",officeTitle:"Vice President of the United States"},page:page("donald-j-trump")}),/OFFICE_MISMATCH/);
  assert.throws(()=>parseExecutiveProfile({person:{name:"JD Vance",officeTitle:"Vice President of the United States"},page:{...page("jd-vance"),url:"https://example.org/vance"}}),/OFFICIAL_PAGE/);
  const links=executiveProfileLinks({name:"JD Vance"},{url:ADMINISTRATION_URL,html:'<a href="https://www.whitehouse.gov/administration/jd-vance/">JD Vance</a><a href="https://example.org/vance">JD Vance</a>',retrievedAt:at});
  assert.deepEqual(links,["https://www.whitehouse.gov/administration/jd-vance/"]);
});

test("official ceremony, next inauguration and Constitution fill the exact presidential term dates", async () => {
  const {parseExecutiveTerm,parseExecutiveElectionParty,EXECUTIVE_TERM_SOURCES}=await import("../lib/sources/white-house/profile.ts");
  const saved=(name:string,url:string)=>({url,html:readFileSync(new URL(`./fixtures/nx-executive/profiles/${name}.html`,import.meta.url),"utf8"),retrievedAt:at});
  const inauguration=saved("inauguration-2025",EXECUTIVE_TERM_SOURCES.inauguration);
  const schedule=saved("usa-presidential-inauguration",EXECUTIVE_TERM_SOURCES.schedule);
  const amendment=saved("constitution-amendment-20",EXECUTIVE_TERM_SOURCES.amendment);
  const election=saved("archives-president-2025",EXECUTIVE_TERM_SOURCES.election);
  for (const person of [{name:"Donald J. Trump",officeTitle:"President of the United States"},{name:"JD Vance",officeTitle:"Vice President of the United States"}]) {
    const result=parseExecutiveTerm({person,inauguration,schedule,amendment});
    assert.equal(result.termStart,"2025-01-20");
    assert.equal(result.termEnd,"2029-01-20");
    assert.match(result.fieldSources!.termEnd.quote!,/January 20, 2029/);
    assert.equal(parseExecutiveElectionParty(person,election).partyLabel,"Republican");
  }
  assert.throws(()=>parseExecutiveTerm({person:{name:"Joe Biden",officeTitle:"President of the United States"},inauguration,schedule,amendment}),/INAUGURATION_PERSON_DATE/);
  assert.throws(()=>parseExecutiveTerm({person:{name:"JD Vance",officeTitle:"Vice President of the United States"},inauguration,schedule:{...schedule,html:schedule.html.replaceAll("January 20, 2029","January 20, 2033")},amendment}),/TERM_CALENDAR/);
});

test("department directory routes cover every currently named Cabinet office", async () => {
  const {executiveOfficeSources}=await import("../lib/sources/white-house/profile.ts");
  const cabinet=currentCabinet({url:ADMINISTRATION_URL,html:fixture("administration")},page("cabinet"));
  for (const member of cabinet.members) {
    const routes=executiveOfficeSources(member.title);
    assert.ok(routes.length,member.title);
    assert.ok(routes.every(url=>new URL(url).hostname.endsWith(".gov")),member.title);
    assert.ok(routes.every(url=>!url.toLowerCase().includes(member.name.toLowerCase().replaceAll(" ","-"))),"directories follow offices across transitions");
  }
  assert.deepEqual(executiveOfficeSources("Unknown Appointed Office"),[]);
});

test("current inauguration candidates come from the Senate index rather than a fixed ceremony", async () => {
  const {inaugurationLinks,INAUGURATION_INDEX_URL}=await import("../lib/sources/white-house/profile.ts");
  const html=readFileSync(new URL("./fixtures/nx-executive/profiles/senate-inauguration-index.html",import.meta.url),"utf8");
  const held={url:INAUGURATION_INDEX_URL,html,retrievedAt:at};
  const links=inaugurationLinks(held);
  assert.equal(links[0],"https://www.inaugural.senate.gov/60th-inaugural-ceremonies/");
  assert.ok(links.includes("https://www.inaugural.senate.gov/59th-inaugural-ceremonies/"));
  assert.equal(inaugurationLinks({...held,html:html+'<a href="https://www.inaugural.senate.gov/61st-inaugural-ceremonies/">Next ceremony</a>'})[0],"https://www.inaugural.senate.gov/61st-inaugural-ceremonies/");
  assert.throws(()=>inaugurationLinks({...held,url:"https://example.org"}),/SENATE_INDEX/);
});

test("office contact parser keeps shared White House and Treasury channels labelled correctly", async () => {
  const {parseExecutiveOfficeChannels,executiveContactLinks}=await import("../lib/sources/white-house/profile.ts");
  const saved=(name:string,url:string)=>({url,html:readFileSync(new URL(`./fixtures/nx-executive/profiles/${name}.html`,import.meta.url),"utf8"),retrievedAt:at});
  const whiteHouse=saved("whitehouse-contact","https://www.whitehouse.gov/contact/");
  for (const person of [{name:"Donald J. Trump",officeTitle:"President of the United States"},{name:"JD Vance",officeTitle:"Vice President of the United States"}]) {
    const result=parseExecutiveOfficeChannels({person,profileUrl:`https://www.whitehouse.gov/administration/${person.name==="JD Vance"?"jd-vance":"donald-j-trump"}/`,page:whiteHouse});
    assert.equal(result.patch.contactFormUrl,whiteHouse.url);
    assert.equal(result.patch.social,undefined,"shared accounts are not labelled as the elected officer's own account");
    const extra=parseExecutiveOfficeChannels({person,profileUrl:"https://www.whitehouse.gov/administration/",page:{...whiteHouse,html:whiteHouse.html.replace("<main",'<a href="https://x.com/UnaffiliatedPerson">A person</a><main')}});
    assert.ok(!extra.sharedSocial.some(row=>row.url.includes("UnaffiliatedPerson")),"unrelated links outside the institution footer cannot become shared accounts");
    assert.ok(result.sharedSocial.some(row=>row.url==="https://x.com/whitehouse"));
    assert.ok(result.sharedSocial.every(row=>row.scope==="WHITE_HOUSE" && row.label.startsWith("The White House on ")));
    assert.equal(result.patch.fieldSources!.contactFormUrl.quote,`Contact the ${person.officeTitle.startsWith("Vice")?"Vice President":"President"}`);
  }
  const treasury=saved("treasury-contact","https://home.treasury.gov/utility/contact");
  const person={name:"Scott Bessent",officeTitle:"Secretary of the Treasury"};
  const result=parseExecutiveOfficeChannels({person,profileUrl:"https://home.treasury.gov/about/general-information/officials/scott-bessent",page:treasury,departmentName:"Department of the Treasury"});
  assert.equal(result.patch.phone,"(202) 622-2000");
  assert.equal(result.patch.contactFormUrl,treasury.url);
  assert.ok(result.patch.offices!.some(office=>office.address!.includes("1500 Pennsylvania Avenue")));
  assert.ok(result.sharedSocial.some(row=>row.url.includes("USTreasury") && row.scope==="DEPARTMENT"));
  assert.ok(!result.sharedSocial.some(row=>row.url.includes("/status/") || row.url.includes("sharer")));
  assert.ok(executiveContactLinks({url:treasury.url,html:readFileSync(new URL("./fixtures/nx-executive/profiles/treasury-bessent.html",import.meta.url),"utf8"),retrievedAt:at}).includes(treasury.url));
  assert.throws(()=>parseExecutiveOfficeChannels({person,profileUrl:"https://www.energy.gov/person/chris-wright",page:treasury,departmentName:"Department of the Treasury"}),/OWN_AGENCY/);
});

test("Cabinet tenure uses Government Manual wording and does not invent an end date", async () => {
  const {parseCabinetTenure,CABINET_TENURE_SOURCE_URL}=await import("../lib/sources/white-house/profile.ts");
  const html=readFileSync(new URL("./fixtures/nx-executive/profiles/cabinet-tenure-manual.html",import.meta.url),"utf8");
  const source={url:CABINET_TENURE_SOURCE_URL,html,retrievedAt:at};
  const result=parseCabinetTenure({officeTitle:"Secretary of the Treasury"},source);
  assert.match(result.text,/functions at the pleasure of the President/);
  assert.equal(result.sourceUrl,source.url);
  assert.equal(result.collectedAt,at);
  assert.throws(()=>parseCabinetTenure({officeTitle:"President of the United States"},source),/APPOINTED_OFFICE/);
});
