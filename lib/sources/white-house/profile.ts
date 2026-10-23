import type { Officeholder, PortraitCandidate, SocialAccount } from "../../officials/types.ts";
import type { Provenance } from "../types.ts";
import { isOfficialSource } from "../../civic-data/source-authority.ts";
import { decodeEntities } from "../http.ts";
import { statewidePageText } from "../statewide/parse.ts";
import { pickPortraits } from "../../hunt/portrait-pick.ts";

export interface ExecutiveProfilePage { readonly url: string; readonly html: string; readonly retrievedAt: string }
export interface ExecutiveProfileText { readonly text: string; readonly sourceUrl: string; readonly collectedAt: string }
export interface ExecutiveProfileResult {
  readonly patch: Partial<Officeholder>;
  readonly biography?: ExecutiveProfileText;
  readonly termEndDescription?: ExecutiveProfileText;
  readonly priorOffices: readonly ExecutiveProfileText[];
  readonly gaps: readonly string[];
}
const normalized = (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const nameKey = (text: string) => normalized(text).replaceAll(" ", "");
const attribute = (tag: string, name: string): string | null => {
  const value = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return value ? decodeEntities(value[1] ?? value[2] ?? value[3]) : null;
};
const sourceOf = (page: ExecutiveProfilePage, quote: string, sourceOrg: string): Provenance => ({ sourceUrl: page.url, sourceOrg, collectedAt: page.retrievedAt, verifiedAt: page.retrievedAt, quote });
const textOf = (page: ExecutiveProfilePage, text: string): ExecutiveProfileText => ({ text, sourceUrl: page.url, collectedAt: page.retrievedAt });
const mainOf = (html: string) => /<main\b[^>]*>([\s\S]*?)<\/main\s*>/i.exec(html)?.[1] ?? html;
const safeUrl = (raw: string, base: string): string | null => { try { const url = new URL(raw, base); return url.protocol === "https:" ? url.href : null; } catch { return null; } };
const linksIn = (html: string, base: string) => [...html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a\s*>/gi)].flatMap(match => {
  const raw = attribute(match[0].slice(0, match[0].indexOf(">") + 1), "href");
  if (!raw) return [];
  return [{ raw, url: safeUrl(raw, base), label: statewidePageText(match[1]) }];
});

/** A Cabinet roster is many profiles on one page. Never read a sibling member's fields. */
export function executiveProfileSection(person: Pick<Officeholder, "name" | "officeTitle">, page: ExecutiveProfilePage): string {
  if (!isOfficialSource(page.url) || new URL(page.url).protocol !== "https:") throw new Error("EXECUTIVE_PROFILE_OFFICIAL_PAGE_REQUIRED");
  const main = mainOf(page.html);
  const headings = [...main.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi)];
  const exact = headings.filter(heading => nameKey(statewidePageText(heading[2])) === nameKey(person.name));
  if (exact.length !== 1) {
    // Department biographies sometimes prefix the office to the person's name.
    const title = normalized(person.officeTitle), name = normalized(person.name);
    const titled = headings.filter(heading => {
      const text = normalized(statewidePageText(heading[2]));
      return text === `${title} ${name}` || text === `${name} ${title}`;
    });
    if (titled.length !== 1) throw new Error("EXECUTIVE_PROFILE_PERSON_HEADING_MISMATCH");
    return main.slice(titled[0].index!);
  }
  const heading = exact[0], level = Number(heading[1]);
  const end = headings.find(other => other.index! > heading.index! && Number(other[1]) <= level)?.index ?? main.length;
  const scoped = main.slice(heading.index!, end);
  if (!normalized(statewidePageText(scoped)).includes(normalized(person.officeTitle).replace(/^united states /, ""))) throw new Error("EXECUTIVE_PROFILE_OFFICE_MISMATCH");
  return scoped;
}

