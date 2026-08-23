/**
 * **Read a governing body's roster off the body's OWN page.**
 * (NJ Hunt 6, 2026-08-22. Branch `body-own-page-roster`, Tier B.)
 *
 * ## Why this exists, and what it is the second half of
 *
 * RULING 87 draws the line this file sits on: *Wikipedia names the person; the
 * citation proves them.* NJ Hunt 5 walked the naming half and produced 261
 * distinct officials in Morris County. It could not walk the proving half for
 * everybody — 80 of 898 rows came back `LEAD`, `NO_CITATION` or `UNREACHABLE`,
 * and among them were **all nine members of the Rockaway Township Council**,
 * the governing body of the target zip. The encyclopedia named them and cited
 * nothing, so not one of them was eligible to render.
 *
 * They were sitting on `rockawaytownship.org/157/Township-Council` the whole
 * time, with their wards, their term expiries, a direct phone extension each
 * and an email address each — more than Wikipedia carried, from the government
 * that employs them. **This is the Tier B route, and it out-performs the Tier A
 * route it confirms.**
 *
 * ## Why a parser and not nine hand-typed rows
 *
 * RULING 60: a hand-worked body that produced one row and no branch has spent
 * the discovery and kept nothing. Rockaway's page is a hand-authored HTML table
 * inside a CivicPlus/CivicEngage site, and the *pattern* — a table of members
 * where the contact cell carries a `mailto:` — is not a CivicPlus invention. It
 * is how a municipal web editor lays out a council on any CMS. So the parser
 * keys on the PATTERN rather than the vendor, and travels accordingly.
 *
 * **RULING 60's caveat applies and is not decoration.** This is proven against
 * New Jersey municipal sites. A borough in Alaska, a parish in Louisiana and an
 * unincorporated Arizona county will each need their own sub-branch, and the
 * failure is recorded with the jurisdiction rather than treated as evidence the
 * roster does not exist.
 *
 * ## A zero-row extraction is a FAILED extraction
 *
 * `extractRoster` always reports what it was given and what each strategy
 * returned. A page that yields nothing names the page, the strategies tried and
 * the reason — it never returns an empty roster that reads like an empty body.
 */

