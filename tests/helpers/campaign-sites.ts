/**
 * Shared fixtures for the campaign-site suites: held candidacies, real pages from
 * tests/fixtures/campaign-sites (see its provenance.json), and a ResearchRuntime
 * that serves those bytes through the robots-first fetch without touching the network.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { memoryInProcess, type ResearchGet, type ResearchRuntime } from "../../lib/hunt/robots-first-fetch.ts";
import type { CampaignSiteSubject } from "../../lib/control-plane/promotion/campaign-site-chain.ts";

const ROOT = process.cwd();
export const FIXTURES = join(ROOT, "tests", "fixtures", "campaign-sites");

export function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export const DUARTE = "nj:2026:state-nj-county-morris-place-mendham-township:member-of-the-township-committee:duarte-amalia";
export const KAPNER = "nj:2026:state-nj-county-morris-place-mendham-township:member-of-the-township-committee:kapner-gary";
export const CHIPPERSON = "nj:2026:state-nj-county-morris-place-harding-township:member-of-the-township-committee:chipperson-rita-c";
export const RYZUK = "nj:2026:state-nj-county-morris-place-montville-township:member-of-the-township-committee:ryzuk-emily-k";
export const FRENCH = "nh:2026:state-nh-county-merrimack-place-newbury-town:merrimack-county-commissioner-second-district:french-harold-f";
export const TANG_WILLIAMS = "nh:2026:state-nh-cd-2:representative-in-congress-district-2:tang-williams-lily";
export const MAYES = "az:2026:state-az:attorney-general:mayes-kris";

const HELD_SUBJECTS: readonly CampaignSiteSubject[] = [
  {candidacyId: "nj:2026:state-nj-county-morris-place-mendham-township:member-of-the-township-committee:duarte-amalia", givenName: "Amalia", familyName: "DUARTE", officeTitle: "Member of the Township Committee", ocdId: "ocd-division/country:us/state:nj/county:morris/place:mendham_township", stateCode: "NJ", cycle: 2026, readerKeys: ["ballot-nj-morris:mendham-township-member-of-the-township-committee-place-mendham-township:duarte-amalia"], filingDomains: []},
  {candidacyId: "nj:2026:state-nj-county-morris-place-mendham-township:member-of-the-township-committee:kapner-gary", givenName: "Gary", familyName: "KAPNER", officeTitle: "Member of the Township Committee", ocdId: "ocd-division/country:us/state:nj/county:morris/place:mendham_township", stateCode: "NJ", cycle: 2026, readerKeys: ["ballot-nj-morris:mendham-township-member-of-the-township-committee-place-mendham-township:kapner-gary"], filingDomains: ["garykapner.com"]},
  {candidacyId: "nj:2026:state-nj-county-morris-place-harding-township:member-of-the-township-committee:chipperson-rita-c", givenName: "Rita C.", familyName: "CHIPPERSON", officeTitle: "Member of the Township Committee", ocdId: "ocd-division/country:us/state:nj/county:morris/place:harding_township", stateCode: "NJ", cycle: 2026, readerKeys: ["ballot-nj-morris:harding-township-member-of-the-township-committee-place-harding-township:chipperson-rita-c"], filingDomains: ["chippersonlaw.com"]},
  {candidacyId: "nj:2026:state-nj-county-morris-place-montville-township:member-of-the-township-committee:ryzuk-emily-k", givenName: "Emily K.", familyName: "RYZUK", officeTitle: "Member of the Township Committee", ocdId: "ocd-division/country:us/state:nj/county:morris/place:montville_township", stateCode: "NJ", cycle: 2026, readerKeys: ["ballot-nj-morris:montville-township-member-of-the-township-committee-place-montville-township:ryzuk-emily-k"], filingDomains: []},
  {candidacyId: "nh:2026:state-nh-county-merrimack-place-newbury-town:merrimack-county-commissioner-second-district:french-harold-f", givenName: "Harold F.", familyName: "French", officeTitle: "Merrimack County Commissioner, Second District", ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town", stateCode: "NH", cycle: 2026, readerKeys: ["ballot-nh-merrimack:county-commissioner-2:french-harold-f-"], filingDomains: []},
  {candidacyId: "nh:2026:state-nh-cd-2:representative-in-congress-district-2:tang-williams-lily", givenName: "Lily", familyName: "Tang Williams", officeTitle: "Representative in Congress, District 2", ocdId: "ocd-division/country:us/state:nh/cd:2", stateCode: "NH", cycle: 2026, readerKeys: ["ballot-nh-merrimack:us-house-2:tang-williams-lily"], filingDomains: []},
  {candidacyId: "az:2026:state-az:attorney-general:mayes-kris", givenName: "Kris", familyName: "Mayes", officeTitle: "Attorney General", ocdId: "ocd-division/country:us/state:az", stateCode: "AZ", cycle: 2026, readerKeys: ["ballot-az-pima:attorney-general:mayes-kris", "ballot-az-pima:attorney-general|Kris Mayes"], filingDomains: []},
];

/** Unrelated candidacies, so a pass over the universe has more than the named subjects to walk. */
const OTHER_SUBJECTS: readonly CampaignSiteSubject[] = Array.from({ length: 20 }, (_, n) => ({
  candidacyId: `xx:2026:state-xx:example-office:example-${n}`,
  givenName: `Given${n}`,
  familyName: `Family${n}`,
  officeTitle: "Example Office",
  ocdId: "ocd-division/country:us/state:xx",
  stateCode: "XX",
  cycle: 2026,
  readerKeys: [`ballot-xx:example-office:example-${n}`],
  filingDomains: [],
}));

let cached: Map<string, CampaignSiteSubject> | null = null;

/** Every held candidacy, keyed by its canonical id. */
export function committedSubjects(): Map<string, CampaignSiteSubject> {
  cached ??= new Map([...HELD_SUBJECTS, ...OTHER_SUBJECTS].map((subject) => [subject.candidacyId, subject]));
  return cached;
}

export function subject(id: string): CampaignSiteSubject {
  const found = committedSubjects().get(id);
  if (!found) throw new Error(`fixture candidacy ${id} is not in the committed universe`);
  return found;
}

export interface ServedPage {
  readonly status: number;
  readonly body: string;
  readonly contentType?: string;
  readonly location?: string;
}

/** A robots-first runtime over served bytes. Every request is logged; an unserved URL is a transport failure. */
export function servedRuntime(pages: Readonly<Record<string, ServedPage>>, startAt = "2026-09-25T21:00:00.000Z"): ResearchRuntime & { readonly requests: string[] } {
  const requests: string[] = [];
  let clock = Date.parse(startAt);
  const get: ResearchGet = async ({ url }) => {
    requests.push(url);
    const page = pages[url];
    if (page === undefined) return { status: null, body: new Uint8Array(0), contentType: "", location: null, transportError: `not served: ${url}` };
    return { status: page.status, body: new TextEncoder().encode(page.body), contentType: page.contentType ?? (url.endsWith("robots.txt") ? "text/plain" : "text/html; charset=utf-8"), location: page.location ?? null, transportError: null };
  };
  return { get, memory: memoryInProcess(), now: () => (clock += 1_000), sleep: async (ms) => { clock += ms; }, spacingMs: 0, requests };
}
