import { createHash } from "node:crypto";
import { visibleText, decodeEntities } from "../../../extract/visible-text.ts";
import type { SourceSnapshot } from "../../../corpus/types.ts";
import type { WorkerPublicationCapture } from "../../../civic-data/worker-roster-publication.ts";
import type { HeldSubjectDetails } from "./held-subject-enrichment.ts";
import type { HeldDetailFact } from "./held-subject-extraction.ts";

export interface HeldCommitteeIdentity { readonly committeeId: string; readonly name: string; readonly url: string | null }
export interface HeldStatementLink { readonly url: string; readonly postedOn: string; readonly title: string; readonly quote: string }
const text = (html: string) => visibleText(html).replace(/\s+/g, " ").trim();
export const committeeNameKey = (value: string) => text(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const personKey = committeeNameKey;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const publicationDay = (value: string, captured: string): string | null => {
  const date = /^(\d{4}-\d{2}-\d{2})(?:T.*)?$/.exec(value)?.[1];
  if (!date || date > captured.slice(0, 10)) return null;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null;
};

/** Links are acquisition work only. The original held profile and exact dated block remain their referrer proof. */
export function heldStatementLinks(subject: HeldSubjectDetails, capture: WorkerPublicationCapture): HeldStatementLink[] {
  const url = capture.evidence.canonicalUrl;
  if (subject.subjectKind !== "official" || !subject.personName || !subject.profileUrls.includes(url) || !subject.sourceUrls.includes(url)) return [];
  let main = /<main\b[^>]*>([\s\S]*?)<\/main\s*>/i.exec(capture.evidence.text)?.[1] ?? "";
  main = main.replace(/<(nav|footer|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  const own = [...main.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/gi)].filter(h => personKey(h[1]) === personKey(subject.personName!));
  if (own.length !== 1) return [];
  const next = /<h1\b/i.exec(main.slice(own[0]!.index! + own[0]![0].length));
  main = main.slice(own[0]!.index!, next ? own[0]!.index! + own[0]![0].length + next.index : main.length);
  const links: HeldStatementLink[] = [];
  for (const block of main.matchAll(/<(article|li)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)) {
    const dates = [...block[2].matchAll(/<time\b[^>]*datetime\s*=\s*["']([^"']+)["'][^>]*>/gi)].flatMap(match => publicationDay(match[1]!, capture.observedAt) ?? []);
    if (new Set(dates).size !== 1) continue;
    const previousHeading = [...main.slice(0, block.index).matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]\s*>/gi)].at(-1)?.[1];
    if (previousHeading && /staff|team|campaign|personal|other officials/i.test(text(previousHeading))) continue;
    const statedAuthor = /<([a-z0-9]+)\b[^>]*(?:rel|itemprop)\s*=\s*["']author["'][^>]*>([\s\S]*?)<\/\1\s*>/i.exec(block[2])?.[2];
    if (statedAuthor && personKey(statedAuthor) !== personKey(subject.personName)) continue;
    for (const anchor of block[2].matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a\s*>/gi)) {
      const title = text(anchor[2]);
      let linked: URL; try { linked = new URL(decodeEntities(anchor[1]!), url); linked.hash = ""; } catch { continue; }
      if (linked.origin !== new URL(url).origin || linked.href === url || linked.username || linked.password ||
        !/statement|press[ -]?release|remarks/i.test(`${title} ${linked.pathname}`)) continue;
      links.push({ url: linked.href, postedOn: dates[0]!, title, quote: block[0] });
    }
  }
  return links.filter((link, index, all) => all.findIndex(other => other.url === link.url && other.postedOn === link.postedOn) === index);
}

/** Only the named official's own committee section supplies membership candidates. */
export function heldCommitteeCandidates(subject: HeldSubjectDetails, html: string, url: string): { name: string; title: string | null; period: string | null; quote: string }[] {
  if (subject.subjectKind !== "official" || !subject.personName || !subject.sourceUrls.includes(url)) return [];
  const main = /<main\b[^>]*>([\s\S]*?)<\/main\s*>/i.exec(html)?.[1] ?? html;
  const headings = [...main.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi)];
  if (!headings.some(h => personKey(h[2]) === personKey(subject.personName!))) return [];
  const own = headings.find(h => personKey(h[2]) === personKey(subject.personName!))!;
  const nextPerson = headings.find(h => h.index! > own.index! && Number(h[1]) <= Number(own[1]));
  const section = headings.find(h => h.index! > own.index! && (!nextPerson || h.index! < nextPerson.index!) && /^(?:committee assignments|committee memberships|committees)$/i.test(text(h[2])));
  if (!section) return [];
  const ancestors: typeof headings = [];
  for (const heading of headings.filter(h => h.index! < section.index!)) {
    while (ancestors.length && Number(ancestors.at(-1)![1]) >= Number(heading[1])) ancestors.pop();
    ancestors.push(heading);
  }
  while (ancestors.length && Number(ancestors.at(-1)![1]) >= Number(section[1])) ancestors.pop();
  if (!ancestors.includes(own) || ancestors.some(h => /\b(staff|other officials|other members|team)\b/i.test(text(h[2])))) return [];
  const end = headings.find(h => h.index! > section.index! && Number(h[1]) <= Number(section[1]));
  const body = main.slice(section.index! + section[0].length, end?.index ?? main.length);
  return [...body.matchAll(/<(li|tr)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)].flatMap(row => {
    const quote = text(row[0]);
    const cells = [...row[2].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]\s*>/gi)].map(cell => text(cell[1]));
    if (cells.length && /^(committee|name)$/i.test(cells[0]!)) return [];
    const bits = cells.length ? cells : quote.split(/\s+[—–|]\s+|\s*:\s*/);
    const name = bits[0]?.trim();
    if (!name || !/committee|subcommittee/i.test(name)) return [];
    const title = bits.slice(1).find(bit => /^(?:member|chair|chairperson|vice chair|ranking member|co-chair)$/i.test(bit)) ?? null;
    const period = bits.slice(1).find(bit => /^\d{4}(?:\s*[-–]\s*(?:\d{4}|present|current))?$/i.test(bit)) ?? null;
    return [{ name, title, period, quote }];
  });
}

