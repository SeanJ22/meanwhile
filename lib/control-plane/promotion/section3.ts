import { DEFAULT_SOURCE_POLICY, hostSourceKind, type SourceKind, type SourcePolicy } from "./source-kinds.ts";
export type { SourceKind, SourcePolicy } from "./source-kinds.ts";
import { personNameField, personRecordBlocks } from "../workers/record-block.ts";
import { isOfficialSource, type GovernmentWebsiteDelegation, type OfficialLinkingPage } from "../../civic-data/source-authority.ts";

export interface Section3Page {
  readonly url: string;
  readonly text: string;
  readonly retrievedAt: string;
  /** An official page that links this one, when this one is not `.gov`. */
  readonly linkingPage?: OfficialLinkingPage | null;
  readonly websiteDelegation?: GovernmentWebsiteDelegation | null;
  /** The current Admin settings, supplied by the publisher, never by the model. */
  readonly sourcePolicy?: SourcePolicy;
  /** Canonical candidate identity from the work item; the page must name all three. */
  readonly campaign?: { readonly name: string; readonly office: string; readonly cycle: string };
  /** Intact saved documents linked by this page, for re-proving an unknown publisher's values. */
  readonly citations?: readonly Section3Page[];
}

/** The minimum facts that put a record live; every other field attaches on its own. */
export const SECTION3_MINIMUMS: Readonly<Record<string, readonly string[]>> = {
  OFFICIAL_ROSTER: ["name", "office"],
  OFFICIAL_BOARD_DIRECTORY: ["bodyName", "bodyClass"],
  MEETING: ["bodyName", "date", "time"],
  CANDIDATE_FILING_DOCUMENT: ["jurisdictionName", "office", "candidateName"],
  CAMPAIGN_FINANCE_FILING: ["candidateName|committeeName", "amount|receipts|expenditures|cashOnHand", "filingPeriod", "documentUrl"],
  CAMPAIGN_FINANCE_DOCUMENT: ["candidateName|committeeName", "documentUrl"],
  VOTE: ["person", "subject", "position", "date"],
  STANCE: ["personId", "quote", "date"],
  BALLOT_MEASURE: ["election", "number|title", "textUrl"],
  VOTER_ACCESS_ROUTE: ["kind", "url"],
  PUBLIC_COMMENT_RULE: ["commentPeriod"],
  SERVICE_CONTACT: ["service"],
  /** The official candidate list is the saved page itself. */
  BALLOT_CONTEST: ["election", "office"],
};

export const SECTION3_LABEL_FIELDS: readonly string[] = ["bodyClass", "coverage", "kind", "contactKind", "topicId", "commentPeriod", "state", "sourceKind"];

/** Judgment calls: the only fields that need a second, independent source. */
const SECOND_SOURCE_FIELDS: readonly string[] = ["photoUrl", "portrait"];
/** Judgment calls as whole records: portraits, one person matched across sources. */
const SECOND_SOURCE_RECORD_CLASSES: readonly string[] = ["OFFICIAL_PORTRAIT", "CROSS_SOURCE_IDENTITY"];
/** An AI summary of a stance passes with the quote it summarizes, whose page Sources links. */
const STANCE_SUMMARY_FIELDS: readonly string[] = ["statementSummary", "positionSummary"];

export function needsSecondSource(contract: { readonly recordClass: string; readonly requiredFields?: readonly string[]; readonly portraitBasis?: "OWN_PAGE" | "TWO_SOURCES" }): boolean {
  return (SECOND_SOURCE_RECORD_CLASSES.includes(contract.recordClass) && !(contract.recordClass === "OFFICIAL_PORTRAIT" && contract.portraitBasis === "OWN_PAGE")) ||
    (contract.requiredFields ?? []).some(field => SECOND_SOURCE_FIELDS.includes(field) &&
      !(contract.portraitBasis === "OWN_PAGE" && ["photoUrl", "portrait"].includes(field)));
}

/** A saved official page among `pages` that links `url` — how a non-.gov page earns official standing. */
export function linkingPageFrom(url: string, pages: readonly { readonly canonicalUrl: string; readonly text: string; readonly linkingPage?: OfficialLinkingPage | null }[]): OfficialLinkingPage | null {
  for (const page of pages) {
    if (page.canonicalUrl === url) continue;
    const candidate = { url: page.canonicalUrl, html: page.text, ...(page.linkingPage ? { linkingPage: page.linkingPage } : {}) };
    if (isOfficialSource(page.canonicalUrl, page.linkingPage) && isOfficialSource(url, candidate)) return candidate;
  }
  return null;
}

