import { statewidePageText } from "../statewide/parse.ts";
import type { Officeholder, OfficeholderSet } from "../../officials/types.ts";
import { whiteHouseOffice, type WhiteHouseOffice } from "../../officials/white-house-offices.ts";
import { isOfficialSource } from "../../civic-data/source-authority.ts";
import { createHash } from "node:crypto";
import { acquireKnownRelease, knownReleaseSourceCheck, type KnownReleaseOptions, type KnownRelease } from "../known-release.ts";
import { pacedPortraitAcquire } from "../../photos/portrait-work.ts";
import type { StatePeopleAcquisition } from "../../civic-data/state-people-publication.ts";

export const ADMINISTRATION_URL = "https://www.whitehouse.gov/administration/";
/** Offices with their own profile page, linked from the administration index as "<title> <name>". */
export const WHITE_HOUSE_PROFILE_OFFICES = ["president", "vice-president"] as const;
export type WhiteHouseProfileOffice = typeof WHITE_HOUSE_PROFILE_OFFICES[number];
type CabinetOffice = `cabinet:${string}`;
type Page = { url: string; html: string; retrievedAt: string; requestedUrl?: string };
type Index = { url: string; html: string; retrievedAt?: string };
const titleOf = (office: WhiteHouseProfileOffice) => office === "president" ? "President" : "Vice President";
const codeOf = (office: string) => office.replace(/[^a-z0-9]+/gi, "_").toUpperCase();
const isCabinet = (office: WhiteHouseOffice): office is CabinetOffice => office.startsWith("cabinet:");
const own = (value: string) => {
  const url = new URL(value);
  return url.protocol === "https:" && ["whitehouse.gov", "www.whitehouse.gov"].includes(url.hostname) && url.pathname.startsWith("/administration/") && isOfficialSource(url.href);
};
const anchors = (html: string) => [...html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a\s*>/gi)].map(match => ({ href: match[1], label: statewidePageText(match[2]) }));
const slug = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** Each office follows its own current administration link through a transition. */
export function currentWhiteHouseLink(office: WhiteHouseProfileOffice, html: string, url = ADMINISTRATION_URL): { name: string; url: string } {
  const code = codeOf(office);
  if (!own(url)) throw new Error(`${code}_SOURCE_NOT_CURRENT_WHITE_HOUSE`);
  const links = new Map<string, { name: string; url: string }>();
  for (const anchor of anchors(html)) {
    const name = new RegExp(`^${titleOf(office)}\\s+(.+)$`, "i").exec(anchor.label)?.[1]?.trim();
    if (!name) continue;
    const profile = new URL(anchor.href, url);
    if (own(profile.href) && profile.pathname !== "/administration/") links.set(profile.href, { name, url: profile.href });
  }
  if (links.size !== 1) throw new Error(`CURRENT_${code}_PROFILE_UNRESOLVED`);
  return [...links.values()][0];
}
export const currentPresidentLink = (html: string, url = ADMINISTRATION_URL) => currentWhiteHouseLink("president", html, url);

/** The administration index's "The Cabinet" links, in page order; the index may link one page by more than one path. */
export function cabinetLinks(html: string, url = ADMINISTRATION_URL): string[] {
  if (!own(url)) throw new Error("CABINET_SOURCE_NOT_CURRENT_WHITE_HOUSE");
  const links = new Set<string>();
  for (const anchor of anchors(html)) {
    if (!/^The Cabinet$/i.test(anchor.label)) continue;
    const page = new URL(anchor.href, url);
    if (own(page.href) && page.pathname !== "/administration/") links.add(page.href);
  }
  if (!links.size) throw new Error("CURRENT_CABINET_PAGE_UNRESOLVED");
  return [...links];
}

