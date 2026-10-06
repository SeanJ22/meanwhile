import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { acquireWebsiteCorrections } from "../lib/civic-data/website-correction-acquisition.ts";
import {
  applicableWebsiteCorrections,
  DOTGOV_REGISTRY_URL,
  governmentNamesMatch,
  normalizedGovernmentName,
  registryRowFor,
  UNRESOLVED_WEBSITE_CASES,
  WEBSITE_CORRECTIONS,
  websiteCorrectionFor,
  websiteCorrectionIssues,
  websiteCorrectionListIssues,
  websiteCorrectionNote,
  websiteCorrectionReceiptIssue,
  websiteCorrectionRowIssue,
  type WebsiteCorrection,
} from "../lib/civic-data/website-corrections.ts";
import { memoryInProcess, type ResearchGet } from "../lib/hunt/robots-first-fetch.ts";
import { withWebsiteCorrection, type MeetingsDiscoveryNeed } from "../lib/hunt/meetings-discovery.ts";
import { missionMeetingsDiscoveryNeeds } from "../lib/hunt/mission-meetings-discovery.ts";
import type { JurisdictionRegistry } from "../lib/hunt/jurisdiction-universe.ts";

/**
 * **C15: A GOVERNMENT'S WEBSITE IS CORRECTED ONLY ON ITS OWN EVIDENCE.** (2026-09-24.)
 *
 * The owner's rule for the website field: the official homepage and the federal .gov registry must identify the
 * same government. A registry row naming a parent identifies the parent. Where the site is not .gov, another
 * government's own publication must name it, or the case stays unresolved and is named. The reviewer recorded is
 * the agent session that checked it.
 */

const HEX = "a".repeat(64);
const COTTONWOOD = WEBSITE_CORRECTIONS.find((c) => c.jurisdictionId === "az:city:city-of-cottonwood")!;

function variant(patch: Partial<WebsiteCorrection>): WebsiteCorrection {
  return { ...COTTONWOOD, ...patch };
}

test("C15: every reviewed correction meets the owner's rule, once per government", () => {
  assert.deepEqual(websiteCorrectionListIssues(WEBSITE_CORRECTIONS), []);
  assert.equal(applicableWebsiteCorrections(WEBSITE_CORRECTIONS).size, WEBSITE_CORRECTIONS.length);
  for (const c of WEBSITE_CORRECTIONS) {
    assert.match(c.corrected, /^https:\/\/[^/]+$/, `${c.jurisdictionId} corrects to a bare https origin`);
    assert.doesNotMatch(c.reviewedBy, /sean/i, "the reviewer is the agent session that checked it, never the owner");
    assert.doesNotMatch(c.reviewedBy, /^</, "a draft's placeholder reviewer is never committed (pnpm website:check)");
  }
});

test("C15: the nine named governments are each corrected on the rule or named unresolved, never both", () => {
  const nine = [
    "az:city:city-of-cottonwood", "az:city:city-of-douglas", "az:city:city-of-eloy", "az:city:city-of-flagstaff",
    "az:city:city-of-holbrook", "az:city:city-of-el-mirage", "nh:city:town-of-newbury", "nh:city:town-of-sutton",
    "nh:school:kearsarge-regional-school-dist",
  ];
  const corrected = new Set(WEBSITE_CORRECTIONS.map((c) => c.jurisdictionId));
  const unresolved = new Set(UNRESOLVED_WEBSITE_CASES.map((c) => c.jurisdictionId));
  for (const id of nine) assert.ok(corrected.has(id) !== unresolved.has(id), `${id} is corrected or named unresolved, exactly one`);
  for (const u of UNRESOLVED_WEBSITE_CASES) {
    assert.ok(u.why.trim() !== "" && u.wouldResolve.length > 0, `${u.jurisdictionId} says why and what would resolve it`);
    assert.equal(websiteCorrectionFor(u.jurisdictionId, u.recorded), null, `${u.jurisdictionId} is never applied`);
    assert.doesNotMatch(u.reviewedBy, /sean/i);
  }
  /* Sutton, as the rule reads it: its own registry row, a homepage that could not be read, no other government's page. */
  const sutton = variant({
    jurisdictionId: "nh:city:town-of-sutton", governmentName: "Town of Sutton", recorded: "http://www.sutton-nh.gov", corrected: "https://www.suttonnh.gov",
    registry: { ...COTTONWOOD.registry!, domain: "suttonnh.gov", organization: "Town of Sutton", city: "Sutton Mills", state: "NH" },
    homepage: null, other: [],
  });
  assert.match(websiteCorrectionIssues(sutton)[0]!, /UNRESOLVED — its homepage could not be read to confirm the registry/);
});

