/**
 * **WALK THE `wikipedia-municipality` ROUTE — Tier A, RULING 84 and RULING 87.**
 * (NJ Hunt 5 item 3, 2026-08-22.)
 *
 * ```
 * pnpm wiki:muni --state NJ --county Morris          # every Morris muni
 * pnpm wiki:muni --titles "Rockaway Township, New Jersey"
 * pnpm wiki:muni --state NH --county Merrimack --confirm   # + fetch every citation
 * ```
 *
 * ## What this serves, and the claim it is evidence for
 *
 * RULING 83's measurement. NJ Hunt 4 ended by naming a paid search API as the
 * constraint, having never opened the page a non-technical person reaches in two
 * clicks. This script is what that page is worth, counted: officials named per
 * municipality, citations confirmed against fetched primary sources, and the
 * form-of-government prediction checked against what the registry holds.
 *
 * ## It writes no field to any reader surface, ever
 *
 * Output is `data/hunt/wikipedia-<slug>.json` — a discovery record. RULING 87:
 * Wikipedia names the person, the citation proves them, and a name whose
 * citation could not be confirmed is a `LEAD`. Nothing here is a fact this
 * product renders; it is the list of people to go and hunt, which is the thing
 * this product did not have.
 *
 * ## Rate discipline
 *
 * Serialized, spaced by `WIKI_SPACING_MS`, identified `User-Agent` with a
 * contact address, per the public-records rule. The citation fetches are
 * spaced too and are the slow half — one municipality's roster can cite a
 * dozen distinct hosts.
 */

import { writeFileSync } from "node:fs";

import {
  mergeConfirmations,
  readCitationLedger,
  writeCitationLedger,
} from "../lib/hunt/citation-ledger.ts";
import { join } from "node:path";

import {
  WIKI_SPACING_MS,
  WIKI_USER_AGENT,
  confirmAgainstCitation,
  citationHosts,
  fetchWikitext,
  parseMunicipality,
  parseOfficeholderTemplate,
  type CitationCheck,
  type MunicipalityParse,
  type WikiFetcher,
  type WikiOfficial,
} from "../lib/hunt/wikipedia.ts";
import { today } from "./doc-dates.mjs";

const ROOT = process.cwd();
const AS_OF = today();

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (flag: string): boolean => process.argv.includes(flag);

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Rung 2 — a plain identified GET, with a ceiling so one bad host cannot hang a run. */
const fetcher: WikiFetcher = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": WIKI_USER_AGENT, Accept: "*/*" },
      redirect: "follow",
      signal: controller.signal,
    });
    const body = await res.text();
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
};

/* ── The universe to walk ───────────────────────────────────────────────── */

/**
 * Morris County's 39 municipalities. **This list is the OFFICIAL universe**, per
 * the coverage rule — it is the county's own roster of its constituent
 * municipalities, not a count of what this product already holds, so a
 * municipality missing from our registry shows up as a miss rather than being
 * invisible.
 */
const MORRIS_NJ = [
  "Boonton, New Jersey",
  "Boonton Township, New Jersey",
  "Butler, New Jersey",
  "Chatham Borough, New Jersey",
  "Chatham Township, New Jersey",
  "Chester, New Jersey",
  "Chester Township, New Jersey",
  "Denville, New Jersey",
  "Dover, New Jersey",
  "East Hanover, New Jersey",
  "Florham Park, New Jersey",
  "Hanover Township, New Jersey",
  "Harding Township, New Jersey",
  "Jefferson Township, New Jersey",
  "Kinnelon, New Jersey",
  "Lincoln Park, New Jersey",
  "Long Hill Township, New Jersey",
  "Madison, New Jersey",
  "Mendham Borough, New Jersey",
  "Mendham Township, New Jersey",
  "Mine Hill Township, New Jersey",
  "Montville, New Jersey",
  "Morris Plains, New Jersey",
  "Morris Township, New Jersey",
  "Morristown, New Jersey",
  "Mount Arlington, New Jersey",
  "Mount Olive, New Jersey",
  "Mountain Lakes, New Jersey",
  "Netcong, New Jersey",
  "Parsippany–Troy Hills, New Jersey",
  "Pequannock Township, New Jersey",
  "Randolph, New Jersey",
  "Riverdale, New Jersey",
  "Rockaway, New Jersey",
  "Rockaway Township, New Jersey",
  "Roxbury Township, New Jersey",
  "Victory Gardens, New Jersey",
  "Washington Township, Morris County, New Jersey",
  "Wharton, New Jersey",
];

