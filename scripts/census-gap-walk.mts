/**
 * `pnpm bodies:census-gap` — WALK THE GOVERNMENTS AN OFFICIAL CENSUS NAMES.
 * (2026-08-26, the descent-resume session. **RULING 57**, **RULING 183**.)
 *
 * ## The denominator was already in the repository
 *
 * `data/audit/gus-2022-clip-counties.json` is the 2022 Census of Governments
 * clipped to the three pilot counties: **211 governments**, each with its
 * census id, its unit type, and — for most of them — **the official website
 * the government itself reported to the Census Bureau**.
 *
 * Reconciled against `lib/registry/registry.json` on 2026-08-26:
 *
 * ```
 * Pima AZ        50 governments    13 held    37 missing
 * Morris NJ      98 governments    62 held    36 missing
 * Merrimack NH   63 governments    26 held    37 missing
 * ```
 *
 * `states/az/NOTES.md` and `states/nj/NOTES.md` both already described this
 * gap in prose — "the other twenty are enumerated in
 * `gus-2022-clip-counties.json` and are backlog, each implicitly
 * NOT_ATTEMPTED" — and the special-district class is called out there as "the
 * largest class of government and the one the boundary-derived registry
 * structurally lacks". The enumeration was known. Walking it is what had not
 * happened.
 *
 * ## Why this is the government-first walk and the link descent is not
 *
 * The lead adjudication this session ran works OUTWARD from pages: something
 * linked to something, and the question is whether the thing linked to is a
 * body. That finds what governments choose to link.
 *
 * This works INWARD from an enumeration: an official census says this
 * government exists, and the question is where it publishes. A fire district
 * that nobody links to is invisible to the first method and named by the
 * second — and RULING 57's twigs, the cemetery trustees and the village water
 * precinct, are exactly the governments nobody links to.
 *
 * **The Census counts GOVERNMENTS and this product renders BODIES**
 * (RULING 9). They are not the same unit, which is why a promoted row here
 * carries the census id it came from: the disagreement stays visible instead
 * of being resolved by whichever number was loaded last.
 *
 * ## The control, and what a missing website means
 *
 * A government is promoted when its own reported website answers and names it.
 * A government whose website does not answer is **not** dropped — the Census
 * asserts it exists, and that assertion is what is recorded, with the transport
 * failure named. That is the difference between "this government has no web
 * presence we could reach today" and "this government does not exist", and
 * only the first is ever true here.
 *
 * Usage:
 *   pnpm bodies:census-gap --dry
 *   pnpm bodies:census-gap --county "Morris NJ" --budget 40
 *   pnpm bodies:census-gap --budget 200
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { appendPromotedBodies, loadPromotedBodies } from "../lib/registry/promoted-bodies.ts";
import type { Body } from "../lib/registry/types.ts";
import { decodeEntities, politeGetText } from "../lib/sources/http.ts";
import { floored, floorLine } from "../lib/ops/denominator-floor.ts";
import { today } from "./doc-dates.mjs";

const ROOT = process.cwd();
const GUS = join(ROOT, "data", "audit", "gus-2022-clip-counties.json");
const REGISTRY = join(ROOT, "lib", "registry", "registry.json");

const has = (n: string): boolean => process.argv.includes(`--${n}`);
function arg(n: string): string | undefined {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

interface GusUnit {
  kind: string;
  censusId: string;
  name: string;
  /*
   * PRESENT ON GENERAL-PURPOSE UNITS ONLY.
   *
   * The clip carries `unitType` ("1 - COUNTY", "2 - MUNICIPAL") for the 74
   * general-purpose governments and the 5 dependent school districts, and
   * OMITS it for all 60 special districts and 72 school districts, where the
   * `kind` is the type. Reported as `undefined` in the first run's own output,
   * which is the only reason it is typed honestly here rather than as
   * `string` — a required field that is absent two thirds of the time is a
   * lie the compiler would have helped tell.
   */
  unitType?: string;
  web: string | null;
  city: string;
  active: string;
}