const DAY = 24;
/** How long a capture stays inside its freshness window, by kind of fact. Refresh cadence is separate. */
export const FRESHNESS_WINDOW_HOURS: Readonly<Record<string, number>> = {
  MEETING: 12,
  VOTER_ACCESS_ROUTE: 7 * DAY,
  CANDIDATE_FILING_DOCUMENT: 7 * DAY,
  CAMPAIGN_FINANCE_FILING: 7 * DAY,
  CAMPAIGN_FINANCE_DOCUMENT: 7 * DAY,
  OFFICIAL_ROSTER: 30 * DAY,
  OFFICIAL_BOARD_DIRECTORY: 30 * DAY,
  PUBLIC_COMMENT_RULE: 30 * DAY,
  SERVICE_CONTACT: 30 * DAY,
  BALLOT_CONTEST: 7 * DAY,
};
const DEFAULT_WINDOW_HOURS = 7 * DAY;

const ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };

/** Visible text of a page, for comparing values: tags gone, entities decoded, whitespace collapsed. */
export function pageWords(text: string): string {
  return text
    .replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (whole, name: string) => ENTITIES[name.toLowerCase()] ?? whole)
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

let normalizedPage: { page: WeakRef<Section3Page>; text: string; words: string } | null = null;
function wordsOf(page: Section3Page): string {
  if (normalizedPage?.page.deref() === page && normalizedPage.text === page.text) return normalizedPage.words;
  const words = pageWords(page.text);
  normalizedPage = { page: new WeakRef(page), text: page.text, words };
  return words;
}

/** Code confirms the value is on the page: its visible text, or an attribute such as an href or tel: link. */
export function valueOnPage(value: unknown, text: string, words: string = pageWords(text), pageUrl?: string): boolean {
  if (typeof value === "number" || typeof value === "boolean") return words.includes(String(value));
  if (typeof value !== "string" || !value.trim()) return false;
  const wanted = value.replace(/\s+/g, " ").toLowerCase().trim();
  if (words.includes(wanted) || words.includes(pageWords(value))) return true;
  const raw = text.replace(/&amp;/g, "&");
  if (raw.includes(value) || raw.includes(value.replace(/&/g, "&amp;"))) return true;
  if (/^https?:\/\//i.test(value)) {
    const address = value.toLowerCase().replace(/^https?:\/\/(?:www\.)?/, "").replace(/\/$/, "");
    const printed = address.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\//g, "/\\s*");
    if (new RegExp(`(?<![\\w./:-])(?:www\\.)?${printed}/?(?![\\w/?:#-]|\\.[a-z0-9])`, "i").test(words)) return true;
  }
  if (/^https?:\/\//i.test(value) && pageUrl &&
      (sourceLinkAddress(value, pageUrl) === sourceLinkAddress(pageUrl) || pageLinksTo({ url: pageUrl, text }, value))) return true;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 11 && /^[\d\s().+-]+$/.test(value) && (raw.replace(/\D/g, " ").includes(digits) || raw.includes(`tel:${digits}`));
}

export interface Section3PageVerdict {
  readonly kind: SourceKind;
  readonly ok: boolean;
  readonly reason: string | null;
}

