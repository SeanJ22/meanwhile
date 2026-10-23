import { visibleText, decodeEntities } from "../../../extract/visible-text.ts";
import { readHeldRoster, type HeldRosterRow } from "../../../civic-data/worker-held-roster.ts";
import { readHeldMeetingSchedule } from "../../../civic-data/worker-held-meetings.ts";
import { imagesIn, pickPortraits } from "../../../hunt/portrait-pick.ts";
import type { FieldKind } from "../../../facts/check.ts";
import type { HeldSubjectDetails } from "./held-subject-enrichment.ts";
import { currentCongressTerm } from "../../../officials/congress-normalize.ts";
import { officialTermScope } from "./held-subject-fields.ts";

export interface HeldDetailFact {
  readonly entityId: string;
  readonly field: string;
  readonly fieldKind: FieldKind;
  readonly value: unknown;
  readonly valueText: string;
  readonly quote: string;
  readonly sourceUrl: string;
}
export interface HeldDetailsExtraction {
  readonly facts: readonly HeldDetailFact[];
  readonly rosterRows: readonly HeldRosterRow[];
  readonly completeRoster: boolean;
  /** A candidate for the existing portrait verifier, never a published portrait. */
  readonly portraitImageUrl: string | null;
  readonly refused: string | null;
}

const words = (value: string) => visibleText(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const norm = (value: string) => value.replace(/\s+/g, " ").trim();
const phone = (value: string) => /\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/.exec(value)?.[0] ?? null;
const mail = (value: string) => /[\w.!#$%&'*+/=?^`{|}~-]+@[\w.-]+\.[a-z]{2,}/i.exec(value)?.[0] ?? null;
const tidy = (html: string) => (/<main\b[^>]*>([\s\S]*?)<\/main\s*>/i.exec(html)?.[1] ?? html)
  .replace(/<(script|style|nav|footer|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
const headingNames = (html: string, name: string, office: string | null) => {
  const expected = [name, ...(office ? [`${office} ${name}`, `${name} ${office}`] : [])].map(words);
  return [...html.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]\s*>/gi)].some(match => expected.includes(words(match[1])));
};
const DETAIL_HEADING = /^(?:(?:board|council|commission) )?(?:members?|membership|roster|current members?|contact(?: information)?|public contact|office(?: address)?|meetings?|meeting (?:schedule|calendar)|calendar|agendas?(?: and minutes)?|minutes|about|public comment)$/i;
function namedSection(html: string, name: string): string | null {
  const headings = [...html.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]\s*>/gi)];
  const start = headings.findIndex(heading => headingNames(heading[0], name, null));
  if (start < 0) return null;
  const end = headings.slice(start + 1).find(heading => !headingNames(heading[0], name, null) && !DETAIL_HEADING.test(norm(visibleText(heading[1]))));
  return html.slice(headings[start]!.index, end?.index ?? html.length);
}

