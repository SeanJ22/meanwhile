import { createHash } from "node:crypto";
import { decodeHTML } from "entities";
import { stateCodeOf, stateName } from "../facts/entity-read.ts";
import type { ElectionResult, ElectionResultBatch, ResultCandidate, ResultSource } from "./types.ts";

const text = (html: string) => decodeHTML(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
const number = (value: string): number | undefined => /^\d[\d,]*(?:\.\d+)?%?$/.test(value.trim()) ? Number(value.replace(/[,%]/g, "")) : undefined;
const attr = (html: string, key: string) => decodeHTML(new RegExp(`\\b${key}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(html)?.slice(1).find(value => value !== undefined) ?? "");

function countWords(value: string): number | undefined {
  if (/^\d+$/.test(value)) return Number(value);
  const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
    "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
  const tens: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  const parts = value.toLowerCase().split("-"), first = words.indexOf(parts[0]);
  if (parts.length === 1 && first >= 0) return first;
  if (tens[parts[0]] !== undefined && parts.length <= 2) {
    const ones = parts.length === 1 ? 0 : words.indexOf(parts[1]);
    if (ones >= 0 && ones < 10) return tens[parts[0]] + ones;
  }
  return undefined;
}

export interface BallotpediaRace {
  state: string;
  office: "us_house" | "us_senate";
  districtHint?: string;
  electionDate?: string;
  url: string;
}

/** A public Ballotpedia page identity, never a filesystem path. */
export function ballotpediaRaceId(url: string): string {
  const page = new URL(url);
  if (page.protocol !== "https:" || page.hostname.replace(/^www\./, "") !== "ballotpedia.org")
    throw new Error("Ballotpedia results require a public Ballotpedia HTTPS page");
  return decodeURIComponent(page.pathname.slice(1));
}

function sourceName(url: string): string {
  const host = new URL(url).hostname;
  return /(^|\.)nytimes\.com$/.test(host) ? "The New York Times" : /(^|\.)apnews\.com$/.test(host) ? "Associated Press" : host;
}

/** Read the current contest, including Louisiana's November nonpartisan primary, without historical results. */
export function parseBallotpediaResults(html: string, race: BallotpediaRace, checkedAt: string): ElectionResultBatch {
  const electionDate = race.electionDate ?? "2026-11-03", year = electionDate.slice(0, 4);
  const source = { name: "Ballotpedia", url: race.url };
  const dateLabel = new Date(`${electionDate}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  const headings = [...html.matchAll(/<h[1-6]\b[^>]*>\s*((?:Special\s+)?General|Nonpartisan primary) election\s+for\s+([\s\S]*?)<\/h[1-6]>/gi)];
  const sections = headings.flatMap(heading => {
    const start = heading.index!, after = start + heading[0].length;
    const boundary = /<h[1-6]\b/i.exec(html.slice(after));
    const section = html.slice(start, boundary ? after + boundary.index : undefined);
    const narrative = /<p\b[^>]*class=["'][^"']*\bresults_text\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i.exec(section)?.[1] ?? "";
    const label = text(heading[2]), primary = /primary/i.test(heading[1]);
    const expected = race.office === "us_house" ? /U\.?S\.? House/i : /U\.?S\.? Senate/i;
    const name = stateName(race.state);
    const eligibleDate = primary ? race.state === "LA" && race.office === "us_house" && text(narrative).includes(dateLabel)
      : new RegExp(`\\b${year}\\b`).test(text(narrative));
    return expected.test(label) && name && label.includes(name) && eligibleDate ? [{ section, narrative, label, primary }] : [];
  });
  const selected = sections.some(section => !section.primary) ? sections.filter(section => !section.primary) : sections;
  // Some pages embed the exact current box both in the summary and the year history.
  const choices = [...new Map(selected.map(section => [section.section, section])).values()];
  if (choices.length === 0) {
    const expected = race.office === "us_house" ? /U\.?S\.? House/i : /U\.?S\.? Senate/i;
    const unopposed = [...html.matchAll(/<p\b[^>]*>[\s\S]*?<\/p>/gi)].filter(paragraph => {
      const content = text(paragraph[0]);
      return content.includes(dateLabel) && content.includes(stateName(race.state) ?? "\0") && expected.test(content)
        && /general election.*was canceled\./i.test(content) && /won election.*without appearing on the ballot/i.test(content);
    });
    if (unopposed.length === 1) {
      const quote = unopposed[0][0], candidate = /<a\b[^>]*>([\s\S]*?)<\/a>/i.exec(quote);
      const name = text(candidate?.[1] ?? ""), party = /\(([^)]+)\)/.exec(text(quote.slice((candidate?.index ?? 0) + (candidate?.[0].length ?? 0))))?.[1];
      if (!name) throw new Error(`Ballotpedia unopposed general-election candidate is missing: ${race.url}`);
      return { source, races: [{ sourceId: "ballotpedia", sourceName: source.name, sourceUrl: race.url, creditedSources: [],
        sourceRaceId: ballotpediaRaceId(race.url), state: race.state.toUpperCase(), office: race.office,
        officeName: `${race.office === "us_house" ? "U.S. House" : "U.S. Senate"} ${stateName(race.state)}`,
        ...(race.districtHint === undefined ? {} : { districtHint: race.districtHint }), electionDate, status: "unopposed", seatsToFill: 1,
        candidates: [{ name, ...(party ? { party } : {}), won: true, runoff: false, quote }], checkedAt, quote }], summaries: [],
        evidence: { text: html, contentType: "text/html", contentHash: createHash("sha256").update(html).digest("hex") } };
    }
  }
  if (choices.length !== 1) throw new Error(`Ballotpedia current general-election table is ambiguous or missing: ${race.url}`);
  const { section, narrative, label, primary } = choices[0];
  const table = /<table\b[^>]*class=["'][^"']*\bresults_table\b[^"']*["'][^>]*>[\s\S]*?<\/table>/i.exec(section)?.[0];
  if (!table) throw new Error(`Ballotpedia results table is missing: ${race.url}`);
  const candidates: ResultCandidate[] = [];
  let incumbentsLost = 0;
  for (const row of table.matchAll(/<tr\b[^>]*class=["'][^"']*\bresults_row\b[^"']*["'][^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cellMatches = [...row[1].matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)];
    const cells = cellMatches.map(cell => cell[2]);
    const nameCell = cellMatches.find(cell => /\bvotebox-results-cell--text\b/.test(cell[1]))?.[2]
      ?? cells.find(cell => /<a\b/i.test(cell) && text(cell).length > 0 && !/submit photo/i.test(text(cell)));
    if (!nameCell || cells.length < 3) throw new Error(`Ballotpedia candidate row changed shape: ${race.url}`);
    const nameLink = /<a\b[^>]*>([\s\S]*?)<\/a>/i.exec(nameCell);
    const name = text(nameLink?.[1] ?? "");
    if (!name) throw new Error(`Ballotpedia candidate name is missing: ${race.url}`);
    const percentHtml = /class=["'][^"']*\bpercentage_number\b[^"']*["'][^>]*>([^<]*)</i.exec(row[1])?.[1];
    const percent = number(text(percentHtml ?? cells[cells.length - 2]));
    const votes = number(text(cells[cells.length - 1]));
    const party = /\(([^)]+)\)/.exec(text(nameCell.slice((nameLink?.index ?? 0) + (nameLink?.[0].length ?? 0))))?.[1];
    const selected = /[✔✓]/.test(text(cells[0]));
    const won = selected && (!primary || /won election outright|\bdefeated\b/i.test(text(narrative)));
    const incumbent = /<(?:strong|b)\b[^>]*>[\s\S]*?<u\b/i.test(nameCell);
    if (incumbent && !selected) incumbentsLost++;
    candidates.push({ name, ...(party ? { party } : {}), ...(votes === undefined ? {} : { votes }),
      ...(percent === undefined ? {} : { percent }), won, runoff: primary && selected && !won, incumbent, quote: row[0] });
  }
  if (!candidates.length) throw new Error(`Ballotpedia general-election candidates are missing: ${race.url}`);
  const creditedSources: ResultSource[] = [];
  for (const link of section.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)) {
    if (!/^source(?:\s*\d+)?$/i.test(text(link[0]))) continue;
    const url = attr(link[0], "href");
    if (!/^https?:\/\//.test(url)) continue;
    if (!creditedSources.some(source => source.url === url)) creditedSources.push({ name: sourceName(url), url });
  }
  const descriptions = [...html.matchAll(/<meta\b[^>]*>/gi)].filter(meta => attr(meta[0], "name") === "description").map(meta => attr(meta[0], "content"));
  const winnerNames = candidates.filter(candidate => candidate.won).map(candidate => candidate.name);
  // Ballotpedia ticks the winner in a general-election votebox only once the race is called; that mark is the call even when its text has not caught up.
  const called = !primary && winnerNames.length > 0 || [text(narrative), ...descriptions].some(statement => statement.includes(year) && /\bdefeated\b/i.test(statement)
    && winnerNames.some(name => statement.toLocaleLowerCase().includes(name.toLocaleLowerCase())));
  const certified = /results have been certified/i.test(text(section));
  const percentCounted = /(\d+(?:\.\d+)?)%\s+(?:of\s+)?(?:the\s+)?(?:votes|precincts)\s+(?:counted|reporting)/i.exec(text(section));
  const incumbentParties = [...new Set(candidates.filter(candidate => candidate.incumbent).flatMap(candidate => candidate.party ?? []))];
  const winningParties = [...new Set(candidates.filter(candidate => candidate.won).flatMap(candidate => candidate.party ?? []))];
  const seatsFlipped = (called || certified) && incumbentParties.length === 1 && winningParties.length === 1
    ? Number(incumbentParties[0] !== winningParties[0]) : undefined;
  const result: ElectionResult = { sourceId: "ballotpedia", sourceName: source.name, sourceUrl: race.url,
    creditedSources, sourceRaceId: ballotpediaRaceId(race.url), state: race.state.toUpperCase(),
    office: race.office, officeName: label, ...(race.districtHint === undefined ? {} : { districtHint: race.districtHint }),
    electionDate, status: certified ? "certified" : called ? "called" : candidates.some(candidate => candidate.votes !== undefined) ? "counting" : "pending",
    ...(percentCounted ? { percentCounted: Number(percentCounted[1]) } : {}), seatsToFill: 1,
    ...(called || certified ? { incumbentLost: incumbentsLost > 0, incumbentsLost } : {}),
    ...(seatsFlipped === undefined ? {} : { seatsFlipped, flipped: seatsFlipped > 0,
      ...(seatsFlipped ? { gainedByParty: winningParties[0] } : {}) }), candidates, checkedAt, quote: section };
  return { source, races: [result], summaries: [], evidence: { text: html, contentType: "text/html", contentHash: createHash("sha256").update(html).digest("hex") } };
}

export async function readBallotpediaResults(race: BallotpediaRace, checkedAt: string, fetcher: typeof fetch = fetch): Promise<ElectionResultBatch> {
  const response = await fetcher(race.url.replaceAll("'", "%27"), { headers: { Accept: "text/html" } });
  // A 202 is Ballotpedia's challenge page, not results: it counts as blocked.
  if (response.status !== 200) throw new Error(`Ballotpedia HTTP ${response.status}: ${race.url}`);
  return parseBallotpediaResults(await response.text(), race, checkedAt);
}

export const BALLOTPEDIA_CONGRESS_URLS = {
  us_senate: "https://ballotpedia.org/United_States_Senate_elections,_2026",
  us_house: "https://ballotpedia.org/United_States_House_of_Representatives_elections,_2026",
} as const;

function racePages(html: string, office: "us_house" | "us_senate"): NonNullable<ElectionResultBatch["racePages"]> {
  const pages = new Map<string, NonNullable<ElectionResultBatch["racePages"]>[number]>();
  for (const anchor of html.matchAll(/<a\b[^>]*>/gi)) {
    try {
      const url = new URL(attr(anchor[0], "href"), BALLOTPEDIA_CONGRESS_URLS[office]);
      if (url.protocol !== "https:" || !/^(?:www\.)?ballotpedia\.org$/.test(url.hostname) || url.username || url.password) continue;
      const path = decodeURIComponent(url.pathname.slice(1));
      const senate = /^United_States_Senate_(?:special_)?election_in_(.+),_2026$/.exec(path);
      const house = /^(.+?)['’]s?_(?:(\d+)(?:st|nd|rd|th)|at[-_]large)_Congressional_District_election,_2026$/i.exec(path);
      const atLarge = /^United_States_House_of_Representatives_election_in_(.+),_2026$/.exec(path);
      const match = office === "us_senate" ? senate : house ?? atLarge;
      if (!match) continue;
      const state = stateCodeOf(match[1].replaceAll("_", " "));
      if (!state || /^(DC|AS|GU|MP|PR|VI)$/.test(state)) continue;
      url.hash = "";
      url.search = "";
      const canonical = url.href.replaceAll("'", "%27");
      pages.set(path.toLowerCase(), { state, office, ...(office === "us_house" ? { districtHint: house?.[2] ?? "at-large" } : {}), electionDate: "2026-11-03", url: canonical });
    } catch { /* A malformed or foreign link cannot become a source to read. */ }
  }
  return [...pages.values()];
}

function houseIndexPages(html: string): string[] {
  const pages = new Set<string>();
  for (const anchor of html.matchAll(/<a\b[^>]*>/gi)) {
    try {
      const url = new URL(attr(anchor[0], "href"), BALLOTPEDIA_CONGRESS_URLS.us_house);
      if (url.protocol !== "https:" || url.hostname !== "ballotpedia.org" || url.username || url.password) continue;
      const match = /^\/United_States_House_of_Representatives_elections_in_(.+),_2026$/.exec(decodeURIComponent(url.pathname));
      if (!match || !stateCodeOf(match[1].replaceAll("_", " "))) continue;
      url.hash = "";
      url.search = "";
      pages.add(url.href);
    } catch { /* Only source-published valid Ballotpedia index links are followed. */ }
  }
  return [...pages];
}

/** National totals come from the overview's complete result counts, including Senate holdovers. */
export function parseBallotpediaCongressSummary(html: string, office: "us_house" | "us_senate", checkedAt: string): ElectionResultBatch {
  const source = { name: "Ballotpedia", url: BALLOTPEDIA_CONGRESS_URLS[office] }, chamber = office === "us_senate" ? "Senate" : "House";
  const resultsHeading = /<h2\b[^>]*>[\s\S]*?id=["']Election_results(?:,_|\.2C_)2026["'][\s\S]*?<\/h2>/i.exec(html);
  if (!resultsHeading) throw new Error(`Ballotpedia Congress result section is missing: ${office}`);
  const start = resultsHeading.index + resultsHeading[0].lastIndexOf("<h2"), after = resultsHeading.index + resultsHeading[0].length;
  const nextHeading = /<h2\b/i.exec(html.slice(after));
  const sectionEnd = nextHeading ? after + nextHeading.index : html.length;
  const section = html.slice(start, sectionEnd), content = text(section);
  const won = new RegExp(`Democrats had won (\\d+) and Republicans (\\d+) of the (\\d+) U\\.S\\. ${chamber} races`, "i").exec(content);
  if (!won) throw new Error(`Ballotpedia Congress complete race counts are missing: ${office}`);
  const totalRaces = Number(won[3]), stillCounting = totalRaces - Number(won[1]) - Number(won[2]);
  const tableMatch = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)].find(table => office === "us_senate"
    ? /U\.S\. Senate Partisan Breakdown/.test(text(table[0])) : /Partisan composition, U\.S\. House/.test(text(table[0])));
  if (!tableMatch || stillCounting < 0) throw new Error(`Ballotpedia Congress before composition is missing or inconsistent: ${office}`);
  const seatsBefore: Record<string, number> = {};
  for (const row of tableMatch[0].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(cell => text(cell[1].replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, "")));
    const party = /^Democratic(?: Party)?$/.test(cells[0] ?? "") ? "D" : /^Republican(?: Party)?$/.test(cells[0] ?? "") ? "R"
      : cells[0] === "Independent" ? "I" : cells[0] === "Vacancies" ? "Vacant" : null;
    if (party && /^\d+$/.test(cells[1] ?? "")) seatsBefore[party] = Number(cells[1]);
  }
  if (seatsBefore.D === undefined || seatsBefore.R === undefined) throw new Error(`Ballotpedia Congress party counts are missing: ${office}`);
  let seatsNow: Record<string, number> = { D: Number(won[1]), R: Number(won[2]), I: 0, Vacant: 0 };
  if (office === "us_senate") {
    const defending = /Democrats hold (\d+) and Republicans hold (\d+)/i.exec(content);
    if (!defending || Number(defending[1]) + Number(defending[2]) !== totalRaces) throw new Error("Ballotpedia Senate holdover evidence is missing");
    seatsNow = { ...seatsBefore, D: seatsBefore.D - Number(defending[1]) + Number(won[1]),
      R: seatsBefore.R - Number(defending[2]) + Number(won[2]) };
  }
  const chamberSize = office === "us_senate" ? 100 : 435;
  if (Object.values(seatsNow).reduce((sum, count) => sum + count, stillCounting) !== chamberSize) throw new Error(`Ballotpedia Congress totals do not balance: ${office}`);
  const controlBefore = /Republicans held a [\d-]+ majority/.test(content) ? "R" : /Democrats held a [\d-]+ majority/.test(content) ? "D" : null;
  const projected = new RegExp(`Decision Desk HQ projected that (Democrats|Republicans) would win control of the U\\.S\\. ${chamber}`, "i").exec(content);
  const creditedSources: ResultSource[] = [];
  if (projected) {
    const footnote = /<li\b[^>]*id=["']cite_note-1["'][^>]*>[\s\S]*?<\/li>/i.exec(html)?.[0] ?? "";
    const link = [...footnote.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)].find(link => /^https?:\/\//.test(attr(link[0], "href")));
    creditedSources.push({ name: "Decision Desk HQ", ...(link ? { url: attr(link[0], "href") } : {}) });
  }
  const quoteStart = Math.min(start, tableMatch.index!), quoteEnd = Math.max(sectionEnd, tableMatch.index! + tableMatch[0].length);
  const catalog = racePages(html, office);
  const flipText = /\b(\d+|[a-z]+(?:-[a-z]+)?)\s+(?:seats\s+)?changed party control\b/i.exec(content)?.[1];
  const seatsFlipped = flipText ? countWords(flipText) : undefined;
  const incumbentParagraph = [...html.matchAll(/<p\b[^>]*>[\s\S]*?<\/p>/gi)].find(paragraph =>
    /\b(\d+|[a-z]+(?:-[a-z]+)?)\s+(?:U\.S\.\s+(?:House|Senate)\s+)?incumbents\b.*\blost re-election in the general elections?\b/i.test(text(paragraph[0])));
  const incumbentText = incumbentParagraph && /\b(\d+|[a-z]+(?:-[a-z]+)?)\s+(?:U\.S\.\s+(?:House|Senate)\s+)?incumbents\b/i.exec(text(incumbentParagraph[0]))?.[1];
  const incumbentsLost = incumbentText ? countWords(incumbentText) : undefined;
  const quote = html.slice(quoteStart, quoteEnd);
  return { source, races: [], summaries: [{ state: "US", chambers: [{ name: office, seatsBefore, seatsNow, stillCounting, controlBefore,
    controlNow: projected ? projected[1].toLowerCase() === "democrats" ? "D" : "R" : null,
    ...(seatsFlipped === undefined ? {} : { seatsFlipped }) }], governor: { before: null, now: null },
    ...(incumbentsLost === undefined ? {} : { incumbentsLost }), statewideOfficesFlipped: [], source, creditedSources, checkedAt, quote,
    ...(incumbentParagraph && incumbentsLost !== undefined && !quote.includes(incumbentParagraph[0]) ? { quotes: [quote, incumbentParagraph[0]] } : {}) }],
    ...(catalog.length ? { racePages: catalog } : {}),
    evidence: { text: html, contentType: "text/html", contentHash: createHash("sha256").update(html).digest("hex") } };
}

export async function readBallotpediaCongressSummary(office: "us_house" | "us_senate", checkedAt: string, fetcher: typeof fetch = fetch, discoverRacePages = false): Promise<ElectionResultBatch> {
  const response = await fetcher(BALLOTPEDIA_CONGRESS_URLS[office], { headers: { Accept: "text/html" } });
  if (!response.ok) throw new Error(`Ballotpedia Congress HTTP ${response.status}: ${office}`);
  const html = await response.text(), batch = parseBallotpediaCongressSummary(html, office, checkedAt);
  if (!discoverRacePages || office !== "us_house" || (batch.racePages?.length ?? 0) >= 435) return batch;
  const pending = houseIndexPages(html), catalog = new Map((batch.racePages ?? []).map(page => [page.url, page]));
  const catalogErrors: NonNullable<ElectionResultBatch["catalogErrors"]> = [];
  await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
    for (let url = pending.shift(); url; url = pending.shift()) {
      try {
        const response = await fetcher(url, { headers: { Accept: "text/html" } });
        if (!response.ok) throw new Error(`Ballotpedia House index HTTP ${response.status}${response.headers.get("Retry-After") ? `; Retry-After: ${response.headers.get("Retry-After")}` : ""}`);
        for (const page of racePages(await response.text(), "us_house")) catalog.set(page.url, page);
      } catch (error) { catalogErrors.push({ url, reason: error instanceof Error ? error.message : String(error) }); }
    }
  }));
  return { ...batch, ...(catalog.size ? { racePages: [...catalog.values()] } : {}), ...(catalogErrors.length ? { catalogErrors } : {}) };
}

/** Race pages captured through a browser that passes Ballotpedia's challenge: exact page substrings, dated when captured. */
export interface CapturedBallotpedia { capturedAt: string; seats: Map<string, string>; races: BallotpediaRace[];
  /** The two national overview pages (full page text), when the file carries them. */
  overviews: Partial<Record<"us_house" | "us_senate", string>> }

const AT_LARGE_STATES = ["AK", "DE", "ND", "SD", "VT", "WY"];

/** The seat a captured page key or a race route names: state, chamber and district, or Senate regular or special. */
function seatOf(state: string, office: "us_house" | "us_senate", value: string | undefined, special: boolean): string {
  if (office === "us_senate") return `${state}:senate:${special ? "special" : "regular"}`;
  const district = (value ?? "").toLowerCase().replace(/[\s-]/g, "");
  const atLarge = ["0", "00", "atlarge"].includes(district) || !district && AT_LARGE_STATES.includes(state);
  return `${state}:house:${atLarge ? 0 : Number(district)}`;
}

/** The seat a page key names, with the race route that reads it. */
function capturedRace(path: string): { seat: string; race: BallotpediaRace } | null {
  let key = path.replace(/^https?:\/\/[^/]+/i, "").replace(/^\//, "");
  try { key = decodeURIComponent(key); } catch { /* keep the raw key */ }
  const senate = /^United_States_Senate_(special_)?election_in_(.+?),_2026$/.exec(key);
  const house = /^United_States_House_of_Representatives_election_in_(.+?),_2026$/.exec(key);
  const district = /^(.+?)(?:'s|')_(?:(\d+)(?:st|nd|rd|th)|At-Large)_Congressional_District_election,_2026$/.exec(key);
  const name = senate?.[2] ?? house?.[1] ?? district?.[1];
  const state = name ? stateCodeOf(name.replaceAll("_", " ")) : null;
  if (!state) return null;
  const office = senate ? "us_senate" as const : "us_house" as const;
  const hint = senate ? undefined : house ? "at-large" : district![2] ?? "at-large";
  return { seat: seatOf(state, office, hint === "at-large" ? "0" : hint, Boolean(senate?.[1])),
    race: { state, office, electionDate: "2026-11-03", ...(hint ? { districtHint: hint } : {}),
      url: `https://ballotpedia.org/${encodeURI(key).replaceAll("'", "%27")}` } };
}

/** Throws unless the text is a version-1 capture file. Pages are indexed by seat, so a route's own spelling never has to match the page key. */
export function parseCapturedBallotpedia(text: string): CapturedBallotpedia {
  const file = JSON.parse(text) as { formatVersion?: unknown; capturedAt?: unknown; pages?: Record<string, unknown>; summaryPages?: Record<string, unknown> };
  if (file.formatVersion !== 1) throw new Error(`Captured Ballotpedia file has format version ${String(file.formatVersion)}, not 1`);
  if (typeof file.capturedAt !== "string" || !file.pages || typeof file.pages !== "object") throw new Error("Captured Ballotpedia file has no capturedAt and pages");
  const seats = new Map<string, string>(), races: BallotpediaRace[] = [], overviews: CapturedBallotpedia["overviews"] = {};
  for (const [key, html] of Object.entries(file.pages)) {
    const found = typeof html === "string" ? capturedRace(key) : null;
    if (found && !seats.has(found.seat)) { seats.set(found.seat, html as string); races.push(found.race); }
  }
  // The two national overview pages sit beside `pages` under summaryPages, keyed by the page name.
  for (const office of ["us_senate", "us_house"] as const) {
    const page = file.summaryPages?.[BALLOTPEDIA_CONGRESS_URLS[office].replace("https://ballotpedia.org/", "")];
    if (typeof page === "string") overviews[office] = page;
  }
  return { capturedAt: file.capturedAt, seats, races, overviews };
}

/** The race read from its captured page (checkedAt is the capture time), or null when the file has no page for the seat. */
export function readCapturedBallotpediaResults(captured: CapturedBallotpedia, race: BallotpediaRace): ElectionResultBatch | null {
  const special = /special/i.test(race.url), state = race.state.toUpperCase();
  const seat = seatOf(state, race.office, race.districtHint, special);
  const html = captured.seats.get(seat) ?? (race.office === "us_senate" ? captured.seats.get(seatOf(state, race.office, undefined, !special)) : undefined);
  return html === undefined ? null : parseBallotpediaResults(html, race, captured.capturedAt);
}

/** The national overview read from its captured page by the same parser the live read used (checkedAt is the capture time), or null when the file lacks the page. */
export async function readCapturedCongressSummary(captured: CapturedBallotpedia, office: "us_house" | "us_senate"): Promise<ElectionResultBatch | null> {
  const html = captured.overviews[office];
  if (html === undefined) return null;
  const batch = await readBallotpediaCongressSummary(office, captured.capturedAt, async () => new Response(html, { status: 200 }));
  const { racePages: _pages, ...rest } = batch;
  return rest;
}
