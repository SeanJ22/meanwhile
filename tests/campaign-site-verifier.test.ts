import assert from "node:assert/strict";
import test from "node:test";

import {
  CAMPAIGN_SITE_REFUSALS,
  campaignNameForms,
  campaignSiteHostRefusal,
  cycleEvidence,
  heldPageRead,
  officeForms,
  readCampaignSiteLead,
  titleBrandsCandidate,
  verifyCampaignSitePage,
  type CampaignSiteLead,
  type CampaignSitePageRead,
  type CampaignSiteSupportingRead,
} from "../lib/candidates/campaign-site-verifier.ts";
import { CHIPPERSON, DUARTE, FRENCH, KAPNER, RYZUK, TANG_WILLIAMS, fixture, servedRuntime, subject } from "./helpers/campaign-sites.ts";

const AT = "2026-09-25T21:00:00.000Z";
const lead = (url: string): CampaignSiteLead => ({ url, origin: "SCOUT_FINDING", ref: "test" });
function read(url: string, file: string): CampaignSitePageRead {
  return { ...heldPageRead({ requestedUrl: url, httpStatus: 200, contentType: "text/html; charset=utf-8", body: fixture(file), retrievedAt: AT }),
    permissions: [{ origin: new URL(url).origin, verdict: "ALLOWED", detail: "served robots.txt allows /" }] };
}
const codes = (v: ReturnType<typeof verifyCampaignSitePage>) => (v.verdict === "REFUSED" ? v.refusals.map((r) => r.code) : []);

test("a current campaign site VERIFIES: the page names the candidate, the office and the 2026 election", () => {
  const url = "https://www.duarte4mendham.com/meet-amalia";
  const v = verifyCampaignSitePage(subject(DUARTE), lead(url), read(url, "duarte4mendham-meet-amalia.live.html"));
  assert.equal(v.verdict, "VERIFIED", JSON.stringify(codes(v)));
  assert.equal(v.measurement!.name!.form, "amalia duarte");
  assert.ok(v.measurement!.office !== null && v.measurement!.district?.form === "mendham township");
  assert.equal(v.measurement!.cycle.state, "CURRENT");
  assert.equal(v.measurement!.branding?.by, "HOST");
  assert.match(v.verdict === "VERIFIED" ? v.verification : "", /^Fetched 2026-09-25 \(campaign-site-verifier\/1\): 'Meet Amalia Duarte Running for Mendham Township Committee' — names Amalia Duarte, the office/);
});

test("a filed middle initial is omitted by a named rule, never by similarity", () => {
  const url = "https://www.chippersonforharding.com/";
  const v = verifyCampaignSitePage(subject(CHIPPERSON), lead(url), read(url, "chippersonforharding-root.live.html"));
  assert.equal(v.verdict, "VERIFIED", JSON.stringify(codes(v)));
  assert.deepEqual(v.measurement!.name!.rules, ["AS_PUBLISHED", "MIDDLE_INITIAL_OMITTED"]);
  /* Her running mate is "Chris" on the page and "Christopher M." on the filing: a diminutive is never generated. */
  assert.ok(!campaignNameForms({ givenName: "Christopher M.", familyName: "YATES" }).some((f) => f.form === "chris yates"));
  const art = campaignNameForms({ givenName: "Arthur J. (Art)", familyName: "BRUHN" });
  assert.ok(art.some((f) => f.form === "art bruhn" && f.rules.includes("PARENTHESIZED_NICKNAME") && f.rules.includes("MIDDLE_INITIAL_OMITTED")));
  assert.ok(!art.some((f) => f.form === "bruhn"), "a surname alone is never a form");
});

test("a campaign site with no year is CYCLE_NOT_EVIDENCED: it cannot be told from a past cycle's", () => {
  const url = "https://www.kapner4mendhamtwp.com/";
  const v = verifyCampaignSitePage(subject(KAPNER), lead(url), read(url, "kapner4mendhamtwp-root.live.html"));
  assert.deepEqual(codes(v), ["CYCLE_NOT_EVIDENCED"]);
  assert.equal(v.measurement!.name!.form, "gary kapner");
});

