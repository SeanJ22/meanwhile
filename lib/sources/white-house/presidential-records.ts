import { createHash } from "node:crypto";
import { acquireKnownRelease, knownReleaseSourceCheck, type KnownReleaseOptions } from "../known-release.ts";
import { statewidePageText } from "../statewide/parse.ts";
import { object, rows, string, billIdentity, billPage } from "../congress/normalize.ts";
import { publicFederalUrl } from "../congress/acquire.ts";
import { parseFecPage, fecNumber, readFecPages } from "../../funding/fec-api.ts";
import { fecTotalsForPeriod } from "../../funding/fec-collector.ts";
import type { CommitteeTotals } from "../../funding/types.ts";
import type { Officeholder } from "../../officials/types.ts";
import type { StatePeopleAcquisition } from "../../civic-data/state-people-publication.ts";

export const SENATE_TIE_VOTES_URL = "https://www.senate.gov/legislative/TieVotes.htm";
export interface SourcedExecutiveRecord {
  id: string;
  personId: string;
  kind: "EXECUTIVE_ORDER" | "PROCLAMATION" | "MEMORANDUM" | "BILL_SIGNED" | "VETO" | "TIE_BREAKING_VOTE";
  title: string;
  date: string;
  sourceUrl: string;
  evidenceSourceUrl: string;
  quote: string;
  collectedAt: string;
  checkedAt?: string;
  details: { designation?: string; publicationDate?: string; documentUrl?: string; vote?: "Yea" | "Nay"; result?: string; yeas?: number; nays?: number; billId?: string };
}
export interface PresidentialMoney {
  candidateId: string;
  cycle: number;
  totals: CommitteeTotals;
  sourceUrl: string;
  filingUrl: string | null;
  evidenceSourceUrl?: string;
  quote: string;
  collectedAt: string;
  checkedAt?: string;
}
type Page = { url: string; body: string; retrievedAt: string };
const day = (value: unknown): string => {
  const candidate = string(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate) || !Number.isFinite(Date.parse(candidate))) throw new Error("EXECUTIVE_SOURCE_DATE_INVALID");
  return candidate;
};
const inTerm = (value: string, person: Pick<Officeholder, "termStart" | "termEnd">) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(person.termStart)) throw new Error("EXECUTIVE_TERM_START_REQUIRED");
  return value >= person.termStart && (!/^\d{4}-\d{2}-\d{2}$/.test(person.termEnd) || value < person.termEnd);
};
const official = (value: string, hosts: readonly string[]): URL => {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || !hosts.includes(url.hostname)) throw new Error("EXECUTIVE_SOURCE_HOST_INVALID");
  return url;
};

/** The signer is the API's explicit president filter; subtype and signing date come from each row. */
export function presidentialRegisterRecords(page: Page, person: Officeholder, presidentSlug: string): SourcedExecutiveRecord[] {
  const url = official(page.url, ["www.federalregister.gov"]);
  if (!/^\/api\/v1\/documents(?:\.json)?$/.test(url.pathname) || url.searchParams.get("conditions[president]") !== presidentSlug || !presidentSlug) throw new Error("PRESIDENTIAL_REGISTER_SIGNER_UNBOUND");
  const root = object(JSON.parse(page.body));
  if (!Array.isArray(root.results)) throw new Error("PRESIDENTIAL_REGISTER_RESULTS_INVALID");
  const kinds: Record<string, SourcedExecutiveRecord["kind"]> = { "Executive Order": "EXECUTIVE_ORDER", Proclamation: "PROCLAMATION", Memorandum: "MEMORANDUM", "Presidential Memorandum": "MEMORANDUM" };
  return rows(root.results).flatMap(row => {
    const kind = kinds[string(row.subtype)];
    // Notices and determinations remain source evidence rather than being called memoranda.
    if (!kind) return [];
    const date = day(row.signing_date), publicationDate = day(row.publication_date);
    if (!inTerm(date, person)) return [];
    const id = string(row.document_number), title = string(row.title), sourceUrl = string(row.html_url);
    if (!/^(?:[A-Z]\d+-)?\d{4}-\d+$/.test(id) || !title) throw new Error("PRESIDENTIAL_REGISTER_IDENTITY_INVALID");
    official(sourceUrl, ["www.federalregister.gov"]);
    return [{ id: `federal-register:${id}`, personId: person.id, kind, title, date, sourceUrl, evidenceSourceUrl: page.url, quote: title, collectedAt: page.retrievedAt,
      details: { publicationDate, designation: string(row.executive_order_number ?? row.proclamation_number ?? row.presidential_document_number) || id,
        ...(string(row.pdf_url) ? { documentUrl: string(row.pdf_url) } : {}) } }];
  });
}

