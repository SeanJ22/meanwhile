/**
 * Shared fixtures for the campaign-site suites: real candidacies from the
 * committed first-seed ballots, real pages from tests/fixtures/campaign-sites
 * (see its provenance.json), and a ResearchRuntime that serves those bytes
 * through the robots-first fetch without touching the network.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { memoryInProcess, type ResearchGet, type ResearchRuntime } from "../../lib/hunt/robots-first-fetch.ts";
import { deriveCandidateUniverse, type BallotDocument, type EnrichmentStores } from "../../lib/hunt/candidate-universe.ts";
import { campaignSiteSubjects, type FilingChannels, type LineupContest } from "../../lib/candidates/campaign-site-subjects.ts";
import type { CampaignSiteSubject } from "../../lib/control-plane/promotion/campaign-site-chain.ts";

const ROOT = process.cwd();
export const FIXTURES = join(ROOT, "tests", "fixtures", "campaign-sites");

export function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

const json = <T>(...parts: string[]): T => JSON.parse(readFileSync(join(ROOT, ...parts), "utf8")) as T;

let cached: Map<string, CampaignSiteSubject> | null = null;

/** Every canonical candidacy the committed AZ, NH and NJ first seeds hold, joined exactly. */
export function committedSubjects(): Map<string, CampaignSiteSubject> {
  if (cached) return cached;
  const stores: EnrichmentStores = { huntState: {}, cards: {}, links: {}, linkHunts: [] };
  const doc = (path: string, ballot: BallotDocument): BallotDocument => ({ path, contests: ballot.contests, candidacies: ballot.candidacies });
  const universe = (stateCode: string, documents: BallotDocument[]) =>
    deriveCandidateUniverse({ stateCode, cycle: 2026, generatedBy: "test", generatedOn: "2026-09-25", documents, stores });
  const contacts = json<{ contacts: Record<string, FilingChannels> }>("data", "states", "nj", "ballot", "nj-morris-2026-contacts.json");
  cached = campaignSiteSubjects({
    universes: [
      universe("AZ", [doc("az", json<BallotDocument>("data", "states", "az", "ballot", "az-pima-2026.json"))]),
      universe("NH", [doc("nh", json<BallotDocument>("data", "states", "nh", "ballot", "nh-merrimack-2026.json"))]),
      universe("NJ", [doc("nj", json<BallotDocument>("data", "states", "nj", "ballot", "nj-morris-2026.json"))]),
    ],
    lineups: json<{ contests: LineupContest[] }>("data", "states", "az", "ballot", "az-general-lineup-2026.json").contests,
    filings: Object.values(contacts.contacts),
  });
  return cached;
}

export const DUARTE = "nj:2026:state-nj-county-morris-place-mendham-township:member-of-the-township-committee:duarte-amalia";
export const KAPNER = "nj:2026:state-nj-county-morris-place-mendham-township:member-of-the-township-committee:kapner-gary";
export const CHIPPERSON = "nj:2026:state-nj-county-morris-place-harding-township:member-of-the-township-committee:chipperson-rita-c";
export const RYZUK = "nj:2026:state-nj-county-morris-place-montville-township:member-of-the-township-committee:ryzuk-emily-k";
export const FRENCH = "nh:2026:state-nh-county-merrimack-place-newbury-town:merrimack-county-commissioner-second-district:french-harold-f";
export const TANG_WILLIAMS = "nh:2026:state-nh-cd-2:representative-in-congress-district-2:tang-williams-lily";
export const MAYES = "az:2026:state-az:attorney-general:mayes-kris";

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