const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const datePattern = `(?:${monthNames.join("|")})\\s+\\d{1,2},?\\s+\\d{4}`;
function isoDate(text: string): string | undefined {
  const match = new RegExp(`(${monthNames.join("|")})\\s+(\\d{1,2}),?\\s+(\\d{4})`, "i").exec(text);
  if (!match) return undefined;
  const month = monthNames.findIndex(name => name.toLowerCase() === match[1].toLowerCase()) + 1;
  const value = `${match[3]}-${String(month).padStart(2, "0")}-${match[2].padStart(2, "0")}`;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : undefined;
}
/** Abbreviations and initials stay inside their own source sentence. */
function profileSentences(text: string): string[] {
  return text.replace(/\b(?:Mr|Mrs|Ms|Dr|St|U\.S|[A-Z])\./g, value => value.replaceAll(".", "\u2060"))
    .split(/(?<=[.!?])\s+|;\s*/).map(value => value.replaceAll("\u2060", "."));
}
function currentOfficeOath(person: Pick<Officeholder, "name" | "officeTitle">, text: string, requireName = false): { date: string; quote: string } | null {
  const title = normalized(person.officeTitle).replace(/^(?:united states|u s) /, "");
  for (const sentence of profileSentences(text)) {
    const event = /\b(?:sworn[- ]in|took office|assumed (?:the )?office|began (?:his|her|their) (?:service|term))\b/i.exec(sentence);
    if (!event || /\b(?:previously|formerly|prior to)\b/i.test(sentence.slice(0, event.index))) continue;
    if (requireName && !nameKey(sentence).includes(nameKey(person.name))) continue;
    const normalizedSentence = normalized(sentence), roleAt = normalizedSentence.indexOf(title);
    if (roleAt < 0 || roleAt > 0 && /(?:deputy|acting|assistant|under|former)\s*$/.test(normalizedSentence.slice(0, roleAt))) continue;
    const after = new RegExp(datePattern, "gi"), dates = [...sentence.slice(event.index).matchAll(after)];
    const before = [...sentence.slice(0, event.index).matchAll(new RegExp(datePattern, "gi"))];
    const raw = dates.length === 1 ? dates[0][0] : dates.length === 0 && before.length === 1 ? before[0][0] : undefined;
    const date = raw ? isoDate(raw) : undefined;
    if (date) return { date, quote: sentence.trim() };
  }
  return null;
}

const socialPlatforms: Readonly<Record<string, string>> = { "x.com": "twitter", "twitter.com": "twitter", "facebook.com": "facebook", "instagram.com": "instagram", "youtube.com": "youtube", "linkedin.com": "linkedin", "bsky.app": "bluesky", "truthsocial.com": "truthsocial" };