/** An enactment is never called a signature unless the action says Signed by President. */
export function presidentialBillRecords(page: Page, person: Officeholder): SourcedExecutiveRecord[] {
  const url = official(page.url, ["api.congress.gov"]);
  const match = /^\/v3\/bill\/(\d+)\/(hr|s|hjres|sjres)\/(\d+)\/actions\/?$/.exec(url.pathname);
  if (!match) throw new Error("PRESIDENTIAL_BILL_IDENTITY_REQUIRED");
  const root = object(JSON.parse(page.body)), request = object(root.request);
  if (!Array.isArray(root.actions) || string(request.congress) !== match[1] || string(request.billType).toLowerCase() !== match[2] || string(request.billNumber) !== match[3]) throw new Error("PRESIDENTIAL_BILL_RESPONSE_MISMATCH");
  const billId = `${match[1]}:${match[2]}:${match[3]}`, found = new Map<string, SourcedExecutiveRecord>();
  for (const action of rows(root.actions)) {
    const text = string(action.text);
    const kind = /^Signed by President\.?$/i.test(text) ? "BILL_SIGNED" : /^(?:Pocket )?Vetoed by President\.?$/i.test(text) ? "VETO" : null;
    if (!kind) continue;
    const date = day(action.actionDate);
    if (!inTerm(date, person)) continue;
    const id = `congress:${billId}:${kind}:${date}`;
    found.set(id, { id, personId: person.id, kind, title: `${match[2].toUpperCase()} ${match[3]}: ${text}`, date,
      sourceUrl: `${billPage(billId)}/all-actions`, evidenceSourceUrl: page.url, quote: text, collectedAt: page.retrievedAt, details: { billId, designation: `${match[2].toUpperCase()} ${match[3]}` } });
  }
  return [...found.values()];
}

/** FEC totals are the filed period, with a native candidate identity and a direct filing link. */
export function presidentialFecMoney(body: string, candidateId: string, cycle: number, collectedAt: string): PresidentialMoney | null {
  if (!/^P\d{8}$/.test(candidateId)) throw new Error("PRESIDENTIAL_FEC_NATIVE_ID_REQUIRED");
  const parsed = parseFecPage(body);
  if (parsed.results.some(row => row.candidate_id !== candidateId)) throw new Error("PRESIDENTIAL_FEC_IDENTITY_MISMATCH");
  const row = fecTotalsForPeriod(parsed.results, candidateId, cycle);
  if (!row || fecNumber(row.receipts) === null || !row.coverage_end_date) return null;
  const itemized = fecNumber(row.individual_itemized_contributions), unitemized = fecNumber(row.individual_unitemized_contributions);
  const total = itemized !== null && unitemized !== null ? itemized + unitemized : null;
  const image = string(row.last_beginning_image_number);
  return { candidateId, cycle, collectedAt, quote: string(row.receipts), sourceUrl: `https://www.fec.gov/data/candidate/${candidateId}/?cycle=${cycle}`,
    filingUrl: /^\d+$/.test(image) ? `https://docquery.fec.gov/cgi-bin/fecimg/?${image}` : null,
    totals: { receipts: fecNumber(row.receipts), disbursements: fecNumber(row.disbursements), cashOnHand: fecNumber(row.last_cash_on_hand_end_period),
      individualItemized: itemized, individualUnitemized: unitemized, smallDonorShare: total !== null && total > 0 ? unitemized! / total : null,
      coverageEndDate: row.coverage_end_date ? day(row.coverage_end_date) : null } };
}

