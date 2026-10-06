/**
 * **PROVIDER FOUR — LOCAL JURISDICTIONS.** (Session C3, lane C, 2026-09-01.
 * RULING 229, A.R.S. § 16-928, RULING 205, RULING 207, RULING 182.)
 *
 * ## The defect this closes, stated as the invisible thing it makes visible
 *
 * The reviewed filing-regime model routes Arizona correctly and knows
 * exactly two custodians by NAME: the Secretary of State, and Pima County. The
 * Arizona SOS's own bulk table names **109 filing jurisdictions**. Until
 * the jurisdiction operational-reference projection existed, the other 107 were not small obligations
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
 *                 A.R.S. § 16-928's city and town clerks — in every TRACKED
 *                 state (below)
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
 *      their own. They ARE named, durably, in the canonical promoted
 *      operational-reference projection
 *      with their custodian, their routing statute and the sentence saying what
 *      is owed. What they do not have is an individually scheduled row, and the
 *      reason is the record and not the queue: their finance records belong to
 *      a custodian that IS scheduled.
 * ```
 *
 * ## WHICH STATES — THE COVERAGE SET, READ AS DATA (2026-09-23)
 *
 * This file used to schedule `["az", "nh", "nj"]`, a list in code, so a state
 * the owner registered could not be tracked without a code change. The tracked
 * states are now handed in (`TrackedStatesSource` in `../provider-inputs.ts`):
 * the coverage set, and until its promoted accessor is on main, the states
 * whose registry the promoted operational-reference bundle carries. A tracked
 * state whose registry cannot be read is a named read failure, never a silent
 * skip, and never a fallback to a list.
 *
 * ## MEETINGS ROUTES ARE CARRIED BY WHAT THE DATA SAYS OWNS THEM (2026-09-23)
 *
 * The permanent source/body meeting-partition contracts are the only production
 * meetings clock (RULING 282/283). What that means for a registry `MEETINGS`
 * source is now decided by the source's own state and the partition wiring,
 * instead of a blanket strip:
 *
 * ```
 *   DISCOVERY_OWED            the address or the extraction is not known, so
 *                             this is DISCOVERY, not acquisition. The
 *                             meetings-discovery provider carries it, in the
 *                             gap ledger's shape, once the owner's dispatch
 *                             materializes it (MW-028). Never a clock here
 *   known address, and a      inventory: the partition is the clock
 *     partition owns it
 *   known address, and the    the only clock this government's meetings have,
 *     wiring says none does   so it is scheduled here
 *   known address, wiring     HELD and named: never scheduled beside a
 *     unread                  partition that may already own it
 * ```
 *
 * Every registry meetings source today is DISCOVERY_OWED, so no meetings route
 * is scheduled here, exactly as before.
 *
 * ## WORK THE OWNER'S DISPATCH MATERIALIZED (MW-028)
 *
 * `lib/control-plane/expansion/dispatch-work.ts` creates the requirement
 * instances a dispatched geography owes that no clock carries — for example a
 * county in a state the registry covers and the coverage set does not track
 * yet. It creates them under THIS provider's ids, so tracking the state later
 * re-registers the same rows rather than a second copy, and this provider keeps
 * every such row in its corpus while the registry still defines it.
 */

import { sourceOf, type Jurisdiction, type JurisdictionRegistry, type JurisdictionSource } from "../../../hunt/jurisdiction-universe.ts";
import { requiredJurisdictionRegistry } from "../../../civic-data/operational-references.ts";
import {
  NOTHING_MATERIALIZED,
  UNREAD_MEETING_PARTITIONS,
  trackedStatesFromOperationalReference,
  type MaterializedReading,
  type MeetingPartitionOwnership,
  type TrackedStatesSource,
} from "../provider-inputs.ts";
import { bodyDirectoryDiscoveryPlan, jurisdictionDiscoveryPlan, publicCommentDiscoveryPlan, type AutonomousWorkPlan } from "../../workers/autonomous-plan.ts";
import type {
  ObligationProvider,
  ProvidedObligation,
  ProviderContext,
  ProviderYield,
  RouteDescriptor,
} from "../registry.ts";

export const LOCAL_JURISDICTIONS_PROVIDER_ID = "local-jurisdictions";

/** Every id this provider owns starts with this. */
export const LOCAL_JURISDICTION_NAMESPACE = "freshness:jurisdiction:";

/** The durable obligation id for one jurisdiction and route. The provider's `scheduledId`, as a function. */
export function localJurisdictionObligationId(jurisdictionId: string, routeId: string): string {
  return `${LOCAL_JURISDICTION_NAMESPACE}${jurisdictionId}#${routeId}`;
}