/** Extract only fields the named official's own current profile actually publishes. */
export function parseExecutiveProfile(input: { readonly person: Pick<Officeholder, "name" | "officeTitle">; readonly page: ExecutiveProfilePage; readonly sourceOrg?: string }): ExecutiveProfileResult {
  const { person, page } = input, sourceOrg = input.sourceOrg ?? new URL(page.url).hostname;
  const section = executiveProfileSection(person, page), text = statewidePageText(section);
  const patch: Partial<Officeholder> = { websiteUrl: page.url }, fields: Record<string, Provenance> = { websiteUrl: sourceOf(page, person.name, sourceOrg) };
  const allParagraphs = [...section.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi)].map(match => statewidePageText(match[1])).filter(value => value && !/^Learn more about|^Sign up|^Subscribe|^By checking/i.test(value));
  const paragraphs = allParagraphs.filter(value => value.length >= 70);
  const biography = paragraphs.length ? textOf(page, paragraphs.join("\n\n")) : undefined;
  const priorOffices = paragraphs.filter(value => /\b(?:served|elected|represented|former|previously|prior to)\b/i.test(value) && /\b(?:Senat(?:or|e)|Congress(?:man|woman)?|Governor|Representative|Secretary|Attorney General|Director|Commissioner|White House|District Attorney|public service|National Guard|Marine Corps|Army|Air Force)\b/i.test(value)).map(value => textOf(page, value));
  if (biography) fields.biography = sourceOf(page, biography.text, sourceOrg);
  const images = [...section.matchAll(/<img\b[^>]*>/gi)].flatMap(match => {
    const raw = attribute(match[0], "data-src") ?? attribute(match[0], "src");
    const src = raw ? safeUrl(raw, page.url) : null;
    return src ? [{ src, alt: attribute(match[0], "alt") ?? "" }] : [];
  });
  const portrait = pickPortraits(person.name, images)[0];
  if (portrait) {
    const candidate: PortraitCandidate = { imageUrl: portrait.src, sourceUrl: page.url, collectedAt: page.retrievedAt, attribution: sourceOrg };
    patch.portraitCandidate = candidate;
    fields.portraitCandidate = sourceOf(page, portrait.alt || portrait.src, sourceOrg);
  }
  // Party text must describe this person, rather than another politician or a past affiliation.
  for (const paragraph of allParagraphs) {
    const party = /\b(?:is (?:a |an )?|serves as (?:a |an )?)(Republican|Democrat(?:ic)?|Independent)(?:\s+(?:Party\s+)?(?:member|Senator|Representative|Governor))?\b/i.exec(paragraph)
      ?? /\b(?:nominee|nomination) for the (Republican|Democrat(?:ic)?|Independent) Party\b/i.exec(paragraph);
    const before = party ? paragraph.slice(0, party.index) : "";
    const subject = before.trim().split(/\s+/).slice(-Math.max(1, person.name.split(/\s+/).length)).join(" ");
    const directSubject = [person.name, person.name.split(" ").at(-1)!, "he", "she", "they"].some(name => nameKey(subject).endsWith(nameKey(name)));
    const vpNominee = /^Vice President/.test(person.officeTitle) && /Vice-Presidential Nominee/i.test(paragraph) && new RegExp(`extended\\s+${person.name.split(" ")[0]}\\s`, "i").test(paragraph);
    if (party && (directSubject || vpNominee) && !/\b(?:former|formerly|lifelong|used to|previously)\b/i.test(paragraph.slice(0, party.index + party[0].length))) {
      patch.partyLabel = /^democrat/i.test(party[1]) ? "Democratic" : party[1][0].toUpperCase() + party[1].slice(1).toLowerCase();
      fields.partyLabel = sourceOf(page, paragraph, sourceOrg); break;
    }
  }
  for (const paragraph of allParagraphs) {
    const oath = currentOfficeOath(person, paragraph);
    if (oath) { patch.termStart = oath.date; fields.termStart = sourceOf(page, oath.quote, sourceOrg); break; }
  }
  const end = new RegExp(`\\b(?:term (?:ends|expires)|serves until)\\s+(?:on\\s+)?(${datePattern})`, "i").exec(text);
  if (end) { const date = isoDate(end[1]); if (date) { patch.termEnd = date; fields.termEnd = sourceOf(page, end[0], sourceOrg); } }
  const indefinite = /[^.!?]*\b(?:serves? at the pleasure of (?:the )?President|no fixed term|no fixed (?:term )?end date)[^.!?]*[.!?]?/i.exec(text)?.[0].trim();
  const termEndDescription = indefinite ? textOf(page, indefinite) : undefined;
  if (termEndDescription) fields.termEndDescription = sourceOf(page, indefinite!, sourceOrg);
  const social: SocialAccount[] = [];
  for (const link of linksIn(section, page.url)) {
    if (link.raw.startsWith("tel:") && !patch.phone) { patch.phone = link.raw.slice(4); fields.phone = sourceOf(page, link.label || link.raw, sourceOrg); }
    if (link.raw.startsWith("mailto:") && !patch.email) { patch.email = link.raw.slice(7).split("?")[0]; fields.email = sourceOf(page, link.label || link.raw, sourceOrg); }
    if (!link.url) continue;
    if (/^(?:contact(?: us| the secretary| the white house)?|write (?:to )?(?:us|the secretary|the white house))$/i.test(link.label) && isOfficialSource(link.url)) { patch.contactFormUrl = link.url; fields.contactFormUrl = sourceOf(page, link.label, sourceOrg); }
    const url = new URL(link.url), platform = socialPlatforms[url.hostname.replace(/^www\./, "")];
    if (!platform || /\/(?:intent|share|sharer|sharing|search)(?:[/.?]|$)/i.test(url.pathname)) continue;
    if (!social.some(row => row.url === url.href)) social.push({ platform, url: url.href, accountKind: "OFFICIAL", sourceUrl: page.url, collectedAt: page.retrievedAt });
  }
  if (social.length) { patch.social = social; fields.social = sourceOf(page, social.map(row => row.url).join(" "), sourceOrg); }
  patch.fieldSources = fields;
  const gaps = [!biography && "biography", !portrait && "portrait", !patch.partyLabel && "party", !patch.termStart && "took-office", !patch.termEnd && !termEndDescription && "term-end", !patch.contactFormUrl && !patch.phone && !patch.email && "contact", !social.length && "official-social"].filter((value): value is string => Boolean(value));
  return { patch, biography, termEndDescription, priorOffices, gaps };
}

/** Discover a profile by a full source name on an official directory; title links stay leads. */
export function executiveProfileLinks(person: Pick<Officeholder, "name"> & Partial<Pick<Officeholder, "officeTitle">>, page: ExecutiveProfilePage): string[] {
  if (!isOfficialSource(page.url)) throw new Error("EXECUTIVE_DIRECTORY_OFFICIAL_PAGE_REQUIRED");
  const labels = [person.name, ...(person.officeTitle ? [`${person.name} ${person.officeTitle}`, `${person.officeTitle} ${person.name}`] : [])].map(nameKey);
  return [...new Set(linksIn(mainOf(page.html), page.url).filter(link => link.url && isOfficialSource(link.url) && labels.includes(nameKey(link.label))).map(link => link.url!))];
}