export interface SenateTieLink { title: string; date: string; result: string; url: string }
const normalizedName = (value: string) => value.replace(/[^a-z]/gi, "").toLowerCase();
/** The named Vice President's own section supplies identity and the exact vote record links. */
export function senateTieVoteLinks(page: Page, person: Officeholder): SenateTieLink[] {
  if (official(page.url, ["www.senate.gov"]).pathname !== "/legislative/TieVotes.htm") throw new Error("SENATE_TIE_INDEX_REQUIRED");
  const sections = [...page.body.matchAll(/<section_title\b[^>]*>([\s\S]*?)<\/section_title>/gi)];
  const own = sections.filter(row => normalizedName(statewidePageText(row[1]).split("(")[0]) === normalizedName(person.name));
  if (own.length !== 1) throw new Error("SENATE_TIE_VICE_PRESIDENT_UNBOUND");
  const index = sections.indexOf(own[0]), body = page.body.slice(own[0].index! + own[0][0].length, sections[index + 1]?.index ?? page.body.length);
  const links: SenateTieLink[] = [];
  for (const row of body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<column_([1-4])\b[^>]*>([\s\S]*?)<\/column_\1>/gi)];
    if (cells.length !== 4 || !/<a\b/i.test(cells[2][2])) continue;
    const rawDate = statewidePageText(cells[0][2]);
    const parsed = Date.parse(rawDate);
    if (!Number.isFinite(parsed)) throw new Error("SENATE_TIE_DATE_INVALID");
    const date = new Date(parsed).toISOString().slice(0, 10);
    if (!inTerm(date, person)) continue;
    const href = /href=["']([^"']+)["']/i.exec(cells[2][2])?.[1];
    if (!href) throw new Error("SENATE_TIE_RECORD_MISSING");
    const url = official(new URL(href, page.url).href, ["www.senate.gov"]);
    if (!/^\/legislative\/LIS\/roll_call_votes\/vote\d+\/vote_\d+_\d+_\d+\.htm$/.test(url.pathname)) throw new Error("SENATE_TIE_RECORD_INVALID");
    links.push({ title: statewidePageText(cells[1][2]), date, result: statewidePageText(cells[3][2]), url: url.href.replace(/\.htm$/, ".xml") });
  }
  const declared = /(?:<br\s*\/?>|\))\s*(\d+)\s+votes?/i.exec(own[0][1]);
  if (!declared || Number(declared[1]) !== links.length) throw new Error("SENATE_TIE_INDEX_INCOMPLETE");
  return links;
}
const xml = (body: string, tag: string) => statewidePageText(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i").exec(body)?.[1] ?? "");
export function senateTieVoteRecord(page: Page, person: Officeholder, link: SenateTieLink): SourcedExecutiveRecord {
  const url = official(page.url, ["www.senate.gov"]);
  if (url.href !== link.url) throw new Error("SENATE_TIE_RECORD_NOT_LINKED");
  const match = /vote_(\d+)_(\d+)_(\d+)\.xml$/.exec(url.pathname);
  if (!match || Number(xml(page.body, "congress")) !== Number(match[1]) || Number(xml(page.body, "session")) !== Number(match[2]) || Number(xml(page.body, "vote_number")) !== Number(match[3])) throw new Error("SENATE_TIE_NATIVE_ID_MISMATCH");
  const dateText = xml(page.body, "vote_date"), matchDate = /^([A-Za-z]+\s+\d+,\s+\d{4})/.exec(dateText);
  const date = matchDate ? new Date(Date.parse(matchDate[1])).toISOString().slice(0, 10) : "";
  const vote = xml(page.body, "tie_breaker_vote");
  if (date !== link.date || !inTerm(date, person) || !["Yea", "Nay"].includes(vote) || !/Vice President/i.test(xml(page.body, "by_whom")) || !/^\d+$/.test(xml(page.body, "yeas")) || !/^\d+$/.test(xml(page.body, "nays"))) throw new Error("SENATE_TIE_VOTE_UNVERIFIED");
  return { id: `senate-tie:${match[1]}:${match[2]}:${Number(match[3])}`, personId: person.id, kind: "TIE_BREAKING_VOTE", title: link.title, date,
    sourceUrl: url.href.replace(/\.xml$/, ".htm"), evidenceSourceUrl: page.url, quote: xml(page.body, "vote_result_text"), collectedAt: page.retrievedAt,
    details: { vote: vote as "Yea" | "Nay", result: xml(page.body, "vote_result_text"), yeas: Number(xml(page.body, "yeas")), nays: Number(xml(page.body, "nays")) } };
}

export const SENATE_VETO_INDEX_URL = "https://www.senate.gov/legislative/vetoes/vetoCounts.htm";
export interface SenateVetoAdministration { url: string; total: number }
/** The name and tenure distinguish nonconsecutive presidential administrations. */
export function senateVetoAdministration(page: Page, person: Officeholder): SenateVetoAdministration {
  if (page.url !== SENATE_VETO_INDEX_URL) throw new Error("SENATE_VETO_INDEX_REQUIRED");
  const found: SenateVetoAdministration[] = [];
  for (const row of page.body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)];
    const link = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i.exec(cells[0]?.[1] ?? "");
    if (!link || normalizedName(statewidePageText(link[2])) !== normalizedName(person.name)) continue;
    const term = /\((\d{4})-(\d{4}|present)\)/i.exec(statewidePageText(cells[0][1]));
    if (!term || term[1] !== day(person.termStart).slice(0, 4)) continue;
    const total = Number(statewidePageText(cells[4]?.[1] ?? ""));
    const url = official(new URL(link[1], page.url).href, ["www.senate.gov"]);
    if (!Number.isSafeInteger(total) || total < 0 || !url.pathname.startsWith("/legislative/vetoes/")) throw new Error("SENATE_VETO_TOTAL_INVALID");
    found.push({ url: url.href, total });
  }
  if (found.length !== 1) throw new Error("SENATE_VETO_ADMINISTRATION_UNBOUND");
  return found[0];
}
export function senateVetoBills(page: Page, person: Officeholder, administration: SenateVetoAdministration): { congress: number; type: string; number: string }[] {
  if (page.url !== administration.url) throw new Error("SENATE_VETO_PAGE_NOT_LINKED");
  const heading = statewidePageText(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(page.body)?.[1] ?? "").replace(/^Vetoes by President\s+/i, "");
  if (normalizedName(heading) !== normalizedName(person.name)) throw new Error("SENATE_VETO_PRESIDENT_UNBOUND");
  const types: Record<string, string> = { "house-bill": "hr", "senate-bill": "s", "house-joint-resolution": "hjres", "senate-joint-resolution": "sjres" };
  const bills = new Map<string, { congress: number; type: string; number: string }>();
  for (const anchor of page.body.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)) {
    const link = new URL(anchor[1], page.url);
    if (!["www.congress.gov", "congress.gov"].includes(link.hostname)) continue;
    const match = /^\/bill\/(\d+)th-congress\/(house-bill|senate-bill|house-joint-resolution|senate-joint-resolution)\/(\d+)\/?$/.exec(link.pathname);
    if (!match) continue;
    const bill = { congress: Number(match[1]), type: types[match[2]], number: match[3] };
    bills.set(billIdentity(bill), bill);
  }
  if (bills.size !== administration.total) throw new Error("SENATE_VETO_BILLS_INCOMPLETE");
  return [...bills.values()];
}

