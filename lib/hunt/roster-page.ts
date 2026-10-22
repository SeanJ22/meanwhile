/**
 * Read a governing body's roster off the body's own page: the pattern of a
 * table of members whose contact cell carries a `mailto:`, a block per
 * member, or a list of links to per-member contact pages. Keyed on the
 * pattern, not the vendor. Proven against New Jersey municipal sites; other
 * shapes need their own strategy.
 *
 * `extractRoster` reports what it was given and what each strategy returned.
 * A page that yields nothing names the strategies tried and the reason; it
 * never returns an empty roster that reads like an empty body.
 */

/** One person as the body's own page publishes them. */
export interface PageRosterMember {
  name: string;
  /** The source row when its name column is explicit. */
  sourceQuote?:string;
  /** The role the page states — "Council President", "Ward 3". Never inferred. */
  officeTitle: string | null;
  /** The seat, where the page names one separately from the title. */
  seat: string | null;
  /** The page's own words for the term — "Term Exp. 12/31/29". */
  termNote: string | null;
  phone: string | null;
  /**
   * The address the page displays. Where a `mailto:` href disagrees with the
   * text beside it, the displayed text wins and the href is kept separately:
   * a stale href can be a predecessor's mailbox.
   */
  email: string | null;
  /** The `mailto:` target, when it differs from the displayed address. */
  emailHrefMismatch: string | null;
  /**
   * The member's own page on the body's site, where contact goes through a
   * form rather than a published address. Not an email.
   */
  contactPageUrl?: string | null;
}

export interface RosterExtraction {
  url: string;
  /** Rows found, in page order. */
  members: PageRosterMember[];
  /** Which strategy produced them, so a new shape is visible by name. */
  strategy: string | null;
  /** Every strategy tried and what it returned — the count discipline. */
  attempts: { strategy: string; rows: number; note: string | null }[];
  /** Set when nothing was found. Never null alongside zero members. */
  failure: string | null;
  bytes: number;
}

import { revealProtectedEmails } from "../extract/visible-text.ts";

/* ── Small HTML helpers, deliberately dependency-free ───────────────────── */

const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&#39;": "'",
  "&apos;": "'",
  "&quot;": '"',
  "&lt;": "<",
  "&gt;": ">",
  "&#8203;": "",
  "&rsquo;": "’",
  "&ndash;": "–",
  "&mdash;": "—",
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&[a-z]+;|&#\d+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m);
}