/** The Senate's own current Vice President row can supplement the White House profile's party. */
export function parseVicePresidentDirectory(person: Pick<Officeholder, "name">, page: ExecutiveProfilePage): { readonly patch: Partial<Officeholder>; readonly serviceStartYear: number } {
  if (new URL(page.url).hostname !== "www.senate.gov" || !isOfficialSource(page.url)) throw new Error("VICE_PRESIDENT_SENATE_DIRECTORY_REQUIRED");
  const rows = [...page.html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)].map(match => [...match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td\s*>/gi)].map(cell => statewidePageText(cell[1])));
  const matches = rows.filter(row => row.length >= 4 && nameKey(row[0]) === nameKey(person.name) && /\bpresent\b/i.test(row[3]));
  if (matches.length !== 1 || !/^(?:Republican|Democratic|Independent)$/.test(matches[0][1])) throw new Error("VICE_PRESIDENT_CURRENT_SENATE_ROW_UNRESOLVED");
  const row = matches[0], year = /\b(\d{4})\b/.exec(row[3]);
  if (!year) throw new Error("VICE_PRESIDENT_SENATE_TERM_YEAR_UNRESOLVED");
  return { patch: { partyLabel: row[1], fieldSources: { partyLabel: sourceOf(page, row.join(" "), "United States Senate") } }, serviceStartYear: Number(year[1]) };
}

export const EXECUTIVE_TERM_SOURCES = {
  inauguration: "https://www.inaugural.senate.gov/60th-inaugural-ceremonies/",
  schedule: "https://www.usa.gov/inauguration",
  amendment: "https://constitution.congress.gov/constitution/amendment-20/",
  election: "https://www.archives.gov/electoral-college/2024",
} as const;

/** The ceremony identifies who took office and on what date. The next official
 * inauguration date and the Twentieth Amendment establish the scheduled term end. */
