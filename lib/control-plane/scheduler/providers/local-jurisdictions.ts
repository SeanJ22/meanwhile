/**
 * **PROVIDER FOUR — LOCAL JURISDICTIONS.** (Session C3, lane C, 2026-09-01.
 * RULING 229, A.R.S. § 16-928, RULING 205, RULING 207, RULING 182.)
 *
 * ## The defect this closes, stated as the invisible thing it makes visible
 *
 * `data/campaign-finance/filing-regimes.json` routes Arizona correctly and knows
 * exactly two custodians by NAME: the Secretary of State, and Pima County. The
 * Arizona SOS's own bulk table names **109 filing jurisdictions**. Until
 * `data/states/az/jurisdictions/az.json` existed, the other 107 were not small obligations
 * — they were no obligations at all. No name, no clock, no debt row, no
 * denominator. **A government nobody has named cannot be behind schedule.**
 *
 * This provider gives the named ones a clock.
 *
 * ## WHAT IT REGISTERS, AND THE THREE THINGS IT DELIBERATELY DOES NOT
 *
 * ```
 *   REGISTERED    the STATE row, every COUNTY row, and every jurisdiction that
 *                 is a FILING OFFICER IN ITS OWN RIGHT by statute — in Arizona,
 *                 A.R.S. § 16-928's city and town clerks
 *
 *   NOT REGISTERED, and each for a reason about the RECORD rather than about us
 *
 *   1  STATEWIDE-scope routes on a local row. `seethemoney.az.gov` is ONE
 *      record with ONE portfolio, already scheduled once by the
 *      campaign-finance provider. Scheduling it again under all 688 Arizona
 *      governments would be 688 requests for one record — which is not RULING
 *      207, it is the opposite of it: the rule says never skip a materially
 *      DISTINCT representation, not fetch one representation once per subject.
 *
 *   2  PER_COUNTY routes on a district row. Under § 16-928 a school district's,
 *      community college district's and special taxing district's campaign
 *      finance IS the county officer's record. That route is registered ON THE
 *      COUNTY, once. Registering it per district would schedule one record 44
 *      times in Pima alone.
 *
 *   3  The 2,501 enumerated governments that hold no filing-officer role of
 *      their own. They ARE named, durably, in `data/states/<state>/jurisdictions/<state>.json`
 *      with their custodian, their routing statute and the sentence saying what
 *      is owed. What they do not have is an individually scheduled row, and the
 *      reason is the record and not the queue: their finance records belong to
 *      a custodian that IS scheduled, and their own-site meeting records raise a
 *      PERMISSION question — RULING 182 — that no cycle may answer by fetching.
 * ```
 *
 * ## PERMISSION IS READ BEFORE A ROUTE IS OPENED, AND IT IS NOT READ HERE
 *
 * The Census of Governments records a web address for most of these
 * governments. An address is not a permission. `robots.txt` for those hosts has
 * not been read, and RULING 182 keeps permission and transport orthogonal:
 * `CANNOT_TELL` fails safe for the route. So every own-site route below opens
 * `NOT_MACHINE_EXECUTABLE` naming the unread permission — which still gets an
 * occurrence, a RouteTask, an Attempt, a committed disposition, debt and a
 * next-due, exactly as the Arizona FTP drop does. **A route nobody can execute
 * and nobody is reminded of is indistinguishable from a route nobody knows
 * about.** That is the whole point of registering it.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  jurisdictionRegistryPath,
  sourcesOf,
  type Jurisdiction,
  type JurisdictionRegistry,
  type JurisdictionSource,
} from "../../../hunt/jurisdiction-universe.ts";
import type {
  ObligationProvider,
  ProvidedObligation,
  ProviderContext,
  ProviderYield,
  RouteDescriptor,
} from "../registry.ts";

export const LOCAL_JURISDICTIONS_PROVIDER_ID = "local-jurisdictions";

/** The states whose registries this provider schedules. Read, never guessed. */
export const REGISTERED_STATES = ["az", "nh", "nj"] as const;

/**
 * Which enumerated governments get an individually scheduled row.
 *
 * A STATE and a COUNTY always: they are custodians by statute everywhere this
 * project has read one. A CITY_OR_TOWN only where the registry says a route
 * belongs to that government — in Arizona § 16-928 makes the clerk the filing
 * officer, and in New Hampshire and New Jersey this repository has read no such
 * provision, so their municipal rows carry a discovery obligation in the
 * registry and no separate clock here.
 */
function isScheduledHere(reg: JurisdictionRegistry, j: Jurisdiction): boolean {
  if (j.govClass === "STATE" || j.govClass === "COUNTY") return true;
  return sourcesOf(reg, j).some((s) => s.scope === "THIS_JURISDICTION" && s.recordClass !== "MEETINGS");
}

/** The sources this provider opens for one row. See the header's list of three. */
function schedulableSources(reg: JurisdictionRegistry, j: Jurisdiction): JurisdictionSource[] {
  return sourcesOf(reg, j).filter((s) => {
    if (s.scope === "STATEWIDE") return false;
    if (s.scope === "PER_COUNTY" && j.govClass !== "COUNTY") return false;
    return true;
  });
}

/**
 * The route id, which is the fragment after `#` in the durable obligation id.
 *
 * It does NOT repeat the jurisdiction: the obligation id already carries it, and
 * `freshness:jurisdiction:az:city:city-of-benson#az:city:city-of-benson:...`
 * says the same thing twice in a primary key. Where the registry names a
 * method-store route, that name is used verbatim — it is the join to
 * `data/method/knowledge.json` that decides GRADUATED or UNGRADUATED.
 */
