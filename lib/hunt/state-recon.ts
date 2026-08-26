/**
 * THE SEARCH RECONNAISSANCE TEMPLATE, STORED SO IT IS REPRODUCIBLE.
 * (2026-08-26, the sources-and-incumbency session. Item 5b.)
 *
 * **Sean has been finding this project's best sources by typing plain web
 * searches** — "Arizona campaign finance", "Arizona legislature GitHub" — and
 * that is costing him time no person should spend. The pattern is a template and
 * it generalises to every state.
 *
 * This is that template, committed, so a state's reconnaissance is reproducible
 * rather than improvised per session. It is also what stops **RULING 88**'s
 * expansion requirement being aspirational: *name at least one source class not
 * previously walked* becomes a thing the template PRODUCES rather than a thing a
 * session has to remember to do.
 *
 * **IT PROPOSES AND NEVER REGISTERS.** Classification — primary versus derived,
 * licence, what it carries — needs judgement, and a crawler that registered its
 * own finds would quietly fill the registry with junk that later reads as
 * verified. Everything it finds lands in `docs/sources/inbox.md` as a proposal.
 *
 * **THE QUERIES ARE RECORDED, so a later session can see what was asked and,
 * more usefully, what was NOT.** RULING 90 item 1 asks what a person with a
 * browser would type; a stored list of exactly that is the answer, checked in.
 *
 * **CADENCE: periodic, not daily.** A source landscape changes slowly. It runs
 * BEFORE any new state's hunt begins, as part of the RULING 86 gate, and is
 * re-run per state every 90 days.
 */

/** One class of source, and the queries that find it. */
export interface ReconClass {
  readonly id: string;
  /** Why this class exists — the fact it is expected to reach. */
  readonly reaches: string;
  /**
   * Query TEMPLATES. `{state}` is the state's full name, `{code}` its
   * two-letter code. Written as a person would type them, deliberately — the
   * two-click test (RULING 85) is about the obvious query, not a clever one.
   */
  readonly queries: readonly string[];
}

export const RECON_CLASSES: readonly ReconClass[] = [
  {
    id: "campaign-finance",
    reaches: "who paid for a campaign, and which office holds the filings",
    queries: [
      "{state} campaign finance reports search",
      "{state} campaign finance bulk data download",
      "{state} campaign finance filing officer statute",
    ],
  },
  {
    id: "legislature-bulk",
    reaches: "the legislature's own roster and roll calls, without an aggregator",
    queries: [
      "{state} legislature member data download",
      "{state} legislature bulk data",
      "{state} legislature API documentation",
      "{state} legislature roll call votes",
    ],
  },
  {
    id: "legislature-open-source",
    reaches: "a state legislature that publishes code or data on a public forge",
    queries: ["{state} legislature github", "{code} civic tools github", "{state} open source legislature data"],
  },
  {
    id: "secretary-of-state",
    reaches: "candidate filings, ballot certification, the election calendar",
    queries: [
      "{state} secretary of state elections division",
      "{state} candidate filings list",
      "{state} election calendar dates",
    ],
  },
  {
    id: "lobbyist-registry",
    reaches: "who is retained to lobby, by whom, on what subject",
    queries: ["{state} lobbyist registration search", "{state} lobbyist registry"],
  },
  {
    id: "open-data-portal",
    reaches: "everything a state has already decided to publish as data",
    queries: ["{state} open data portal", "{state} data catalog gov"],
  },
  {
    id: "league-of-municipalities",
    reaches: "a directory of every city and town, published by their own association",
    queries: ["{state} league of cities and towns directory", "{state} municipal association member directory"],
  },
  {
    id: "county-clerks",
    reaches: "the county officers who run elections and hold local filings",
    queries: ["{state} county clerk directory", "{state} county election officials contact"],
  },
  {
    id: "civic-tech",
    reaches: "somebody who already compiled what we want, and names their primaries",
    queries: ["{state} civic tech project", "{state} legislature bill tracker open source"],
  },
  {
    id: "public-testimony",
    reaches: "an official mechanism a reader can act through, not just read about",
    queries: [
      "{state} legislature submit testimony online",
      "{state} sign nomination petition online",
      "{state} request to speak committee hearing",
    ],
  },
  {
    id: "tier-above",
    reaches: "the directory the tier above publishes about the tier below (RULING 93)",
    queries: ["usa.gov {state} local governments", "{state} list of municipalities official websites"],
  },
];

/** Fill a template. Kept trivial and pure so the query text is testable. */
export function renderQuery(template: string, stateName: string, code: string): string {
  return template.replaceAll("{state}", stateName).replaceAll("{code}", code.toUpperCase());
}

export function queriesFor(stateName: string, code: string): { classId: string; query: string }[] {
  return RECON_CLASSES.flatMap((c) => c.queries.map((q) => ({ classId: c.id, query: renderQuery(q, stateName, code) })));
}

export const STATE_NAMES: Readonly<Record<string, string>> = {
  az: "Arizona",
  nh: "New Hampshire",
  nj: "New Jersey",
  vt: "Vermont",
  wy: "Wyoming",
  ak: "Alaska",
  la: "Louisiana",
};