export function parseExecutiveTerm(input: {
  readonly person: Pick<Officeholder, "name" | "officeTitle">;
  readonly inauguration: ExecutiveProfilePage;
  readonly schedule: ExecutiveProfilePage;
  readonly amendment: ExecutiveProfilePage;
}): Partial<Officeholder> {
  const { person, inauguration, schedule, amendment } = input;
  if (!/^https:\/\/www\.inaugural\.senate\.gov\//.test(inauguration.url) || !/^https:\/\/www\.usa\.gov\//.test(schedule.url) || !/^https:\/\/constitution\.congress\.gov\//.test(amendment.url)) throw new Error("EXECUTIVE_TERM_OFFICIAL_SOURCES_REQUIRED");
  const role = /^Vice President(?: of the United States)?$/.test(person.officeTitle) ? "Vice President" : /^President(?: of the United States)?$/.test(person.officeTitle) ? "President" : null;
  if (!role) throw new Error("EXECUTIVE_FIXED_TERM_OFFICE_REQUIRED");
  const ceremony = statewidePageText(inauguration.html);
  const escapedName = person.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replaceAll(" ", "\\s+");
  const ceremonyEntry = new RegExp(`${role}\\s+${escapedName}\\s+(${datePattern})`, "i").exec(ceremony);
  const date = ceremonyEntry?.[1];
  if (!date || !/sworn.in/i.test(ceremony) || !nameKey(ceremony).includes(nameKey(`${person.name} was sworn`))) throw new Error("EXECUTIVE_INAUGURATION_PERSON_DATE_UNRESOLVED");
  const termStart = isoDate(date);
  const next = new RegExp(`The next presidential inauguration is scheduled to be on (${datePattern})`, "i").exec(statewidePageText(mainOf(schedule.html)));
  const termEnd = next ? isoDate(next[1]) : undefined;
  const constitutional = /The terms of the President and the Vice President shall end at noon on the 20th day of January[^.]*\./i.exec(statewidePageText(mainOf(amendment.html)))?.[0];
  if (!termStart || !termEnd || !constitutional || !termStart.endsWith("-01-20") || !termEnd.endsWith("-01-20") || Number(termEnd.slice(0, 4)) !== Number(termStart.slice(0, 4)) + 4) throw new Error("EXECUTIVE_TERM_CALENDAR_UNRESOLVED");
  return { termStart, termEnd, fieldSources: {
    termStart: sourceOf(inauguration, ceremonyEntry![0], "Joint Congressional Committee on Inaugural Ceremonies"),
    termEnd: sourceOf(schedule, next![0], "USAGov"),
    termEndConstitution: sourceOf(amendment, constitutional, "Constitution Annotated, United States Congress"),
  } };
}

/** The National Archives records the ticket's filed party next to its named
 * President and Vice President. No party is inferred from who appointed someone. */
export function parseExecutiveElectionParty(person: Pick<Officeholder, "name" | "officeTitle">, page: ExecutiveProfilePage): Partial<Officeholder> {
  const sourceUrl = new URL(page.url);
  if (sourceUrl.hostname !== "www.archives.gov" || !/^\/electoral-college\/\d{4}\/?$/.test(sourceUrl.pathname)) throw new Error("EXECUTIVE_PARTY_ELECTION_SOURCE_REQUIRED");
  const text = statewidePageText(page.html), role = /^Vice President/.test(person.officeTitle) ? "Vice President" : /^President/.test(person.officeTitle) ? "President" : null;
  if (!role) throw new Error("EXECUTIVE_PARTY_ELECTED_OFFICE_REQUIRED");
  const labels = [...text.matchAll(/\b(Vice President|President)\s+([^\[\]]{1,90})\s+\[([RDI])\]/g)];
  const match = labels.find(row => row[1] === role && nameKey(row[2]) === nameKey(person.name));
  if (!match) throw new Error("EXECUTIVE_PARTY_ELECTION_PERSON_UNRESOLVED");
  return { partyLabel: ({ R: "Republican", D: "Democratic", I: "Independent" })[match[3]], fieldSources: { partyLabel: sourceOf(page, match[0], "National Archives") } };
}

/** Directory routes describe offices. Current holder URLs are discovered from
 * these pages and checked against the White House's current named holder. */
const officeDirectories: Readonly<Record<string, readonly string[]>> = {
  "Secretary of the Treasury": ["https://home.treasury.gov/about/general-information/officials", "https://home.treasury.gov/"],
  "Attorney General": ["https://www.justice.gov/ag", "https://www.justice.gov/"],
  "Secretary of the Interior": ["https://www.doi.gov/interior-leadership", "https://www.doi.gov/"],
  "Director of National Intelligence": ["https://www.odni.gov/leadership/", "https://www.odni.gov/"],
  "Secretary of Veterans Affairs": ["https://www.va.gov/opa/bios/", "https://department.va.gov/"],
  "Secretary of Transportation": ["https://www.transportation.gov/mission/meet-key-officials", "https://www.transportation.gov/"],
  "United States Trade Representative": ["https://ustr.gov/about-us/biographies-key-officials", "https://ustr.gov/"],
  "Secretary of War": ["https://www.war.gov/About/Leadership/", "https://www.war.gov/"],
  "Secretary of Defense": ["https://www.defense.gov/About/Leadership/", "https://www.defense.gov/"],
  "Secretary of Health and Human Services": ["https://www.hhs.gov/about/leadership/index.html", "https://www.hhs.gov/"],
  "Administrator of the Small Business Administration": ["https://www.sba.gov/about-sba/organization/sba-leadership/", "https://www.sba.gov/"],
  "Secretary of Commerce": ["https://www.commerce.gov/about/leadership", "https://www.commerce.gov/"],
  "Secretary of Education": ["https://www.ed.gov/about/ed-overview/leadership", "https://www.ed.gov/"],
  "Secretary of Homeland Security": ["https://www.dhs.gov/leadership", "https://www.dhs.gov/"],
  "Director of the Central Intelligence Agency": ["https://www.cia.gov/about/director-of-cia/", "https://www.cia.gov/"],
  "Secretary of Agriculture": ["https://www.usda.gov/about-usda/general-information/leadership-usda", "https://www.usda.gov/"],
  "Secretary of State": ["https://www.state.gov/secretary/", "https://www.state.gov/"],
  "Secretary of Labor": ["https://www.dol.gov/agencies/osec", "https://www.dol.gov/"],
  "Secretary of Housing and Urban Development": ["https://www.hud.gov/about/leadership", "https://www.hud.gov/"],
  "Director of the Office of Management and Budget": ["https://www.whitehouse.gov/omb/"],
  "Secretary of Energy": ["https://www.energy.gov/leadership-organization", "https://www.energy.gov/"],
  "Administrator of the Environmental Protection Agency": ["https://www.epa.gov/aboutepa/epa-administrator", "https://www.epa.gov/"],
};
export function executiveOfficeSources(officeTitle: string): readonly string[] {
  if (/^(?:Vice )?President(?: of the United States)?$/.test(officeTitle)) return ["https://www.whitehouse.gov/administration/", "https://www.whitehouse.gov/contact/"];
  return officeDirectories[officeTitle] ?? [];
}

/** Site navigation can change a directory route without requiring holder-specific code. */
export function executiveDirectoryLinks(page: ExecutiveProfilePage): string[] {
  if (!isOfficialSource(page.url)) throw new Error("EXECUTIVE_DIRECTORY_OFFICIAL_PAGE_REQUIRED");
  return [...new Set(linksIn(page.html, page.url).filter(link => link.url && isOfficialSource(link.url) && /^(?:meet (?:the )?(?:secretary|director|administrator)|(?:interior |department )?leadership(?: (?:at |and |& )?[a-z]+)*|(?:view all )?leadership\s*(?:&|and)?\s*(?:organization|offices)?|(?:key |senior )?officials|(?:office of (?:the )?)?(?:secretary|director|administrator)|(?:about )?(?:us|the department|the agency))$/i.test(link.label)).map(link => link.url!))];
}
export function executiveContactLinks(page: ExecutiveProfilePage): string[] {
  if (!isOfficialSource(page.url)) throw new Error("EXECUTIVE_DIRECTORY_OFFICIAL_PAGE_REQUIRED");
  return [...new Set(linksIn(page.html, page.url).filter(link => link.url && isOfficialSource(link.url) && /^(?:contact(?: us| the (?:white house|secretary|department|agency))?|write (?:to )?(?:us|the (?:white house|secretary)))$/i.test(link.label)).map(link => link.url!))];
}

export const INAUGURATION_INDEX_URL = "https://www.inaugural.senate.gov/past-inaugural-ceremonies/";
/** Discover ceremonies newest first. Each candidate must still pass the named
 * person's own ceremony check; a future event never proves a person took office. */
export function inaugurationLinks(page: ExecutiveProfilePage): string[] {
  if (new URL(page.url).hostname !== "www.inaugural.senate.gov") throw new Error("EXECUTIVE_INAUGURATION_SENATE_INDEX_REQUIRED");
  const ceremonies = linksIn(page.html, page.url).flatMap(link => {
    if (!link.url) return [];
    const ceremonyUrl = new URL(link.url);
    const number = /^\/(\d+)(?:st|nd|rd|th)-inaugural-ceremonies\/$/.exec(ceremonyUrl.pathname)?.[1];
    return ceremonyUrl.hostname === "www.inaugural.senate.gov" && number ? [{ url: link.url, number: Number(number) }] : [];
  });
  return [...new Set(ceremonies.sort((a, b) => b.number - a.number).map(ceremony => ceremony.url))];
}

export interface ExecutiveOfficeSocial extends SocialAccount {
  readonly label: string;
  readonly scope: "OFFICE" | "DEPARTMENT" | "WHITE_HOUSE";
}
export interface ExecutiveOfficeChannels {
  readonly patch: Partial<Officeholder>;
  readonly sharedSocial: readonly ExecutiveOfficeSocial[];
}
const officialRoot = (url: string) => new URL(url).hostname.split(".").slice(-2).join(".");
/** A department's shared contact channels remain labelled as the department's,
 * rather than being represented as the secretary's personal accounts. */
export function parseExecutiveOfficeChannels(input: {
  readonly person: Pick<Officeholder, "name" | "officeTitle">;
  readonly profileUrl: string;
  readonly page: ExecutiveProfilePage;
  readonly departmentName?: string;
}): ExecutiveOfficeChannels {
  const { person, page, profileUrl } = input;
  if (!isOfficialSource(page.url) || !isOfficialSource(profileUrl) || officialRoot(page.url) !== officialRoot(profileUrl)) throw new Error("EXECUTIVE_CONTACT_OWN_AGENCY_REQUIRED");
  const whiteHouse = officialRoot(page.url) === "whitehouse.gov";
  const elected = /^(?:Vice )?President(?: of the United States)?$/.test(person.officeTitle);
  const main = mainOf(page.html), text = statewidePageText(main);
  const label = whiteHouse ? "The White House" : input.departmentName;
  if (!label || !whiteHouse && !normalized(text).includes(normalized(label).replace(/^u s /, ""))) throw new Error("EXECUTIVE_CONTACT_DEPARTMENT_UNRESOLVED");
  const fields: Record<string, Provenance> = {}, patch: Partial<Officeholder> = {};
  const role = /^Vice President/.test(person.officeTitle) ? "Vice President" : "President";
  const options = [...main.matchAll(/<option\b[^>]*>([\s\S]*?)<\/option\s*>/gi)].map(match => statewidePageText(match[1]));
  if (whiteHouse && elected && options.includes(`Contact the ${role}`)) {
    patch.contactFormUrl = page.url;
    fields.contactFormUrl = sourceOf(page, `Contact the ${role}`, label);
  } else if (!whiteHouse && /<h[1-3]\b[^>]*>\s*(?:<[^>]+>\s*)*Contact(?: Us)?\s*(?:<\/[^>]+>\s*)*<\/h[1-3]>/i.test(main)) {
    patch.contactFormUrl = page.url;
    fields.contactFormUrl = sourceOf(page, "Contact", label);
  }
  const info = /<h[1-6]\b[^>]*>\s*General Information\s*<\/h[1-6]>([\s\S]*?)(?=<h[1-6]\b|$)/i.exec(main)?.[1];
  const phone = info ? /(?:Telephone|Phone):\s*(\(?\d{3}\)?[\s.-]+\d{3}[\s.-]+\d{4})/i.exec(statewidePageText(info)) : null;
  if (phone) { patch.phone = phone[1]; fields.phone = sourceOf(page, phone[0], label); }
  const address = [...main.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi)].map(match => statewidePageText(match[1])).find(value => /\b\d{2,5}\s+(?:[A-Za-z.,]+\s+){0,7}(?:Avenue|Street|Road|Boulevard)\b/i.test(value) && /\bWashington\b/.test(value));
  if (address && (!whiteHouse || role === "President")) {
    patch.offices = [{ name: label, address, sourceUrl: page.url, collectedAt: page.retrievedAt }];
    fields.offices = sourceOf(page, address, label);
  }
  const sharedSocial: ExecutiveOfficeSocial[] = [], ownSocial: SocialAccount[] = [];
  const footer = /<footer\b[^>]*>([\s\S]*?)<\/footer\s*>/i.exec(page.html)?.[1] ?? "";
  const footerAccounts = new Set(linksIn(footer, page.url).map(link => link.url));
  for (const link of linksIn(page.html, page.url)) {
    if (!link.url) continue;
    const url = new URL(link.url), platform = socialPlatforms[url.hostname.replace(/^www\./, "")];
    // A profile link has one account path; posts, videos and sharing tools are not accounts.
    if (!platform || !/^\/@?[A-Za-z0-9_.-]+\/?$/.test(url.pathname) || /\/(?:share|sharer|intent|watch|search|reels?|videos?)\/?$/i.test(url.pathname) || /(?:archive|\d{2}$)/i.test(url.pathname.replace(/\/$/, ""))) continue;
    const handle = url.pathname.replace(/^\/@?|\/$/g, "").toLowerCase();
    const direct = whiteHouse && elected && (role === "President" ? handle === "potus" : handle === "vp");
    const account = { platform, url: url.href, accountKind: "OFFICIAL" as const, sourceUrl: page.url, collectedAt: page.retrievedAt };
    if (direct) { if (!ownSocial.some(row => row.url === url.href)) ownSocial.push(account); }
    else if (footerAccounts.has(url.href) && !sharedSocial.some(row => row.url === url.href)) sharedSocial.push({ ...account, label: `${label} on ${platform === "twitter" ? "X" : platform}`, scope: whiteHouse ? "WHITE_HOUSE" : "DEPARTMENT" });
  }
  if (ownSocial.length) { patch.social = ownSocial; fields.social = sourceOf(page, ownSocial.map(row => row.url).join(" "), label); }
  patch.fieldSources = fields;
  return { patch, sharedSocial };
}