// The isolated Validator has no URL global; source links resolve against their actual page.
function sourceLinkAddress(value: string, base?: string): string | null {
  let link = value.trim().replace(/&amp;/gi, "&").replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));
  const parent = base ? /^(https?):\/\/([^/?#]+)([^?#]*)([?#].*)?$/i.exec(base) : null;
  if (link.startsWith("//")) link = `${parent?.[1] ?? "https"}:${link}`;
  if (!/^https?:\/\//i.test(link)) {
    if (!parent || /^[a-z][a-z0-9+.-]*:/i.test(link)) return null;
    const path = parent[3] || "/";
    const resolved = link.startsWith("/") ? link : link.startsWith("#") ? `${path}${parent[4]?.split("#")[0] ?? ""}${link}`
      : link.startsWith("?") ? `${path}${link}` : `${path.replace(/[^/]*$/, "")}${link}`;
    link = `${parent[1]}://${parent[2]}${resolved}`;
  }
  const match = /^(https?):\/\/([^/?#]+)([^?#]*)([?#].*)?$/i.exec(link);
  if (!match || /\s|@/.test(match[2])) return null;
  const segments: string[] = [];
  const path = match[3] || "/";
  for (const segment of path.split("/")) {
    if (segment === ".") continue;
    if (segment === "..") { if (segments.length > 1) segments.pop(); continue; }
    segments.push(segment);
  }
  let normalized = segments.join("/") || "/";
  if (/\/(?:\.|\.\.)$/.test(path) && !normalized.endsWith("/")) normalized += "/";
  return `${match[1].toLowerCase()}://${match[2].toLowerCase()}${normalized}${match[4] ?? ""}`;
}

export function pageLinksTo(page: Pick<Section3Page, "url" | "text"> & Partial<Section3Page>, url: string): boolean {
  const target = sourceLinkAddress(url, page.url);
  if (!target) return false;
  for (const match of page.text.matchAll(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const href = sourceLinkAddress(match[1] ?? match[2] ?? match[3], page.url);
    if (href && (target.includes("#") ? href === target : href.split("#")[0] === target)) return true;
  }
  return false;
}

function campaignPageMatches(page: Section3Page): boolean {
  const candidate = page.campaign;
  if (!candidate || !candidate.name.trim() || !candidate.office.trim() || !candidate.cycle.trim()) return false;
  return valueOnPage(candidate.name, page.text) && valueOnPage(candidate.office, page.text) && valueOnPage(candidate.cycle, page.text);
}

/** Label first; only enabled kinds with the required source evidence may publish. */
export function section3Page(page: Section3Page, recordClass: string, now: string): Section3PageVerdict {
  const policy = page.sourcePolicy ?? DEFAULT_SOURCE_POLICY;
  const official = isOfficialSource(page.url, page.linkingPage, page.websiteDelegation);
  const kind: SourceKind = official ? (/FILING/.test(recordClass) ? "FILING" : "OFFICIAL")
    : page.campaign || hostSourceKind(page.url, policy) === "CAMPAIGN" ? "CAMPAIGN" : hostSourceKind(page.url, policy);
  const refuse = (reason: string): Section3PageVerdict => ({ ok: false, kind, reason });
  if (!policy.enabled[kind]) return refuse(`SOURCE_KIND_DISABLED: ${kind}`);
  const age = Date.parse(now) - Date.parse(page.retrievedAt);
  const window = FRESHNESS_WINDOW_HOURS[recordClass] ?? DEFAULT_WINDOW_HOURS;
  if (!Number.isFinite(age) || age < 0) return refuse(`CAPTURE_TIME_INVALID: ${page.retrievedAt}`);
  if (age > window * 3_600_000) return refuse(`OUTSIDE_FRESHNESS_WINDOW: captured ${page.retrievedAt}, window ${window}h`);
  if (kind === "CAMPAIGN" && !campaignPageMatches(page)) return refuse("CAMPAIGN_IDENTITY_UNVERIFIED: the candidate, office and cycle must be on their own page");
  if (kind === "OTHER" && !(page.citations ?? []).some(citation => citation.url !== page.url && pageLinksTo(page, citation.url) &&
    section3Page({ ...citation, sourcePolicy: policy, citations: [] }, recordClass, now).ok)) {
    return refuse("LINKED_SOURCE_UNVERIFIED: no linked, saved source confirms this page");
  }
  return { ok: true, kind, reason: null };
}

export interface Section3RecordVerdict {
  /** Minimum facts all verified: the record goes live. */
  readonly live: boolean;
  /** Fields whose values code found on the page. Only these are published. */
  readonly verifiedFields: readonly string[];
  /** Fields with a value that did not verify, or that need a second source; they stay open as work. */
  readonly openFields: readonly string[];
  readonly reason: string | null;
}

/** `derived` fields pass when their stated `from` field is verified. */
export function section3Record(input: {
  readonly recordClass: string;
  readonly fields: Readonly<Record<string, unknown>>;
  readonly page: Section3Page;
  readonly now: string;
  readonly minimums?: readonly string[];
  readonly derived?: Readonly<Record<string, string>>;
  readonly pageVerdict?: Section3PageVerdict;
}): Section3RecordVerdict {
  const page = input.pageVerdict ?? section3Page(input.page, input.recordClass, input.now);
  const present = Object.entries(input.fields).filter(([, value]) => value !== null && value !== undefined && value !== "").map(([field]) => field);
  if (!page.ok) return { live: false, verifiedFields: [], openFields: present, reason: page.reason };
  if (page.kind === "CAMPAIGN") {
    const name = input.fields.name ?? input.fields.candidateName ?? input.fields.person;
    if (typeof name !== "string" || pageWords(name) !== pageWords(input.page.campaign?.name ?? "")) {
      return { live: false, verifiedFields: [], openFields: present, reason: "CAMPAIGN_OTHER_SUBJECT: campaign sources only establish facts about their own candidate" };
    }
  }
  if (input.recordClass === "MEETING" && /^(scheduled|upcoming)$/i.test(String(input.fields.status ?? ""))) {
    const start = input.fields.startAt ?? input.fields.startsAt ?? input.fields.start ??
      (typeof input.fields.date === "string" ? `${input.fields.date}T${input.fields.time ?? "00:00:00"}` : null);
    const instant = typeof start === "string" ? Date.parse(start) : NaN;
    if (Number.isFinite(instant) && Date.parse(input.now) - instant > 86_400_000) {
      return { live: false, verifiedFields: [], openFields: present, reason: "DATE_IN_PAST: the source still calls this meeting upcoming, but its start is more than a day past" };
    }
  }
  const nameField = personNameField(input.fields, input.recordClass);
  const anchorField = nameField ? input.derived?.[nameField] ?? nameField : null;
  const blocks = anchorField ? personRecordBlocks(input.page.text, String(input.fields[anchorField]), (name, text) => pageWords(text).includes(pageWords(name))) : [];
  // Repeated names are resolved by the record's other minimums, never by
  // pooling contact fields from several rows belonging to different people.
  const minimums = input.minimums ?? SECTION3_MINIMUMS[input.recordClass] ?? [];
  const matching = [...new Map(blocks.filter(block => minimums.every(requirement => requirement.split("|").some(field =>
    SECTION3_LABEL_FIELDS.includes(field) || input.derived?.[field] || valueOnPage(input.fields[field], input.page.text.slice(block.start, block.end), undefined, input.page.url))))
    // CMS pages may repeat the exact same row for desktop and mobile. This
    // is one record twice, not permission to combine differing rows.
    .map(block => [input.page.text.slice(block.start, block.end), block])).values()];
  const recordText = nameField ? (matching.length === 1 ? input.page.text.slice(matching[0].start, matching[0].end) : "") : input.page.text;
  const words = recordText === input.page.text ? wordsOf(input.page) : pageWords(recordText);
  const verified = new Set<string>();
  for (const field of present) {
    if (SECOND_SOURCE_FIELDS.includes(field) || STANCE_SUMMARY_FIELDS.includes(field) || input.derived?.[field]) continue;
    if (SECTION3_LABEL_FIELDS.includes(field)) { verified.add(field); continue; }
    if (valueOnPage(input.fields[field], recordText, words, input.page.url)) verified.add(field);
  }
  for (const [field, from] of Object.entries(input.derived ?? {})) if (present.includes(field) && verified.has(from)) verified.add(field);
  for (const field of STANCE_SUMMARY_FIELDS) if (present.includes(field) && verified.has("quote")) verified.add(field);
  if (page.kind === "OTHER") {
    const citations = (input.page.citations ?? []).filter(citation => citation.url !== input.page.url && pageLinksTo(input.page, citation.url) &&
      section3Page({ ...citation, sourcePolicy: input.page.sourcePolicy, citations: [] }, input.recordClass, input.now).ok);
    // Re-prove the whole record against each linked copy, preserving the same
    // person's block rule instead of pooling a value from somebody else's row.
    const supported = new Set(citations.flatMap(citation => section3Record({ ...input,
      page: { ...citation, sourcePolicy: input.page.sourcePolicy, citations: [] }, pageVerdict: undefined }).verifiedFields));
    for (const field of verified) if (!supported.has(field)) verified.delete(field);
  }
  const missing = minimums.filter(requirement => !requirement.split("|").some(field => verified.has(field)));
  return {
    live: missing.length === 0,
    verifiedFields: [...verified].sort(),
    openFields: present.filter((field) => !verified.has(field)).sort(),
    reason: missing.length ? `MINIMUM_FACTS_UNVERIFIED: ${missing.join(", ")}` : null,
  };
}

/** One contest on a saved official ballot or candidate list: live when its election and office are on the page; each candidate attaches only when named inside the contest's own section. */
export function section3Contest(input: {
  readonly page: Section3Page;
  readonly now: string;
  readonly contest: { readonly election: string; readonly office: string; readonly candidates: readonly string[] };
  /** Every office the same page lists, so one contest's section ends where the next begins. */
  readonly pageOffices?: readonly string[];
}): { readonly live: boolean; readonly verifiedCandidates: readonly string[]; readonly openCandidates: readonly string[]; readonly reason: string | null } {
  const pageVerdict = section3Page(input.page, "BALLOT_CONTEST", input.now);
  const verdict = section3Record({ recordClass: "BALLOT_CONTEST", fields: { election: input.contest.election, office: input.contest.office }, page: input.page, now: input.now, pageVerdict });
  if (!verdict.live) return { live: false, verifiedCandidates: [], openCandidates: [...input.contest.candidates], reason: verdict.reason };
  const words = pageWords(input.page.text);
  const office = pageWords(input.contest.office);
  const others = (input.pageOffices ?? []).map(pageWords).filter(other => other && other !== office && !office.includes(other));
  const sections: string[] = [];
  for (let at = words.indexOf(office); at >= 0; at = words.indexOf(office, at + office.length)) {
    const ends = others.map(other => words.indexOf(other, at + office.length)).filter(end => end >= 0);
    sections.push(words.slice(at, ends.length ? Math.min(...ends) : words.length));
  }
  const inSection = (name: string) => sections.some(section => ` ${section} `.includes(` ${pageWords(name)} `));
  const verifiedCandidates = input.contest.candidates.filter(inSection);
  return { live: true, verifiedCandidates, openCandidates: input.contest.candidates.filter(name => !verifiedCandidates.includes(name)), reason: null };
}
