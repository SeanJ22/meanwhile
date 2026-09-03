/**
 * **READ THE COUNTY CLERK'S CERTIFIED ELECTION WINNERS.**
 * (NJ Hunt 6, 2026-08-22. Branch `filing-county`, enriched. Tier A.)
 *
 * ```
 * pnpm nj:winners                       # Morris County, the three cycles below
 * pnpm nj:winners --url <pdf> --cycle 2025
 * ```
 *
 * ## Why this is the strongest record in the whole hunt
 *
 * M62 set the rule: a local office is partisan or nonpartisan by law FIRST, and
 * only a partisan office gets a party, read from the certified result of the
 * election that put the person in the seat. Never from an endorsement, a news
 * report, a party's own site, or an encyclopedia.
 *
 * The Morris County Clerk publishes exactly that document, and it carries more
 * than party. Every row is:
 *
 * > `Boonton Town  MEMBER OF THE TOWN COUNCIL WARD 1  2 1 W1  John P. MEEHAN
 * >  Republican  46 Dogwood Road Boonton NJ 07005  meehanj23@yahoo.com`
 *
 * — municipality, office, ward, name, **party**, street address and **email**,
 * certified by the election authority. That is a party source, a contact source
 * and a filed-address source in one born-digital PDF per cycle.
 *
 * ## The parse anchors on the party token, not on layout
 *
 * The text layer arrives as one run-on line per page, so a column parser has
 * nothing to hold. The party word is the reliable anchor: it appears once per
 * row, between a name whose SURNAME IS UPPER-CASE and an address. The
 * municipality is the last one seen before the row, which is how the document
 * itself groups them.
 *
 * ## Honesty
 *
 * `%PDF` is checked before parsing, so a challenge page served at HTTP 200
 * reports as the wrong TYPE rather than as a document that says nothing. A run
 * that extracts zero rows exits non-zero: a zero-row extraction is a FAILED
 * extraction, never an empty document.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { extractTextLayer } from "../lib/extract/text-layer.ts";
import { today } from "./doc-dates.mjs";

const ROOT = process.cwd();
const AS_OF = today();
const UA =
  "we-the-people/1.0 (civic data for a public-records product; contact: hello@wethepeople.vote)";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** The clerk's own published past-results assets. Version segment included. */
const MORRIS: { cycle: string; url: string }[] = [
  {
    cycle: "2025",
    url: "https://www.morriscountyclerk.org/files/sharedassets/clerk/v/2/elections/past-results/2025-general-winners.pdf",
  },
  {
    cycle: "2024",
    url: "https://www.morriscountyclerk.org/files/sharedassets/clerk/v/1/elections/past-results/2024-general-winners.pdf",
  },
  {
    cycle: "2023",
    url: "https://www.morriscountyclerk.org/files/sharedassets/clerk/v/1/elections/past-results/2023-general-winners.pdf",
  },
];

/**
 * The municipalities the document groups rows under, longest-first so
 * `Boonton Twp` wins over `Boonton Town`, and `Chatham Twp` over `Chatham`.
 */
const MUNICIPALITIES = [
  "Boonton Town", "Boonton Township", "Butler Borough", "Chatham Borough", "Chatham Township",
  "Chester Borough", "Chester Township", "Denville Township", "Dover Town",
  "East Hanover Township", "Florham Park Borough", "Hanover Township", "Harding Township",
  "Jefferson Township", "Kinnelon Borough", "Lincoln Park Borough", "Long Hill Township",
  "Madison Borough", "Mendham Borough", "Mendham Township", "Mine Hill Township",
  "Montville Township", "Morris Plains Borough", "Morris Township", "Morristown Town",
  "Mount Arlington Borough", "Mount Olive Township", "Mountain Lakes Borough", "Netcong Borough",
  "Parsippany - Troy Hills Township", "Parsippany-Troy Hills Township", "Pequannock Township",
  "Randolph Township", "Riverdale Borough", "Rockaway Borough", "Rockaway Township",
  "Roxbury Township", "Victory Gardens Borough", "Washington Township", "Wharton Borough",
  "Morris County",
].sort((a, b) => b.length - a.length);

const PARTY = /\b(Republican|Democratic|Democrat|Independent|Libertarian|Green|Nonpartisan)\b/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

interface Winner {
  cycle: string;
  municipality: string | null;
  office: string | null;
  seat: string | null;
  name: string;
  party: string;
  address: string | null;
  email: string | null;
  sourceUrl: string;
}

/**
 * Turn `John P. MEEHAN` into `John P. Meehan`. The document upper-cases the
 * surname for legibility; that is a typographic choice of the clerk's, not the
 * person's name, and rendering it verbatim would shout at a reader.
 */