/** What the runner hands this provider. Each member defaults to a reading of data, never a list. */
export interface LocalJurisdictionsInput {
  readonly trackedStates?: TrackedStatesSource;
  readonly materialized?: () => MaterializedReading;
  readonly meetingPartitions?: MeetingPartitionOwnership;
}

/**
 * How one registry source is carried, for one government.
 *
 *   HERE                 a route this provider schedules (for a tracked
 *                        custodian) or keeps (when the owner's dispatch
 *                        materialized it)
 *   MEETING_PARTITION    a machine-openable meetings route a production
 *                        meeting partition owns: inventory
 *   HELD_UNREAD_WIRING   a machine-openable meetings route whose partition
 *                        ownership could not be read: held, named
 */
export type RequirementCarriage = "HERE" | "MEETING_PARTITION" | "HELD_UNREAD_WIRING";

/** One requirement instance the registry defines for a government, outside meetings discovery. */
export interface JurisdictionRequirement {
  readonly obligationId: string;
  /** The registry's source-catalog key, the requirement's own identity. */
  readonly sourceKey: string;
  readonly source: JurisdictionSource;
  readonly route: RouteDescriptor;
  readonly carriage: RequirementCarriage;
  readonly heldReason?: string;
}

/** Custodian dedupe, the header's rules 1 and 2: whose record a source is. */
function belongsToThisRow(s: JurisdictionSource, j: Jurisdiction): boolean {
  if (s.scope === "STATEWIDE") return false;
  if (s.scope === "PER_COUNTY" && j.govClass !== "COUNTY") return false;
  return true;
}

/**
 * The route id, which is the fragment after `#` in the durable obligation id.
 *
 * It does NOT repeat the jurisdiction: the obligation id already carries it, and
 * `freshness:jurisdiction:az:city:city-of-benson#az:city:city-of-benson:...`
 * says the same thing twice in a primary key. Where the registry names a
 * method-store route, that name is used verbatim — it is the join to
 * `data/method/knowledge.json` that decides GRADUATED or UNGRADUATED.
 *
 * `n` counts the row's non-meetings sources only, as it always has: counting
 * meetings sources would move every existing positional id and orphan its
 * next-due, occurrence count and debt row.
 */
function routeIdFor(s: JurisdictionSource, n: number): string {
  return s.routeId ?? `${s.recordClass.toLowerCase().replace(/_/g, "-")}-${n}`;
}

/** A known meetings route's id: never positional, never the retired `meetings-<n>` shape. */
function meetingsRouteIdFor(s: JurisdictionSource, k: number): string {
  return s.routeId ?? `meetings-adapted-${k}`;
}

function descriptorFor(j: Jurisdiction, s: JurisdictionSource, routeId: string): RouteDescriptor {
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
  return {
    routeId,
    label,
    executorClass: "BOUNDED_MODEL_WORKER",
    executorReason:
      "the custodian and the routing rule are known and the ADDRESS is not. Finding an address is a " +
        "scout's job, and a deterministic client pointed at a guessed page that answers HTTP 200 is the " +
        "worst available outcome",
    open: {
      kind: "NOT_MACHINE_EXECUTABLE",
      target: s.url ?? j.ownWebAddress ?? s.authority,
      reason:
        `${s.owed ?? "no next move is recorded for this source, which is itself the defect"} ` +
        "REQUIRES_NEW_ADAPTER: this is a fact about our tooling and our reading, never about the record.",
    },
    citation: s.citation,
    awaitingAdapter: `an address for ${s.authority}`,
  };
}

/**
 * **THE REGISTRY'S OWN REQUIREMENT DEFINITIONS FOR ONE GOVERNMENT**, with the
 * ids this provider gives them. Meetings DISCOVERY is not here: it belongs to
 * `meetings-discovery.ts`, in the gap ledger's shape.
 *
 * Sources are taken in the row's own order, custodian-deduped, and non-meetings
 * sources keep the positional ids they have always had.
 */
const NO_LIVE_FAMILIES: ReadonlySet<string> = new Set();