function routeIdFor(s: JurisdictionSource, n: number): string {
  return s.routeId ?? `${s.recordClass.toLowerCase().replace(/_/g, "-")}-${n}`;
}

function descriptorFor(j: Jurisdiction, s: JurisdictionSource, n: number): RouteDescriptor {
  const routeId = routeIdFor(s, n);
  const label = `${j.name} — ${s.recordClass.replace(/_/g, " ").toLowerCase()} via ${s.authority}`;

  if (s.state === "ADAPTED" && s.url && /^https?:\/\//i.test(s.url)) {
    return {
      routeId,
      label,
      executorClass: "DETERMINISTIC",
      executorReason:
        "the registry records this as ADAPTED with an explicit address, so opening it is a replay of a " +
        "route this project has already walked rather than a derivation",
      open: { kind: "HTTP_GET", url: s.url },
      citation: s.citation,
    };
  }

  /*
   * EVERYTHING ELSE IS NOT_MACHINE_EXECUTABLE, and the reason is carried
   * verbatim from the registry's `owed` sentence rather than summarised. A
   * summarised next move is a next move somebody has to reconstruct.
   */
  const ownSite = s.recordClass === "MEETINGS" && j.ownWebAddress !== null;
  return {
    routeId,
    label,
    executorClass: "BOUNDED_MODEL_WORKER",
    executorReason: ownSite
      ? "the address is recorded and its PERMISSION is not read. Pointing a deterministic client at an " +
        "unread host would answer a permission question by fetching, which RULING 182 forbids; reading " +
        "the host's robots.txt and its own publication is a scout's job"
      : "the custodian and the routing rule are known and the ADDRESS is not. Finding an address is a " +
        "scout's job, and a deterministic client pointed at a guessed page that answers HTTP 200 is the " +
        "worst available outcome",
    open: {
      kind: "NOT_MACHINE_EXECUTABLE",
      target: s.url ?? j.ownWebAddress ?? s.authority,
      reason:
        `${s.owed ?? "no next move is recorded for this source, which is itself the defect"} ` +
        (ownSite
          ? `PERMISSION FOR ${j.ownWebAddress} HAS NOT BEEN READ. RULING 182: permission state and ` +
            "transport state are orthogonal, and CANNOT_TELL fails safe for the route. This is a fact " +
            "about what we have read, never about what the government publishes."
          : "REQUIRES_NEW_ADAPTER: this is a fact about our tooling and our reading, never about the record."),
    },
    citation: s.citation,
    awaitingAdapter: ownSite
      ? `a permission reading of ${j.ownWebAddress}, then an adapter for whatever it publishes`
      : `an address for ${s.authority}`,
  };
}

function readRegistry(root: string, stateCode: string): JurisdictionRegistry | null {
  const path = join(root, jurisdictionRegistryPath(stateCode));
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as JurisdictionRegistry;
}

export function localJurisdictionsProvider(): ObligationProvider {
  return {
    id: LOCAL_JURISDICTIONS_PROVIDER_ID,
    describe:
      "every named government that is a filing officer or an election custodian in its own right, from " +
      "the committed jurisdiction registries — so a government outside the pilot ZIPs has a clock BEFORE " +
      "a reader arrives in it",

    scheduledId: (record, route) => `freshness:jurisdiction:${record.subjectId}#${route.routeId}`,

    enumerate(ctx: ProviderContext): ProviderYield {
      const records: ProvidedObligation[] = [];
      const failures: string[] = [];

      for (const stateCode of REGISTERED_STATES) {
        let reg: JurisdictionRegistry | null;
        try {
          reg = readRegistry(ctx.root, stateCode);
        } catch (error) {
          failures.push(
            `${jurisdictionRegistryPath(stateCode)} did not parse ` +
              `(${error instanceof Error ? error.message : String(error)})`,
          );
          continue;
        }
        if (reg === null) {
          failures.push(
            `${jurisdictionRegistryPath(stateCode)} is ABSENT. Regenerate it with ` +
              "`pnpm jurisdictions:enumerate`. A missing registry is a missing file, never a state " +
              "with no local government.",
          );
          continue;
        }
        if (reg.jurisdictions.length === 0) {
          failures.push(
            `${jurisdictionRegistryPath(stateCode)} parsed and holds ZERO jurisdictions — a FAILED read, ` +
              "never an empty state",
          );
          continue;
        }
        for (const j of reg.jurisdictions) {
          if (!isScheduledHere(reg, j)) continue;
          const sources = schedulableSources(reg, j);
          if (sources.length === 0) continue;
          records.push({
            recordClass: "local-jurisdiction",
            subjectId: j.id,
            /*
             * NULL ON BOTH SIGNALS, and the reason is the same one the
             * campaign-finance records carry: a filing officer's publication
             * costs a reader the moment it goes stale, not on election day. We
             * hold no declared publication cycle for any of these governments
             * and will not invent one — a publisher cycle nobody read is a
             * fabricated citation with a number in it.
             */
            readerImpactAt: null,
            observedChangeRateHours: null,
            lastWorkedAt: null,
            routes: sources.map((s, n) => descriptorFor(j, s, n)),
          });
        }
      }

      return {
        obligations: records,
        readFailure: failures.length === 0 ? null : failures.join("; "),
        emptyReason:
          records.length === 0 && failures.length === 0
            ? "every committed jurisdiction registry was read and none named a government holding a " +
              "filing-officer or custodian role of its own. That cannot be true while Arizona's " +
              "registry carries 15 counties, so a zero here is a defect in this provider."
            : null,
      };
    },
  };
}