/** A committee name never creates a committee: only an exact, unambiguous held identity can receive it. */
export function heldCommitteeFacts(subject: HeldSubjectDetails, html: string, url: string, known: readonly HeldCommitteeIdentity[]): HeldDetailFact[] {
  return heldCommitteeCandidates(subject, html, url).flatMap(candidate => {
    const matches = known.filter(committee => committeeNameKey(committee.name) === committeeNameKey(candidate.name));
    if (matches.length !== 1) return [];
    const committee = matches[0]!;
    return [{ entityId: subject.personId ?? subject.subjectId, field: `committee:${committee.committeeId}`, fieldKind: "officeholder" as const,
      value: { committeeId: committee.committeeId, name: committee.name, rank: null, title: candidate.title, period: candidate.period, url: committee.url },
      valueText: candidate.name, quote: candidate.quote, sourceUrl: url }];
  });
}

/** Dated quoted speech names its speaker in the same article; page headings and topics are never attribution. */
export function heldStatementFacts(subject: HeldSubjectDetails, capture: WorkerPublicationCapture): HeldDetailFact[] {
  if (subject.subjectKind !== "official" || !subject.personName || !subject.sourceUrls.includes(capture.evidence.canonicalUrl)) return [];
  const facts: HeldDetailFact[] = [], url = capture.evidence.canonicalUrl;
  const append = (quote: string, date: string, title: string | null) => {
    const contentHash = digest(quote), subjectId = subject.personId ?? subject.subjectId;
    const snapshot: SourceSnapshot = { id: `${subjectId}|${url}|${contentHash}`, subjectId, subjectName: subject.personName!,
      kind: "OFFICIAL_PAGE", url, contentHash, retrievedAt: capture.observedAt, postedOn: date,
      httpStatus: capture.httpStatus!, extraction: "ok", text: quote, title,
      sourceRevision: { revisionId: `${capture.evidence.artifactId}:${capture.evidence.contentHash}`, artifactId: capture.evidence.artifactId,
        canonicalUrl: url, rawContentHash: capture.evidence.contentHash.replace(/^sha256-/, ""), capturedAt: capture.observedAt,
        extractionVersion: 1, supersedesRevisionId: null } };
    const field = `statement:${digest(`${url}|${date}|${quote}`)}`;
    if (!facts.some(fact => fact.field === field)) facts.push({ entityId: subjectId, field, fieldKind: "statement", value: snapshot,
      valueText: quote, quote, sourceUrl: url });
  };
  for (const article of capture.evidence.text.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article\s*>/gi)) {
    const dates = [...article[1].matchAll(/<time\b[^>]*datetime\s*=\s*["'](\d{4}-\d{2}-\d{2})(?:T[^"']*)?["'][^>]*>/gi)].map(match => match[1]!);
    const uniqueDates = [...new Set(dates)];
    if (uniqueDates.length !== 1) continue;
    const date = uniqueDates[0]!, parsed = new Date(`${date}T00:00:00.000Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || date > capture.observedAt.slice(0, 10)) continue;
    for (const block of article[1].matchAll(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote\s*>\s*(<cite\b[^>]*>[\s\S]*?<\/cite\s*>)?/gi)) {
      const cite = /<cite\b[^>]*>([\s\S]*?)<\/cite\s*>/i.exec(block[0]);
      if (!cite || personKey(cite[1]) !== personKey(subject.personName)) continue;
      const quote = text(block[1].replace(/<cite\b[^>]*>[\s\S]*?<\/cite\s*>/gi, ""));
      if (!quote || !text(article[0]).includes(quote)) continue;
      append(quote, date, text(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]\s*>/i.exec(article[1])?.[1] ?? "") || null);
    }
  }
  for (const script of capture.evidence.text.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    let parsed: unknown; try { parsed = JSON.parse(script[1]!); } catch { continue; }
    const rows = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" && Array.isArray((parsed as { "@graph"?: unknown })["@graph"])
      ? (parsed as { "@graph": unknown[] })["@graph"] : [parsed];
    for (const value of rows) {
      if (!value || typeof value !== "object") continue;
      const row = value as Record<string, unknown>, author = row.author;
      if (!["Article", "NewsArticle", "BlogPosting"].includes(String(row["@type"])) || !author || typeof author !== "object" || Array.isArray(author) ||
        personKey(String((author as Record<string, unknown>).name ?? "")) !== personKey(subject.personName) ||
        typeof row.datePublished !== "string" || typeof row.articleBody !== "string") continue;
      const date = publicationDay(row.datePublished, capture.observedAt), quote = text(row.articleBody);
      if (!date || !quote) continue;
      append(quote, date, typeof row.headline === "string" ? row.headline : null);
    }
  }
  return facts;
}