test("middle given names may be omitted while every family-name token remains exact", () => {
  const forms = campaignNameForms({ givenName: "Elaine Marie", familyName: "Van Buren" });
  assert.ok(forms.some(form => form.form === "elaine van buren" && form.rules.includes("MIDDLE_NAME_OMITTED")));
  assert.ok(!forms.some(form => form.form === "elaine buren" || form.form === "van buren"));
});

test("a current independent profile supplies its own election span without inventing one on a yearless campaign page", () => {
  const identity = { ...subject(KAPNER), candidacyId: "mo:2026:sldl-19:cooper-elaine-marie", givenName: "Elaine Marie",
    familyName: "Cooper", stateCode: "MO", officeTitle: "State Representative, District 19", ocdId: "ocd-division/country:us/state:mo/sldl:19" };
  const url = "https://elainecooper.example/";
  const primary = heldPageRead({ requestedUrl: url, httpStatus: 200, contentType: "text/html", retrievedAt: AT,
    body: "<title>Elaine Cooper for Missouri</title><h1>Elaine Cooper</h1><p>As a State Representative, I will work for rural communities.</p><p>Paid for by Elaine Cooper.</p>" });
  const profileBody = `<title>Elaine Marie Cooper | Candidate profile</title><h1>Elaine Marie Cooper</h1>
    <p>Missouri State Representative, District 19. Candidate in the 2026 General Election.</p><a href="${url}">Website</a>`;
  const support = (body = profileBody, sourceUrl = "https://profile.example/elaine"): CampaignSiteSupportingRead => {
    const page = heldPageRead({ requestedUrl: sourceUrl, httpStatus: 200, contentType: "text/html", retrievedAt: AT, body });
    return { source: { artifactId: "ar-profile", sha256: page.sha256, requestedUrl: page.requestedUrl, finalUrl: page.finalUrl,
      readAt: page.retrievedAt, contentType: page.contentType, httpStatus: page.httpStatus }, page };
  };
  assert.deepEqual(codes(verifyCampaignSitePage(identity, lead(url), primary)), ["CYCLE_NOT_EVIDENCED"]);
  const verified = verifyCampaignSitePage(identity, lead(url), primary, support());
  assert.equal(verified.verdict, "VERIFIED", JSON.stringify(codes(verified)));
  assert.equal(verified.measurement!.name!.form, "elaine cooper");
  assert.equal(verified.measurement!.cycle.span!.where, "INDEPENDENT_PROFILE");
  assert.equal(verified.measurement!.cycle.source!.artifactId, "ar-profile");
  assert.match(verified.verdict === "VERIFIED" ? verified.verification : "", /; https:\/\/profile.example\/elaine identifies the 2026 election/);
  for (const supporting of [support(profileBody.replaceAll("Elaine Marie Cooper", "Another Person")),
    support(profileBody.replace("District 19", "District 20")), support(profileBody.replace("Missouri", "Arizona")),
    support(`${profileBody}<p>Candidate for District 20 in the 2026 election.</p>`),
    support(profileBody.replace("State Representative", "State Senator")), support(profileBody.replace("2026", "2022")),
    support(profileBody.replace(url, "https://anothercampaign.example/")), support(profileBody, "https://profile.elainecooper.example/")]) {
    assert.ok(codes(verifyCampaignSitePage(identity, lead(url), primary, supporting)).includes("CYCLE_NOT_EVIDENCED"));
  }
  const forged = support();
  assert.ok(codes(verifyCampaignSitePage(identity, lead(url), primary,
    { ...forged, page: { ...forged.page, body: `${forged.page.body}<p>Altered.</p>` } })).includes("CYCLE_NOT_EVIDENCED"));
  const historicalBody = `${primary.body}<p>Vote in the 2022 election.</p>`;
  const historical = heldPageRead({ ...primary, body: historicalBody, sha256: undefined });
  assert.ok(codes(verifyCampaignSitePage(identity, lead(url), historical, support())).includes("HISTORICAL_CYCLE"));
});

test("a past-cycle campaign site is refused HISTORICAL_CYCLE and labelled historical", () => {
  const url = "https://www.yateschipperson.com/home";
  const v = verifyCampaignSitePage(subject(CHIPPERSON), lead(url), read(url, "yateschipperson-home-2022.archived.html"));
  assert.deepEqual(codes(v), ["HISTORICAL_CYCLE"]);
  assert.ok(v.verdict === "REFUSED" && v.historical !== null && v.historical.years.includes(2022));
});