export const CABINET_TENURE_SOURCE_URL = "https://www.govinfo.gov/content/pkg/GOVMAN-1998-06-02/html/GOVMAN-1998-06-02-Pg89.htm";
/** The Government Manual describes Cabinet tenure as service at the President's
 * pleasure. That institutional rule supplies a description, never an end date. */
export function parseCabinetTenure(person: Pick<Officeholder, "officeTitle">, page: ExecutiveProfilePage): ExecutiveProfileText {
  if (!/^https:\/\/www\.govinfo\.gov\/content\/pkg\/GOVMAN-/.test(page.url)) throw new Error("CABINET_TENURE_GOVERNMENT_MANUAL_REQUIRED");
  if (!/^Secretary of |^Attorney General$|^Director of |^Administrator of |^(?:United States |U\.S\. )?Trade Representative$|^(?:White House )?Chief of Staff$/.test(person.officeTitle)) throw new Error("CABINET_TENURE_APPOINTED_OFFICE_REQUIRED");
  const quote = /The Cabinet,[^.]*functions at the pleasure of the President\./i.exec(statewidePageText(page.html))?.[0];
  if (!quote) throw new Error("CABINET_TENURE_RULE_UNRESOLVED");
  return textOf(page, quote);
}


export const EXECUTIVE_INSTITUTIONAL_ACCOUNTS_URL = "https://www.archives.gov/presidential-libraries/presidential-transitions-faqs";
/** NARA explicitly identifies the office-owned institutional account and its
 * transfer to each incoming administration; the current White House membership
 * binds that office's account to its current holder. */