/** One person as the body's own page publishes them. */
export interface PageRosterMember {
  name: string;
  /** The role the page states — "Council President", "Ward 3". Never inferred. */
  officeTitle: string | null;
  /** The seat, where the page names one separately from the title. */
  seat: string | null;
  /** The page's own words for the term — "Term Exp. 12/31/29". */
  termNote: string | null;
  phone: string | null;
  /**
   * The address the page DISPLAYS. Where a `mailto:` href disagrees with the
   * text beside it, the text is what the body publishes as the address and the
   * href is recorded separately rather than silently preferred — Rockaway's own
   * page shows `hmorrison@` over a `mailto:hkritz@`, and picking the href would
   * have shipped a predecessor's mailbox as a sitting member's contact.
   */
  email: string | null;
  /** The `mailto:` target, when it differs from the displayed address. */
  emailHrefMismatch: string | null;
  /**
   * The member's own page on the body's site, where the body routes contact
   * through a FORM rather than publishing an address. A working contact and a
   * verified page at once — and honestly not an email.
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
    html
      /*
       * `<style>` and `<script>` bodies are not text. Joomla's SP Page Builder
       * emits a per-widget `<style>` block INSIDE the content region, so a
       * naive tag-strip returned 800 characters of CSS media queries as though
       * they were the page's words — and a name-shaped test then found nothing
       * in it, which reads as "this body publishes no roster".
       */
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      // `<br id="isPasted">` and `<br data-pasted="true">` are what a WYSIWYG
      // editor actually emits, and a `<br>`-only pattern silently skips them:
      // four of Rockaway's nine council members vanished because their name and
      // their term ran together into one unparsable line, and the extraction
      // returned five rows and no error. Match the TAG, not the tidy form.
      .replace(/<br\b[^>]*>/gi, "\n")
      .replace(/<\/(?:p|div|li|tr)>/gi, "\n")
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
  /\b(?:council|committee|board|township|borough|city|county|department|division|office|clerk|administrator|attorney|engineer|manager|coordinator|director|supervisor|meetings?|agendas?|minutes?|phone|email|address|term|ward|at[- ]large|vacant|vacancy)\b/i;

export function looksLikeNameCell(text: string): boolean {
  const first = text.split("\n")[0]?.trim() ?? "";
  if (first.length < 5 || first.length > 60) return false;
  if (OFFICE_WORD.test(first)) return false;
  if (EMAIL.test(first) || PHONE.test(first)) return false;
  const tokens = first.replace(/[,.]$/, "").split(/\s+/);
  if (tokens.length < 2 || tokens.length > 5) return false;
  let capitalised = 0;
  for (const token of tokens) {
    const bare = token.replace(/^["'(]+|["'),.]+$/g, "");
    if (bare.length === 0) continue;
    if (/^(?:Sr|Jr|II|III|IV|V|Esq)\.?$/i.test(bare)) continue;
    if (/^(?:van|von|de|del|della|di|da|la|le|du)$/i.test(bare)) continue;
    if (!/^[A-Z][A-Za-z'’.-]*$/.test(bare)) return false;
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
 * **Split a name cell into a name, a title and a term note.**
 *
 * Two shapes live here. Rockaway stacks the term under the name with a `<br>`;
 * Morris Plains writes the office INTO the name cell — `Jason Karr, Mayor`,
 * `Art Bruhn, Jr. Councilmember`. Taking the cell whole put the office inside
 * the person's name, so a card would have rendered a man called *Jason Karr,
 * Mayor* — and, because the title then came back null, the body resolved no
 * presiding officer at all.
 *
 * The generational suffix is kept on the name (`Art Bruhn, Jr.`) and the title
 * is taken off after it, which is why the suffix is matched before the split
 * rather than as part of it.
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
  const term = /term\s*exp[^)]*|expires?[^)]*|term\s*ends?[^)]*/i.exec(rest)?.[0] ?? (rest || null);
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
    for (const row of rows) {
      const cells = row.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) ?? [];
      if (cells.length < 2) continue;
      const texts = cells.map((c) => cellText(c));
      const nameIndex = texts.findIndex((t) => looksLikeNameCell(t));
      if (nameIndex < 0) continue;

      const { name, officeTitle: gluedTitle, termNote } = splitNameCell(texts[nameIndex]);
      const others = texts.filter((_, i) => i !== nameIndex);
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
       * it. Rockaway writes `Council Vice President Ward 4` on one line, and
       * taking the line gave a council member a seat called "Vice President
       * Ward 4" — a seat that does not exist, on a card claiming to quote the
       * body's own page.
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
    if (found.length >= 2) out.push(...found);
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

/* ── Strategy 3: a list of links, one per member ────────────────────────── */

/**
 * **`Adrienne Zimmermann (Ward 2)` linking to her own contact page.**
 * (NJ Hunt 6, found hand-working Denville Township — a `07866` body.)
 *
 * A great many municipal sites publish no address at all and route every member
 * through a per-member contact FORM. The first two strategies both key on a
 * contact being present in the text, so a site like this returned zero rows and
 * the body read as one that publishes no roster — while its seven council
 * members, with their wards, sat in a list called *Contact Members*.
 *
 * A contact form IS a working contact, and the per-member page IS that member's
 * own page on the body's site, so this closes the verified-page field too.
 *
 * The anchor text carries the seat in a parenthetical, which is the same shape
 * the encyclopedia uses and is parsed the same way.
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
 * **Extract a roster, reporting every strategy and its count.**
 *
 * Strategies run in order and the FIRST that returns at least two people wins —
 * two, because a governing body with one member is not a governing body and a
 * single match is almost always a webmaster's address in a footer.
 */
export function extractRoster(url: string, html: string): RosterExtraction {
  const attempts: Attempt[] = [];
  const body = /<main[\s\S]*?<\/main>/i.exec(html)?.[0] ?? html;

  const table = fromTables(body, attempts);
  if (table.length >= 2) {
    return { url, members: table, strategy: "table-rows-with-contact", attempts, failure: null, bytes: html.length };
  }

  const blocks = fromBlocks(body, attempts);
  if (blocks.length >= 2) {
    return { url, members: blocks, strategy: "repeated-contact-blocks", attempts, failure: null, bytes: html.length };
  }

  const links = fromMemberLinks(body, attempts);
  if (links.length >= 2) {
    return { url, members: links, strategy: "per-member-contact-links", attempts, failure: null, bytes: html.length };
  }

  return {
    url,
    members: [],
    strategy: null,
    attempts,
    failure:
      `no strategy returned two or more members from ${html.length} bytes — ` +
      attempts.map((a) => `${a.strategy}:${a.rows}`).join(", ") +
      ". This is a FAILED extraction, not an empty body: the next rung is the " +
      "page's own network calls, then the vendor's directory module, then the " +
      "live browser.",
    bytes: html.length,
  };
}
