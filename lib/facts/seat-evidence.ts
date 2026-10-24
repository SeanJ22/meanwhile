import { visibleText } from "../extract/visible-text.ts";
import { boundedIndexOf, normalizeText } from "./check.ts";
import { isOfficeTitle, looksLikeNameCell } from "../hunt/roster-page.ts";

// A supervisor of a kind of work is staff; county supervisors, a Town Supervisor and numbered supervisory districts are seats.
const JOB_SUPERVISOR = "(?:maintenance|road|roads|highway|street|streets|bridge|public works|works|water|sewer|wastewater|sanitation|solid waste|landfill|utilit(?:y|ies)|park|parks|recreation|facilit(?:y|ies)|building|grounds|cemetery|fleet|equipment|shop|garage|transportation|bus|custodial|food service|nutrition|cafeteria|library|operations|field|crew|shift|plant|program|department|dept|office|it|technology|payroll|billing|collections|records|dispatch|animal control|code enforcement|inspection|election|elections|youth|school|district office)\\s+supervisors?";
const STAFF_TITLE = new RegExp(`\\b(manager|clerk|attorney|administrator|director|superintendent|engineer|planner|treasurer|secretary|coordinator|assistant|staff|purchasing|procurement|administrative head|teacher|principal|counselor|custodian|paraprofessional|specialist|technician|captain|officer|${JOB_SUPERVISOR}|supervisors? of (?:maintenance|roads?|highways?|streets?|public works|operations|parks))\\b`, "i");
const COUNCIL_SEAT = /\b((vice|deputy)[- ]?)?mayor\b|\bcouncil[- ]?(m[ae]n|member|woman|person|or|lor|president)s?\b|\balder(m[ae]n|woman|person)\b|\bselect(m[ae]n|woman|board)\b|\b(trustee|supervisor|freeholder|legislator|commissioner)s?\b/i;
const BOARD_SEAT = /\b(vice[- ]?)?(chair(person|man|woman)?|president)\b|\bboard (?:members?|clerk|secretary|treasurer)\b|\bmember of the board\b/i;
const SEAT_NUMBER = /\b(?:(?:district|ward|seat|position|place|zone)\s*(?:no\.?\s*)?\d+|seat\s+[a-f]|at[- ]large)\b(?![\w@])/i;
const TERM_LINE = /\bterms?\s*(?:expires?|ends?|:|\(|[-–]\s*\d{1,2}\/\d{2,4})|\bterm of office\b|\b(?:elected|appointed) (?:to|in|for) /i;
const SEAT_MARKER = /\b(?:(?:seat|position|place|zone|ward)\s*(?:no\.?\s*)?\d+|seat\s+[a-f])\b(?![\w@])/i;
const WARD = /\b(?:ward|district)\s*(?:no\.?\s*)?(\d+)\b/i;
const ROSTER_HEADER = /\bname\s+seat\s+seat expires\b|\bdistrict\s+member\b/i;

/** The seat a person's own words show on this body, or null: a staff title never seats anyone, and a council seats only by its own titles. */
export function seatIn(words: string, bodyId: string, personName?: string): { readonly ward: string | null } | null {
  if (personName) {
    const at = words.toLowerCase().indexOf(personName.toLowerCase());
    const before = words.slice(0, at);
    const appointment = /\b(?:appointed|elected|named)\s*$/i.exec(before);
    if (at >= 0 && appointment) words = words.slice(appointment.index);
    const clauses = words.split(/;\s*|\s+(?:and|while)\s+|,\s*(?=(?:city|town|county|school) (?:manager|clerk|superintendent))/i);
    const own = clauses.find(clause => clause.toLowerCase().includes(personName.toLowerCase()));
    if (own && clauses.length > 1 && (COUNCIL_SEAT.test(own) || BOARD_SEAT.test(own))) words = own;
  }
  if (FORMER.test(words) || /\bserved (?:as|from)\b|\b(?:18|19)\d{2}\s*[-–]\s*(?:18|19)\d{2}\b/i.test(words)) return null;
  const council = bodyId.endsWith("#governing"), board = bodyId.endsWith("#board");
  // A lettered or numbered seat is a seat held, whatever office the holder also fills ("Seat E - Secretary/Treasurer" is a school board member).
  const seated = (council || board) && SEAT_MARKER.test(words);
  const boardOffice = board && /\bgoverning board (?:clerk|secretary|treasurer)\b/i.test(words);
  const staff = [...words.matchAll(new RegExp(STAFF_TITLE.source, "gi"))].map(match => match[0]);
  if (staff.length && !seated && !(boardOffice && staff.every(title => /^(?:clerk|secretary|treasurer)$/i.test(title)))) return null;
  // A city's maintenance supervisor is staff. A county supervisor, Town Supervisor, or a numbered district is a seat.
  if (/\bsupervisor\b/i.test(words) && !/county[:/]|:county:/.test(bodyId) && !/\btown supervisor\b|\bboard of supervisors\b/i.test(words) && !SEAT_NUMBER.test(words)) return null;
  // On a council or a board, the district, ward or seat a person holds is a seat on its own ("Annie Williams, District 1"), and a school board's plain "Member" is a member.
  // A county board's "Chairman" is a seat on it, unless the words put that chair on a committee, department or authority.
  const chairs = council && /\b(?:vice[- ]?)?chair(?:man|woman|person)?\b/i.test(words) && !/\b(?:committee|department|commission|authority|library|hospital|district board)\b/i.test(words);
  // A term served is a seat held: staff do not serve terms ("Term: October 2023 - October 2026", "Term Expires 3/28").
  const appointed = /\b(?:appointed|elected|named)\b[^.!?]{0,100}\bto (?:the )?(?:[\w.'#-]+\s+){0,10}(?:governing board|board of (?:education|trustees|supervisors)|school board|city council|town council)\b/i.test(words);
  const numbered = (council || board) && (SEAT_NUMBER.test(words) || TERM_LINE.test(words) || ROSTER_HEADER.test(words)) || board && /\bmembers?\b/i.test(words) || chairs || appointed;
  if (!numbered && !COUNCIL_SEAT.test(words) && (council || !BOARD_SEAT.test(words)) && (council || board || !/\bmembers?\b/i.test(words))) return null;
  const district = [...words.matchAll(new RegExp(WARD.source, "gi"))].find(match => !/\bschool\s+$/i.test(words.slice(0, match.index)));
  return { ward: council || board ? district?.[1] ?? null : null };
}

/** Only a title the saved passage actually writes is attached to the person's card. */
export function seatTitleIn(quote: string, bodyId: string, name: string): string | null {
  const lines = quote.split("\n"), at = lines.findIndex(line => line.toLowerCase().includes(name.toLowerCase()));
  const words = [lines[at], lines[at + 1], lines[at - 1]].filter((line): line is string => !!line &&
    (line.toLowerCase().includes(name.toLowerCase()) || !looksLikeNameCell(line))).join("\n");
  return (bodyId.endsWith("#board") ? /\b(?:Governing Board (?:Clerk|Secretary|Treasurer|Member|President)|Board Member|(?:Vice[- ]?)?President|(?:Vice[- ]?)?Chair(?:man|woman|person)?)\b/i.exec(words)
    : COUNCIL_SEAT.exec(words))?.[0] ?? null;
}

const FORMER = /\b(former|past|previous|late|retired|deceased)\s+(?:\w+\s+){0,2}(?:mayors?|council|members?|officials?|officeholders?|commissioners?|trustees?|presidents?|chairs?|chairmen|chairwomen|officers?)\b|\bhistory of\b/i;

/** Read this person's seat from a contiguous passage of the same saved page. A page-wide menu is not a person's title. */
export function seatQuoteOnPage(page: string, name: string, bodyId: string, original: string): string | null {
  if (!looksLikeNameCell(name)) return null;
  const text = visibleText(page), normalized = normalizeText(text);
  const hasName = (words: string) => boundedIndexOf(normalizeText(words).toLowerCase(), normalizeText(name).toLowerCase()) >= 0;
  const headings = [...page.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi)]
    .map(m => ({ at: m.index!, level: Number(m[1]), text: visibleText(m[2]!) }));
  // Historical directories cannot prove current seats, even if each row just says "Mayor".
  if (headings.some(h => h.level <= 1 && FORMER.test(h.text)) || /<title\b[^>]*>[^<]*(?:former|past) mayors?/i.test(page)) return null;
  if (headings.some(h => FORMER.test(h.text) && hasName(visibleText(page.slice(h.at,
    headings.find(next => next.at > h.at && next.level <= h.level)?.at ?? page.length))))) return null;
  const valid = (words: string) => hasName(words) && !FORMER.test(words) && seatIn(words, bodyId, name) !== null;
  for (const heading of headings) if (valid(heading.text)) return heading.text;
  // A paragraph or table row keeps the person's name and title together across inline markup.
  for (const block of page.matchAll(/<(p|li|tr)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)) {
    const passage = visibleText(block[2]!);
    if (passage.length < 600 && valid(passage)) return passage;
  }
  const lines = text.split("\n");
  // An explicit members list binds every listed name to the heading. A general council page does not.
  for (let start = 0; start < lines.length; start++) {
    if (!/\b(?:board(?: of education)?|council) members\b/i.test(lines[start]!) || lines[start]!.length > 180 || /\b(?:former|past|archives?|staff|minutes|agendas?)\b/i.test(lines[start]!)) continue;
    for (let end = start + 1; end < Math.min(lines.length, start + 25); end++) {
      const line = lines[end]!;
      if (hasName(line)) {
        const passage = lines.slice(start, end + 1).join("\n");
        if (valid(passage)) return passage;
      }
      if (!looksLikeNameCell(line) && !/\b(?:president|chair|member)\b/i.test(line)) break;
    }
  }
  // A table's own Name / Seat / Seat Expires columns establish lettered seats without inventing "Seat D".
  for (const table of page.matchAll(/<table\b[^>]*>[\s\S]*?<\/table\s*>/gi)) {
    const tableText = visibleText(table[0]);
    if (!ROSTER_HEADER.test(tableText) || !hasName(tableText)) continue;
    const end = tableText.toLowerCase().indexOf(name.toLowerCase()) + name.length;
    const passage = tableText.slice(0, end);
    if (passage.length <= 6000 && valid(passage)) return passage;
  }
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (!hasName(line)) continue;
    if (valid(line)) return line;
    // Only the clause describing this person determines whether a staff title vetoes the seat.
    const sentences = line.split(/(?<=[.!?])\s+(?=[A-Z])/).filter(hasName);
    for (const sentence of sentences) if (valid(sentence)) return sentence;
    if (STAFF_TITLE.test(line) || FORMER.test(line)) continue;
    // A title immediately above or below a name belongs to that name when it names no other person.
    for (const neighbor of [index + 1, index - 1]) {
      const title = lines[neighbor];
      if (!title || !(isOfficeTitle(title) || TERM_LINE.test(title) || /^(?:(?:vice|deputy)[- ]?)?(?:mayor|councilmember) of [\p{L} .'-]+$/iu.test(title)) || !seatIn(title, bodyId)) continue;
      if (neighbor < index && /\band\b|\b(?:mayors|members|council|board|commission)\s*$/i.test(title)) continue;
      if (neighbor < index && index >= 2 && looksLikeNameCell(lines[index - 2]!)) continue;
      const passage = lines.slice(Math.min(index, neighbor), Math.max(index, neighbor) + 1).join("\n");
      if (valid(passage)) return passage;
    }
  }
  // Profile headings sometimes separate a person's name and office with markup, or put a short navigation line between them.
  for (const heading of headings.filter(h => hasName(h.text))) {
    const end = headings.find(h => h.at > heading.at && h.level <= heading.level)?.at ?? page.length;
    const section = visibleText(page.slice(heading.at, end));
    if (FORMER.test(section.slice(0, 300))) continue;
    for (const sentence of section.split(/(?<=[.!?])\s+(?=[A-Z])/).filter(hasName)) {
      if (sentence.length < 600 && valid(sentence)) return sentence;
    }
  }
  // Split prose before applying the staff veto: another person's job in the next sentence says nothing about this person.
  const ownSentences = original.split(/(?<=[.!?])\s+(?=[A-Z])/).filter(hasName);
  for (const sentence of ownSentences) {
    const at = normalized.toLowerCase().indexOf(normalizeText(sentence).toLowerCase());
    if (valid(sentence) && at >= 0) return normalized.slice(at, at + normalizeText(sentence).length);
  }
  return null;
}