/** Merrimack County, New Hampshire — the 03255 zip's county. */
const MERRIMACK_NH = [
  "Allenstown, New Hampshire",
  "Andover, New Hampshire",
  "Boscawen, New Hampshire",
  "Bow, New Hampshire",
  "Bradford, New Hampshire",
  "Canterbury, New Hampshire",
  "Chichester, New Hampshire",
  "Concord, New Hampshire",
  "Danbury, New Hampshire",
  "Dunbarton, New Hampshire",
  "Epsom, New Hampshire",
  "Franklin, New Hampshire",
  "Henniker, New Hampshire",
  "Hill, New Hampshire",
  "Hooksett, New Hampshire",
  "Hopkinton, New Hampshire",
  "Loudon, New Hampshire",
  "Newbury, New Hampshire",
  "New London, New Hampshire",
  "Northfield, New Hampshire",
  "Pembroke, New Hampshire",
  "Pittsfield, New Hampshire",
  "Salisbury, New Hampshire",
  "Sutton, New Hampshire",
  "Warner, New Hampshire",
  "Webster, New Hampshire",
  "Wilmot, New Hampshire",
];

const UNIVERSES: Record<string, string[]> = {
  "NJ/Morris": MORRIS_NJ,
  "NH/Merrimack": MERRIMACK_NH,
};

/* ── Run ────────────────────────────────────────────────────────────────── */

const titlesArg = arg("--titles");
const state = arg("--state");
const county = arg("--county");
const key = state !== undefined && county !== undefined ? `${state}/${county}` : null;

const titles =
  titlesArg !== undefined
    ? titlesArg.split("|").map((t) => t.trim())
    : key !== null && UNIVERSES[key] !== undefined
      ? UNIVERSES[key]
      : null;

if (titles === null) {
  console.error(
    "pnpm wiki:muni --state NJ --county Morris   (or --titles 'A|B')\n" +
      `known universes: ${Object.keys(UNIVERSES).join(", ")}`,
  );
  process.exit(2);
}

const confirm = has("--confirm");
const outPath = join(
  ROOT,
  "data",
  "hunt",
  `wikipedia-${(key ?? "adhoc").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`,
);

interface MunicipalityRecord extends MunicipalityParse {
  /** Officials read out of the transcluded officeholder templates. */
  fromTemplates: WikiOfficial[];
  /** Citation confirmations, when `--confirm` was passed. */
  citationChecks: CitationCheck[];
}

const records: MunicipalityRecord[] = [];
const hostTotals = new Map<string, number>();
const templateCache = new Map<string, WikiOfficial[]>();

console.log(`walking wikipedia-municipality for ${titles.length} municipalities — ${key ?? "ad hoc"}`);

for (const [i, title] of titles.entries()) {
  const page = await fetchWikitext(title, fetcher, AS_OF);
  await sleep(WIKI_SPACING_MS);

  const parsed = parseMunicipality(page);
  const rec: MunicipalityRecord = { ...parsed, fromTemplates: [], citationChecks: [] };

  if (page.wikitext !== null) {
    for (const [host, n] of citationHosts(page.wikitext)) {
      hostTotals.set(host, (hostTotals.get(host) ?? 0) + n);
    }
  }

  // The officeholder templates — where the county governing body and the
  // legislative delegation actually live. Cached: one template serves every
  // municipality in the county, so Morris is fetched once, not 39 times.
  for (const name of parsed.representation?.officeholderTemplates ?? []) {
    const cached = templateCache.get(name);
    if (cached !== undefined) {
      rec.fromTemplates.push(...cached);
      continue;
    }
    const tpl = await fetchWikitext(`Template:${name}`, fetcher, AS_OF);
    await sleep(WIKI_SPACING_MS);
    const people = tpl.wikitext === null ? [] : parseOfficeholderTemplate(tpl.wikitext, name);
    templateCache.set(name, people);
    rec.fromTemplates.push(...people);
    if (tpl.wikitext !== null && people.length === 0) {
      // A zero-row extraction is a FAILED extraction, never an empty document.
      console.log(`    ! template ${name} returned wikitext and parsed 0 people`);
    }
  }

  if (confirm) {
    const people = [parsed.mayor, ...parsed.council, ...rec.fromTemplates].filter(
      (o): o is WikiOfficial => o !== null,
    );
    for (const person of people) {
      rec.citationChecks.push(await confirmAgainstCitation(person, fetcher, AS_OF));
      await sleep(WIKI_SPACING_MS);
    }
  }

  records.push(rec);

  const named = (parsed.mayor === null ? 0 : 1) + parsed.council.length + rec.fromTemplates.length;
  const gb = parsed.governingBody;
  const pred =
    gb === null
      ? "—"
      : `${gb.form ?? "?"}${gb.plan === null ? "" : " Plan " + gb.plan} · seats ${gb.seats ?? "?"}` +
        `${gb.wardSeats === null ? "" : ` (${gb.wardSeats} ward`}${gb.atLargeSeats === null ? (gb.wardSeats === null ? "" : ")") : ` + ${gb.atLargeSeats} at-large)`}`;
  console.log(
    `  ${String(i + 1).padStart(2)}/${titles.length} ${title.padEnd(46)} ` +
      `named ${String(named).padStart(2)}  ${parsed.missReason ?? pred}`,
  );
}