test("C15: the registry's inverted names read as the government's own", () => {
  assert.equal(normalizedGovernmentName("Holbrook, City of"), "CITY OF HOLBROOK");
  assert.ok(governmentNamesMatch("CITY OF DOUGLAS", "City of Douglas"));
  assert.ok(!governmentNamesMatch("City of Douglas", "Douglas County"));
  assert.ok(!governmentNamesMatch("", ""), "an empty name matches nothing");
});

test("C15: a registry row that names a parent is not the government's, and without other evidence it is UNRESOLVED", () => {
  const parent = variant({
    corrected: "https://www.flagstaff.az.gov",
    registry: { ...COTTONWOOD.registry!, domain: "az.gov", domainType: "State", organization: "State of Arizona" },
    homepage: { ...COTTONWOOD.homepage!, url: "https://www.flagstaff.az.gov/", selfName: "City of Cottonwood" },
  });
  const issues = websiteCorrectionIssues(parent);
  assert.equal(issues.length, 1);
  assert.match(issues[0]!, /UNRESOLVED/);
  assert.match(issues[0]!, /az\.gov \(State of Arizona\), a parent/);

  const withEvidence = variant({
    ...parent,
    other: [{ kind: "STATE_LISTING", publisher: "Arizona", url: "https://example.az.gov/cities", quote: "Flagstaff — www.flagstaff.az.gov", sha256: HEX, readAt: "2026-09-24T18:00:00Z" }],
  });
  assert.deepEqual(websiteCorrectionIssues(withEvidence), []);
});

test("C15: a source naming a different government is a conflict no other evidence outweighs", () => {
  const conflict = variant({
    homepage: { ...COTTONWOOD.homepage!, selfName: "Town of Clarkdale" },
    other: [{ kind: "COUNTY_PAGE", publisher: "Yavapai County", url: "https://example.gov/x", quote: "cottonwoodaz.gov", sha256: HEX, readAt: "2026-09-24T18:00:00Z" }],
  });
  const issues = websiteCorrectionIssues(conflict);
  assert.ok(issues.some((i) => /names "Town of Clarkdale"/.test(i)));
  assert.equal(applicableWebsiteCorrections([conflict]).size, 0, "a conflicted correction is never applied");

  const registryConflict = variant({ registry: { ...COTTONWOOD.registry!, organization: "Yavapai County" } });
  assert.ok(websiteCorrectionIssues(registryConflict).some((i) => /for "Yavapai County"/.test(i)));
});

test("C15: a recorded redirect alone is not another government's publication", () => {
  const notGov = variant({
    corrected: "https://www.example.org",
    registry: null,
    homepage: { ...COTTONWOOD.homepage!, url: "https://www.example.org/" },
    other: [{ kind: "RECORDED_HOST_REDIRECT", publisher: "City of Cottonwood", url: "http://old.example", quote: "301", sha256: HEX, readAt: "2026-09-24T18:00:00Z" }],
  });
  assert.match(websiteCorrectionIssues(notGov)[0]!, /UNRESOLVED — the site is not \.gov/);
});

test("C15: a correction applies only while the address on record is still the one it replaces", () => {
  assert.equal(websiteCorrectionFor(COTTONWOOD.jurisdictionId, "http://www.ci.cottonwood.az.us")?.corrected, "https://cottonwoodaz.gov");
  assert.equal(websiteCorrectionFor(COTTONWOOD.jurisdictionId, "https://ci.cottonwood.az.us/")?.corrected, "https://cottonwoodaz.gov", "scheme, www and a trailing slash aside");
  assert.equal(websiteCorrectionFor(COTTONWOOD.jurisdictionId, "https://cottonwoodaz.gov"), null, "a record that has since changed is left alone");
  assert.equal(websiteCorrectionFor(COTTONWOOD.jurisdictionId, null), null);
  assert.equal(websiteCorrectionFor("az:city:city-of-tucson", "http://www.tucsonaz.gov"), null);
});