export function jurisdictionRequirements(
  reg: JurisdictionRegistry,
  j: Jurisdiction,
  meetingPartitions: MeetingPartitionOwnership = UNREAD_MEETING_PARTITIONS,
  discoverMissingFamilies = false,
  /** Record classes whose owed rows for this government are already live (CH-04): no paid discovery Scout is queued for them. */
  liveFamilies: ReadonlySet<string> = NO_LIVE_FAMILIES,
): readonly JurisdictionRequirement[] {
  const out: JurisdictionRequirement[] = [];
  let n = 0;
  let k = 0;
  for (const key of j.sourceIds) {
    const s = sourceOf(reg, j, key);
    if (!belongsToThisRow(s, j)) continue;
    if (s.recordClass !== "MEETINGS") {
      const routeId = routeIdFor(s, n);
      n += 1;
      out.push({ obligationId: localJurisdictionObligationId(j.id, routeId), sourceKey: key, source: s, route: descriptorFor(j, s, routeId), carriage: "HERE" });
      continue;
    }
    if (s.state === "DISCOVERY_OWED") continue;
    const routeId = meetingsRouteIdFor(s, k);
    k += 1;
    const owner = meetingPartitions.ownerOf(j.id);
    out.push({
      obligationId: localJurisdictionObligationId(j.id, routeId),
      sourceKey: key,
      source: s,
      route: descriptorFor(j, s, routeId),
      carriage: owner === "NONE" ? "HERE" : owner === "PARTITION" ? "MEETING_PARTITION" : "HELD_UNREAD_WIRING",
      ...(owner === "UNKNOWN" ? { heldReason: meetingPartitions.reasonFor?.(j.id) ?? meetingPartitions.source } : {}),
    });
  }
  if (discoverMissingFamilies) {
    const directoryRoute = "coverage-discovery:body-directory";
    const directorySource: JurisdictionSource = { recordClass: "OFFICEHOLDERS", authority: j.name,
      authorityBasis: "The official directory and independent jurisdiction evidence define the body denominator; a roster cannot establish it.",
      scope: "THIS_JURISDICTION", routeId: directoryRoute, url: j.ownWebAddress, state: "DISCOVERY_OWED",
      owed: "Discover governing and subordinate bodies, verify their actual territorial applicability, and create the downstream work for each verified body.",
      citation: `Registered government ${j.id}.` };
    out.push({ obligationId: localJurisdictionObligationId(j.id, directoryRoute), sourceKey: directoryRoute,
      source: directorySource, route: descriptorFor(j, directorySource, directoryRoute), carriage: "HERE" });
    // A registered government with no source entry still owes discovery. These
    // are questions, not invented sources, filing authorities or absence claims.
    // Known shared custodians remain on their existing routes instead of being
    // copied under every district they serve. Meetings retain their own provider.
    const represented = new Set(j.sourceIds.map(key => sourceOf(reg, j, key).recordClass));
    const families = [
      ["OFFICEHOLDERS", "Find the governing bodies, subordinate boards, current offices and members, their official pages, contacts and published statements. Establish exact authority and identity before extraction."],
      ["BALLOT_AND_CANDIDATES", "Find the responsible election authorities and their current candidate filings, contests, measures and certified results. Follow candidate identities into verified profiles, campaign publications and positions. Determine applicability from evidence, not from an empty queue."],
      ["CAMPAIGN_FINANCE", "Establish the legally responsible filing custodian and applicable committee, contribution and expenditure records. Reuse that custodian's shared work; do not assume this government operates a separate filing system."],
      ["PUBLIC_SERVICES", "Find the actual responsible service offices and usable contact channels. Independently verify topic, service responsibility and service-area ZIP applicability; a mailing address or county boundary is not evidence that an office serves that ZIP. Reuse shared authorities and retain unresolved topic/area gaps."],
      ["VOTER_ACCESS", "Find the responsible election authority's polling-place and registration lookup routes. Independently verify the state, route kind and destination; do not infer that a local route serves an entire state. Publish only verified statewide lookup routes through the statewide Reader; retain narrower applicability as unresolved work."],
    ] as const;
    for (const [recordClass, owed] of families) {
      if (represented.has(recordClass) || liveFamilies.has(recordClass)) continue;
      const routeId = `coverage-discovery:${recordClass.toLowerCase()}`;
      const source: JurisdictionSource = { recordClass, authority: j.name,
        authorityBasis: "The registered government's missing information family requires discovery; publisher, custodian and applicability have not yet been established.",
        scope: "THIS_JURISDICTION", routeId, url: j.ownWebAddress, state: "DISCOVERY_OWED", owed,
        citation: `Government ${j.id}, enumerated by ${j.enumeratedFrom}; no ${recordClass} source entry is held.` };
      const route: RouteDescriptor = { ...descriptorFor(j, source, routeId),
        executorReason: "The government is registered, but this information family's publisher, custodian and applicability remain unresolved. Discover and verify them using inherited methods.",
        open: { kind: "NOT_MACHINE_EXECUTABLE", target: j.ownWebAddress ?? j.name, reason: owed },
        awaitingAdapter: `verified source applicability and extraction for ${recordClass}` };
      out.push({ obligationId: localJurisdictionObligationId(j.id, routeId), sourceKey: routeId,
        source, route, carriage: "HERE" });
    }
    const bodyId = meetingPartitions.bodyIdFor ? meetingPartitions.bodyIdFor(j.id) : j.bodyId ?? null;
    if (bodyId && !represented.has("PUBLIC_COMMENT")) {
      const routeId = "coverage-discovery:public-comment";
      const source: JurisdictionSource = { recordClass: "PUBLIC_COMMENT", authority: j.name,
        authorityBasis: `Exact registered governing body ${bodyId}; its participation rules remain to be verified.`,
        scope: "THIS_JURISDICTION", routeId, url: j.ownWebAddress, state: "DISCOVERY_OWED",
        owed: "Find and independently verify the body's published public-comment rules, signup, written comments, attendance and speaking limits.",
        citation: `Registered government ${j.id}, body ${bodyId}.` };
      out.push({ obligationId: localJurisdictionObligationId(j.id, routeId), sourceKey: routeId, source,
        route: descriptorFor(j, source, routeId), carriage: "HERE" });
    }
  }
  return out;
}

