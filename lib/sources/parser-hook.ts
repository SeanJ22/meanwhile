/**
 * THE PLATFORM HOOK: how a kind of website gets read.
 *
 * A link on the work list (a `lead`) is a page or PDF to read. The parser worker (lib/sources/parser-worker.ts) claims links
 * newest first within each tier, and for every one it fetches the page, saves the exact bytes once (by fingerprint), calls the
 * parser registered for the link's kind of website, sends every fact through the Slide with its exact line, and turns every
 * new link into a new lead. A parser only reads a saved page and says what is on it; it fetches, saves, matches, checks and
 * publishes nothing.
 *
 * TO ADD OR DEEPEN A PARSER, in your lane's folder `lib/sources/<platform>/` (the PDF reader is `lib/extract/`):
 *   1. Make `parser.ts` there. Its default export is one `PlatformParser`:
 *        export default { platform: "legistar", parse(page, lead) { ... return { facts, links }; } } satisfies PlatformParser;
 *      `platform` is the kind of website, as `platformOf` (lib/sources/platform-of.ts) names it from an address. Nothing else is
 *      registered anywhere: the worker finds `parser.ts` in each folder.
 *   2. `parse(page, lead)` is a pure read of `page.raw` (the exact saved HTML, JSON, calendar text, or the text of a PDF).
 *      Return EVERY fact the page shows, not just the one a hunter wanted, and every link worth reading next.
 *        facts: { subjectHint, field, fieldKind, value, valueText, quote }[]
 *          subjectHint  the name of the body this fact is about, as the page writes it ("Planning Commission"). Null is the
 *                       body or government the lead was found under. The worker matches it to the one body in the store under
 *                       that government (and makes it when the page names one we do not hold); two equal matches go to a
 *                       detective. Never put an id here.
 *          field        the fact store's field name, such as `agenda_url`, `meeting_cadence`, `office_phone`.
 *          fieldKind    the freshness kind of the field (lib/facts/check.ts FieldKind).
 *          value        the value to store. valueText is the value exactly as the page writes it.
 *          quote        the exact line of the saved page that shows valueText. `lineOf(page.copy, valueText)` from
 *                       lib/facts/check.ts finds it. The Slide checks the quote is on the saved page and holds valueText; a fact
 *                       whose line is not found is tried once more, then a detective gets it. Never invent or rebuild a line.
 *        links: absolute or relative addresses to read next; the worker makes each one a lead (once, however often it is found).
 *   3. A page of a kind you do not read yet returns `{ facts: [], links: [] }`. Throwing means "this page broke the parser":
 *      the lead goes to a detective and comes back by itself when your parser's code changes.
 *   4. Test it with a saved page: `parse({ url, raw, copy }, lead)` needs no database. The worker's own test
 *      (tests/parser-worker.test.ts) shows a whole lead going through on a test database.
 *
 * Do not change the work list or the Slide. Send anything they do not cover to SPN-01.
 */
import { existsSync, readdirSync } from "node:fs";
import type { FieldKind, SavedCopy } from "../facts/check.ts";

/** The link being read: where it points, what kind of website it is on, and what it was found under. */
export interface Lead {
  readonly url: string;
  readonly platform: string;
  /** The government or body whose page led here. */
  readonly subjectId: string;
  readonly placeId: string;
  readonly state: string;
  /** The page that linked here, when a parser found it. */
  readonly foundOn: string | null;
}

/** The saved page: its address after redirects, the exact bytes as text, and the copy the Slide checks every quote against. */
export interface Page {
  readonly url: string;
  readonly raw: string;
  readonly copy: SavedCopy;
}

export interface ParsedFact {
  readonly subjectHint: string | null;
  readonly field: string;
  readonly fieldKind: FieldKind;
  readonly value: unknown;
  readonly valueText: string;
  readonly quote: string;
}

export interface Parsed {
  readonly facts: readonly ParsedFact[];
  readonly links: readonly string[];
}

export interface PlatformParser {
  readonly platform: string;
  parse(page: Page, lead: Lead): Parsed | Promise<Parsed>;
}

const SOURCES = new URL("./", import.meta.url);
const EXTRACT = new URL("../extract/", import.meta.url);

/** Every parser the folders hold, by kind of website. */
export async function loadParsers(): Promise<ReadonlyMap<string, PlatformParser>> {
  const files = [...readdirSync(SOURCES, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => new URL(`${entry.name}/parser.ts`, SOURCES)),
    new URL("parser.ts", EXTRACT)].filter(file => existsSync(file));
  const parsers = new Map<string, PlatformParser>();
  for (const file of files) {
    const { default: parser } = await import(file.href) as { default: PlatformParser };
    if (typeof parser?.platform !== "string" || typeof parser.parse !== "function" || parsers.has(parser.platform)) throw new Error(`PARSER_INVALID:${file.pathname}`);
    parsers.set(parser.platform, parser);
  }
  return parsers;
}
