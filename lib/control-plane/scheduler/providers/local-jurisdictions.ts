/**
 * Local jurisdictions as standing obligations in every tracked state: the state row, every county, and every
 * government that is a filing officer in its own right. Not registered: statewide-scope routes on a local row
 * (already scheduled once by their own provider), per-county routes on a district row (registered on the
 * county once), and governments with no filing-officer role (their records belong to a scheduled custodian).
 * Only sources the registry records ADAPTED with an address become rows; the rest are hunted in their government's
 * packet. Meetings routes are carried by what owns them: DISCOVERY_OWED goes to meetings discovery, a partition-owned
 * route is inventory, and an unread wiring holds the route by name.
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

/** Custodian dedupe: whose record a source is. */
function belongsToThisRow(s: JurisdictionSource, j: Jurisdiction): boolean {
  if (s.scope === "STATEWIDE") return false;
  if (s.scope === "PER_COUNTY" && j.govClass !== "COUNTY") return false;
  return true;
}

/** The route id (the fragment after `#`). A registry-named method route is used verbatim; `n` counts non-meetings sources only so positional ids never move. */
function routeIdFor(s: JurisdictionSource, n: number): string {
  return s.routeId ?? `${s.recordClass.toLowerCase().replace(/_/g, "-")}-${n}`;
}

/** A known meetings route's id: never positional, never the retired `meetings-<n>` shape. */
function meetingsRouteIdFor(s: JurisdictionSource, k: number): string {
  return s.routeId ?? `meetings-adapted-${k}`;
}

/** A registry source the registry records as ADAPTED with an address: a replay of a route already walked. Anything else is hunted through its government's packet. */
function descriptorFor(j: Jurisdiction, s: JurisdictionSource, routeId: string): RouteDescriptor | null {
  if (s.state !== "ADAPTED" || !s.url || !/^https?:\/\//i.test(s.url)) return null;
  return {
    routeId,
    label: `${j.name} — ${s.recordClass.replace(/_/g, " ").toLowerCase()} via ${s.authority}`,
    executorClass: "DETERMINISTIC",
    executorReason:
      "the registry records this as ADAPTED with an explicit address, so opening it is a replay of a " +
      "route this project has already walked rather than a derivation",
    open: { kind: "HTTP_GET", url: s.url },
    citation: s.citation,
  };
}

/** The registry's own requirement definitions for one government, custodian-deduped, in the row's order. Meetings discovery belongs to `meetings-discovery.ts`. */
export function jurisdictionRequirements(
  reg: JurisdictionRegistry,
  j: Jurisdiction,
  meetingPartitions: MeetingPartitionOwnership = UNREAD_MEETING_PARTITIONS,
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
      const route = descriptorFor(j, s, routeId);
      if (route !== null) out.push({ obligationId: localJurisdictionObligationId(j.id, routeId), sourceKey: key, source: s, route, carriage: "HERE" });
      continue;
    }
    if (s.state === "DISCOVERY_OWED") continue;
    const routeId = meetingsRouteIdFor(s, k);
    k += 1;
    const route = descriptorFor(j, s, routeId);
    if (route === null) continue;
    const owner = meetingPartitions.ownerOf(j.id);
    out.push({
      obligationId: localJurisdictionObligationId(j.id, routeId),
      sourceKey: key,
      source: s,
      route,
      carriage: owner === "NONE" ? "HERE" : owner === "PARTITION" ? "MEETING_PARTITION" : "HELD_UNREAD_WIRING",
      ...(owner === "UNKNOWN" ? { heldReason: meetingPartitions.reasonFor?.(j.id) ?? meetingPartitions.source } : {}),
    });
  }
  return out;
}

/** Which governments get an individually scheduled row in a tracked state: a state and a county always; any other only where a route carried here belongs to it alone. */
function isScheduledHere(j: Jurisdiction, requirements: readonly JurisdictionRequirement[]): boolean {
  if (j.govClass === "STATE" || j.govClass === "COUNTY") return true;
  return requirements.some((r) => r.carriage === "HERE" && r.source.scope === "THIS_JURISDICTION");
}

/** `xx:county:county-of-name` from `freshness:jurisdiction:xx:county:county-of-name#ballot-1`, or null. */
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
      const add = (j: Jurisdiction, r: JurisdictionRequirement): void => {
        const list = routesBySubject.get(j.id) ?? [];
        if (list.some((x) => x.routeId === r.route.routeId)) return;
        list.push(r.route);
        routesBySubject.set(j.id, list);
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
            for (const r of requirements) if (r.carriage === "HERE") add(j, r);
          }
        }
      }

      /* The owner's materialized work, kept while the registry still defines it. */
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
          const r = jurisdictionRequirements(reg, j, meetingPartitions).find((x) => x.obligationId === id);
          if (r !== undefined && r.carriage === "HERE") add(j, r);
          if (r?.carriage === "HELD_UNREAD_WIRING") failures.push(r.heldReason ?? `${id}: meeting partition ownership unread; retain the owner's existing work`);
        }
      }

      const records: ProvidedObligation[] = [...routesBySubject.keys()].sort().map((subjectId) => ({
        recordClass: "local-jurisdiction",
        subjectId,
        /* Null on both signals: a filing officer's publication costs a reader the moment it goes stale, and no publication cycle is held. */
        readerImpactAt: null,
        observedChangeRateHours: null,
        lastWorkedAt: null,
        routes: routesBySubject.get(subjectId) ?? [],
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