export const PRESIDENTIAL_DOCUMENTS_URL = "https://www.federalregister.gov/presidential-documents";
export function presidentialRegisterSlug(page: Page, person: Officeholder): string {
  if (page.url !== PRESIDENTIAL_DOCUMENTS_URL) throw new Error("PRESIDENTIAL_REGISTER_DIRECTORY_REQUIRED");
  const slugs = new Set<string>();
  for (const anchor of page.body.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    if (normalizedName(statewidePageText(anchor[2])) !== normalizedName(person.name)) continue;
    const url = official(new URL(anchor[1], page.url).href, ["www.federalregister.gov"]);
    const match = /^\/presidential-documents\/(?:executive-orders|proclamations|other-presidential-documents)\/([a-z0-9-]+)\/(\d{4})$/.exec(url.pathname);
    if (!match || Number(match[2]) < Number(day(person.termStart).slice(0, 4)) || /^\d{4}-/.test(person.termEnd) && Number(match[2]) >= Number(person.termEnd.slice(0, 4))) continue;
    slugs.add(match[1]);
  }
  if (slugs.size !== 1) throw new Error("PRESIDENTIAL_REGISTER_SIGNER_UNRESOLVED");
  return [...slugs][0];
}
export interface PresidentialFecIdentity {
  candidateId: string;
  electionYear: number;
  sourceUrl: string;
  evidenceSourceUrl: string;
  quote: string;
  collectedAt: string;
  partyLabel?: string;
}
const fecName = (value: string) => value.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean).sort().join(" ");
/** The candidate's exact full name, presidency and election year bind the two official records. */
export function resolvePresidentialFecIdentity(page: Page, person: Officeholder, electionYear: number): PresidentialFecIdentity {
  const url = official(page.url, ["api.open.fec.gov"]);
  if (!/^\/v1\/candidates\/?$/.test(url.pathname) || url.searchParams.get("office") !== "P" || url.searchParams.get("election_year") !== String(electionYear)) throw new Error("PRESIDENTIAL_FEC_QUERY_UNBOUND");
  const matches = parseFecPage(page.body).results.filter(row => row.office === "P" && /^P\d{8}$/.test(string(row.candidate_id)) && fecName(string(row.name)) === fecName(person.name) && Array.isArray(row.election_years) && row.election_years.includes(electionYear));
  const identities = new Set(matches.map(row => string(row.candidate_id)));
  if (identities.size !== 1) throw new Error("PRESIDENTIAL_FEC_IDENTITY_UNRESOLVED");
  const row = matches[0], candidateId = string(row.candidate_id);
  return { candidateId, electionYear, sourceUrl: `https://www.fec.gov/data/candidate/${candidateId}/?election_full=true&election=${electionYear}`,
    evidenceSourceUrl: page.url, quote: string(row.name), collectedAt: page.retrievedAt,
    ...(string(row.party_full) ? { partyLabel: string(row.party_full) } : {}) };
}