/** Cell text with `<br>` preserved as a line break — the layout carries meaning. */
export function cellText(html: string): string {
  return decodeEntities(
    revealProtectedEmails(html)
      /*
       * `<style>` and `<script>` bodies are not text; some page builders emit
       * a `<style>` block inside the content region.
       */
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      // WYSIWYG editors emit `<br id="isPasted">` and `<br data-pasted="true">`;
      // match the tag, not only the tidy form, or a name and term run together.
      .replace(/<br\b[^>]*>/gi, "\n")
      .replace(/<\/(?:p|div|li|tr|h[1-6]|td|th)>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .split("\n")
    .map((l) => l.replace(/​/g, "").trim())
    .filter((l) => l.length > 0)
    .join("\n")
    .trim();
}

const PHONE = /(?:\(\d{3}\)\s*|\d{3}[-.\s])\d{3}[-.\s]\d{4}(?:\s*(?:x|ext\.?|extension)\s*\d{1,6})?/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

/**
 * Does this cell read as a person's name? Reuses the roster parser's shape test
 * in spirit — capitalised tokens, no office word — but tolerates the trailing
 * term parenthetical municipal pages glue on beneath the name.
 */
const OFFICE_WORD =
  /\b(?:secretary|treasurer|pending|appointment|commission|members?|social media|policy|public safety|council|councilmember|councilman|councilwoman|councilors?|councillors?|councils|boards|committees|commissions|offices|alderman|alderwoman|alderperson|mayor|trustees?|commissioners?|officials?|staff|leadership|selectman|selectmen|selectwoman|chair|chairman|chairwoman|committee|board|township|borough|city|county|department|division|office|clerk|administrator|attorney|engineer|manager|coordinator|director|supervisor|meetings?|agendas?|minutes?|phone|email|address|term|ward|district|at[- ]large|vacant|vacancy)\b/i;

/** Words a page puts in a heading, a notice, a menu or a place's name, never in a person's: a cell holding one is not a name. */
const NOT_A_NAME =
  /\b(?:announcements?|notices?|elections?|portal|calendar|events?|news|agenda|minutes|meetings?|departments?|services?|online|links?|ticket|tickets|permits?|forms?|applications?|apply|resources?|information|contact|directory|archives?|documents?|reports?|budget|ordinances?|resolutions?|hearings?|public|works|safety|municipal|complex|center|centre|building|courthouse|library|home|about|welcome|search|login|subscribe|facebook|twitter|instagram|youtube|webcam|police|utilities|airport|inspections?|licenses?|zoning|planning|recycling|trash|sewer|taxes|careers|employment|volunteer|history|visit|visiting|living|working|business|businesses)\b/i;

export function looksLikeNameCell(text: string): boolean {
  const first = text.split("\n")[0]?.trim() ?? "";
  if (first.length < 5 || first.length > 60 || /^(?:contact|email|meet|about|biography of)\b/i.test(first)) return false;
  if (OFFICE_WORD.test(first) || NOT_A_NAME.test(first)) return false;
  if (EMAIL.test(first) || PHONE.test(first) || /\d/.test(first)) return false;
  const tokens = first.replace(/[,.]$/, "").split(/\s+/);
  if (tokens.length < 2 || tokens.length > 5) return false;
  let capitalised = 0;
  for (const token of tokens) {
    const bare = token.replace(/^["'(]+|["'),.]+$/g, "");
    if (bare.length === 0) continue;
    if (/^(?:Sr|Jr|II|III|IV|V|Esq)\.?$/i.test(bare)) continue;
    if (/^(?:van|von|de|del|della|di|da|la|le|du)$/i.test(bare)) continue;
    if (!/^[\p{Lu}][\p{L}'’.-]*$/u.test(bare)) return false;
    capitalised++;
  }
  return capitalised >= 2;
}

/**
 * The office titles a municipal page glues onto the end of a name cell.
 * Longest-first so `Council President` wins over `Council`.
 */
const TRAILING_TITLE =
  /[,\s]+((?:Deputy\s+)?Mayor|Council\s*President|Council\s*Vice[-\s]?President|Vice[-\s]?President|President|Councilm[ae]n?|Councilmember|Councilwoman|Councilman|Council\s*Member|Committeem[ae]n?|Committeewoman|Committeeman|Committee\s*Member|Commissioner|Trustee|Chair(?:person|man|woman)?|Alderm[ae]n|Alderwoman|Freeholder|Selectm[ae]n|Selectwoman)\.?$/i;

/**
 * Split a name cell into a name, a title and a term note. A page may stack
 * the term under the name with a `<br>`, or write the office into the name
 * cell (`Name, Mayor`, `Name, Jr. Councilmember`). A generational suffix stays
 * on the name and is matched before the split.
 */
function splitNameCell(text: string): {
  name: string;
  officeTitle: string | null;
  termNote: string | null;
} {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  let name = (lines[0] ?? "").replace(/[,;]$/, "").trim();

  let officeTitle: string | null = null;
  const trailing = TRAILING_TITLE.exec(name);
  if (trailing !== null) {
    officeTitle = trailing[1].replace(/\s+/g, " ").trim();
    name = name.slice(0, trailing.index).replace(/[,;\s]+$/, "").trim();
  }

  const rest = lines.slice(1).join(" ").trim();
  const term = /(?:term|expires?|elected|appointed|sworn|since)\b[^)]*/i.exec(rest)?.[0] ?? null;
  return {
    name,
    officeTitle,
    termNote: term === null ? null : term.replace(/^\(|\)$/g, "").trim(),
  };
}

/* ── Strategy 1: a table whose rows carry a name and a contact ──────────── */

interface Attempt {
  strategy: string;
  rows: number;
  note: string | null;
}

function fromTables(html: string, attempts: Attempt[]): PageRosterMember[] {
  const out: PageRosterMember[] = [];
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) ?? [];
  let tablesSeen = 0;
  for (const table of tables) {
    tablesSeen++;
    const rows = table.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
    const found: PageRosterMember[] = [];
    const headers=(rows.find(row=>/<th\b/i.test(row))?.match(/<t[dh][\s\S]*?<\/t[dh]>/gi)??[]).map(cell=>cellText(cell).toLowerCase().trim());
    const nameColumn=headers.findIndex(label=>/^(?:full |member |official )?name$/.test(label));
    const firstColumn=headers.indexOf('first name'),lastColumn=headers.indexOf('last name');
    // A table of meetings (date, time, location, status) lists sittings and places, not people.
    if(nameColumn<0 && !(firstColumn>=0 && lastColumn>=0) && headers.some(label=>/\b(?:date|time|location|status|agenda|minutes|video)\b/.test(label)))continue;
    for (const row of rows) {
      const cells = row.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) ?? [];
      if (cells.length < 2) continue;
      const texts = cells.map((c) => cellText(c));
      const splitColumns=firstColumn>=0 && lastColumn>=0;
      const nameIndex=splitColumns ? firstColumn : nameColumn>=0 ? nameColumn : texts.findIndex(t=>looksLikeNameCell(splitNameCell(t).name));
      if(nameIndex<0)continue;
      const nameText=splitColumns ? `${texts[firstColumn]??''} ${texts[lastColumn]??''}` : texts[nameIndex];
      const { name, officeTitle: gluedTitle, termNote } = splitNameCell(nameText);
      if(!looksLikeNameCell(name))continue;
      const others = texts.filter((_, i) => i !== nameIndex && !(splitColumns && i===lastColumn));
      const joined = others.join("\n");

      const phone = PHONE.exec(joined)?.[0]?.replace(/\s+/g, " ").trim() ?? null;
      const displayed = EMAIL.exec(joined)?.[0] ?? null;
      const href = /mailto:([^"'?>\s]+)/i.exec(cells.join(""))?.[1] ?? null;

      // The role cell is the one that names an office and is not the contact.
      const roleCell =
        others.find((t) => t.length > 0 && OFFICE_WORD.test(t) && !EMAIL.test(t) && !PHONE.test(t)) ??
        null;
      /**
       * The seat is the WARD or AT-LARGE token itself, never the line holding
       * it (`Council Vice President Ward 4` has seat `Ward 4`).
       */
      const roleLines = roleCell === null ? [] : roleCell.split("\n").map((l) => l.trim()).filter(Boolean);
      const seatRe = /\b(Ward\s*\d+|At[- ]Large)\b/i;
      const seatLine = roleLines.find((l) => seatRe.test(l)) ?? null;
      const seatMatch = seatLine === null ? null : seatRe.exec(seatLine)?.[1] ?? null;
      const seat =
        seatMatch === null
          ? null
          : /^at[- ]large$/i.test(seatMatch)
            ? "At-Large"
            : seatMatch.replace(/\s+/g, " ").replace(/^ward/i, "Ward");
      const titleLines = roleLines
        .map((l) => (l === seatLine ? l.replace(seatRe, "").replace(/[-–,]\s*$/, "").trim() : l))
        .filter((l) => l.length > 0 && !/^council[- ]?$/i.test(l));
      // A title glued to the NAME cell is the page's own statement of the
      // office and outranks whatever a role column happens to say.
      const officeTitle = gluedTitle ?? titleLines[0] ?? seat;

      // A row with a name and no contact at all is still a member; a row with
      // neither a contact nor a role is probably a layout artefact.
      if (phone === null && displayed === null && roleCell === null) continue;

      found.push({
        name,
        ...(splitColumns || nameColumn>=0 ? {sourceQuote:cellText(row)} : {}),
        officeTitle,
        seat,
        termNote,
        phone,
        email: displayed,
        emailHrefMismatch:
          href !== null && displayed !== null && href.toLowerCase() !== displayed.toLowerCase()
            ? href
            : null,
      });
    }
    if (found.length >= 1) out.push(...found);
  }
  attempts.push({
    strategy: "table-rows-with-contact",
    rows: out.length,
    note: `${tablesSeen} table(s) on the page`,
  });
  return out;
}

/* ── Strategy 2: repeated blocks — a heading per member ─────────────────── */

function fromBlocks(html: string, attempts: Attempt[]): PageRosterMember[] {
  const out: PageRosterMember[] = [];
  const blocks =
    html.match(/<(?:li|div|p)[^>]*>[\s\S]{0,600}?mailto:[\s\S]{0,400}?<\/(?:li|div|p)>/gi) ?? [];
  for (const block of blocks) {
    const text = cellText(block);
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const nameLine = lines.find((l) => looksLikeNameCell(l));
    if (nameLine === undefined) continue;
    const displayed = EMAIL.exec(text)?.[0] ?? null;
    const href = /mailto:([^"'?>\s]+)/i.exec(block)?.[1] ?? null;
    const phone = PHONE.exec(text)?.[0]?.replace(/\s+/g, " ").trim() ?? null;
    const role = lines.find((l) => l !== nameLine && OFFICE_WORD.test(l) && !EMAIL.test(l)) ?? null;
    if (out.some((m) => m.name === nameLine)) continue;
    out.push({
      name: nameLine,
      officeTitle: role,
      seat: role !== null && /\b(?:ward\s*\d+|at[- ]large)\b/i.test(role) ? role : null,
      termNote: null,
      phone,
      email: displayed,
      emailHrefMismatch:
        href !== null && displayed !== null && href.toLowerCase() !== displayed.toLowerCase()
          ? href
          : null,
    });
  }
  attempts.push({
    strategy: "repeated-contact-blocks",
    rows: out.length,
    note: `${blocks.length} block(s) carrying a mailto`,
  });
  return out;
}

/** The line under a member's name that makes them a member: a seat title, or the district, ward or seat they hold. */
const SEAT_LINE =
  /\b(?:(?:vice[- ]?|deputy )?mayor|council[- ]?(?:member|man|woman|person|or|lor|president)s?|councilors?|councillors?|alder(?:man|woman|person)|select(?:man|woman|person)|commissioner|trustee|supervisor|board (?:member|president|chair)|chair(?:man|woman|person)?|vice[- ]?chair|president|vice[- ]?president|member|(?:district|ward|seat|position|place|zone)\s*\d+|at[- ]large)\b/i;

/**
 * A card per member: the person's name on the first line, the seat or title they hold on the next, and whatever
 * contact the card shows (a plain address counts as much as a `mailto:`). Cards are the smallest block holding one
 * name-shaped line, so a wrapper around several members is not taken for one.
 */
function fromTitledBlocks(html: string): PageRosterMember[] {
  const out: PageRosterMember[] = [];
  // Every opening tag is tried, so a card inside a wrapper is found as well as the wrapper.
  const open = /<(div|li|p|article|td|section)\b[^>]*>/gi;
  for (let tag = open.exec(html); tag !== null; tag = open.exec(html)) {
    const close = html.indexOf(`</${tag[1]!.toLowerCase()}`, open.lastIndex);
    const inner = close < 0 || close - open.lastIndex > 1500 ? null : html.slice(open.lastIndex, close);
    if (inner === null) continue;
    const text = cellText(inner);
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2 || lines.length > 8) continue;
    const { name, officeTitle: glued } = splitNameCell(lines[0]);
    if (!looksLikeNameCell(name) || lines.slice(1).some((l) => looksLikeNameCell(l))) continue;
    const seatLine = lines.slice(1).find((l) => l.length <= 70 && !EMAIL.test(l) && !PHONE.test(l) && SEAT_LINE.test(l)) ?? glued;
    if (!seatLine || out.some((m) => m.name === name)) continue;
    const seat = /\b((?:district|ward|seat|position|place|zone)\s*\d+|at[- ]large)\b/i.exec(seatLine)?.[1] ?? null;
    out.push({
      name,
      sourceQuote: text,
      officeTitle: seatLine,
      seat: seat === null ? null : /^at[- ]large$/i.test(seat) ? "At-Large" : seat.replace(/\s+/g, " ").replace(/^(\w)/, (c) => c.toUpperCase()),
      termNote: null,
      phone: PHONE.exec(text)?.[0]?.replace(/\s+/g, " ").trim() ?? null,
      email: EMAIL.exec(text)?.[0] ?? null,
      emailHrefMismatch: null,
    });
  }
  return out;
}

/* ── Strategy 3: a list of links, one per member ────────────────────────── */

/**
 * `Member Name (Ward 2)` linking to the member's own contact page. Many
 * municipal sites publish no address and route every member through a
 * per-member contact form; that form is a working contact, and the page is
 * the member's own page on the body's site. The seat is the parenthetical.
 */
function fromMemberLinks(html: string, attempts: Attempt[]): PageRosterMember[] {
  const out: PageRosterMember[] = [];
  const seen = new Set<string>();
  let linksSeen = 0;
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi)) {
    const href = m[1];
    // The href must look like a page ABOUT ONE PERSON on this site.
    if (!/(?:contact|email|member|profile|bio)[^/]*\.(?:php|html?|aspx)|\/(?:contact|email)\//i.test(href))
      continue;
    linksSeen++;
    const text = decodeEntities(m[2].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
    const paren = /^(.{4,50}?)\s*\(([^)]{2,40})\)$/.exec(text);
    const name = (paren === null ? text : paren[1]).trim();
    if (!looksLikeNameCell(name) || seen.has(name)) continue;
    seen.add(name);

    const inside = paren === null ? null : paren[2].trim();
    const seatMatch = inside === null ? null : /\b(Ward\s*\d+|At[- ]Large)\b/i.exec(inside)?.[1] ?? null;
    const seat =
      seatMatch === null
        ? null
        : /^at[- ]large$/i.test(seatMatch)
          ? "At-Large"
          : seatMatch.replace(/\s+/g, " ").replace(/^ward/i, "Ward");

    out.push({
      name,
      officeTitle: seat ?? inside,
      seat,
      termNote: null,
      phone: null,
      // The member's own page on the body's site. Not an address — the page
      // publishes a FORM — and saying so is more honest than an empty field.
      email: null,
      emailHrefMismatch: null,
      contactPageUrl: href,
    });
  }
  attempts.push({
    strategy: "per-member-contact-links",
    rows: out.length,
    note: `${linksSeen} link(s) shaped like a per-member page`,
  });
  return out;
}

/**
 * Extract a roster, reporting every strategy and its count. Strategies run in
 * order and the first sourced member is returned. The publisher checks the
 * seat and every field against its own saved row before it can go live.
 */
export function extractRoster(url: string, html: string): RosterExtraction {
  const attempts: Attempt[] = [];
  const body = /<main[\s\S]*?<\/main>/i.exec(html)?.[0] ?? html;

  const table = fromTables(body, attempts);
  if (table.length >= 1) {
    return { url, members: table, strategy: "table-rows-with-contact", attempts, failure: null, bytes: html.length };
  }

  const titled = fromTitledBlocks(body);
  attempts.push({ strategy: "titled-member-cards", rows: titled.length, note: null });
  const blocks = [...fromBlocks(body, attempts), ...titled].filter((member, at, all) => all.findIndex((other) => other.name === member.name) === at);
  if (blocks.length >= 1) {
    return { url, members: blocks, strategy: "repeated-contact-blocks", attempts, failure: null, bytes: html.length };
  }

  const links = fromMemberLinks(body, attempts);
  if (links.length >= 1) {
    return { url, members: links, strategy: "per-member-contact-links", attempts, failure: null, bytes: html.length };
  }

  return {
    url,
    members: [],
    strategy: null,
    attempts,
    failure:
      `no strategy returned a member from ${html.length} bytes — ` +
      attempts.map((a) => `${a.strategy}:${a.rows}`).join(", ") +
      ". This is a FAILED extraction, not an empty body: the next rung is the " +
      "page's own network calls, then the vendor's directory module, then the " +
      "live browser.",
    bytes: html.length,
  };
}
