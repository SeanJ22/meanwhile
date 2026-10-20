import { statewidePageText } from "../statewide/parse.ts";
import type { OfficeholderSet } from "../../officials/types.ts";
import { isOfficialSource } from "../../civic-data/source-authority.ts";
import { createHash } from "node:crypto";
import { acquireKnownRelease, knownReleaseSourceCheck, type KnownReleaseOptions, type KnownRelease } from "../known-release.ts";
import { pacedPortraitAcquire } from "../../photos/portrait-work.ts";
import type { StatePeopleAcquisition } from "../../civic-data/state-people-publication.ts";

export const ADMINISTRATION_URL = "https://www.whitehouse.gov/administration/";
const own = (value: string) => {
  const url = new URL(value);
  return url.protocol === "https:" && ["whitehouse.gov", "www.whitehouse.gov"].includes(url.hostname) && url.pathname.startsWith("/administration/") && isOfficialSource(url.href);
};

/** Follow the administration's own current President link, so a transition changes the acquired profile. */
export function currentPresidentLink(html: string, url = ADMINISTRATION_URL): { name: string; url: string } {
  if (!own(url)) throw new Error("PRESIDENT_SOURCE_NOT_CURRENT_WHITE_HOUSE");
  const links = new Map<string, { name: string; url: string }>();
  for (const anchor of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a\s*>/gi)) {
    const label = statewidePageText(anchor[2]);
    const name = /^President\s+(.+)$/i.exec(label)?.[1]?.trim();
    if (!name) continue;
    const profile = new URL(anchor[1], url);
    if (own(profile.href) && profile.pathname !== "/administration/") links.set(profile.href, { name, url: profile.href });
  }
  if (links.size !== 1) throw new Error("CURRENT_PRESIDENT_PROFILE_UNRESOLVED");
  return [...links.values()][0];
}

/** Publish only the name, office, and source the captured own page establishes. */
export function verifiedPresident(index: { url: string; html: string }, page: { url: string; html: string; retrievedAt: string }): OfficeholderSet {
  const current = currentPresidentLink(index.html, index.url);
  if (!own(page.url) || new URL(page.url).href !== current.url) throw new Error("PRESIDENT_PROFILE_NOT_CURRENT");
  const name = statewidePageText(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i.exec(page.html)?.[1] ?? "");
  if (name !== current.name) throw new Error("PRESIDENT_OWN_PAGE_NAME_MISMATCH");
  const text = statewidePageText(page.html);
  const officeTitle = "President of the United States";
  const role = [...page.html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi)].map(match => statewidePageText(match[1]))
    .find(value => /^(?:(?:\d+(?:st|nd|rd|th))(?:\s*&\s*\d+(?:st|nd|rd|th))?\s+)?President of the United States$/i.test(value));
  if (!role || !text.includes(`${name} ${role}`)) throw new Error("PRESIDENT_CURRENT_OFFICE_NOT_BOUND");
  const id = `white-house:${new URL(page.url).pathname.split("/").filter(Boolean).at(-1)}`;
  const root = "ocd-division/country:us", membershipId = `${id}:president`;
  const provenance = { sourceUrl: page.url, sourceOrg: "The White House", collectedAt: page.retrievedAt, verifiedAt: page.retrievedAt, quote: `${name} ${role}` };
  return { scope: "US", generatedAt: page.retrievedAt, currentMembershipComplete: true,
    officeholders: [{ id, personId: id, nativeIds: { "white-house": [page.url] }, name, officeTitle, level: "FEDERAL", termStart: "", termEnd: "", birthDate: null,
      partyLabel: null, websiteUrl: page.url, profileUrls: [page.url], contactFormUrl: null, phone: null, email: null, campaignUrl: null, photo: null,
      memberships: [{ id: membershipId, personId: id, officeId: `${root}:office:president`, jurisdiction: "US", divisionId: root, level: "FEDERAL", officeTitle, current: true, sourceUrl: page.url }],
      fieldSources: { name: provenance, officeTitle: provenance }, provenance }],
    divisions: [{ officeholderId: id, ocdId: root, bodyId: null, membershipId }], unmatched: [] };
}


/** The standing source follows the administration index instead of retaining a previous holder's URL. */
export async function acquirePresidentPeople(options: Pick<KnownReleaseOptions, "store" | "locks" | "fetchImpl" | "now"> & {
  readonly signal: AbortSignal;
  readonly acquire?: typeof acquireKnownRelease;
}) {
  const acquire = options.acquire ?? pacedPortraitAcquire;
  const read = (url: string) => acquire({ ...options, sourceId: "statewide-executive-sources", releaseId: `official:${url}`,
    url, parserVersion: "white-house-president/1", maxBytes: 8 * 1024 * 1024, checkAfterMs: 86_400_000,
    allowedHosts: ["www.whitehouse.gov", "whitehouse.gov"], headers: { accept: "text/html" } });
  const html = (release: KnownRelease) => new TextDecoder("utf-8", { fatal: true }).decode(release.bytes);
  const index = await read(ADMINISTRATION_URL), current = currentPresidentLink(html(index), index.finalUrl);
  const page = await read(current.url);
  const roster = verifiedPresident({ url: index.finalUrl, html: html(index) }, { url: page.finalUrl, html: html(page), retrievedAt: page.retrievedAt });
  const acquisitions: StatePeopleAcquisition[] = [index, page].map(release => ({ requestedUrl: release.requestedUrl, finalUrl: release.finalUrl,
    httpStatus: release.httpStatus, body: html(release), retrievedAt: release.retrievedAt, rawHash: release.sha256,
    sourceCheck: knownReleaseSourceCheck(release) }));
  return { state: "us", releaseId: createHash("sha256").update(acquisitions.map(row => row.rawHash).join("|")).digest("hex"),
    roster, acquisitions, gaps: [], coverage: { sourceId: "statewide-executive-sources", jurisdiction: "US", people: 1 } };
}
