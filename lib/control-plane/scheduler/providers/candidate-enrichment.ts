/**
 * **PROVIDER FIVE — CANDIDATE ENRICHMENT, FOR THE WHOLE STATE.**
 * (Session C3, lane C, 2026-09-01. RULING 229, RULING 87, RULING 182,
 * RULING 207, RULING 53.)
 *
 * ## The defect, stated as what a second ZIP used to cost
 *
 * Campaign sites, candidate-authored positions, bios, photos and published
 * contact were hunted **for the visible candidate universe** — the candidates on
 * two Arizona ZIPs' certified ballot, 68 acquisition attempts, keyed
 * `ballot-az-pima:*`. Every one of those people is running for an office in
 * ARIZONA. Activating a third Arizona ZIP that reaches the same Governor's race
 * would have started the identical hunt over, because the corpus was keyed by
 * where we happened to look first.
 *
 * This provider makes the enrichment fields STANDING OBLIGATIONS against the
 * canonical statewide candidate universe
 * (`data/hunt/<state>-candidate-universe-<cycle>.json`), so the work is owed
 * before a reader arrives rather than triggered by one.
 *
 * ## THE PORTFOLIO IS THE ONE ALREADY PROVEN, AND ITS WALLS ARE CARRIED TOO
 *
 * "The SAME equal-effort route portfolio already proven for the visible
 * candidates" is a specific set, and every member below is registered on a
 * PERMISSION READING and a CONTROL that this repository has actually taken:
 *
 * ```
 *   candidate-site-recorded      the site we already hold, re-walked. RULING 53:
 *                                a held finding is re-established, not assumed
 *   candidate-wikipedia-api      en.wikipedia.org/w/api.php — Tier A, WIRED,
 *                                identified User-Agent, spaced. DISCOVERY ONLY
 *                                and never a source of record (RULING 87)
 *   candidate-marginalia-index   api.marginalia.nu/public/search — an
 *                                independent keyword index, walked 2026-08-24
 *                                with a real control (a `license` field and a
 *                                `results` array). CC-BY-NC-SA: it may POINT at
 *                                a URL and may never be a source of record, so
 *                                the URL is then fetched from the origin
 *   candidate-web-index-4get     REGISTERED AS A WALL, NOT AS A ROUTE. Its
 *                                robots.txt permits every path and it is the
 *                                only compliant general index in the register —
 *                                and on 2026-08-26 it returned ZERO result
 *                                links to this client. That is a wall, it
 *                                carries a date, and RULING 53 sends a session
 *                                back to it. Left unregistered it would simply
 *                                be forgotten
 * ```
 *
 * **`4get.ca` is the reason this file names its walls.** The 2026-08-25 reading
 * recorded it as working; the 2026-08-26 re-measurement found the "names the
 * subject 8 times" signal was eight ECHOES of the query in the page's own
 * furniture. A route registered on the earlier reading would have been opening a
 * search engine that returns nothing, and calling the silence an absence about a
 * candidate.
 *
 * ## WHAT IS NEVER REGISTERED HERE
 *
 * A route that would produce a POSITION. `positions` obligations open the
 * candidate's OWN site and nothing else, because RULING 26's first
 * non-negotiable is that a position carries a source record pointing at a
 * specific statement by that candidate. A general index may point at a page; it
 * may never be the page.
 *
 * ## AND NOTHING IS REGISTERED FOR A FIELD ALREADY HELD
 *
 * A `FOUND` field is not re-hunted on this provider's clock — it is the
 * re-walk's business and the re-walk has its own. Registering an obligation for
 * a record we hold would spend the whole portfolio re-finding what is in the
 * corpus, which is the exact opposite of RULING 229's invariant.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ENRICHMENT_FIELDS,
  type CandidateUniverse,
  type CanonicalCandidacy,
  type EnrichmentField,
} from "../../../hunt/candidate-universe.ts";
import type {
  ObligationProvider,
  ProvidedObligation,
  ProviderContext,
  ProviderYield,
  RouteDescriptor,
} from "../registry.ts";

export const CANDIDATE_ENRICHMENT_PROVIDER_ID = "candidate-enrichment";

/** The states whose canonical universes this provider schedules. */
export const ENRICHED_STATES = ["az", "nh", "nj"] as const;
export const CYCLE = 2026;

/**
 * Identification the hosts below actually serve.
 *
 * A person and a purpose, in headers. No credential, no session, and nothing
 * claiming to be a residential client — identification, never evasion.
 */
