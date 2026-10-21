import { statewidePageText } from "../statewide/parse.ts";
import type { OfficeholderSet } from "../../officials/types.ts";
import { isOfficialSource } from "../../civic-data/source-authority.ts";
import { createHash } from "node:crypto";
import { acquireKnownRelease, knownReleaseSourceCheck, type KnownReleaseOptions, type KnownRelease } from "../known-release.ts";
import { pacedPortraitAcquire } from "../../photos/portrait-work.ts";
import type { StatePeopleAcquisition } from "../../civic-data/state-people-publication.ts";

export const ADMINISTRATION_URL = "https://www.whitehouse.gov/administration/";
export const WHITE_HOUSE_OFFICES = ["president", "vice-president"] as const;
export type WhiteHouseOffice = typeof WHITE_HOUSE_OFFICES[number];
const titleOf = (office: WhiteHouseOffice) => office === "president" ? "President" : "Vice President";
export function whiteHouseOffice(title: string | null | undefined): WhiteHouseOffice | null {
  return /^President(?: of the United States)?$/i.test(title ?? "") ? "president"
    : /^Vice President(?: of the United States)?$/i.test(title ?? "") ? "vice-president" : null;
}
const own = (value: string) => {
  const url = new URL(value);
  return url.protocol === "https:" && ["whitehouse.gov", "www.whitehouse.gov"].includes(url.hostname) && url.pathname.startsWith("/administration/") && isOfficialSource(url.href);
};

/** Each office follows its own current administration link through a transition. */
export function currentWhiteHouseLink(office: WhiteHouseOffice, html: string, url = ADMINISTRATION_URL): { name: string; url: string } {
  const code = office.replaceAll("-", "_").toUpperCase();
  if (!own(url)) throw new Error(`${code}_SOURCE_NOT_CURRENT_WHITE_HOUSE`);
  const links = new Map<string, { name: string; url: string }>();
  for (const anchor of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a\s*>/gi)) {
    const label = statewidePageText(anchor[2]);
    const name = new RegExp(`^${titleOf(office)}\\s+(.+)$`, "i").exec(label)?.[1]?.trim();
    if (!name) continue;
    const profile = new URL(anchor[1], url);
    if (own(profile.href) && profile.pathname !== "/administration/") links.set(profile.href, { name, url: profile.href });
  }
  if (links.size !== 1) throw new Error(`CURRENT_${code}_PROFILE_UNRESOLVED`);
  return [...links.values()][0];
}
export const currentPresidentLink = (html: string, url = ADMINISTRATION_URL) => currentWhiteHouseLink("president", html, url);

/** Publish only the name, office, and source the captured own page establishes. */
export function verifiedWhiteHouseOfficial(office: WhiteHouseOffice, index: { url: string; html: string; retrievedAt?: string }, page: { url: string; html: string; retrievedAt: string }): OfficeholderSet {
  const code = office.replaceAll("-", "_").toUpperCase();
  const current = currentWhiteHouseLink(office, index.html, index.url);
  if (!own(page.url) || new URL(page.url).href !== current.url) throw new Error(`${code}_PROFILE_NOT_CURRENT`);
  const name = statewidePageText(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i.exec(page.html)?.[1] ?? "");
  if (name !== current.name) throw new Error(`${code}_OWN_PAGE_NAME_MISMATCH`);
  const text = statewidePageText(page.html);
  const officeTitle = `${titleOf(office)} of the United States`;
  const role = [...page.html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi)].map(match => statewidePageText(match[1]))
    .find(value => new RegExp(`^(?:(?:\\d+(?:st|nd|rd|th))(?:\\s*&\\s*\\d+(?:st|nd|rd|th))?\\s+)?${officeTitle}$`, "i").test(value));
  if (!role || !text.includes(`${name} ${role}`)) throw new Error(`${code}_CURRENT_OFFICE_NOT_BOUND`);
  const id = `white-house:${new URL(page.url).pathname.split("/").filter(Boolean).at(-1)}`;
  const root = "ocd-division/country:us", membershipId = `${id}:${office}`;
  const provenance = { sourceUrl: page.url, sourceOrg: "The White House", collectedAt: page.retrievedAt, verifiedAt: page.retrievedAt, quote: `${name} ${role}` };
  const fieldSources: Record<string, typeof provenance> = { name: provenance, officeTitle: provenance };
  let contactFormUrl: string | null = null;
  for (const source of [{ ...page }, { ...index, retrievedAt: index.retrievedAt ?? page.retrievedAt }]) {
    for (const anchor of source.html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a\s*>/gi)) {
      const label = statewidePageText(anchor[2]);
      if (!/^(?:contact(?: us| the white house)?|write (?:to )?(?:us|the white house))$/i.test(label)) continue;
      const contact = new URL(anchor[1], source.url);
      if (contact.protocol !== "https:" || !["whitehouse.gov", "www.whitehouse.gov"].includes(contact.hostname) || !isOfficialSource(contact.href)) continue;
      contactFormUrl = contact.href;
      fieldSources.contactFormUrl = { ...provenance, sourceUrl: source.url, collectedAt: source.retrievedAt, verifiedAt: source.retrievedAt, quote: label };
      break;
    }
    if (contactFormUrl) break;
  }
  return { scope: "US", generatedAt: page.retrievedAt, currentMembershipComplete: true,
    officeholders: [{ id, personId: id, nativeIds: { "white-house": [page.url] }, name, officeTitle, level: "FEDERAL", termStart: "", termEnd: "", birthDate: null,
      partyLabel: null, websiteUrl: page.url, profileUrls: [page.url], contactFormUrl, phone: null, email: null, campaignUrl: null, photo: null,
      memberships: [{ id: membershipId, personId: id, officeId: `${root}:office:${office}`, jurisdiction: "US", divisionId: root, level: "FEDERAL", officeTitle, current: true, sourceUrl: page.url }],
      fieldSources, provenance }],
    divisions: [{ officeholderId: id, ocdId: root, bodyId: null, membershipId }], unmatched: [] };
}
export const verifiedPresident = (index: { url: string; html: string; retrievedAt?: string }, page: { url: string; html: string; retrievedAt: string }) =>
  verifiedWhiteHouseOfficial("president", index, page);