test("a party committee's page about the candidate is PARTY_OR_ORGANIZATION, not their site", () => {
  const url = "https://montvillevotes.org/";
  const v = verifyCampaignSitePage(subject(RYZUK), lead(url), read(url, "montvillevotes-root.live.html"));
  assert.ok(codes(v).includes("PARTY_OR_ORGANIZATION"), JSON.stringify(codes(v)));
  assert.ok(codes(v).includes("SITE_NOT_CANDIDATE_BRANDED"));
});

test("a page that names neither the office nor the district is OFFICE_NOT_NAMED", () => {
  const url = "https://haroldfrench.com/";
  const v = verifyCampaignSitePage(subject(FRENCH), lead(url), read(url, "haroldfrench-root.live.html"));
  assert.ok(codes(v).includes("OFFICE_NOT_NAMED"), JSON.stringify(codes(v)));
});

test("the same bytes on a host that is not the candidate's are refused: a page about them is not their site", () => {
  const v = verifyCampaignSitePage(subject(DUARTE), lead("https://mendham-news.example/meet"), read("https://mendham-news.example/meet", "duarte4mendham-meet-amalia.live.html"));
  assert.deepEqual(codes(v), ["SITE_NOT_CANDIDATE_BRANDED"]);
  /* A title only brands a page as a segment that begins with the name — and only beside a campaign disclaimer. */
  assert.equal(titleBrandsCandidate("Rita Chipperson - Harding Township Committee", ["rita chipperson"]), "rita chipperson");
  assert.equal(titleBrandsCandidate("Home | Jane Doe for Council", ["jane doe"]), "jane doe");
  assert.equal(titleBrandsCandidate("AFP Action Endorses Juan Ciscomani for U.S. House", ["juan ciscomani"]), null);
  assert.equal(titleBrandsCandidate("Katie Hobbs signs budget", ["katie hobbs"]), null);
});

test("a surname alone never names the candidate", () => {
  const url = "https://www.duarte4mendham.com/meet-amalia";
  const v = verifyCampaignSitePage({ ...subject(DUARTE), givenName: "Zelda" }, lead(url), read(url, "duarte4mendham-meet-amalia.live.html"));
  assert.ok(codes(v).includes("CANDIDATE_NOT_NAMED"));
});

test("a Marginalia-pointed page on the candidate's own host verifies like any other lead", () => {
  const url = "https://www.lilytangwilliams.com/congress/endorsements/";
  const v = verifyCampaignSitePage(subject(TANG_WILLIAMS), { url, origin: "MARGINALIA_POINTER", ref: "test" }, read(url, "lilytangwilliams-endorsements.live.html"));
  assert.equal(v.verdict, "VERIFIED", JSON.stringify(codes(v)));
  assert.equal(v.measurement!.lead.origin, "MARGINALIA_POINTER");
});

test("host classes are refused before any request, each with its own typed reason", () => {
  const cases: readonly [string, string][] = [
    ["https://www.facebook.com/DuarteForMendham", "SOCIAL_PLATFORM"],
    ["https://ballotpedia.org/Amalia_Duarte", "AGGREGATOR"],
    ["https://onyourballot.vote411.org/race-detail.do?id=1", "AGGREGATOR"],
    ["https://www.tapinto.net/towns/montville/sections/elections/articles/x", "NEWS_OUTLET"],
    ["https://www.mendhamtownship.org/committee", "GOVERNMENT_SITE"],
    ["https://www.azsos.gov/elections", "GOVERNMENT_SITE"],
    ["https://web.archive.org/web/2022/https://www.yateschipperson.com/", "WEB_ARCHIVE"],
    ["https://html.duckduckgo.com/html/?q=duarte", "SEARCH_ENGINE"],
    ["https://longhilldems.com/candidates/mansi-patel", "PARTY_OR_ORGANIZATION"],
    ["https://www.randolphdems2026.org/", "PARTY_OR_ORGANIZATION"],
    ["https://www.duarte4mendham.com/flyer.pdf", "NOT_A_PAGE"],
    ["ftp://duarte4mendham.com/", "LEAD_URL_INVALID"],
  ];
  for (const [url, code] of cases) assert.equal(campaignSiteHostRefusal(url)?.code, code, url);
  assert.equal(campaignSiteHostRefusal("https://www.duarte4mendham.com/meet-amalia"), null);
  assert.ok(cases.every(([, code]) => (CAMPAIGN_SITE_REFUSALS as readonly string[]).includes(code)));
});