/* ── Report — every count stated, denominators included ─────────────────── */

const reached = records.filter((r) => r.missReason === null);
const withRoster = records.filter((r) => r.council.length > 0);
const withGb = records.filter((r) => r.governingBody?.form !== null && r.governingBody !== null);
const allOfficials = records.flatMap((r) =>
  [r.mayor, ...r.council, ...r.fromTemplates].filter((o): o is WikiOfficial => o !== null),
);
const uniqueOfficials = new Set(allOfficials.map((o) => `${o.name}|${o.body ?? ""}`));

const checks = records.flatMap((r) => r.citationChecks);
const confirmed = checks.filter((c) => c.verdict === "CONFIRMED").length;
const leads = checks.filter((c) => c.verdict === "LEAD").length;
const unreachable = checks.filter((c) => c.verdict === "UNREACHABLE").length;
const noCitation = checks.filter((c) => c.verdict === "NO_CITATION").length;

const topHosts = [...hostTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);

const out = {
  route: "wikipedia-municipality",
  tier: "A",
  manifestNote:
    "RULING 87 — a DISCOVERY source, never a source of record. Every name here " +
    "is a LEAD until its citation has been fetched and read.",
  universe: key ?? "ad hoc",
  universeSize: titles.length,
  walkedAt: AS_OF,
  confirmRan: confirm,
  totals: {
    municipalitiesAsked: titles.length,
    municipalitiesReached: reached.length,
    withGoverningBodyParsed: withGb.length,
    withRosterParsed: withRoster.length,
    officialRowsExtracted: allOfficials.length,
    distinctOfficials: uniqueOfficials.size,
    citationChecks: checks.length,
    confirmed,
    leads,
    unreachable,
    noCitation,
  },
  citationHostMap: topHosts.map(([host, n]) => ({ host, citations: n })),
  municipalities: records,
};

writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");

/*
 * **THE CONFIRMATIONS OUTLIVE THIS ARTIFACT, BECAUSE A PROOF DOES.**
 * (2026-09-01.)
 *
 * This file is overwritten on every walk, so a citation that was CONFIRMED last
 * month and is UNREACHABLE today reads, to anything downstream, as though it was
 * never proved. Re-walking on 2026-09-01 moved 8 citations that way and
 * `pnpm nj:wire` then deleted a sitting mayor from the reader's page, because a
 * borough had dropped a `www` from its own hostname.
 *
 * A CONFIRMED verdict is written to an append-only ledger, keyed by person AND
 * by the URL that confirmed them. Nothing else writes it, it is never removed,
 * and it never transfers to a different URL. See `lib/hunt/citation-ledger.ts`.
 */
if (confirm) {
  const confirmations = checks
    .filter((c) => c.verdict === "CONFIRMED" && c.confirmedBy)
    .map((c) => ({ person: c.person, url: String(c.confirmedBy) }));
  const merged = mergeConfirmations(
    readCitationLedger(ROOT),
    confirmations,
    AS_OF,
    "wiki:muni",
  );
  writeCitationLedger(ROOT, merged.ledger);
  console.log(
    `  citation ledger             ${merged.added} new · ${merged.refreshed} re-confirmed · ` +
      `${merged.ledger.rows.length} held in total`,
  );
}

console.log("");
console.log(`  municipalities reached      ${reached.length} of ${titles.length}`);
console.log(`  governing body parsed       ${withGb.length} of ${reached.length} reached`);
console.log(`  roster parsed               ${withRoster.length} of ${reached.length} reached`);
console.log(`  official rows extracted     ${allOfficials.length}`);
console.log(`  distinct officials named    ${uniqueOfficials.size}`);
if (confirm) {
  console.log(
    `  citations                   ${confirmed} CONFIRMED · ${leads} LEAD · ` +
      `${unreachable} UNREACHABLE · ${noCitation} NO_CITATION  (of ${checks.length})`,
  );
}
console.log(`  distinct citation hosts     ${hostTotals.size}`);
console.log(`  written                     ${outPath}`);

if (reached.length === 0) {
  console.error("ZERO municipalities reached — that is a FAILED walk, not an empty universe.");
  process.exit(1);
}