/*
 * **THE CANONICAL `Body` TYPE, NOT A LOCAL COPY OF IT** (2026-08-27, NH232).
 *
 * A `RegistryBody` interface stood here — the same shape as
 * `lib/registry/types.ts`'s `Body`, with `bodyClass`, `bodyOrigin`,
 * `coverageStatus`, `agendaSourceType` and `sourceDataset` widened to `string`.
 * `scripts/adjudicate-leads.mts` carried its own identical copy. Two duplicate
 * types meant neither promoter's rows were ever compared against what the
 * registry declares, and `PROMOTED_FROM_CENSUS_OF_GOVERNMENTS` and `GUS_2022`
 * sat in 57 committed rows while being members of no union at all.
 *
 * That is the same defect as NH232 one level down: a second copy of a
 * definition, kept in step by nothing.
 */
type RegistryBody = Body;

/** The state code each clipped county belongs to. */
const COUNTY_STATE: Record<string, string> = {
  "Pima AZ": "az",
  "Morris NJ": "nj",
  "Merrimack NH": "nh",
};

function normName(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(the|of|and|for|a|an)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The spellings one government legitimately goes by.
 *
 * The Census writes `TOWNSHIP OF ROCKAWAY`; the town writes `Rockaway
 * Township`; the registry's division tail is `rockaway`. All three are the
 * same government, and a single-key lookup would promote it a second time.
 */
function aliases(name: string): string[] {
  const base = normName(name);
  const out = new Set<string>([base]);
  /* `TOWNSHIP OF ROCKAWAY` -> `rockaway township` */
  const inverted = /^(county|city|town|township|borough|village|school district)\s+(.+)$/.exec(base);
  if (inverted) {
    out.add(`${inverted[2]} ${inverted[1]}`);
    out.add(inverted[2]);
  }
  /* `rockaway township` -> `rockaway` */
  const stripped = base.replace(/\s+(county|city|town|township|borough|village)$/, "").trim();
  if (stripped) out.add(stripped);
  return [...out].filter(Boolean);
}

interface Fetched {
  status: number;
  title: string;
  challenged: boolean;
  finalUrl: string;
}

/**
 * Fetch through the PROJECT'S ladder, not a private one.
 *
 * ## The defect this replaced, and what it cost
 *
 * The first version of this function called `curl` and only `curl`. It
 * reported **23 governments unreachable**. Re-testing those same URLs with
 * Node's own fetch reached **64 of 111** that the curl-only client could not,
 * and a rung-by-rung comparison across the New Hampshire state family was
 * unanimous:
 *
 * ```
 * www.nh.gov            rung 3 (node + browser headers) 200    rung 4 (curl) 403
 * www.revenue.nh.gov    rung 3 200                             rung 4 403
 * www.education.nh.gov  rung 3 200                             rung 4 403
 * www.sos.nh.gov        rung 3 200                             rung 4 403
 * www.courts.nh.gov     rung 3 200                             rung 4 403
 * ```
 *
 * **The ladder is not monotonic.** Rung 4 exists because curl's TLS
 * fingerprint passes walls Node's does not, and on this host family the
 * relationship is exactly inverted — `curl` here is built on **Schannel**, the
 * Windows TLS stack, and every `*.nh.gov` host refuses it with a 403 while
 * admitting undici. A private ladder that reached for curl FIRST therefore
 * manufactured walls in front of pages that were serving.
 *
 * The correct client was in the repository the whole time: `politeGetText`
 * walks rung 2, steps to rung 3, and escalates to rung 4 **only when rung 3
 * refuses** — so it never trades a working rung for a broken one. It also
 * paces itself, honours `Retry-After`, and runs every body through
 * `challengeIn`, which is the Incapsula-at-HTTP-200 shape `states/nj/NOTES.md`
 * records. Re-implementing all of that badly is what RULING 63 calls a defect.
 *
 * *Caveat recorded rather than smoothed:* this machine's curl uses Schannel.
 * A Linux CI runner's curl uses OpenSSL and may well be admitted. The finding
 * is "the ladder is not monotonic and rung 4 can be weaker than rung 3", which
 * holds either way; the specific 403 is this client on this platform.
 */
async function get(url: string): Promise<Fetched | null> {
  /* One identified client (2026-09-25): the browser profile disguised it and is retired. */
  {
    try {
      const res = await politeGetText(url, { accept: "text/html,*/*" });
      const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(res.text);
      const title = m ? decodeEntities(m[1].replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim() : "";
      return { status: res.status, title, challenged: false, finalUrl: url };
    } catch (e) {
      /* `politeGetText` throws a `SourceHttpError` carrying the rung it died
       * on and, for a challenge, the interstitial's name. A challenge is a
       * TRANSPORT state and must not reach the caller as a content verdict. */
      const msg = String((e as Error)?.message ?? "");
      if (/WALL|challenge/i.test(msg)) {
        return { status: 200, title: "", challenged: true, finalUrl: url };
      }
      return null;
    }
  }
}

/** Does the page name this government? Distinctive words, not a substring. */
const STOP = new Set([
  "of", "the", "and", "for", "a", "an", "in", "on", "to", "county", "city", "town",
  "township", "borough", "village", "district", "school", "arizona", "jersey",
  "hampshire", "new", "az", "nj", "nh",
]);

/**
 * The Census writes government names in abbreviations. Expand them first.
 *
 * **This is the fix for a real false positive, found by reading the run's own
 * output.** `DUNBARTON SCH DIST` was promoted against a page titled "Goffstown
 * School District" — a different town's district entirely. The matcher kept
 * `sch` and `dist` as distinctive words, and both are SUBSTRINGS of `school`
 * and `district`, so two of the three words "matched" every school district in
 * the country and the only truly distinctive word, `dunbarton`, was outvoted.
 *
 * Expanding the abbreviations puts `school` and `district` back into the stop
 * list where they belong, leaving the town name carrying the decision — which
 * is the only word that was ever going to distinguish one town's school
 * district from another's.
 */
const CENSUS_ABBREV: Record<string, string> = {
  sch: "school",
  dist: "district",
  dists: "districts",
  reg: "regional",
  twp: "township",
  auth: "authority",
  co: "county",
  dept: "department",
  comm: "commission",
  util: "utility",
  fd: "fire",
  vlg: "village",
  prec: "precinct",
  /*
   * Added on the SECOND reading of this run's output, which is where the
   * over-correction showed up. Making the match whole-word fixed
   * `DUNBARTON SCH DIST` matching Goffstown — and immediately started
   * REJECTING `ROCKAWAY BORO SCH DIST` against a page titled "Rockaway
   * Borough School District", because `boro` is not the word `borough`.
   *
   * Five Morris County districts were failed that way in one run. A rule that
   * trades a false positive for a false negative has not been fixed, it has
   * been moved, and the second direction is the more expensive one here: a
   * wrong government is visible and a missing government is not.
   */
  boro: "borough",
  bor: "borough",
  boros: "boroughs",
  vill: "village",
  twps: "townships",
  regl: "regional",
  cons: "consolidated",
  un: "union",
  jt: "joint",
};

function expand(s: string): string {
  return normName(s)
    .split(" ")
    .map((w) => CENSUS_ABBREV[w] ?? w)
    .join(" ");
}

function namesIt(name: string, title: string): boolean {
  const words = expand(name)
    .split(" ")
    .filter((w) => w.length > 2 && !STOP.has(w));
  const t = expand(title);
  if (words.length === 0) {
    /* Nothing distinctive survives — "Town of Newbury" is all stop words but
     * "newbury". If even that is gone, fall back to the whole normalised name
     * so this never silently passes everything. */
    return t.includes(expand(name));
  }
  /* WHOLE WORDS. A substring test is what let `sch` match `school`, and the
   * cost of that was a government attributed to the wrong town. */
  const tokens = new Set(t.split(" "));
  const hit = words.filter((w) => tokens.has(w)).length;
  return hit >= Math.ceil(words.length * 0.6);
}

function bodyIdFor(state: string, censusId: string, name: string): string {
  const slug = normName(name).replace(/\s+/g, "_").slice(0, 60);
  return `wtp-body/country:us/state:${state}/census:${censusId}/${slug}#governing`;
}

async function main(): Promise<void> {
  const dry = has("dry");
  const only = arg("county");
  const budget = Number(arg("budget") ?? 60);
  const stamp = today();

  const gus = JSON.parse(readFileSync(GUS, "utf8")) as Record<string, GusUnit[]>;
  const registry = JSON.parse(readFileSync(REGISTRY, "utf8")) as {
    generatedAt: string;
    divisions: unknown[];
    bodies: RegistryBody[];
  };

  /*
   * Every spelling the registry already answers to — and every spelling the
   * PROMOTED INPUT STORE holds (NH232). The two sets are the same only after a
   * `pnpm registry:build`; between a promotion and the next rebuild the store
   * is ahead, and reading the generated file alone would re-promote a body this
   * repository already has. Union, so a duplicate is caught before the fetch
   * rather than by `appendPromotedBodies` after it.
   */
  const promotedStore = loadPromotedBodies();
  const knownBodies: RegistryBody[] = [
    ...registry.bodies,
    ...promotedStore.bodies,
  ];
  const held = new Map<string, string>();
  for (const b of knownBodies) {
    if (b.name) for (const a of aliases(b.name)) held.set(a, b.id);
    const tail = b.ocdId?.split("/").pop();
    if (tail) {
      for (const a of aliases(tail.replace(/^[a-z_]+:/, "").replace(/_/g, " "))) held.set(a, b.id);
    }
    if (b.censusId) held.set(`census:${b.censusId}`, b.id);
  }
  const heldIds = new Set(knownBodies.map((b) => b.id));

  const counties = Object.keys(gus).filter((c) => !only || c === only);
  const added: RegistryBody[] = [];
  const report: string[] = [];

  const totals = {
    universe: 0,
    alreadyHeld: 0,
    missing: 0,
    withSite: 0,
    opened: 0,
    named: 0,
    promoted: 0,
    unreachable: 0,
    challenged: 0,
    controlFailed: 0,
    noSite: 0,
  };

  for (const county of counties) {
    const state = COUNTY_STATE[county];
    if (!state) continue;
    const units = gus[county].filter((u) => u.active !== "N");
    const missing: GusUnit[] = [];
    for (const u of units) {
      totals.universe += 1;
      const hit =
        held.get(`census:${u.censusId}`) ?? aliases(u.name).map((a) => held.get(a)).find(Boolean);
      if (hit) {
        totals.alreadyHeld += 1;
        continue;
      }
      missing.push(u);
    }
    totals.missing += missing.length;

    report.push(`\n=== ${county} — ${units.length} active government(s) in the 2022 Census clip`);
    report.push(`    already held: ${units.length - missing.length}   MISSING: ${missing.length}`);

    for (const u of missing) {
      const site = (u.web ?? "").trim();
      if (!site || !/^https?:\/\//i.test(site)) {
        /*
         * NAMED, NOT DROPPED.
         *
         * The Census asserts this government exists and reported no usable
         * website. That is a gap in what we can READ, never evidence about
         * whether it governs — and a government the reader has and we cannot
         * reach is exactly the row a later route needs to find.
         */
        totals.noSite += 1;
        report.push(`    NO SITE REPORTED  ${u.name}  (census ${u.censusId}, ${u.unitType ?? u.kind})`);
        continue;
      }
      totals.withSite += 1;
      if (totals.opened >= budget) continue;
      totals.opened += 1;

      const page = await get(site);
      if (!page) {
        totals.unreachable += 1;
        report.push(`    UNREACHABLE       ${u.name}  ${site}`);
        continue;
      }
      if (page.challenged) {
        totals.challenged += 1;
        report.push(`    CHALLENGED        ${u.name}  ${site} — interstitial, not the document`);
        continue;
      }
      if (page.status < 200 || page.status >= 400 || !page.title) {
        totals.unreachable += 1;
        report.push(`    HTTP ${page.status}          ${u.name}  ${site}`);
        continue;
      }
      if (!namesIt(u.name, page.title)) {
        totals.controlFailed += 1;
        report.push(`    CONTROL FAILED    ${u.name}  ${site} — page says "${page.title.slice(0, 60)}"`);
        continue;
      }
      totals.named += 1;

      const id = bodyIdFor(state, u.censusId, u.name);
      if (heldIds.has(id)) continue;
      heldIds.add(id);
      for (const a of aliases(u.name)) held.set(a, id);
      held.set(`census:${u.censusId}`, id);

      added.push({
        id,
        /* Null for the same reason the descent promotions are: the Census
         * names the GOVERNMENT, not the OCD division it maps to, and inventing
         * that mapping would be a guess in the one field that answers "does
         * this govern me?". `states/az/NOTES.md` already records Pima
         * Community College as a curated body with `ocdId: null` for the same
         * honest reason — a district with no Census boundary at all. */
        ocdId: null,
        name: u.name
          .toLowerCase()
          .replace(/\b\w/g, (c) => c.toUpperCase())
          .replace(/\bOf\b/g, "of"),
        bodyClass: "GOVERNING",
        bodyOrigin: "PROMOTED_FROM_CENSUS_OF_GOVERNMENTS",
        coverageStatus: "NOT_ATTEMPTED",
        agendaSourceType: "NONE",
        agendaSourceRef: null,
        meetingCadence: null,
        homepageUrl: page.finalUrl,
        demandCount: 0,
        sourceDataset: "GUS_2022",
        /* The census id and the unit type travel WITH the row. RULING 9 says
         * the Census counts governments and this product renders bodies; the
         * two units disagree, and carrying the census id is what keeps that
         * disagreement inspectable instead of resolved by silence. */
        censusId: u.censusId,
        censusUnitType: u.unitType ?? u.kind,
        provenance: {
          sourceUrl: page.finalUrl,
          sourceOrg: "U.S. Census Bureau, 2022 Census of Governments",
          collectedAt: `${stamp}T00:00:00.000Z`,
          verifiedAt: `${stamp}T00:00:00.000Z`,
        },
      });
      totals.promoted += 1;
      report.push(`    PROMOTED          ${u.name}  <- "${page.title.slice(0, 55)}"`);
    }
  }

  /*
   * **NH232.** Promotions land in the canonical INPUT store, never in the
   * generated registry. See `lib/registry/promoted-bodies.ts` for why: this
   * script and the lead adjudicator were both appending to a file whose
   * generator rewrites it whole, so `pnpm registry:build` deleted every row
   * either of them had ever written and nothing went red.
   */
  if (!dry && added.length > 0) {
    const appended = appendPromotedBodies(added);
    console.log(
      `\nwrote ${appended.added} row(s) to lib/registry/promoted-bodies.json  (the canonical INPUT)` +
        (appended.skipped.length > 0 ? `\n  ${appended.skipped.length} already held by the store` : "") +
        `\n  run \`pnpm registry:build\` to merge them into lib/registry/registry.json`,
    );
  }

  console.log(report.join("\n"));
  console.log(`\n=== CENSUS GAP WALK${dry ? "  (DRY RUN — nothing written)" : ""}`);
  console.log(`governments in the clip        ${totals.universe}`);
  console.log(`  already in the registry      ${totals.alreadyHeld}`);
  console.log(`  missing                      ${totals.missing}`);
  console.log(`    reported no usable site    ${totals.noSite}   <- named, still owed by another route`);
  console.log(`    reported a site            ${totals.withSite}`);
  console.log(`\nopened this run                ${totals.opened}  (budget ${budget})`);
  console.log(`  unreachable                  ${totals.unreachable}`);
  console.log(`  met a challenge screen       ${totals.challenged}   <- transport state, never a verdict`);
  console.log(`  page named something else    ${totals.controlFailed}`);
  console.log(`  named itself                 ${totals.named}`);
  console.log(`  PROMOTED                     ${totals.promoted}`);
  console.log("");
  for (const line of [
    totals.universe > 0
      ? floored("held before this run", "the 2022 Census clip", totals.universe, totals.alreadyHeld)
      : floored("held before this run", "the 2022 Census clip", 0, 0, "no county was selected"),
    totals.opened > 0
      ? floored("named themselves", "the government sites opened", totals.opened, totals.named)
      : floored("named themselves", "the government sites opened", 0, 0, "the budget opened nothing"),
    totals.universe > 0
      ? floored("held after this run", "the 2022 Census clip", totals.universe, totals.alreadyHeld + totals.promoted)
      : floored("held after this run", "the 2022 Census clip", 0, 0, "no county was selected"),
  ]) {
    console.log(`  ${floorLine(line)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