export interface CabinetMember { readonly name: string; readonly title: string; readonly office: CabinetOffice }
/** The Cabinet page the index links lists each member as a name heading directly followed by a title heading. */
export function currentCabinet(index: Index, page: Omit<Page, "retrievedAt">): { members: CabinetMember[]; unclassified: { name: string; title: string }[] } {
  const links = cabinetLinks(index.html, index.url);
  const linked = [page.url, page.requestedUrl].some(value => value && links.includes(new URL(value).href));
  if (!own(page.url) || !linked) throw new Error("CABINET_PAGE_NOT_CURRENT");
  const headings = [...page.html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi)];
  const top = headings.findIndex(heading => heading[1] === "1" && /^The Cabinet$/i.test(statewidePageText(heading[2])));
  if (top < 0) throw new Error("CABINET_PAGE_HEADING_MISSING");
  const text = statewidePageText(page.html), members: CabinetMember[] = [], unclassified: { name: string; title: string }[] = [];
  for (let at = top + 1; at < headings.length - 1; at++) {
    const [nameHeading, titleHeading] = [headings[at], headings[at + 1]];
    if (Number(titleHeading[1]) !== Number(nameHeading[1]) + 1) continue;
    if (statewidePageText(page.html.slice(nameHeading.index! + nameHeading[0].length, titleHeading.index!))) continue;
    const name = statewidePageText(nameHeading[2]), title = statewidePageText(titleHeading[2]);
    if (!name || !title || !text.includes(`${name} ${title}`)) continue;
    const office = whiteHouseOffice(title);
    if (office && isCabinet(office)) members.push({ name, title, office });
    else unclassified.push({ name, title });
  }
  if (!members.length) throw new Error("CABINET_MEMBERS_UNRESOLVED");
  return { members, unclassified };
}

type NationalPerson = Pick<Officeholder, "id" | "name" | "officeTitle" | "nativeIds" | "websiteUrl" | "profileUrls" | "contactFormUrl" | "fieldSources">;
function nationalOfficial(office: WhiteHouseOffice, page: Page, person: NationalPerson, quote: string): OfficeholderSet {
  const root = "ocd-division/country:us", membershipId = `${person.id}:${office}`;
  const provenance = { sourceUrl: page.url, sourceOrg: "The White House", collectedAt: page.retrievedAt, verifiedAt: page.retrievedAt, quote };
  return { scope: "US", generatedAt: page.retrievedAt, currentMembershipComplete: true,
    officeholders: [{ ...person, personId: person.id, level: "FEDERAL", termStart: "", termEnd: "", birthDate: null, partyLabel: null, phone: null, email: null, campaignUrl: null, photo: null,
      memberships: [{ id: membershipId, personId: person.id, officeId: `${root}:office:${office}`, jurisdiction: "US", divisionId: root, level: "FEDERAL", officeTitle: person.officeTitle, current: true, sourceUrl: page.url }],
      fieldSources: { name: provenance, officeTitle: provenance, ...person.fieldSources }, provenance }],
    divisions: [{ officeholderId: person.id, ocdId: root, bodyId: null, membershipId }], unmatched: [] };
}

