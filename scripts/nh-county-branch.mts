/**
 * `pnpm nh:county` — **Merrimack County's own site as a BRANCH.**
 * (NH Hunt 3, 2026-08-21. RULING 52.)
 *
 * ## What this reaches, and why it is one branch and not six
 *
 * Six of the twelve contests on Newbury's ballot are county offices — Register
 * of Probate, Register of Deeds, County Treasurer, County Attorney, Sheriff and
 * Commissioner — and they are the thinnest in the product: 16 candidates
 * carrying 47 owed Kelly fields between them. They are also the races a reader
 * can research least easily on their own, which is exactly why they matter.
 *
 * The county publishes an office page for every one of them, and all of it is
 * one host answering rung 2 at HTTP 200. That makes it ONE branch serving six
 * contests — independent of the Secretary of State's filings, independent of
 * the General Court's roster, and independent of our own registry.
 *
 * ## Two things it must not do, both learned the hard way
 *
 * **Strip the navigation before harvesting anything.** `docs/zip-playbook.md`
 * records this and it still catches people: a Revize page carries the whole
 * site menu in its markup, so a name-shaped harvest over raw HTML returns
 * "County Attorney", "Treasurer" and "Register of Deeds" from the nav bar on
 * every single page, identically. The content region is extracted first.
 *
 * **Never record the CMS's own addresses as a contact.** Every page on this
 * host carries `noreply@revize.com` and `webpageupdate_subscribers@revize.com`
 * in its markup. They are the vendor's plumbing. Recording either under a named
 * person would be a wrong contact — worse than an honest gap, and precisely the
 * class of defect the render-default rule exists to stop.
 *
 * Run:
 *   pnpm nh:county            # every office, what it publishes
 *   pnpm nh:county --json
 */
import { politeGetText } from "../lib/sources/http.ts";

const JSON_OUT = process.argv.includes("--json");
const BASE = "https://www.merrimackcounty.net";

/** One office, its page, and the ballot contest it serves. */
const OFFICES = [
  { office: "County Commissioners", contest: "county-commissioner-2", path: "board_of_commissioners_/index.php" },
  { office: "County Attorney", contest: "county-attorney", path: "departments/county_attorney/index.php" },
  { office: "County Treasurer", contest: "county-treasurer", path: "departments/finance/treasurer.php" },
  { office: "Register of Deeds", contest: "register-of-deeds", path: "departments/register_of_deeds/index.php" },
  { office: "Sheriff", contest: "county-sheriff", path: "departments/sheriff/index.php" },
  { office: "Register of Deeds staff", contest: "register-of-deeds", path: "departments/register_of_deeds/staff_directory.php" },
  { office: "County Attorney staff", contest: "county-attorney", path: "departments/county_attorney/staff_directory.php" },
  { office: "Sheriff staff", contest: "county-sheriff", path: "departments/sheriff/staff_directory.php" },
] as const;

/**
 * The vendor's own addresses, on every page of this CMS. Never a contact.
 * Matched on the DOMAIN rather than the local part, because the next Revize
 * site will use different mailbox names and the same domain.
 */
const CMS_NOISE = /@(revize|granicus|civicplus)\.com$/i;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.(?:gov|org|net|com|us)/g;
const PHONE = /\(?\b603\)?[ .-]?\d{3}[ .-]?\d{4}\b/g;

/**
 * The page's content, with the site furniture removed.
 *
 * Revize wraps its editable region in `<main>` or an element carrying
 * `id="main"`. Falling back to the whole document would silently reintroduce
 * the navigation, so a page with neither is reported as UNPARSED rather than
 * harvested — a zero-row extraction is a failed extraction, and so is a
 * whole-page one wearing a content region's name.
 */
/**
 * The inner HTML of the element an opening-tag pattern matches, counting nested
 * tags of the same name so the region ends where it actually ends.
 *
 * A lazy `<div …>([\s\S]*?)</div>` stops at the FIRST closing tag, which on any
 * real CMS page is a few characters in — so it reads as "found the region" and
 * returns almost nothing. That is the empty-success shape again: no error, no
 * exception, and a content extractor that quietly harvests a wrapper.
 */
