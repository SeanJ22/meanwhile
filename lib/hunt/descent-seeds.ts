/**
 * WHERE EACH STATE'S DESCENT STARTS — the tier-above publication, per tier.
 * (2026-08-26, the descent session. RULING 93 and RULING 169.)
 *
 * ## Why these are SEEDS and not a source list
 *
 * `states/<code>/sources.md` is the REGISTER — what exists and what may be
 * used. This is where the WALK begins, which is a different question: a seed is
 * the publication the tier ABOVE puts out about the tier below, and the walk's
 * whole job is to follow it downward until it stops producing.
 *
 * **A seed is never a limit.** RULING 170: any list in this project is a floor.
 * The walk follows what it finds, so the seeds decide where it starts and
 * nothing decides where it ends.
 *
 * ## Why the tier is declared per seed
 *
 * RULING 169 counts per LEVEL — one tier, one state. A seed that did not say
 * which tier it is about would have to be guessed at counting time, and a
 * guessed tier is a count that cannot be checked.
 *
 * Every host here was judged by `pnpm robots:sweep` on 2026-08-26 and every one
 * came back ALLOWED or NO_ROBOTS. `CANNOT_TELL` hosts were left out under the
 * rule of that date; since the owner decision of 2026-09-25 an unread robots.txt
 * no longer refuses a walk, so such a host may be added as a seed with its
 * verdict recorded (an access control on its pages still walls it).
 */

import type { TierId } from "./descent.ts";

export interface DescentSeed {
  readonly url: string;
  /** Which tier this publication is ABOUT — never which tier publishes it. */
  readonly tier: TierId;
  /** Who publishes it, for the catalog row this seed will produce. */
  readonly publisher: string;
  /** Why this is the right door — the RULING 93 argument, stated per seed. */
  readonly why: string;
  /**
   * A string that must appear in the body. RULING 93: a 200 whose content is
   * not about the thing asked for is not a document, and `nj.gov/nj/gov/county/`
   * answers HTTP 200 with a styled "Page not found".
   */
  readonly control: string;
}

const AZ: readonly DescentSeed[] = [
  {
    url: "https://az.gov/",
    tier: "state",
    publisher: "State of Arizona",
    why: "the state's own front door — the top of the descent, and the tier above every other Arizona tier",
    control: "Arizona",
  },
  {
    url: "https://azsos.gov/elections/about-elections/county-election-contact-info",
    tier: "county",
    publisher: "Arizona Secretary of State",
    why: "the state naming its own counties' election officers — RULING 93's descend-the-hierarchy move, already proven",
    control: "Pima",
  },
  {
    url: "https://azsos.gov/",
    tier: "state",
    publisher: "Arizona Secretary of State",
    why: "the division-by-division walk of the office that certifies elections and holds the filings",
    control: "Secretary of State",
  },
  {
    url: "https://www.azleg.gov/",
    tier: "multi-county",
    publisher: "Arizona State Legislature",
    why: "the body publishing its own members and districts — RULING 166's rung one for the legislative tier",
    control: "Legislature",
  },
  {
    url: "https://www.azcourts.gov/",
    tier: "multi-county",
    publisher: "Arizona Judicial Branch",
    why: "the judiciary enumerating its own superior, justice and municipal courts by county",
    control: "Court",
  },
  {
    url: "https://www.azed.gov/",
    tier: "special-district",
    publisher: "Arizona Department of Education",
    why: "the state oversight directory of every school district — the tier above the special-district layer",
    control: "Education",
  },
  {
    url: "https://lgd.azleague.org/",
    tier: "city",
    publisher: "League of Arizona Cities and Towns",
    why: "the state itself points at this as its local-government directory; a compilation, so DERIVED",
    control: "Local Government",
  },
  {
    url: "https://www.pima.gov/2317/Board-of-Supervisors",
    tier: "county",
    publisher: "Pima County",
    why: "the county's own governing body, and the pilot-zip county for 85641 and 85701",
    control: "Supervisor",
  },
  {
    url: "https://www.pima.gov/394/Elections",
    tier: "county",
    publisher: "Pima County Elections Department",
    why: "the certifying body for every county and special-district measure in the two AZ pilot zips",
    control: "Election",
  },
  {
    url: "https://www.pima.gov/2619/Administration",
    tier: "county",
    publisher: "Pima County",
    why: "the county enumerating its own departments, boards and commissions",
    control: "Pima",
  },
  {
    url: "https://www.pima.gov/2312/Clerk-of-the-Board",
    tier: "county",
    publisher: "Pima County Clerk of the Board",
    why: "the officer who keeps the minutes, and therefore names every board whose minutes are kept",
    control: "Clerk",
  },
  {
    url: "https://pima.legistar.com/Calendar.aspx",
    tier: "county",
    publisher: "Pima County (Legistar tenant)",
    why: "a tenant of an adapter this project already runs daily and had never asked this county about",
    control: "Calendar",
  },
  {
    url: "https://www.vailschooldistrict.org/page/governing-board",
    tier: "special-district",
    publisher: "Vail Unified School District",
    why: "the 85641 school district's own governing-board publication — RULING 166 rung one",
    control: "Board",
  },
  {
    url: "https://www.azauditor.gov/",
    tier: "other",
    publisher: "Arizona Auditor General",
    why: "who was COMPELLED to write it down — per-entity audits name the governing body of every audited district",
    control: "Auditor",
  },
  {
    url: "https://azdor.gov/",
    tier: "special-district",
    publisher: "Arizona Department of Revenue",
    why: "the tax rate tables — every levying district must appear because somebody has to be billed",
    control: "Revenue",
  },
];