function identifiedHeaders(): Record<string, string> {
  const from = process.env.INGEST_CONTACT_EMAIL;
  return {
    "user-agent": "we-the-people/1.0 (civic data for a public-records product)",
    "x-purpose": "civic candidate record index for a public-records product",
    ...(from ? { from } : {}),
  };
}

function displayName(c: CanonicalCandidacy): string {
  return `${c.givenName} ${c.familyName}`.replace(/\s+/g, " ").trim();
}

/** The query the visible-candidate hunt used: the person AND the office. */
function query(c: CanonicalCandidacy): string {
  return `${displayName(c)} ${c.officeTitle} ${c.stateCode}`;
}

function siteRoute(c: CanonicalCandidacy, url: string): RouteDescriptor {
  return {
    routeId: "candidate-site-recorded",
    label: `${displayName(c)} — the campaign site already recorded, re-walked`,
    executorClass: "DETERMINISTIC",
    executorReason:
      "the address is held, so opening it is a replay. Spending a model to re-find a URL we already " +
      "wrote down is spending tokens on a known answer",
    open: { kind: "HTTP_GET", url, headers: identifiedHeaders() },
    citation:
      "data/hunt/<state>-candidate-universe-2026.json — the recorded campaign site for this canonical " +
      "candidacy, carried forward from data/ballot/candidate-links-2026.json",
  };
}

function wikipediaRoute(c: CanonicalCandidacy): RouteDescriptor {
  const params = new URLSearchParams({
    action: "query",
    list: "search",
    srsearch: query(c),
    srlimit: "10",
    format: "json",
    formatversion: "2",
  });
  return {
    routeId: "candidate-wikipedia-api",
    label: `${displayName(c)} — Wikipedia search API, DISCOVERY ONLY`,
    executorClass: "DETERMINISTIC",
    executorReason:
      "the API shape is written down and stable; replaying a documented query needs no model",
    open: {
      kind: "HTTP_GET",
      url: `https://en.wikipedia.org/w/api.php?${params.toString()}`,
      headers: identifiedHeaders(),
    },
    /*
     * THE CONTROL, AS A YIELD CONTRACT. The MediaWiki API answers HTTP 200 with
     * `{"query":{"search":[]}}` for a person who is not there, which is a real
     * answer and not a wall — but a 200 with no `search` key at all is a
     * different page entirely, and ingesting it as a reading of Wikipedia would
     * be a two-byte-200 defect with a longer body.
     */
    yieldContract: {
      describe: "a MediaWiki search response carrying query.search[]",
      requireAll: ["query", "search"],
      rowsAt: "query.search",
    },
    citation:
      "docs/sources.md — Wikipedia, en.wikipedia.org/w/api.php, Tier A, WIRED, identified User-Agent, " +
      "spaced 400 ms; RULING 87 — DISCOVERY ONLY, never a source of record",
  };
}

function marginaliaRoute(c: CanonicalCandidacy): RouteDescriptor {
  return {
    routeId: "candidate-marginalia-index",
    label: `${displayName(c)} — Marginalia keyword index, DISCOVERY ONLY`,
    executorClass: "DETERMINISTIC",
    executorReason: "a documented public endpoint with a measured control; replaying it needs no model",
    open: {
      kind: "HTTP_GET",
      url: `https://api.marginalia.nu/public/search/${encodeURIComponent(query(c))}`,
      headers: identifiedHeaders(),
    },
    yieldContract: {
      describe: "a Marginalia response carrying its licence declaration and a results array",
      requireAll: ["license", "results"],
      rowsAt: "results",
    },
    citation:
      "docs/sources.md — api.marginalia.nu/public/search, walked 2026-08-24, control: an impossible " +
      "term returns a `license` field and an empty `results` array. CC-BY-NC-SA 4.0 — DISCOVERY ONLY, " +
      "so it may point at a URL and may never be a source of record here",
  };
}

/**
 * The general-index WALL, registered so it is re-walked rather than forgotten.
 *
 * RULING 53: an absence expires and a wall carries a date. `4get.ca` is the only
 * general web index whose `robots.txt` permits the query path, and on 2026-08-26
 * it answered 200 with zero result links to this client. Registering it as
 * NOT_MACHINE_EXECUTABLE keeps it on a clock and keeps the reason in front of
 * whoever reads the digest.
 */