test("C15: the CISA registry row is read by exact domain, quoted fields included", () => {
  const csv = [
    "Domain name,Domain type,Organization name,Suborganization name,City,State,Security contact email",
    "cottonwoodaz.gov.example,City,Wrong,,X,AZ,",
    "cottonwoodaz.gov,City,\"City of Cottonwood\",,Cottonwood,AZ,",
    "holbrookaz.gov,City,\"Holbrook, City of\",,Holbrook,AZ,",
  ].join("\n");
  assert.deepEqual(registryRowFor(csv, "cottonwoodaz.gov"), { domainType: "City", organization: "City of Cottonwood", city: "Cottonwood", state: "AZ" });
  assert.equal(registryRowFor(csv, "holbrookaz.gov")?.organization, "Holbrook, City of");
  assert.equal(registryRowFor(csv, "nowhere.gov"), null);
  assert.equal(registryRowFor("no,header\n", "cottonwoodaz.gov"), null);
});

/* ---- the promotion's reading of the sources again ---- */

const REGISTRY_CSV = [
  "Domain name,Domain type,Organization name,Suborganization name,City,State,Security contact email",
  "cottonwoodaz.gov,City,City of Cottonwood,,Cottonwood,AZ,",
].join("\n");
const HOMEPAGE = "<html><head><title>Cottonwood, AZ | Official Website</title></head><body><footer>City of Cottonwood 827 N. Main St</footer></body></html>";

function runtime(pages: Readonly<Record<string, { status: number; body: string } | "TIMEOUT">>) {
  const requested: string[] = [];
  const get: ResearchGet = async ({ url }) => {
    requested.push(url);
    const page = pages[url] ?? (url.endsWith("/robots.txt") ? { status: 200, body: "User-agent: *\nAllow: /\n" } : { status: 404, body: "" });
    if (page === "TIMEOUT") return { status: null, body: new Uint8Array(0), contentType: "", location: null, transportError: "timed out" };
    return { status: page.status, body: new TextEncoder().encode(page.body), contentType: "text/html", location: null, transportError: null };
  };
  let clock = Date.parse("2026-09-25T01:00:00Z");
  return { requested, runtime: { get, memory: memoryInProcess(), now: () => (clock += 1000), sleep: async () => undefined } };
}

test("C15: every source agreeing applies the correction, each page receipted, robots.txt first", async () => {
  const { requested, runtime: rt } = runtime({
    [DOTGOV_REGISTRY_URL]: { status: 200, body: REGISTRY_CSV },
    "https://cottonwoodaz.gov/": { status: 200, body: HOMEPAGE },
  });
  const { receipts, outcomes } = await acquireWebsiteCorrections([COTTONWOOD], rt);
  assert.equal(outcomes[0]?.disposition, "APPLIED_VERIFIED");
  assert.deepEqual(receipts.map((r) => r.sourceId), ["website-correction:dotgov-registry", "website-correction:az:city:city-of-cottonwood:homepage"]);
  assert.equal(receipts[1]?.rawHash, createHash("sha256").update(HOMEPAGE).digest("hex"));
  for (const receipt of receipts) assert.equal(websiteCorrectionReceiptIssue(receipt), null);
  assert.equal(requested[0], "https://raw.githubusercontent.com/robots.txt");
  assert.equal(requested[2], "https://cottonwoodaz.gov/robots.txt");
});