interface PresidentInput { person: Officeholder; registerSlug?: string; congresses: readonly number[]; fecCandidateId?: string; fecCycle?: number }
/** Backend acquisition entrypoints own environment access; reader libraries receive only explicit credentials. */
export interface ExecutiveSourceCredentials {
  readonly fec?: string;
  readonly congress?: string;
}
export interface PresidentialRecordOptions extends Pick<KnownReleaseOptions, "store" | "locks" | "fetchImpl" | "now"> {
  signal: AbortSignal;
  credentials?: ExecutiveSourceCredentials;
  president?: PresidentInput;
  vicePresident?: Officeholder;
  acquire?: typeof acquireKnownRelease;
}
export interface PresidentialRecordAcquisition {
  records: SourcedExecutiveRecord[];
  money: PresidentialMoney | null;
  fecIdentity?: PresidentialFecIdentity;
  captures: StatePeopleAcquisition[];
  gaps: { sourceUrl: string; detail: string }[];
  coverage: Readonly<Record<string, boolean>>;
  releaseId: string;
}
/** Source bytes share the existing national known-release vault; no reader makes an upstream request. */
export async function acquirePresidentialRecords(options: PresidentialRecordOptions): Promise<PresidentialRecordAcquisition> {
  const captures: StatePeopleAcquisition[] = [], records: SourcedExecutiveRecord[] = [], gaps: { sourceUrl: string; detail: string }[] = [];
  const complete: Record<string, boolean> = {}, acquire = options.acquire ?? acquireKnownRelease;
  const read = async (url: string): Promise<Page> => {
    const sourceUrl = publicFederalUrl(url), host = new URL(sourceUrl).hostname;
    const key = host === "api.congress.gov" ? options.credentials?.congress : host === "api.open.fec.gov" ? options.credentials?.fec : undefined;
    if (["api.congress.gov", "api.open.fec.gov"].includes(host) && !key) throw new Error(`${host === "api.congress.gov" ? "CONGRESS" : "FEC"}_API_KEY_UNAVAILABLE`);
    const release = await acquire({ ...options, sourceId: "statewide-executive-sources", releaseId: `executive-record:${sourceUrl}`, url: sourceUrl,
      parserVersion: "presidential-records/1", maxBytes: 16 * 1024 * 1024, checkAfterMs: 86_400_000,
      allowedHosts: ["api.congress.gov", "api.open.fec.gov", "www.federalregister.gov", "www.senate.gov"], headers: { accept: host === "www.senate.gov" ? "text/html,application/xml" : "application/json", ...(key ? { "X-Api-Key": key } : {}) } });
    const body = new TextDecoder("utf-8", { fatal: true }).decode(release.bytes);
    captures.push({ requestedUrl: release.requestedUrl, finalUrl: release.finalUrl, httpStatus: release.httpStatus, body,
      retrievedAt: release.retrievedAt, rawHash: release.sha256, sourceCheck: knownReleaseSourceCheck(release) });
    return { url: release.finalUrl, body, retrievedAt: release.retrievedAt };
  };
  const route = async (name: string, url: string, work: () => Promise<void>) => {
    complete[name] = false;
    try { await work(); complete[name] = true; } catch (error) {
      options.signal.throwIfAborted(); gaps.push({ sourceUrl: url, detail: `${name}:${error instanceof Error ? error.message : String(error)}` });
    }
  };
  const readBills = async (bills: readonly { congress: number; type: string; number: string | number }[]) => {
    let cursor = 0;
    const failures: string[] = [];
    const worker = async () => {
      while (cursor < bills.length) {
        const bill = bills[cursor++];
        try {
          if (!billIdentity(bill)) throw new Error("PRESIDENTIAL_BILL_IDENTITY_INVALID");
          let next: string | null = `https://api.congress.gov/v3/bill/${bill.congress}/${bill.type.toLowerCase()}/${bill.number}/actions?format=json&limit=250`, count = 0, expected: number | undefined;
          const seen = new Set<string>();
          while (next) {
            if (seen.has(next)) throw new Error("PRESIDENTIAL_BILL_ACTION_PAGINATION_REPEATED"); seen.add(next);
            const page = await read(next), root = object(JSON.parse(page.body)), pagination = object(root.pagination);
            records.push(...presidentialBillRecords(page, options.president!.person));
            if (!Array.isArray(root.actions) || !Number.isSafeInteger(pagination.count) || Number(pagination.count) < 0 || expected !== undefined && expected !== pagination.count) throw new Error("PRESIDENTIAL_BILL_ACTION_COUNT_INVALID");
            expected = Number(pagination.count); count += root.actions.length;
            next = string(pagination.next) || null;
          }
          if (count !== expected) throw new Error("PRESIDENTIAL_BILL_ACTIONS_INCOMPLETE");
        } catch (error) {
          options.signal.throwIfAborted(); failures.push(`${billIdentity(bill)}:${error instanceof Error ? error.message : String(error)}`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, bills.length) }, worker));
    if (failures.length) throw new Error(failures.join("; "));
  };
  let money: PresidentialMoney | null = null;
  let fecIdentity: PresidentialFecIdentity | undefined;
  const president = options.president;
  const presidential = president ? [route("presidentialDocuments", "https://www.federalregister.gov/api/v1/documents.json", async () => {
    const registerSlug = president.registerSlug ?? presidentialRegisterSlug(await read(PRESIDENTIAL_DOCUMENTS_URL), president.person);
    const start = new URL("https://www.federalregister.gov/api/v1/documents.json");
    start.searchParams.set("conditions[type][]", "PRESDOCU"); start.searchParams.set("conditions[president]", registerSlug);
    start.searchParams.set("conditions[publication_date][gte]", day(president.person.termStart)); start.searchParams.set("per_page", "1000"); start.searchParams.set("order", "oldest");
    for (const field of ["document_number", "title", "html_url", "pdf_url", "publication_date", "signing_date", "executive_order_number", "proclamation_number", "presidential_document_number", "subtype"]) start.searchParams.append("fields[]", field);
    let next: string | null = start.href, count = 0, expected: number | undefined;
    const seen = new Set<string>();
    while (next) {
      if (seen.has(next)) throw new Error("PRESIDENTIAL_REGISTER_PAGINATION_REPEATED"); seen.add(next);
      const page = await read(next), root = object(JSON.parse(page.body));
      const total = Number(root.count);
      if (!Number.isSafeInteger(total) || total < 0 || expected !== undefined && expected !== total || !Array.isArray(root.results)) throw new Error("PRESIDENTIAL_REGISTER_COUNT_INVALID");
      expected = total; count += root.results.length; records.push(...presidentialRegisterRecords(page, president.person, registerSlug));
      next = string(root.next_page_url) || null;
    }
    if (count !== expected) throw new Error("PRESIDENTIAL_REGISTER_PAGINATION_INCOMPLETE");
  }), route("signedBills", "https://api.congress.gov/v3/law", async () => {
    if (!president.congresses.length) throw new Error("PRESIDENTIAL_CONGRESSES_REQUIRED");
    const bills = new Map<string, { congress: number; type: string; number: string }>();
    for (const congress of president.congresses) for (const category of ["pub", "priv"]) {
      let next: string | null = `https://api.congress.gov/v3/law/${congress}/${category}?format=json&limit=250`, count = 0, expected: number | undefined;
      const seen = new Set<string>();
      while (next) {
        if (seen.has(next)) throw new Error("PRESIDENTIAL_LAW_PAGINATION_REPEATED"); seen.add(next);
        const page = await read(next), root = object(JSON.parse(page.body)), pagination = object(root.pagination);
        if (!Array.isArray(root.bills) || !Number.isSafeInteger(pagination.count) || Number(pagination.count) < 0 || expected !== undefined && expected !== pagination.count) throw new Error("PRESIDENTIAL_LAW_INDEX_INVALID");
        expected = Number(pagination.count); count += root.bills.length;
        for (const bill of rows(root.bills)) {
          const id = billIdentity(bill);
          if (!id || Number(bill.congress) !== congress) throw new Error("PRESIDENTIAL_LAW_IDENTITY_INVALID");
          bills.set(id, { congress, type: string(bill.type).toLowerCase(), number: string(bill.number) });
        }
        next = string(pagination.next) || null;
      }
      if (count !== expected) throw new Error("PRESIDENTIAL_LAW_INDEX_INCOMPLETE");
    }
    await readBills([...bills.values()]);
  }), route("vetoedBills", SENATE_VETO_INDEX_URL, async () => {
    const administration = senateVetoAdministration(await read(SENATE_VETO_INDEX_URL), president.person);
    const bills = senateVetoBills(await read(administration.url), president.person, administration);
    await readBills(bills);
    if (bills.some(bill => !records.some(row => row.kind === "VETO" && row.details.billId === billIdentity(bill)))) throw new Error("PRESIDENTIAL_VETO_CONGRESS_CONFIRMATION_INCOMPLETE");
  }), route("presidentialMoney", "https://api.open.fec.gov/v1/candidate/", async () => {
    let id = president.fecCandidateId;
    if (!id || !president.person.fecCandidateIds?.includes(id)) {
      const electionYear = Number(day(president.person.termStart).slice(0, 4)) - 1;
      let identityPage: Page | undefined;
      const candidates = await readFecPages(async (path, params) => {
        const url = new URL(`https://api.open.fec.gov/v1${path}`);
        for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
        const page = await read(url.href); identityPage = page;
        return parseFecPage(page.body);
      }, "/candidates/", { office: "P", name: president.person.name, election_year: electionYear });
      if (!identityPage) throw new Error("PRESIDENTIAL_FEC_IDENTITY_UNAVAILABLE");
      // A unique matching row must itself occur in a saved page; never cite a synthetic merged body.
      const selected = candidates.filter(row => row.office === "P" && fecName(string(row.name)) === fecName(president.person.name));
      if (new Set(selected.map(row => row.candidate_id)).size !== 1) throw new Error("PRESIDENTIAL_FEC_IDENTITY_UNRESOLVED");
      const capture = captures.find(row => row.finalUrl.includes("/v1/candidates/") && parseFecPage(row.body).results.some(candidate => candidate.candidate_id === selected[0].candidate_id));
      if (!capture) throw new Error("PRESIDENTIAL_FEC_IDENTITY_EVIDENCE_MISSING");
      fecIdentity = resolvePresidentialFecIdentity({ url: capture.finalUrl, body: capture.body, retrievedAt: capture.retrievedAt }, president.person, electionYear);
      id = fecIdentity.candidateId;
    }
    const cycle = president.fecCycle ?? Math.ceil(Number((options.now?.() ?? new Date().toISOString()).slice(0, 4)) / 2) * 2;
    const results = await readFecPages(async (path, params) => {
      const url = new URL(`https://api.open.fec.gov/v1${path}`);
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
      const page = await read(url.href);
      return { ...parseFecPage(page.body), sourceObservedAt: page.retrievedAt };
    }, `/candidate/${id}/totals/`, { cycle, election_full: false });
    const chosen = fecTotalsForPeriod(results, id, cycle);
    const source = chosen ? captures.find(capture => {
      const sourceUrl = new URL(capture.finalUrl);
      return sourceUrl.pathname === `/v1/candidate/${id}/totals/` && parseFecPage(capture.body).results.some(row => JSON.stringify(row) === JSON.stringify(chosen));
    }) : undefined;
    if (!source) throw new Error("PRESIDENTIAL_FEC_TOTALS_EVIDENCE_MISSING");
    money = presidentialFecMoney(source.body, id, cycle, source.retrievedAt);
    if (!money) throw new Error("PRESIDENTIAL_FEC_TOTALS_NOT_RETURNED");
    money = { ...money, evidenceSourceUrl: source.finalUrl };
  })] : [];
  const vice = options.vicePresident ? route("vicePresidentVotes", SENATE_TIE_VOTES_URL, async () => {
    const person = options.vicePresident!, index = await read(SENATE_TIE_VOTES_URL);
    for (const link of senateTieVoteLinks(index, person)) records.push(senateTieVoteRecord(await read(link.url), person, link));
  }) : Promise.resolve();
  await Promise.all([...presidential, vice]);
  const coverage = { campaignMoney: complete.presidentialMoney === true, executiveOrders: complete.presidentialDocuments === true, proclamations: complete.presidentialDocuments === true, memoranda: complete.presidentialDocuments === true, signedBills: complete.signedBills === true, vetoedBills: complete.vetoedBills === true, tieBreakingVotes: complete.vicePresidentVotes === true };
  return { records: [...new Map(records.map(row => [row.id, row])).values()].sort((a, b) => b.date.localeCompare(a.date)), money, fecIdentity,
    captures, gaps, coverage, releaseId: createHash("sha256").update(captures.map(row => row.rawHash).sort().join("|")).digest("hex") };
}