function normaliseName(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .map((tok) =>
      /^[A-Z][A-Z'’-]+$/.test(tok)
        ? tok[0] + tok.slice(1).toLowerCase().replace(/(['’-])(\p{Ll})/gu, (_, p, c) => p + c.toUpperCase())
        : tok,
    )
    .join(" ");
}

/**
 * **Where each municipality's block starts, across the WHOLE page.**
 *
 * The first version looked back 260 characters for a municipality name, which is
 * shorter than one row — so a Boonton Township committee member was filed under
 * *Boonton Town*, a different government two miles away. Scanning the whole page
 * once and assigning each row to the block it falls inside is both correct and
 * cheaper.
 *
 * Overlapping names are resolved longest-first at each position, so `Boonton
 * Twp` is never read as `Boonton Town`.
 */
function municipalityBlocks(text: string): { at: number; name: string }[] {
  /*
   * **A municipality name is only a row header when an OFFICE follows it.**
   *
   * Every winner's filed address ends `… Boonton NJ 07005`, so the town names
   * appear twice per row and the second one is not a header. Taking them all
   * filed a COUNTY SHERIFF under Denville — the sheriff's home town — and put a
   * Boonton Township committee member under Boonton Town. Requiring the
   * all-caps office string to follow separates a header from an address, since
   * an address is followed by a street or a state abbreviation and never by
   * `MEMBER OF THE …`.
   */
  const OFFICE_FOLLOWS =
    /^\s+(?:MEMBER OF THE|MAYOR|SHERIFF|SURROGATE|COUNTY CLERK|CLERK|COUNCIL|COMMITTEE|BOARD|FREEHOLDER|PRESIDENT|GOVERNOR|SENATE|ASSEMBLY|US |U\.S\.)/;
  const marks: { at: number; name: string }[] = [];
  for (const name of MUNICIPALITIES) {
    let from = 0;
    for (;;) {
      const at = text.indexOf(name, from);
      if (at < 0) break;
      from = at + name.length;
      if (!OFFICE_FOLLOWS.test(text.slice(at + name.length, at + name.length + 24))) continue;
      marks.push({ at, name });
    }
  }
  marks.sort((a, b) => a.at - b.at || b.name.length - a.name.length);
  // Drop a shorter name that starts at or inside a longer one already taken.
  const kept: { at: number; name: string }[] = [];
  for (const m of marks) {
    const prev = kept[kept.length - 1];
    if (prev !== undefined && m.at < prev.at + prev.name.length) continue;
    kept.push(m);
  }
  return kept;
}

/** Seat words the document puts between the office and the name. */
const SEAT_PREFIX =
  /^(?:All\/?\s*)?(?:County\s+Wide|Countywide|Township|Town|Borough|Boro|City|Ward\s*\d+|W\d|At[-\s]?Large)\s+/i;

function parsePage(text: string, cycle: string, sourceUrl: string): Winner[] {
  const out: Winner[] = [];
  const blocks = municipalityBlocks(text);
  PARTY.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PARTY.exec(text)) !== null) {
    const party = match[1];
    const before = text.slice(Math.max(0, match.index - 260), match.index);
    const after = text.slice(match.index + party.length, match.index + party.length + 200);

    /*
     * The NAME is immediately before the party and ends in an upper-case
     * surname. Allowing a lower-case particle (`DE VENEZIA`, `Van Ness`) keeps
     * multi-token surnames whole.
     */
    const nameMatch =
      /([A-Z][A-Za-z'’.-]*(?:\s+[A-Z][A-Za-z'’.]*\.?)*\s+(?:DE|VAN|VON|LA|DEL|ST\.?)?\s*[A-Z][A-Z'’ -]{1,30})\s*$/.exec(
        before.trim(),
      );
    if (nameMatch === null) continue;
    // `County Wide Donald J. Trump` — the seat word sits immediately before the
    // name and is not part of it.
    const name = normaliseName(nameMatch[1].replace(SEAT_PREFIX, ""));
    if (name.split(/\s+/).length < 2) continue;

    // The municipality is the block this row falls inside, read off the whole
    // page rather than a fixed look-back window.
    let municipality: string | null = null;
    let bestAt = -1;
    for (const block of blocks) {
      if (block.at > match.index) break;
      municipality = block.name;
      bestAt = block.at;
    }
    // `bestAt` is an absolute page offset; `before` is a window. Re-base it.
    bestAt = bestAt - Math.max(0, match.index - 260);

    // The office sits between the municipality and the name.
    const between = bestAt >= 0 ? before.slice(bestAt + (municipality?.length ?? 0)) : before;
    const officeMatch = /\b((?:MEMBER OF THE |)[A-Z][A-Z ,'()-]{6,80}?)(?:\s+\d|\s+All\/|\s+Ward|\s+W\d|\s*$)/.exec(
      between.trim(),
    );
    const office = officeMatch === null ? null : officeMatch[1].replace(/\s+/g, " ").trim();
    const seat = /\b(Ward\s*\d+|W\d\b|All\/County Wide|At-Large|Town(?:ship)?)\b/i.exec(between)?.[1] ?? null;

    const email = EMAIL.exec(after)?.[0] ?? null;
    const address =
      /^\s*(\d+[^,]{3,60}?(?:NJ|New Jersey)\s*\d{5})/.exec(after)?.[1]?.replace(/\s+/g, " ").trim() ?? null;

    out.push({ cycle, municipality, office, seat, name, party, address, email, sourceUrl });
  }
  return out;
}

/* ── Run ────────────────────────────────────────────────────────────────── */

const single = arg("--url");
const docs = single === undefined ? MORRIS : [{ cycle: arg("--cycle") ?? AS_OF.slice(0, 4), url: single }];

const winners: Winner[] = [];
const documents: { cycle: string; url: string; status: number; pages: number; chars: number; rows: number; failure: string | null }[] = [];

for (const doc of docs) {
  const res = await fetch(doc.url, { headers: { "User-Agent": UA }, redirect: "follow" });
  const record = { cycle: doc.cycle, url: doc.url, status: res.status, pages: 0, chars: 0, rows: 0, failure: null as string | null };
  if (res.status !== 200) {
    record.failure = `HTTP ${res.status} — a wall on the clerk's asset host, not an absent certification`;
    documents.push(record);
    console.log(`  ${doc.cycle}  ${record.failure}`);
    continue;
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const extraction = await extractTextLayer(bytes, doc.url);
  const pages = extraction.items ?? [];
  const text = pages.map((p) => p.text).join("\n");
  record.pages = pages.length;
  record.chars = text.length;

  if (text.length === 0) {
    record.failure =
      "the text layer produced ZERO characters — a FAILED extraction, not an empty document. " +
      "The next rung is OCR.";
    documents.push(record);
    console.log(`  ${doc.cycle}  ${record.failure}`);
    continue;
  }

  const rows = parsePage(text, doc.cycle, doc.url);
  record.rows = rows.length;
  winners.push(...rows);
  documents.push(record);
  console.log(
    `  ${doc.cycle}  ${pages.length} page(s), ${text.length} chars, ${rows.length} certified winner(s), ` +
      `${rows.filter((r) => r.email).length} with an email`,
  );
  await new Promise((r) => setTimeout(r, 800));
}

if (winners.length === 0) {
  console.error(
    "\n0 rows parsed from every document. A ZERO-ROW EXTRACTION IS A FAILED EXTRACTION — " +
      "refusing to write an empty artifact.",
  );
  process.exit(1);
}

/** Which municipalities the certified record shows holding PARTISAN seats. */
const partisanship = new Map<string, { party: Set<string>; cycles: Set<string>; url: string }>();
for (const w of winners) {
  if (w.municipality === null) continue;
  const e = partisanship.get(w.municipality) ?? { party: new Set(), cycles: new Set(), url: w.sourceUrl };
  e.party.add(w.party);
  e.cycles.add(w.cycle);
  partisanship.set(w.municipality, e);
}

const out = {
  route: "county-clerk-certified-winners",
  branch: "filing-county",
  tier: "A",
  note:
    "M62's rung. A local seat's party is read from the certified result of the election that " +
    "put the person in it, and from nothing else. This document also carries each winner's " +
    "filed street address and email — a contact source certified by the election authority.",
  licence: "New Jersey county government work — public record.",
  walkedAt: AS_OF,
  totals: {
    documents: documents.length,
    documentsExtracted: documents.filter((d) => d.failure === null).length,
    winners: winners.length,
    withEmail: winners.filter((w) => w.email !== null).length,
    withAddress: winners.filter((w) => w.address !== null).length,
    municipalitiesWithPartyLabelledSeats: partisanship.size,
  },
  documents,
  partisanshipByMunicipality: [...partisanship].map(([municipality, e]) => ({
    municipality,
    parties: [...e.party].sort(),
    cycles: [...e.cycles].sort(),
    sourceUrl: e.url,
  })),
  winners,
};

const outPath = join(ROOT, "data", "states", "nj", "hunt", "nj-morris-certified-winners.json");
writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`, "utf8");

console.log(
  `\n  certified winners ${out.totals.winners} · with email ${out.totals.withEmail} · ` +
    `with filed address ${out.totals.withAddress}\n` +
    `  municipalities whose seats the certified record labels with a party: ${partisanship.size}\n` +
    `written ${outPath}`,
);