/** Keep one source-native array member in memory, even when the held source is a national directory. */
interface CongressDetailRecord {
  readonly id?: { readonly bioguide?: string };
  readonly name?: { readonly official_full?: string; readonly first?: string; readonly middle?: string; readonly last?: string; readonly suffix?: string };
  readonly terms?: Parameters<typeof currentCongressTerm>[0];
}
function congressRecord(text: string, bioguide: string): { record: CongressDetailRecord; raw: string } | null {
  if (!/^\s*\[/.test(text)) return null;
  let depth = 0, start = -1, quoted = false, escaped = false;
  for (let at = text.indexOf("[") + 1; at < text.length; at++) {
    const char = text[at];
    if (quoted) { if (escaped) escaped = false; else if (char === "\\") escaped = true; else if (char === '"') quoted = false; continue; }
    if (char === '"') { quoted = true; continue; }
    if (char === "{") { if (depth++ === 0) start = at; }
    else if (char === "}" && --depth === 0) {
      const raw = text.slice(start, at + 1);
      if (!raw.includes(bioguide)) continue;
      try { const record = JSON.parse(raw); if (record?.id?.bioguide === bioguide) return { record, raw }; } catch { return null; }
    }
  }
  return null;
}

/** Only values written on this saved source, attached to its exact known subject; unsupported families remain owed. */
export function extractHeldSubjectDetails(subject: HeldSubjectDetails, html: string, sourceUrl: string, asOf = new Date().toISOString()): HeldDetailsExtraction {
  const facts: HeldDetailFact[] = [];
  const empty = (refused: string): HeldDetailsExtraction => ({ facts: [], rosterRows: [], completeRoster: false, portraitImageUrl: null, refused });
  if (!subject.sourceUrls.includes(sourceUrl)) return empty("SOURCE_NOT_REGISTERED_FOR_HELD_SUBJECT");
  const bioguide = /^congress:([A-Z]\d{6})$/.exec(subject.subjectId)?.[1] ?? /^congress:([A-Z]\d{6})$/.exec(subject.personId ?? "")?.[1];
  if (subject.subjectKind === "official" && bioguide && /^\s*\[/.test(html)) {
    const found = congressRecord(html, bioguide);
    if (!found) return empty("HELD_OFFICIAL_NOT_IN_DIRECTORY");
    const row = found.record, name = row.name?.official_full ?? [row.name?.first, row.name?.middle, row.name?.last, row.name?.suffix].filter(Boolean).join(" ");
    const term = Array.isArray(row.terms) ? currentCongressTerm(row.terms, asOf) : null;
    const state = /\/(?:state|district|territory):([a-z]{2})(?:\/|$)/i.exec(subject.divisionIds[0] ?? "")?.[1]?.toUpperCase();
    const chamber = /senator/i.test(subject.officeTitle ?? "") ? "sen" : /representative|delegate|commissioner/i.test(subject.officeTitle ?? "") ? "rep" : null;
    if (!subject.personName || words(name) !== words(subject.personName) || !term || term.state !== state || term.type !== chamber)
      return empty("DIRECTORY_IDENTITY_OR_CURRENT_TERM_MISMATCH");
    for (const [key, field] of [["phone", "phone"], ["url", "website"], ["office", "office_address"]] as const) {
      const value = term[key];
      if (typeof value !== "string" || !value.trim()) continue;
      const quoted = new RegExp(`"${key}"\\s*:\\s*${JSON.stringify(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).exec(found.raw)?.[0];
      if (quoted) facts.push({ entityId: subject.personId ?? subject.subjectId, field, fieldKind: "contact", value, valueText: value, quote: quoted, sourceUrl });
    }
    const termScope = officialTermScope(subject.bodyId, subject.officeTitle);
    if (termScope) for (const [key, field] of [["start", "term_start"], ["end", "term_end"]] as const) {
      const value = term[key];
      if (typeof value !== "string" || !value.trim()) continue;
      const quoted = new RegExp(`"${key}"\\s*:\\s*${JSON.stringify(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).exec(found.raw)?.[0];
      if (quoted) facts.push({ entityId: subject.personId ?? subject.subjectId, field: `${field}:${termScope}`, fieldKind: "officeholder",
        value, valueText: value, quote: quoted, sourceUrl });
    }
    return { facts, rosterRows: [], completeRoster: false, portraitImageUrl: null, refused: null };
  }
  const identity = subject.subjectKind === "official" ? subject.personName : subject.subjectKind === "body" ? subject.bodyName : subject.label;
  let scope = tidy(html);
  if (subject.subjectKind !== "official") {
    const section = identity ? namedSection(scope, identity) : null;
    if (!section) return empty("SOURCE_NOT_ABOUT_HELD_SUBJECT");
    scope = section;
  } else if (subject.bodyName && !subject.profileUrls.includes(sourceUrl)) {
    scope = namedSection(scope, subject.bodyName) ?? scope;
  }
  const text = norm(visibleText(scope));
  const entityId = subject.subjectKind === "official" ? subject.personId ?? subject.subjectId : subject.subjectId;
  const push = (field: string, value: string | null | undefined, quote: string, fieldKind: FieldKind = "contact", valueText = value) => {
    if (!value || !valueText || !quote || !norm(quote).includes(norm(valueText))) return;
    if (!norm(visibleText(html)).includes(norm(quote)) && !html.includes(quote)) return;
    if (!facts.some(held => held.field === field && held.value === value)) facts.push({ entityId, field, fieldKind, value, valueText, quote, sourceUrl });
  };
  const term = (label: string, value: string, quote: string) => {
    if (subject.subjectKind !== "official") return;
    const scope = officialTermScope(subject.bodyId, subject.officeTitle);
    if (!scope) return;
    const field = /\b(start|starts|begin|begins|since)\b/i.test(label) ? "term_start"
      : /\b(end|ends|expire|expires|until|through)\b/i.test(label) ? "term_end" : "term_note";
    push(`${field}:${scope}`, value, quote, "officeholder");
  };
  const roster = readHeldRoster(scope, sourceUrl);
  if (subject.subjectKind === "official" && subject.personName) {
    const matches = roster?.rows.filter(row => words(row.name) === words(subject.personName!) &&
      (!subject.officeTitle || words(row.office) === words(subject.officeTitle))) ?? [];
    if (matches.length === 1) {
      const row = matches[0]!;
      const matchedRows = [...scope.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)].filter(match => {
        const seen = words(match[1]); return seen.includes(words(row.nameAsWritten)) && seen.includes(words(row.office));
      });
      const raw = matchedRows.length === 1 ? matchedRows[0]![0] : null;
      if (raw) {
        push("email", row.email, row.email ?? "");
        push("phone", row.phone, row.phone ?? "");
        if (row.websiteUrl) {
          const anchor = [...raw.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>[\s\S]*?<\/a\s*>/gi)].find(match => {
            try { return new URL(decodeEntities(match[1]), sourceUrl).href === row.websiteUrl; } catch { return false; }
          });
          if (anchor) push("website", row.websiteUrl, anchor[0], "contact", anchor[1]);
        }
        for (const table of scope.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table\s*>/gi)) {
          if (!table[1].includes(raw)) continue;
          const header = /<tr\b[^>]*>([\s\S]*?<th\b[\s\S]*?)<\/tr\s*>/i.exec(table[1])?.[1];
          const headings = [...(header ?? "").matchAll(/<th\b[^>]*>([\s\S]*?)<\/th\s*>/gi)].map(match => norm(visibleText(match[1])));
          const values = [...raw.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td\s*>/gi)].map(match => norm(visibleText(match[1])));
          headings.forEach((label, index) => { if (/\bterm\b|\bservice (start|end|begin|since)\b/i.test(label) && values[index]) term(label, values[index]!, values[index]!); });
        }
      }
    }
  }
  const about = identity !== null && headingNames(scope, identity, subject.subjectKind === "official" ? subject.officeTitle : null);
  if (!about) return facts.length ? { facts, rosterRows: [], completeRoster: false, portraitImageUrl: null, refused: null }
    : empty("SOURCE_NOT_ABOUT_HELD_SUBJECT");
  if (subject.subjectKind !== "official") push("name", identity!, identity!, "officeholder");

  // Labelled office fields carry the surrounding exact subject heading; site footers and a staff member's later section never supply them.
  const labels: { label: string; value: string; quote: string; at: number }[] = [];
  for (const match of scope.matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt\s*>\s*<dd\b[^>]*>([\s\S]*?)<\/dd\s*>|<tr\b[^>]*>\s*<th\b[^>]*>([\s\S]*?)<\/th\s*>\s*<td\b[^>]*>([\s\S]*?)<\/td\s*>\s*<\/tr\s*>/gi)) {
    labels.push({ label: norm(visibleText(match[1] ?? match[3])), value: norm(visibleText(match[2] ?? match[4])), quote: match[0], at: match.index });
  }
  for (const match of scope.matchAll(/<(p|li)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)) {
    const line = norm(visibleText(match[2])), colon = line.indexOf(":");
    if (colon > 0 && colon < 50) labels.push({ label: line.slice(0, colon), value: line.slice(colon + 1).trim(), quote: match[0], at: match.index });
  }
  for (const item of labels) {
    const previous = [...scope.slice(0, item.at).matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]\s*>/gi)].at(-1)?.[1];
    if (previous && !headingNames(`<h1>${previous}</h1>`, identity!, subject.officeTitle) &&
      !/^(?:office|contact(?: information)?|public contact|term|service|tenure|biography|about|profile)$/i.test(norm(visibleText(previous)))) continue;
    const label = words(item.label), quote = norm(visibleText(item.quote));
    if (/\b(home|personal|residential|campaign)\b/.test(label)) continue;
    if (/\b(phone|telephone|tel)\b/.test(label)) push(subject.subjectKind === "official" ? "phone" : "office_phone", phone(item.value), quote);
    else if (/\b(email|e mail)\b/.test(label) && subject.subjectKind === "official") push("email", mail(item.value), quote);
    else if (/\b(office|city hall|town hall|municipal office|government office|county office) address\b/.test(label)) push("office_address", item.value, quote);
    else if (/\bterm|\bservice (start|end|begin|since)\b/.test(label)) term(label, item.value, quote);
  }
  // Structured records must identify this exact person or institution. Other records on the same page cannot donate fields.
  for (const script of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    let parsed: unknown;
    try { parsed = JSON.parse(script[1]); } catch { continue; }
    const rows = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" && Array.isArray((parsed as { "@graph"?: unknown })["@graph"])
      ? (parsed as { "@graph": unknown[] })["@graph"] : [parsed];
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const record = row as Record<string, unknown>;
      const types = Array.isArray(record["@type"]) ? record["@type"] : [record["@type"]];
      const correctType = subject.subjectKind === "official" ? types.includes("Person")
        : types.some(type => ["GovernmentOrganization", "GovernmentOffice", "CityHall"].includes(String(type)));
      if (!correctType || typeof record.name !== "string" || words(record.name) !== words(identity!)) continue;
      const quoted = (key: string, value: string) => new RegExp(`"${key}"\\s*:\\s*${JSON.stringify(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).exec(script[0])?.[0] ?? "";
      if (typeof record.telephone === "string") push(subject.subjectKind === "official" ? "phone" : "office_phone", phone(record.telephone), quoted("telephone", record.telephone));
      if (typeof record.email === "string" && subject.subjectKind === "official") push("email", mail(record.email), quoted("email", record.email));
      if (typeof record.url === "string" && record.url === sourceUrl) push(subject.subjectKind === "official" ? "website" : "homepage", record.url, quoted("url", record.url));
      if (subject.subjectKind !== "official" && typeof record.address === "string") push("office_address", record.address, quoted("address", record.address));
    }
  }
  if (subject.subjectKind !== "official") {
    const schedule = readHeldMeetingSchedule(scope, sourceUrl);
    if (schedule?.cadence && text.includes(norm(schedule.cadence))) push("meeting_cadence", schedule.cadence, schedule.cadence, "meeting");
    if (schedule?.agendaUrl) {
      const anchor = [...scope.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>[\s\S]*?<\/a\s*>/gi)]
        .find(match => { try { return new URL(decodeEntities(match[1]), sourceUrl).href === schedule.agendaUrl; } catch { return false; } });
      if (anchor) push("agenda_url", schedule.agendaUrl, anchor[0], "meeting", anchor[1]);
    }
  }
  const portrait = subject.subjectKind === "official" && subject.personName && subject.profileUrls.includes(sourceUrl)
    ? pickPortraits(subject.personName, imagesIn(scope, sourceUrl))[0]?.src ?? null : null;
  const members = (roster?.rows ?? []).filter(row => !/\b(staff|manager|clerk|attorney|administrator|superintendent|engineer|planner|assistant|executive director|director of|secretary to)\b/i.test(row.office) &&
    /\b(mayor|council|councillor|councilor|chair|president|member|commissioner|supervisor|trustee|director|secretary|alderman|alderwoman|selectman)\b/i.test(row.office));
  return { facts, rosterRows: subject.subjectKind === "body" ? members : [],
    completeRoster: subject.subjectKind === "body" && Boolean(roster?.complete) && members.length === roster?.rows.length,
    portraitImageUrl: portrait, refused: null };
}