export function balancedRegion(html: string, open: RegExp, tag: string): string | null {
  const m = open.exec(html);
  if (!m) return null;
  const start = m.index + m[0].length;
  const step = new RegExp(`<${tag}\\b|</${tag}>`, "gi");
  step.lastIndex = start;
  let depth = 1;
  let hit: RegExpExecArray | null;
  while ((hit = step.exec(html)) !== null) {
    depth += hit[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return html.slice(start, hit.index);
  }
  // Unbalanced markup: report NOT FOUND rather than returning the rest of the
  // document, which would be the navigation this whole function removes.
  return null;
}

export function contentRegion(html: string): string | null {
  const inner =
    balancedRegion(html, /<main\b[^>]*>/i, "main") ??
    // Revize names its editable region `freeform-main`. Measured on
    // merrimackcounty.net 2026-08-21; `<main>` and `id="main"` are both absent
    // from this theme, which is why the first version of this parsed nothing on
    // all eight pages and refused the run rather than harvesting the menu.
    balancedRegion(html, /<div\b[^>]*id=["']freeform-main["'][^>]*>/i, "div") ??
    balancedRegion(html, /<(?:div|section)\b[^>]*id=["']main["'][^>]*>/i, "div");
  if (!inner) return null;
  return inner
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Contacts a page publishes, with the vendor's own plumbing removed. */
export function contactsIn(text: string): { emails: string[]; phones: string[] } {
  const emails = [...new Set(text.match(EMAIL) ?? [])].filter((e) => !CMS_NOISE.test(e));
  const phones = [...new Set(text.match(PHONE) ?? [])];
  return { emails, phones };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Result {
  office: string;
  contest: string;
  url: string;
  chars: number;
  emails: string[];
  phones: string[];
  /** Names the page publishes, for a human to match against the ballot. */
  names: string[];
}

/**
 * Capitalised multi-word runs that look like a person, minus the office words.
 *
 * Deliberately RECALL-ORIENTED and reported for a human to read rather than
 * written anywhere: this is a hunt aid, not a source. Nothing it returns
 * reaches the product without a person confirming it against the page.
 */
const OFFICE_WORDS =
  /^(County|Register|Deeds|Sheriff|Treasurer|Attorney|Commissioner|Commissioners|Department|Office|Merrimack|New Hampshire|Nursing Home|Staff Directory|Board Of|Human Services)/i;

function namesIn(text: string): string[] {
  const hits = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z]\.)?\s+[A-Z][a-z]+(?:-[A-Z][a-z]+)?\b/g) ?? [];
  return [...new Set(hits)].filter((n) => !OFFICE_WORDS.test(n)).slice(0, 25);
}

const results: Result[] = [];
const walls: string[] = [];

for (const o of OFFICES) {
  const url = `${BASE}/${o.path}`;
  try {
    const page = await politeGetText(url, { expect: { label: "a county office page", marker: "<" },
    });
    const text = contentRegion(page.text);
    if (text === null) {
      // Falling back to the whole document would reintroduce the navigation
      // this function exists to remove.
      walls.push(`${o.office}: 200 but no content region found — UNPARSED, not empty`);
      continue;
    }
    const { emails, phones } = contactsIn(text);
    results.push({ office: o.office, contest: o.contest, url, chars: text.length, emails, phones, names: namesIn(text) });
  } catch (error) {
    // A wall is a measurement with a date, never a standing property.
    walls.push(`${o.office} (${url}): ${(error as Error).message.slice(0, 110)}`);
  }
  await sleep(500);
}

if (JSON_OUT) {
  console.log(JSON.stringify({ results, walls }, null, 1));
} else {
  console.log(`\nnh:county — Merrimack County's own site, walked 2026-08-21\n`);
  // The PAIR, always.
  console.log(`  ${results.length} page(s) read of ${OFFICES.length} attempted\n`);
  for (const r of results) {
    console.log(`  ${r.office}  (${r.contest})`);
    console.log(`    ${r.url}  — ${r.chars} chars of content`);
    if (r.emails.length) console.log(`    emails  ${r.emails.join(", ")}`);
    if (r.phones.length) console.log(`    phones  ${r.phones.join(", ")}`);
    if (r.names.length) console.log(`    names   ${r.names.slice(0, 12).join(" · ")}`);
    console.log("");
  }
  if (walls.length) {
    console.log(`  WALLS met on 2026-08-21 (${walls.length}) — re-test in 14 days per RULING 53:`);
    for (const w of walls) console.log(`    ${w}`);
  }
}

// An operation that can return nothing must be asked what it returned.
if (results.length === 0) {
  console.error("REFUSED: zero pages read. That is a failed run, not an empty county.");
  process.exit(1);
}