function verifiedProfileOfficial(office: WhiteHouseProfileOffice, index: Index, page: Page): OfficeholderSet {
  const code = codeOf(office);
  const current = currentWhiteHouseLink(office, index.html, index.url);
  if (!own(page.url) || new URL(page.url).href !== current.url) throw new Error(`${code}_PROFILE_NOT_CURRENT`);
  const name = statewidePageText(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i.exec(page.html)?.[1] ?? "");
  if (name !== current.name) throw new Error(`${code}_OWN_PAGE_NAME_MISMATCH`);
  const text = statewidePageText(page.html);
  const officeTitle = `${titleOf(office)} of the United States`;
  const role = [...page.html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi)].map(match => statewidePageText(match[1]))
    .find(value => new RegExp(`^(?:(?:\\d+(?:st|nd|rd|th))(?:\\s*&\\s*\\d+(?:st|nd|rd|th))?\\s+)?${officeTitle}$`, "i").test(value));
  if (!role || !text.includes(`${name} ${role}`)) throw new Error(`${code}_CURRENT_OFFICE_NOT_BOUND`);
  const fieldSources: NonNullable<Officeholder["fieldSources"]> = {};
  let contactFormUrl: string | null = null;
  for (const source of [{ ...page }, { ...index, retrievedAt: index.retrievedAt ?? page.retrievedAt }]) {
    for (const anchor of anchors(source.html)) {
      if (!/^(?:contact(?: us| the white house)?|write (?:to )?(?:us|the white house))$/i.test(anchor.label)) continue;
      const contact = new URL(anchor.href, source.url);
      if (contact.protocol !== "https:" || !["whitehouse.gov", "www.whitehouse.gov"].includes(contact.hostname) || !isOfficialSource(contact.href)) continue;
      contactFormUrl = contact.href;
      Object.assign(fieldSources, { contactFormUrl: { sourceUrl: source.url, sourceOrg: "The White House", collectedAt: source.retrievedAt, verifiedAt: source.retrievedAt, quote: anchor.label } });
      break;
    }
    if (contactFormUrl) break;
  }
  const id = `white-house:${new URL(page.url).pathname.split("/").filter(Boolean).at(-1)}`;
  return nationalOfficial(office, page, { id, name, officeTitle, nativeIds: { "white-house": [page.url] }, websiteUrl: page.url, profileUrls: [page.url], contactFormUrl, fieldSources }, `${name} ${role}`);
}

/** A Cabinet member has no own profile page; the current Cabinet page names them in their office. */
function verifiedCabinetMember(office: CabinetOffice, index: Index, page: Page): OfficeholderSet {
  const held = currentCabinet(index, page).members.filter(member => member.office === office);
  if (held.length !== 1) throw new Error(`${codeOf(office)}_HOLDER_UNRESOLVED`);
  const [{ name, title }] = held;
  return nationalOfficial(office, page, { id: `white-house:${slug(name)}`, name, officeTitle: title, websiteUrl: null, profileUrls: [page.url], contactFormUrl: null }, `${name} ${title}`);
}

/** Publish only the name, office, and source the captured official page establishes. */
export function verifiedWhiteHouseOfficial(office: WhiteHouseOffice, index: Index, page: Page): OfficeholderSet {
  return isCabinet(office) ? verifiedCabinetMember(office, index, page) : verifiedProfileOfficial(office, index, page);
}
export const verifiedPresident = (index: Index, page: Page) => verifiedWhiteHouseOfficial("president", index, page);