function generalIndexWall(stateCode: string): RouteDescriptor {
  return {
    routeId: "candidate-web-index-4get",
    label: `${stateCode.toUpperCase()} — general web index (4get.ca), recorded as a WALL`,
    executorClass: "BOUNDED_MODEL_WORKER",
    executorReason:
      "there is nothing graduated to replay: the route answers and returns nothing. Establishing " +
      "whether that changed is an observation, not a fetch with a fixed shape",
    open: {
      kind: "NOT_MACHINE_EXECUTABLE",
      target: "https://4get.ca/web",
      reason:
        "GENERAL WEB SEARCH IS A WALL FOR THIS PROJECT, dated 2026-08-26. `4get.ca` is the only " +
        "general index whose robots.txt permits the query path — an empty `Disallow:` — and rung 2 " +
        "answers HTTP 200 with a page that is INTERFACE ONLY: 7,154 B against a 7,274 B control, with " +
        "ZERO result links. The 2026-08-25 reading that recorded it working counted eight ECHOES of " +
        "the query in the page's own furniture. Mojeek, Brave and Ecosia carry `Disallow: /search` and " +
        "are DISALLOWED, which is a different fact and is never re-walked on a clock. This row is the " +
        "WALL, and RULING 53 sends a session back to it.",
    },
    citation: "docs/sources.md — the search-pool table, re-measured 2026-08-26; lib/hunt/search-pool.ts",
  };
}

/**
 * The whole portfolio for one candidacy, given the fields it still owes.
 *
 * ## POSITIONS AND BIOS ARE NARROWER THAN THE REST, AND THAT IS RULING 26
 *
 * A candidate's stance and their self-description are only ever taken from that
 * candidate's OWN statement. An index may point at a page; it may never be the
 * page. So where no site is held, those two fields are BLOCKED ON the
 * campaign-site question — a named dependency, never an absence about a person —
 * and that is stated on the record rather than left for a reader to infer from a
 * null.
 *
 * ## AND EVERY DISCOVERY ROUTE IS ON ITS OWN CLOCK (RULING 207)
 *
 * The recorded site, Wikipedia and Marginalia are materially distinct
 * representations. A 200 from one does not mark the others worked, does not
 * clear their debt and does not move their next-due, because they are separate
 * scheduled units over one record.
 */
function routesForCandidacy(
  c: CanonicalCandidacy,
  owed: readonly EnrichmentField[],
): RouteDescriptor[] {
  const site = c.enrichment.campaignSite.sourceUrl;
  const owedList = owed.join(", ");
  const out: RouteDescriptor[] = [];

  if (site) {
    const r = siteRoute(c, site);
    out.push({ ...r, label: `${r.label} — owed: ${owedList}` });
  }

  const needsDiscovery = owed.some((f) => f === "campaignSite" || f === "photo" || f === "contact");
  if (needsDiscovery || !site) {
    const w = wikipediaRoute(c);
    const m = marginaliaRoute(c);
    out.push(
      { ...w, label: `${w.label} — owed: ${owedList}` },
      { ...m, label: `${m.label} — owed: ${owedList}` },
    );
  }

  const authoredOwed = owed.filter((f) => f === "positions" || f === "bio");
  if (authoredOwed.length > 0 && !site) {
    out.push({
      routeId: "candidate-authored-awaits-site",
      label: `${displayName(c)} — ${authoredOwed.join(" and ")} await this candidate's own publication`,
      executorClass: "BOUNDED_MODEL_WORKER",
      executorReason:
        "no deterministic client applies: the only permitted source for these fields is the " +
        "candidate's own publication, and we do not hold its address",
      open: {
        kind: "NOT_MACHINE_EXECUTABLE",
        target: `${displayName(c)} — the candidate's own publication`,
        reason:
          `${authoredOwed.join(" and ").toUpperCase()} IS ONLY EVER TAKEN FROM THE CANDIDATE'S OWN ` +
          "STATEMENT. RULING 26: every position rendered to a reader carries a source record pointing " +
          "at a specific statement by that candidate, and a general index may point at a page but may " +
          "never be the page. This is BLOCKED ON the campaign-site routes on this same record, which " +
          "is a named dependency and is never an absence about this person.",
      },
      citation: "CLAUDE.md — never generate a candidate position; RULING 26",
    });
  }

  return out;
}