const NJ: readonly DescentSeed[] = [
  {
    url: "https://www.nj.gov/nj/gov/county/localgov.shtml",
    tier: "minor-civil",
    publisher: "State of New Jersey",
    why: "the state publishing every county and every municipality with its official site — already proven, 618 links",
    control: "Rockaway",
  },
  {
    url: "https://www.nj.gov/",
    tier: "state",
    publisher: "State of New Jersey",
    why: "the state's own front door — the top of the descent",
    control: "New Jersey",
  },
  {
    url: "https://www.njleg.state.nj.us/",
    tier: "multi-county",
    publisher: "New Jersey Legislature",
    why: "the body publishing its own members and districts — RULING 166 rung one",
    control: "Legislature",
  },
  {
    url: "https://www.njcourts.gov/",
    tier: "multi-county",
    publisher: "New Jersey Judiciary",
    why: "the judiciary enumerating its own vicinages and municipal courts",
    control: "Court",
  },
  {
    url: "https://www.elec.nj.gov/",
    tier: "state",
    publisher: "NJ Election Law Enforcement Commission",
    why: "the single statewide filing officer under N.J.S.A. 19:44A — the centralised shape",
    control: "ELEC",
  },
  {
    url: "https://www.morriscountynj.gov/",
    tier: "county",
    publisher: "Morris County",
    why: "the 07866 county's own front door, and the tier above every Morris municipality",
    control: "Morris",
  },
  {
    url: "https://morriscountyclerk.org/",
    tier: "county",
    publisher: "Morris County Clerk",
    why: "admits this project's User-Agent first try and publishes certified winners with a Party column",
    control: "Clerk",
  },
  {
    url: "https://rockawaytownship.org/",
    tier: "minor-civil",
    publisher: "Rockaway Township",
    why: "the 07866 governing body's own publication — RULING 166 rung one",
    control: "Rockaway",
  },
  {
    url: "https://www.njsba.org/",
    tier: "special-district",
    publisher: "NJ School Boards Association",
    why: "an association that exists to know who sits on every school board; a compilation, so DERIVED",
    control: "School Boards",
  },
  {
    url: "https://www.njlm.org/",
    tier: "city",
    publisher: "NJ League of Municipalities",
    why: "the municipal compilation the state's own directory sits beside",
    control: "Municipalities",
  },
];

const NH: readonly DescentSeed[] = [
  {
    url: "https://www.nh.gov/",
    tier: "state",
    publisher: "State of New Hampshire",
    why: "the state's own front door — refused this project until rung 4 was walked on 2026-08-26",
    control: "New Hampshire",
  },
  {
    url: "https://gc.nh.gov/downloads/",
    tier: "multi-county",
    publisher: "NH General Court",
    why: "RUNG ZERO — the legislature's own bulk download, published so consumers need not scrape",
    control: "Download",
  },
  {
    url: "https://www.gencourt.state.nh.us/",
    tier: "multi-county",
    publisher: "NH General Court",
    why: "the body's own pages beside its bulk file",
    control: "General Court",
  },
  {
    url: "https://www.courts.nh.gov/",
    tier: "multi-county",
    publisher: "NH Judicial Branch",
    why: "the judiciary enumerating its own circuit, superior and district courts",
    control: "Court",
  },
  {
    url: "https://www.education.nh.gov/",
    tier: "special-district",
    publisher: "NH Department of Education",
    why: "the state oversight directory of every SAU and school district — the tier above",
    control: "Education",
  },
  {
    url: "https://www.revenue.nh.gov/",
    tier: "special-district",
    publisher: "NH Department of Revenue Administration",
    why: "who was COMPELLED to write it down — the tax rate tables itemise every levying district",
    control: "Revenue",
  },
  {
    url: "https://www.nhmunicipal.org/",
    tier: "minor-civil",
    publisher: "NH Municipal Association",
    why: "the compilation covering the towns, village districts and precincts the Census misses",
    control: "Municipal",
  },
  {
    url: "https://www.nhsba.org/",
    tier: "special-district",
    publisher: "NH School Boards Association",
    why: "an association that exists to know who sits on every school board",
    control: "School Board",
  },
  /*
   * THE COUNTY TIER, ADDED AFTER THE GATE REFUSED THE WALK WITHOUT IT.
   *
   * The first New Hampshire run walked six levels, followed 98 links and was
   * REFUSED at the end: *NH has no walk at tier "county". Every US state has
   * one, so its absence is a broken walk rather than a finding.* That is
   * RULING 159 catching a session's own omission rather than a host's refusal,
   * and it is the whole reason the assertion exists — a run that had quietly
   * reported six tiers would have read as a state with no counties.
   *
   * New Hampshire's ten counties are unusual and worth stating: they run the
   * nursing home, the house of corrections and the registry of deeds, and their
   * DELEGATION is the state representatives elected from that county rather
   * than a separately elected body. A reader has county government and did not
   * elect anybody to it under that name.
   */
  {
    url: "https://nhcounties.org/",
    tier: "county",
    publisher: "New Hampshire Association of Counties",
    why: "the compilation naming all ten counties; a DERIVED source walked because the state has no single county directory of its own",
    control: "count",
  },
  {
    url: "https://merrimackcounty.net/",
    tier: "county",
    publisher: "Merrimack County",
    why: "the county containing 03255 (Newbury) — the body's own publication, RULING 166 rung one",
    control: "Merrimack",
  },
];

export const DESCENT_SEEDS: Readonly<Record<string, readonly DescentSeed[]>> = { az: AZ, nj: NJ, nh: NH };

export function seedsFor(state: string): readonly DescentSeed[] {
  return DESCENT_SEEDS[state.trim().toLowerCase()] ?? [];
}