/** The standing source follows the administration index instead of retaining a previous holder's URL. */
export async function acquirePresidentPeople(options: Pick<KnownReleaseOptions, "store" | "locks" | "fetchImpl" | "now"> & {
  readonly signal: AbortSignal;
  readonly acquire?: typeof acquireKnownRelease;
}) {
  const acquire = options.acquire ?? pacedPortraitAcquire;
  const read = (url: string) => acquire({ ...options, sourceId: "statewide-executive-sources", releaseId: `official:${url}`,
    url, parserVersion: "white-house-officials/3", maxBytes: 8 * 1024 * 1024, checkAfterMs: 86_400_000,
    allowedHosts: ["www.whitehouse.gov", "whitehouse.gov"], headers: { accept: "text/html" } });
  const html = (release: KnownRelease) => new TextDecoder("utf-8", { fatal: true }).decode(release.bytes);
  const pageOf = (release: KnownRelease): Page => ({ url: release.finalUrl, requestedUrl: release.requestedUrl, html: html(release), retrievedAt: release.retrievedAt });
  const index = await read(ADMINISTRATION_URL), indexPage = pageOf(index);
  const captures = [index], gaps: { sourceUrl: string; detail: string }[] = [];
  const gap = (office: string, sourceUrl: string, error: unknown): null => {
    options.signal.throwIfAborted();
    gaps.push({ sourceUrl, detail: `WHITE_HOUSE_OFFICE_UNAVAILABLE:${office}:${error instanceof Error ? error.message : String(error)}` });
    return null;
  };
  // A broken page for one office cannot suppress another office's verified facts.
  const profiles = WHITE_HOUSE_PROFILE_OFFICES.map(async office => {
    let sourceUrl = ADMINISTRATION_URL;
    try {
      sourceUrl = currentWhiteHouseLink(office, indexPage.html, indexPage.url).url;
      const page = await read(sourceUrl);
      captures.push(page);
      return verifiedWhiteHouseOfficial(office, indexPage, pageOf(page));
    } catch (error) { return gap(office, sourceUrl, error); }
  });
  const cabinetOffices: CabinetOffice[] = [];
  const cabinet = (async (): Promise<(OfficeholderSet | null)[]> => {
    let sourceUrl = ADMINISTRATION_URL, page: Page;
    try {
      sourceUrl = cabinetLinks(indexPage.html, indexPage.url)[0];
      const release = await read(sourceUrl);
      captures.push(release);
      page = pageOf(release);
      const { members, unclassified } = currentCabinet(indexPage, page);
      for (const member of unclassified) gap(`cabinet:${slug(member.title)}`, page.url, new Error(`CABINET_TITLE_UNCLASSIFIED:${member.name}:${member.title}`));
      cabinetOffices.push(...new Set(members.map(member => member.office)));
    } catch (error) { return [gap("cabinet", sourceUrl, error)]; }
    return cabinetOffices.map(office => {
      try { return verifiedWhiteHouseOfficial(office, indexPage, page); } catch (error) { return gap(office, page.url, error); }
    });
  })();
  const offices = [...await Promise.all(profiles), ...await cabinet];
  const verified: OfficeholderSet[] = [], ids = new Set<string>();
  for (const held of offices) {
    if (!held) continue;
    const person = held.officeholders[0];
    // One person named in two offices is a contradiction to investigate, never two people.
    if (ids.has(person.id)) { gap(whiteHouseOffice(person.officeTitle) ?? person.officeTitle, person.provenance.sourceUrl ?? ADMINISTRATION_URL, new Error(`WHITE_HOUSE_PERSON_IN_SEVERAL_OFFICES:${person.id}`)); continue; }
    ids.add(person.id); verified.push(held);
  }
  const roster: OfficeholderSet = { scope: "US", generatedAt: captures.map(page => page.retrievedAt).sort().at(-1)!,
    currentMembershipComplete: gaps.length === 0 && verified.length === offices.length,
    officeholders: verified.flatMap(roster => roster.officeholders), divisions: verified.flatMap(roster => roster.divisions), unmatched: [] };
  const acquisitions: StatePeopleAcquisition[] = [index,...captures.slice(1).sort((a,b)=>a.finalUrl.localeCompare(b.finalUrl))].map(release => ({ requestedUrl: release.requestedUrl, finalUrl: release.finalUrl,
    httpStatus: release.httpStatus, body: html(release), retrievedAt: release.retrievedAt, rawHash: release.sha256,
    sourceCheck: knownReleaseSourceCheck(release) }));
  // Admin lists every office this run owed: both profile offices, then each Cabinet office the page named (or the unread Cabinet).
  const owed: string[] = [...WHITE_HOUSE_PROFILE_OFFICES, ...(cabinetOffices.length ? cabinetOffices : ["cabinet"])];
  return { state: "us", releaseId: createHash("sha256").update(acquisitions.map(row => row.rawHash).join("|")).digest("hex"),
    roster, acquisitions, gaps, coverage: { sourceId: "statewide-executive-sources", jurisdiction: "US", people: roster.officeholders.length,
      offices: owed.map(office => ({ office, verified: roster.officeholders.some(person => whiteHouseOffice(person.officeTitle) === office) })) } };
}