/** The exact registered body a government's reader door publishes to, or null when none is joined. */
export function requirementBodyId(j: Jurisdiction, meetingPartitions: MeetingPartitionOwnership): string | null {
  return meetingPartitions.bodyIdFor ? meetingPartitions.bodyIdFor(j.id) : j.bodyId ?? null;
}

/**
 * The work plan one requirement's paid work carries (CH-22), or null. Discovery the owner's Send
 * materialized always gets one; a registry route gets one when it reaches the paid model path, so a
 * tracked government's findings go through the coordinator and the builders to a reader door the
 * way a Send's do, instead of staying staged. Meetings keep their own discovery and publishing.
 */
export function requirementPlan(j: Jurisdiction, r: JurisdictionRequirement, bodyId: string | null, discoverMissingFamilies: boolean): AutonomousWorkPlan | null {
  if (!discoverMissingFamilies && (r.carriage !== "HERE" || r.route.executorClass !== "BOUNDED_MODEL_WORKER")) return null;
  if (r.route.routeId === "coverage-discovery:body-directory") return bodyDirectoryDiscoveryPlan(j, bodyId);
  if (r.source.recordClass === "PUBLIC_COMMENT") return publicCommentDiscoveryPlan(j, bodyId);
  return jurisdictionDiscoveryPlan(j, r.source, r.route.routeId, bodyId);
}

/**
 * Which enumerated governments get an individually scheduled row in a tracked
 * state.
 *
 * A STATE and a COUNTY always: they are custodians by statute everywhere this
 * project has read one. Any other government only where a route carried here
 * belongs to it alone — in Arizona § 16-928 makes the clerk the filing officer,
 * and in New Hampshire and New Jersey this repository has read no such
 * provision, so their municipal rows carry a discovery obligation in the
 * registry and no separate clock here.
 */
function isScheduledHere(j: Jurisdiction, requirements: readonly JurisdictionRequirement[]): boolean {
  if (j.govClass === "STATE" || j.govClass === "COUNTY") return true;
  return requirements.some((r) => r.carriage === "HERE" && r.source.scope === "THIS_JURISDICTION");
}

/** `az:county:county-of-pima` from `freshness:jurisdiction:az:county:county-of-pima#ballot-1`, or null. */
function jurisdictionOf(obligationId: string): string | null {
  if (!obligationId.startsWith(LOCAL_JURISDICTION_NAMESPACE)) return null;
  const rest = obligationId.slice(LOCAL_JURISDICTION_NAMESPACE.length);
  const hash = rest.indexOf("#");
  return hash <= 0 ? null : rest.slice(0, hash);
}