/** The standing source follows the administration index instead of retaining a previous holder's URL. */
export async function acquirePresidentPeople(options: Pick<KnownReleaseOptions, "store" | "locks" | "fetchImpl" | "now"> & {
  readonly signal: AbortSignal;
  readonly acquire?: typeof acquireKnownRelease;
}) {
  const acquire = options.acquire ?? pacedPortraitAcquire;
  const read = (url: string) => acquire({ ...options, sourceId: "statewide-executive-sources", releaseId: `official:${url}`,
    url, parserVersion: "white-house-officials/2", maxBytes: 8 * 1024 * 1024, checkAfterMs: 86_400_000,
    allowedHosts: ["www.whitehouse.gov", "whitehouse.gov"], headers: { accept: "text/html" } });
  const html = (release: KnownRelease) => new TextDecoder("utf-8", { fatal: true }).decode(release.bytes);
  const index = await read(ADMINISTRATION_URL), indexPage = { url: index.finalUrl, html: html(index), retrievedAt: index.retrievedAt };
  const captures = [index], gaps: { sourceUrl: string; detail: string }[] = [];
  // A broken profile for one office cannot suppress the other office's verified facts.
  const offices = await Promise.all(WHITE_HOUSE_OFFICES.map(async office => {
    let sourceUrl = ADMINISTRATION_URL;
    try {
      const current = currentWhiteHouseLink(office, indexPage.html, indexPage.url);
      sourceUrl = current.url;
      const page = await read(current.url);
      captures.push(page);
      return verifiedWhiteHouseOfficial(office, indexPage, { url: page.finalUrl, html: html(page), retrievedAt: page.retrievedAt });
    } catch (error) {
      options.signal.throwIfAborted();
      gaps.push({ sourceUrl, detail: `WHITE_HOUSE_OFFICE_UNAVAILABLE:${office}:${error instanceof Error ? error.message : String(error)}` });
      return null;
    }
  }));
  const verified = offices.filter((roster): roster is OfficeholderSet => roster !== null);
  const roster: OfficeholderSet = { scope: "US", generatedAt: captures.map(page => page.retrievedAt).sort().at(-1)!,
    currentMembershipComplete: verified.length === WHITE_HOUSE_OFFICES.length,
    officeholders: verified.flatMap(roster => roster.officeholders), divisions: verified.flatMap(roster => roster.divisions), unmatched: [] };
  const acquisitions: StatePeopleAcquisition[] = [index,...captures.slice(1).sort((a,b)=>a.finalUrl.localeCompare(b.finalUrl))].map(release => ({ requestedUrl: release.requestedUrl, finalUrl: release.finalUrl,
    httpStatus: release.httpStatus, body: html(release), retrievedAt: release.retrievedAt, rawHash: release.sha256,
    sourceCheck: knownReleaseSourceCheck(release) }));
  return { state: "us", releaseId: createHash("sha256").update(acquisitions.map(row => row.rawHash).join("|")).digest("hex"),
    roster, acquisitions, gaps, coverage: { sourceId: "statewide-executive-sources", jurisdiction: "US", people: roster.officeholders.length,
      offices: WHITE_HOUSE_OFFICES.map(office => ({ office, verified: roster.officeholders.some(person => whiteHouseOffice(person.officeTitle) === office) })) } };
}