export function parseExecutiveInstitutionalSocial(person: Officeholder, page: ExecutiveProfilePage): Partial<Officeholder> {
  if (page.url !== EXECUTIVE_INSTITUTIONAL_ACCOUNTS_URL) throw new Error("EXECUTIVE_ACCOUNT_NARA_SOURCE_REQUIRED");
  const role = /^(?:Vice )?President(?: of the United States)?$/.test(person.officeTitle) ? person.officeTitle.startsWith("Vice") ? "Vice President" : "President" : null;
  const current = role && person.id.startsWith("white-house:") && person.memberships?.some(membership => membership.current === true && membership.divisionId === "ocd-division/country:us" && (membership.officeTitle ?? person.officeTitle).replace(/ of the United States$/, "") === role);
  if (!current || !person.provenance.sourceUrl || !/^https:\/\/(?:www\.)?whitehouse\.gov\/administration\//.test(person.provenance.sourceUrl)) throw new Error("EXECUTIVE_ACCOUNT_CURRENT_WHITE_HOUSE_OFFICE_REQUIRED");
  const quote = /The institutional accounts on social media[^.]*transfer to the incoming administration\./i.exec(statewidePageText(page.html))?.[0];
  const handle = role === "Vice President" ? "VP" : "POTUS";
  if (!quote || !new RegExp(`@${handle}(?:[,\\s]|$)`).test(quote)) throw new Error("EXECUTIVE_INSTITUTIONAL_ACCOUNT_UNRESOLVED");
  const account: SocialAccount = { platform: "twitter", url: `https://x.com/${handle}`, accountKind: "OFFICIAL", sourceUrl: page.url, collectedAt: page.retrievedAt };
  const held = Array.isArray(person.social) ? person.social as readonly SocialAccount[] : [];
  return { social: [...held.filter(row => row.url !== account.url), account], fieldSources: { social: sourceOf(page, quote, "National Archives") } };
}

/** An oath release is an independent source of a start date, not a biography
 * and not a substitute for the Senate's separate confirmation record. */
export function parseExecutiveOathRelease(person: Pick<Officeholder, "name" | "officeTitle">, page: ExecutiveProfilePage): Partial<Officeholder> {
  if (!isOfficialSource(page.url) || !executiveOfficeSources(person.officeTitle).some(url => officialRoot(url) === officialRoot(page.url))) throw new Error("EXECUTIVE_OATH_OWN_DEPARTMENT_REQUIRED");
  const main = mainOf(page.html), headings = [...main.matchAll(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]\s*>/gi)].map(match => statewidePageText(match[1]));
  if (!headings.some(heading => nameKey(heading).includes(nameKey(person.name)) && /\b(?:sworn[- ]in|swearing[- ]in|takes? (?:the )?oath|took office|takes? office)\b/i.test(heading))) throw new Error("EXECUTIVE_OATH_PERSON_HEADING_REQUIRED");
  for (const paragraph of main.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi)) {
    const oath = currentOfficeOath(person, statewidePageText(paragraph[1]), true);
    if (oath) return { termStart: oath.date, fieldSources: { termStart: sourceOf(page, oath.quote, new URL(page.url).hostname) } };
  }
  throw new Error("EXECUTIVE_OATH_CURRENT_OFFICE_DATE_UNRESOLVED");
}
export function executiveOathLinks(person: Pick<Officeholder, "name" | "officeTitle">, page: ExecutiveProfilePage): string[] {
  if (!isOfficialSource(page.url)) return [];
  const roots = executiveOfficeSources(person.officeTitle).map(officialRoot);
  return [...new Set(linksIn(page.html, page.url).filter(link => link.url && isOfficialSource(link.url) && roots.includes(officialRoot(link.url)) && nameKey(link.label).includes(nameKey(person.name)) && /\b(?:sworn[- ]in|swearing[- ]in|takes? (?:the )?oath|took office|takes? office)\b/i.test(link.label)).map(link => link.url!))];
}