export function localJurisdictionsProvider(input: LocalJurisdictionsInput = {}): ObligationProvider {
  const trackedStates = input.trackedStates ?? trackedStatesFromOperationalReference();
  const readMaterialized = input.materialized ?? (() => NOTHING_MATERIALIZED);
  const meetingPartitions = input.meetingPartitions ?? UNREAD_MEETING_PARTITIONS;
  return {
    id: LOCAL_JURISDICTIONS_PROVIDER_ID,
    describe:
      "every named government that is a filing officer or an election custodian in its own right in a tracked " +
      "state, and every requirement the owner's dispatch materialized, from the promoted operational-reference " +
      "registries — so a government outside the pilot ZIPs has a clock BEFORE a reader arrives in it",

    /* The template `localJurisdictionObligationId` restates; the assignment view's prefix table reads it here. */
    scheduledId: (record, route) => `freshness:jurisdiction:${record.subjectId}#${route.routeId}`,

    enumerate(_ctx: ProviderContext): ProviderYield {
      const failures: string[] = [];
      const routesBySubject = new Map<string, RouteDescriptor[]>();
      const plansBySubject = new Map<string, Record<string, AutonomousWorkPlan>>();
      const add = (j: Jurisdiction, r: JurisdictionRequirement, discoverMissingFamilies: boolean): void => {
        const list = routesBySubject.get(j.id) ?? [];
        if (list.some((x) => x.routeId === r.route.routeId)) return;
        list.push(r.route);
        routesBySubject.set(j.id, list);
        const plan = requirementPlan(j, r, requirementBodyId(j, meetingPartitions), discoverMissingFamilies);
        if (plan !== null) plansBySubject.set(j.id, { ...plansBySubject.get(j.id), [r.route.routeId]: plan });
      };
      const registries = new Map<string, JurisdictionRegistry | null>();
      const registryFor = (stateCode: string): JurisdictionRegistry | null => {
        if (registries.has(stateCode)) return registries.get(stateCode) ?? null;
        let reg: JurisdictionRegistry | null = null;
        try {
          reg = requiredJurisdictionRegistry(stateCode);
          if (reg.jurisdictions.length === 0) {
            failures.push(
              `canonical operational-reference projection for ${stateCode} holds ZERO jurisdictions — a FAILED read, ` +
                "never an empty state",
            );
            reg = null;
          }
        } catch (error) {
          failures.push(
            `canonical operational-reference projection for ${stateCode} could not be read ` +
              `(${error instanceof Error ? error.message : String(error)})`,
          );
        }
        registries.set(stateCode, reg);
        return reg;
      };

      /* THE STANDING CLOCKS, for every tracked state. */
      const tracked = trackedStates.read();
      if ("unreadable" in tracked) {
        failures.push(`the tracked states could not be read from ${tracked.source} (${tracked.unreadable})`);
      } else {
        for (const stateCode of tracked.states) {
          const reg = registryFor(stateCode);
          if (reg === null) continue;
          for (const j of reg.jurisdictions) {
            const requirements = jurisdictionRequirements(reg, j, meetingPartitions);
            if (!isScheduledHere(j, requirements)) continue;
            for (const r of requirements) if (r.carriage === "HERE") add(j, r, false);
          }
        }
      }

      /* THE OWNER'S MATERIALIZED WORK, kept while the registry still defines it (MW-028). */
      const materialized = readMaterialized();
      if ("unreadable" in materialized) {
        failures.push(`the work the owner's dispatch materialized could not be read (${materialized.unreadable})`);
      } else {
        const byState = new Map<string, Map<string, Jurisdiction>>();
        for (const id of [...materialized.ids].sort()) {
          const jurisdictionId = jurisdictionOf(id);
          if (jurisdictionId === null) continue;
          const stateCode = jurisdictionId.split(":")[0]?.toLowerCase() ?? "";
          const reg = registryFor(stateCode);
          if (reg === null) continue;
          let rows = byState.get(stateCode);
          if (rows === undefined) {
            rows = new Map(reg.jurisdictions.map((j) => [j.id, j]));
            byState.set(stateCode, rows);
          }
          const j = rows.get(jurisdictionId);
          if (j === undefined) continue;
          const r = jurisdictionRequirements(reg, j, meetingPartitions, true).find((x) => x.obligationId === id);
          if (r !== undefined && r.carriage === "HERE") add(j, r, true);
          if (r?.carriage === "HELD_UNREAD_WIRING") failures.push(r.heldReason ?? `${id}: meeting partition ownership unread; retain the owner's existing work`);
        }
      }

      const records: ProvidedObligation[] = [...routesBySubject.keys()].sort().map((subjectId) => ({
        recordClass: "local-jurisdiction",
        subjectId,
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
        routes: routesBySubject.get(subjectId) ?? [],
        ...(plansBySubject.has(subjectId) ? { autonomousPlans: plansBySubject.get(subjectId)! } : {}),
      }));

      return {
        obligations: records,
        readFailure: failures.length === 0 ? null : failures.join("; "),
        emptyReason:
          records.length === 0 && failures.length === 0
            ? "every promoted jurisdiction registry was read and none named a government holding a " +
              "filing-officer or custodian role of its own. That cannot be true while Arizona's " +
              "registry carries 15 counties, so a zero here is a defect in this provider."
            : null,
      };
    },
  };
}