function readUniverse(root: string, stateCode: string): CandidateUniverse | null {
  const path = join(root, "data", "hunt", `${stateCode}-candidate-universe-${CYCLE}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as CandidateUniverse;
}

export function candidateEnrichmentProvider(): ObligationProvider {
  return {
    id: CANDIDATE_ENRICHMENT_PROVIDER_ID,
    describe:
      "campaign sites, candidate-authored positions, bios, photos and published contact as STANDING " +
      "obligations against the canonical STATEWIDE candidate universe — never against the ZIPs that " +
      "happen to be enabled",

    /*
     * THE IDENTITY SCHEME IS THE FIX. `freshness:candidate-enrichment:` then a
     * canonical `<state>:<cycle>:<division>:<office>:<person>` — no ZIP, no
     * county, no pilot. Activating another ZIP that reaches this candidacy finds
     * this row already registered, already clocked and already worked, which is
     * RULING 229's invariant expressed as a primary key.
     */
    scheduledId: (record, route) =>
      `freshness:candidate-enrichment:${record.subjectId}#${route.routeId}`,

    enumerate(ctx: ProviderContext): ProviderYield {
      const records: ProvidedObligation[] = [];
      const failures: string[] = [];

      for (const stateCode of ENRICHED_STATES) {
        let universe: CandidateUniverse | null;
        try {
          universe = readUniverse(ctx.root, stateCode);
        } catch (error) {
          failures.push(
            `data/hunt/${stateCode}-candidate-universe-${CYCLE}.json did not parse ` +
              `(${error instanceof Error ? error.message : String(error)})`,
          );
          continue;
        }
        if (universe === null) {
          failures.push(
            `data/hunt/${stateCode}-candidate-universe-${CYCLE}.json is ABSENT. Regenerate with ` +
              "`pnpm candidates:universe`. A missing denominator is a missing file, never a state " +
              "with no candidates.",
          );
          continue;
        }
        if (universe.candidacies.length === 0) {
          failures.push(
            `data/hunt/${stateCode}-candidate-universe-${CYCLE}.json parsed and holds ZERO candidacies ` +
              "— a FAILED read, never an election with no candidates",
          );
          continue;
        }

        /*
         * **THE RECORD IS THE CANDIDATE'S PUBLIC RECORD; THE ROUTES ARE ITS
         * REPRESENTATIONS.** (RULING 206, RULING 207, and the registry's own
         * doctrine in `registry.ts`.)
         *
         * The first draft of this file made the record (candidacy × FIELD),
         * which put the same Wikipedia query and the same Marginalia query on
         * three separate clocks for one person — one for the site, one for the
         * photo, one for the contact — and would have opened one endpoint three
         * times to answer one question. A representation is scheduled once; the
         * FIELDS it is owed for are what the representation is read FOR.
         */
        for (const c of universe.candidacies) {
          const owed = ENRICHMENT_FIELDS.filter((f) => c.enrichment[f].state !== "FOUND");
          if (owed.length === 0) continue;
          const routes = routesForCandidacy(c, owed);
          if (routes.length === 0) continue;
          records.push({
            recordClass: "candidate-enrichment",
            subjectId: c.id,
            /*
             * NULL ON BOTH SIGNALS, for the reason the campaign-finance records
             * carry: a candidate with no campaign site on their card costs a
             * reader TODAY, not on election day. We hold no declared publication
             * cycle for a campaign website and will not invent one — a cycle
             * nobody read is a fabricated citation with a number in it.
             * RULING 212's surviving default applies.
             */
            readerImpactAt: null,
            observedChangeRateHours: null,
            lastWorkedAt: owed
              .map((f) => c.enrichment[f].checkedAt)
              .filter((d): d is string => d !== null)
              .sort()
              .pop() ?? null,
            routes,
          });
        }

        /*
         * THE WALL IS ONE RECORD, NOT ONE PER PERSON.
         *
         * `4get.ca` returning nothing is a fact about the index. Registering it
         * under every candidacy would have written 378 copies of one wall into
         * the control plane and called the noise coverage.
         */
        records.push({
          recordClass: "candidate-enrichment",
          subjectId: `${stateCode}:${CYCLE}:general-web-index-availability`,
          readerImpactAt: null,
          observedChangeRateHours: null,
          lastWorkedAt: "2026-08-26",
          routes: [generalIndexWall(stateCode)],
        });
      }

      return {
        obligations: records,
        readFailure: failures.length === 0 ? null : failures.join("; "),
        emptyReason:
          records.length === 0 && failures.length === 0
            ? "every canonical candidate universe was read and every enrichment field on every " +
              "candidacy is already FOUND. That would be a real and remarkable result; treat a zero " +
              "here as a defect in this provider until the split is checked against " +
              "`pnpm candidates:universe`."
            : null,
      };
    },
  };
}