test("C15: an outage keeps the reviewed evidence, and says which source was not read", async () => {
  const { runtime: rt } = runtime({
    [DOTGOV_REGISTRY_URL]: { status: 200, body: REGISTRY_CSV },
    "https://cottonwoodaz.gov/": "TIMEOUT",
  });
  const [outcome] = (await acquireWebsiteCorrections([COTTONWOOD], rt)).outcomes;
  assert.equal(outcome?.disposition, "APPLIED_ON_REVIEWED_EVIDENCE");
  assert.match(outcome!.detail, /timed out/);

  const challenged = runtime({
    [DOTGOV_REGISTRY_URL]: { status: 200, body: REGISTRY_CSV },
    "https://cottonwoodaz.gov/": { status: 200, body: "<html><title>Just a moment...</title></html>" },
  });
  const challengedOutcome = (await acquireWebsiteCorrections([COTTONWOOD], challenged.runtime)).outcomes[0];
  assert.equal(challengedOutcome?.disposition, "APPLIED_ON_REVIEWED_EVIDENCE");
  assert.match(challengedOutcome!.detail, /an access control answered in place of the page \(a bot challenge/);

  /* A 403 to this client is an access control: not a reading, never pushed past, and never a contradiction. */
  const forbidden = runtime({
    [DOTGOV_REGISTRY_URL]: { status: 200, body: REGISTRY_CSV },
    "https://cottonwoodaz.gov/": { status: 403, body: "<html><title>Forbidden</title></html>" },
  });
  const forbiddenOutcome = (await acquireWebsiteCorrections([COTTONWOOD], forbidden.runtime)).outcomes[0];
  assert.equal(forbiddenOutcome?.disposition, "APPLIED_ON_REVIEWED_EVIDENCE");
  assert.match(forbiddenOutcome!.detail, /HTTP 403: the host forbids this client/);
  assert.equal(forbidden.requested.filter((u) => u === "https://cottonwoodaz.gov/").length, 1, "the forbidden page is asked once, never re-sent");
});

test("C15: a public page read over a robots.txt that disallows it is a reading (owner decision 2026-09-25), robots.txt still read first", async () => {
  const overRobots = runtime({
    "https://cottonwoodaz.gov/robots.txt": { status: 200, body: "User-agent: *\nDisallow: /\n" },
    [DOTGOV_REGISTRY_URL]: { status: 200, body: REGISTRY_CSV },
    "https://cottonwoodaz.gov/": { status: 200, body: HOMEPAGE },
  });
  const read = await acquireWebsiteCorrections([COTTONWOOD], overRobots.runtime);
  assert.equal(read.outcomes[0]?.disposition, "APPLIED_VERIFIED", "robots.txt alone never keeps a source from being read again");
  assert.ok(overRobots.requested.includes("https://cottonwoodaz.gov/"), "the public page is requested");
  assert.ok(
    overRobots.requested.indexOf("https://cottonwoodaz.gov/robots.txt") < overRobots.requested.indexOf("https://cottonwoodaz.gov/"),
    "robots.txt is read first",
  );
  assert.deepEqual(read.receipts.map((r) => r.sourceId), ["website-correction:dotgov-registry", "website-correction:az:city:city-of-cottonwood:homepage"]);

  /* A robots.txt that could not be read is recorded as unread and the page is read all the same. */
  const unreadable = runtime({
    "https://cottonwoodaz.gov/robots.txt": "TIMEOUT",
    [DOTGOV_REGISTRY_URL]: { status: 200, body: REGISTRY_CSV },
    "https://cottonwoodaz.gov/": { status: 200, body: HOMEPAGE },
  });
  assert.equal((await acquireWebsiteCorrections([COTTONWOOD], unreadable.runtime)).outcomes[0]?.disposition, "APPLIED_VERIFIED");
});

test("C15: a source that now contradicts the review, or was withdrawn, refuses the correction", async () => {
  const renamed = runtime({
    [DOTGOV_REGISTRY_URL]: { status: 200, body: REGISTRY_CSV.replace("City of Cottonwood,,", "Yavapai County,,") },
    "https://cottonwoodaz.gov/": { status: 200, body: HOMEPAGE },
  });
  const [a] = (await acquireWebsiteCorrections([COTTONWOOD], renamed.runtime)).outcomes;
  assert.equal(a?.disposition, "REFUSED");
  assert.match(a!.detail, /now lists cottonwoodaz\.gov for "Yavapai County"/);

  const otherName = runtime({
    [DOTGOV_REGISTRY_URL]: { status: 200, body: REGISTRY_CSV },
    "https://cottonwoodaz.gov/": { status: 200, body: "<html><body>Welcome to a domain for sale</body></html>" },
  });
  assert.match((await acquireWebsiteCorrections([COTTONWOOD], otherName.runtime)).outcomes[0]!.detail, /no longer names City of Cottonwood/);

  const gone = runtime({
    [DOTGOV_REGISTRY_URL]: { status: 200, body: REGISTRY_CSV },
    "https://cottonwoodaz.gov/": { status: 410, body: "" },
  });
  assert.equal((await acquireWebsiteCorrections([COTTONWOOD], gone.runtime)).outcomes[0]?.disposition, "REFUSED");
});

test("C15: a receipt must be a page the reviewed list names, on its own host", () => {
  const receipt = {
    sourceId: "website-correction:az:city:city-of-cottonwood:homepage",
    requestedUrl: "https://cottonwoodaz.gov/",
    finalUrl: "https://cottonwoodaz.gov/",
    httpStatus: 200,
    retrievedAt: "2026-09-25T01:00:00Z",
    rawHash: HEX,
    byteCount: 10,
  };
  assert.equal(websiteCorrectionReceiptIssue(receipt), null);
  assert.match(websiteCorrectionReceiptIssue({ ...receipt, sourceId: "website-correction:az:city:city-of-tucson:homepage" })!, /UNKNOWN/);
  assert.match(websiteCorrectionReceiptIssue({ ...receipt, requestedUrl: "https://example.gov/" })!, /REQUEST_MISMATCH/);
  assert.match(websiteCorrectionReceiptIssue({ ...receipt, finalUrl: "https://parked.example/" })!, /FINAL_AUTHORITY_MISMATCH/);
  assert.match(websiteCorrectionReceiptIssue({ ...receipt, rawHash: `sha256-${HEX}` })!, /RAW_HASH_INVALID/);
});

test("C15: a corrected row carries the reviewed correction exactly", () => {
  const note = websiteCorrectionNote(COTTONWOOD, "APPLIED_VERIFIED");
  assert.equal(note.basis, "HOMEPAGE_AND_REGISTRY");
  const row = { id: COTTONWOOD.jurisdictionId, ownWebAddress: COTTONWOOD.corrected, ownWebAddressCorrection: note };
  assert.equal(websiteCorrectionRowIssue(row), null);
  assert.match(websiteCorrectionRowIssue({ ...row, ownWebAddress: "https://elsewhere.gov" })!, /under a APPLIED_VERIFIED correction/);
  assert.equal(websiteCorrectionRowIssue({ ...row, ownWebAddress: COTTONWOOD.recorded, ownWebAddressCorrection: websiteCorrectionNote(COTTONWOOD, "REFUSED", "x") }), null);
  assert.match(websiteCorrectionRowIssue({ ...row, id: "az:city:city-of-tucson" })!, /does not hold/);
  assert.match(websiteCorrectionRowIssue({ ...row, ownWebAddressCorrection: { ...note, reviewedBy: "someone else" } })!, /does not match/);
});

test("C15: a need walks the corrected site while the address on record is still the one the correction replaces", () => {
  const need: MeetingsDiscoveryNeed = {
    jurisdictionId: COTTONWOOD.jurisdictionId,
    stateCode: "AZ",
    name: "CITY OF COTTONWOOD",
    govClass: "CITY_OR_TOWN",
    ownWebAddress: COTTONWOOD.recorded,
    basis: "SOURCE_DISCOVERY_OWED",
    sources: ["MEETINGS:THIS_JURISDICTION:this-government-itself"],
  };
  const corrected = withWebsiteCorrection(need);
  assert.equal(corrected.ownWebAddress, "https://cottonwoodaz.gov");
  assert.equal(corrected.addressCorrection?.recorded, COTTONWOOD.recorded);
  assert.equal(corrected.addressCorrection?.reading, "REVIEWED");
  assert.deepEqual(withWebsiteCorrection({ ...need, ownWebAddress: "https://cottonwoodaz.gov" }), { ...need, ownWebAddress: "https://cottonwoodaz.gov" });
});

test("C15 with CH-21: a mission's discovery need carries the reviewed correction, as the retired gap ledger did", () => {
  const reg = {
    stateCode: "AZ",
    sourceCatalog: { "MEETINGS:THIS_JURISDICTION:this-government-itself": { recordClass: "MEETINGS", state: "DISCOVERY_OWED" } },
    jurisdictions: [{ id: COTTONWOOD.jurisdictionId, stateCode: "AZ", name: "CITY OF COTTONWOOD", govClass: "CITY_OR_TOWN",
      ownWebAddress: COTTONWOOD.recorded, sourceIds: ["MEETINGS:THIS_JURISDICTION:this-government-itself"] }],
  } as unknown as JurisdictionRegistry;
  const read = missionMeetingsDiscoveryNeeds({ jurisdictionIds: [COTTONWOOD.jurisdictionId], registryFor: () => reg, bodyIdFor: () => null, heldRoutes: new Set() });
  assert.equal(read.entries.length, 1);
  assert.equal(read.entries[0]!.need.ownWebAddress, COTTONWOOD.corrected, "the mission walks the corrected site");
  assert.equal(read.entries[0]!.need.addressCorrection?.recorded, COTTONWOOD.recorded);
});

/**
 * Sean's words: "Domain ownership alone does not prove which board a calendar belongs to." The website correction
 * says which site is the government's; it never attributes a calendar to a body. Nothing on the C16 path may read it.
 */
test("C15: the website correction never feeds meetings body attribution (C16)", () => {
  const c16 = [
    "lib/civic-data/derived-authority.ts",
    "lib/control-plane/discovery/derived-wiring.ts",
    ...readdirSync(join(process.cwd(), "lib/civic-data")).filter((f) => /crosswalk|derived-wiring/.test(f)).map((f) => `lib/civic-data/${f}`),
  ];
  for (const file of c16) {
    const text = readFileSync(join(process.cwd(), file), "utf8");
    assert.doesNotMatch(text, /website-corrections|website-correction-acquisition/, `${file} reads the website correction`);
  }
});
