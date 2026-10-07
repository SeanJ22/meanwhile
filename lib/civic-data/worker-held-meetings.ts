/** The schedule is kept in the page's own words; no date is ever computed from it. */
import type { ArtifactRecord } from "../control-plane/repository/types.ts";
import { pageWords, section3Page, section3Record } from "../control-plane/promotion/section3.ts";
import { captureIntact, heldPageCopies } from "./worker-publication-evidence.ts";
import { pageIsAboutBody, type WorkerPublicationCapture } from "./worker-roster-publication.ts";

export interface HeldMeetingSchedule {
  readonly cadence: string | null;
  readonly agendaUrl: string | null;
  readonly calendarUrl: string | null;
}

const decode = (text: string) => text
  .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&nbsp;/gi, " ").replace(/&quot;/gi, "\"").replace(/&#39;|&apos;/gi, "'").replace(/&ndash;/gi, "–").replace(/&mdash;/gi, "—")
  .replace(/&[lr]squo;/gi, "’").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&amp;/gi, "&");
const visible = (html: string) => decode(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

const DAY = "(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?";
const RECURRING = new RegExp(`\\b(?:(?:first|second|third|fourth|last|1st|2nd|3rd|4th|every|each)\\b[\\w\\s,&]{0,30}?\\b${DAY}|${DAY} of (?:each|every) month)\\b`, "i");
const TIME = /\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)(?=[\s,.;)]|$)|\bnoon\b/i;
const MEETS = /\b(meet|meets|meeting|meetings|session|sessions|held)\b/i;
const MEETING_PAGE = /\b(meeting|meetings|agendas?|calendar)\b/i;

/** "at 5:00 p.m. in Council Chambers" stays one sentence; "at 5:00 p.m. Special meetings …" is two. */
const sentences = (text: string) => text.split(/(?<=[.!?])\s+(?=[A-Z])/).map(sentence => sentence.trim()).filter(Boolean);

function absolute(href: string, pageUrl: string): string | null {
  try {
    const url = new URL(decode(href), pageUrl);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch { return null; }
}

/** The page's main content: site chrome repeats every page's links and is never this body's. */
function content(html: string): string {
  const main = /<main\b[^>]*>([\s\S]*?)<\/main\s*>/i.exec(html)?.[1] ?? html;
  return main.replace(/<(script|style|template|nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
}

export function scheduleSentences(html: string): string | null {
  // A schedule sentence names a recurring day; its time may follow in the next sentence of the same block.
  const lines = html.split(/<\/(?:p|h[1-6]|li|div|td|tr|dd|dt|section|article)\s*>|<br\s*\/?>/i).map(visible).filter(Boolean).flatMap(sentences);
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!RECURRING.test(lines[i]) || !MEETS.test(lines[i]) || lines[i].length > 400) continue;
    kept.push(lines[i]);
    if (!TIME.test(lines[i]) && lines[i + 1] && TIME.test(lines[i + 1]) && !RECURRING.test(lines[i + 1])) kept.push(lines[++i]);
  }
  return kept.some(line => TIME.test(line)) ? kept.join(" ") : null;
}

export function readHeldMeetingSchedule(html: string, pageUrl: string): HeldMeetingSchedule | null {
  const title = visible(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)?.[1] ?? "");
  const body = content(html);
  const cadence = scheduleSentences(body);
  let agendaUrl: string | null = null, calendarUrl: string | null = null;
  for (const link of body.matchAll(/<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a\s*>/gi)) {
    const url = absolute(link[1] ?? link[2], pageUrl);
    if (!url || /^(mailto|tel):/i.test(url)) continue;
    const label = visible(link[3]);
    const before = visible(body.slice(Math.max(0, (link.index ?? 0) - 200), link.index)).split(/[.;:]\s/).at(-1) ?? "";
    const context = `${before} ${label}`;
    if (!agendaUrl && /\bagendas?\b/i.test(context) && !/\bminutes\b/i.test(label) && (/\bmeeting/i.test(label) || /\bagendas?\b/i.test(label))) agendaUrl = url;
    if (!calendarUrl && /\bcalendar\b/i.test(label)) calendarUrl = url;
  }
  if (!cadence && !(MEETING_PAGE.test(title) && (agendaUrl || calendarUrl))) return null;
  return { cadence, agendaUrl, calendarUrl };
}

export interface HeldBodySchedule {
  readonly schedule: HeldMeetingSchedule;
  readonly capture: WorkerPublicationCapture;
}

export async function heldBodySchedule(input: {
  readonly body: { readonly id: string; readonly name: string | null };
  readonly divisionLabel: string | null;
  readonly artifacts: readonly ArtifactRecord[];
  readonly readHeld: (record: ArtifactRecord) => Promise<WorkerPublicationCapture | null>;
  readonly now: string;
  readonly limit?: number;
}): Promise<HeldBodySchedule | null> {
  const candidates = heldPageCopies(input.artifacts, input.limit ?? 60);
  // The newest usable copy of each page speaks for it; a later "Access Denied" capture never shadows a good one.
  const readUrls = new Set<string>();
  for (const record of candidates) {
    if (readUrls.has(record.canonicalUrl)) continue;
    const capture = await input.readHeld(record);
    if (!capture || !captureIntact(capture)) continue;
    const page = { url: capture.evidence.canonicalUrl, text: capture.evidence.text, retrievedAt: capture.observedAt };
    const pageVerdict = section3Page(page, "OFFICIAL_BOARD_DIRECTORY", input.now);
    if (!pageVerdict.ok || (input.divisionLabel && !pageWords(page.text).includes(input.divisionLabel.toLowerCase()))) continue;
    readUrls.add(record.canonicalUrl);
    const read = readHeldMeetingSchedule(page.text, page.url);
    if (!read) continue;
    const about = pageIsAboutBody(page.text, input.body, input.divisionLabel) ||
      (read.cadence !== null && pageIsAboutBody(`<title>${read.cadence}</title>`, input.body, input.divisionLabel));
    if (!about) continue;
    const verdict = section3Record({ recordClass: "OFFICIAL_BOARD_DIRECTORY", fields: { ...read }, page, now: input.now, pageVerdict, minimums: [] });
    const kept = (field: keyof HeldMeetingSchedule) => verdict.verifiedFields.includes(field) ? read[field] : null;
    const schedule = { cadence: kept("cadence"), agendaUrl: kept("agendaUrl"), calendarUrl: kept("calendarUrl") };
    if (schedule.cadence || schedule.agendaUrl) return { schedule, capture };
  }
  return null;
}