test("the read is robots-first: a refused host is never asked anything; a disallowing robots.txt is read first and recorded, the page is still requested; a challenge is ACCESS_CONTROLLED", async () => {
  const social = servedRuntime({});
  const refused = await readCampaignSiteLead(lead("https://www.facebook.com/x"), social);
  assert.ok(!refused.ok && refused.refusal.code === "SOCIAL_PLATFORM");
  assert.deepEqual(social.requests, [], "no request, robots.txt included, for a refused host");

  const url = "https://www.duarte4mendham.com/meet-amalia";
  const disallow = servedRuntime({
    "https://www.duarte4mendham.com/robots.txt": { status: 200, body: "User-agent: *\nDisallow: /\n" },
    [url]: { status: 200, body: fixture("duarte4mendham-meet-amalia.live.html") },
  });
  const overRobots = await readCampaignSiteLead(lead(url), disallow);
  assert.ok(overRobots.ok, JSON.stringify(overRobots.ok ? null : overRobots.refusal));
  assert.deepEqual(disallow.requests, ["https://www.duarte4mendham.com/robots.txt", url], "robots.txt first, then the page");
  assert.equal(overRobots.read.permissions[0]?.verdict, "DISALLOWED", "the verdict travels on the read");
  const overVerdict = verifyCampaignSitePage(subject(DUARTE), lead(url), overRobots.read);
  assert.equal(overVerdict.verdict, "VERIFIED", JSON.stringify(codes(overVerdict)));
  assert.equal(overVerdict.measurement!.permissions[0]?.verdict, "DISALLOWED", "recorded on the measurement, never a refusal");

  const challenge = servedRuntime({
    "https://www.duarte4mendham.com/robots.txt": { status: 200, body: fixture("duarte4mendham.robots.txt") },
    [url]: { status: 200, body: "<html><head><title>Just a moment...</title></head><body>Checking</body></html>" },
  });
  const challenged = await readCampaignSiteLead(lead(url), challenge);
  assert.ok(challenged.ok);
  assert.deepEqual(codes(verifyCampaignSitePage(subject(DUARTE), lead(url), challenged.read)), ["ACCESS_CONTROLLED"]);
  const forbidden = verifyCampaignSitePage(subject(DUARTE), lead(url), { ...challenged.read, httpStatus: 403, body: "Forbidden" });
  assert.deepEqual(codes(forbidden), ["HTTP_NOT_OK"]);
  assert.ok(!codes(forbidden).includes("ROBOTS_REFUSED") && !codes(overVerdict).includes("ROBOTS_REFUSED"), "ROBOTS_REFUSED is historical, never produced");

  const allow = servedRuntime({
    "https://www.duarte4mendham.com/robots.txt": { status: 200, body: fixture("duarte4mendham.robots.txt") },
    [url]: { status: 200, body: fixture("duarte4mendham-meet-amalia.live.html") },
  });
  const ok = await readCampaignSiteLead(lead(url), allow);
  assert.ok(ok.ok);
  assert.deepEqual(allow.requests, ["https://www.duarte4mendham.com/robots.txt", url]);
  assert.equal(ok.read.permissions[0]?.verdict, "ALLOWED");
  assert.equal(verifyCampaignSitePage(subject(DUARTE), lead(url), ok.read).verdict, "VERIFIED");
});

test("cycle evidence: the year must sit beside an election phrase or in the title", () => {
  assert.equal(cycleEvidence("attorney general 2026 report on water", [], 2026).state, "NOT_EVIDENCED");
  assert.equal(cycleEvidence("paid for by duarte for mendham 2026", [], 2026).state, "CURRENT");
  assert.equal(cycleEvidence("nothing here", ["Kris Mayes for Arizona Attorney General 2026"], 2026).span?.where, "TITLE");
  assert.deepEqual(cycleEvidence("re elect jane 2022 vote november 2022", [], 2026).earlierYears, [2022]);
  assert.equal(officeForms("Member of the Township Committee Unexpired Term")[0], "township committee");
  assert.ok(officeForms("Representative in Congress, District 2").includes("congress"));
});
