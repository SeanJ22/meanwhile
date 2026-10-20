import { OWNER_DISPATCH, withAssignment, type FreshnessObligation, type ObligationAssignment } from "../scheduler/obligation.ts";
import type { WorkQuestion } from "../work-question.ts";
import { standing } from "../scheduler/durable.ts";
import { inheritPublicationConnection } from "../workers/autonomous-plan.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import type { ExecutorKind } from "../scheduler/dispatch.ts";
import { parseDispatchTarget, unitMatchesTarget, type DispatchTarget } from "../scheduler/dispatch-target.ts";
import type { MeetingPartitionOwnership } from "../scheduler/provider-inputs.ts";
import { jurisdictionRequirements } from "../scheduler/providers/local-jurisdictions.ts";
import { huntPacketObligation } from "../../hunt/packet-plan.ts";
import {
  MEETINGS_DISCOVERY_RECORD_CLASS,
  meetingsDiscoveryObligationId,
  meetingsDiscoveryRoute,
} from "../scheduler/providers/meetings-discovery.ts";
import { meetingsDiscoveryNeeds, type MeetingsDiscoveryNeed } from "../../hunt/meetings-discovery.ts";
import { registrySourceOf, type Jurisdiction, type JurisdictionRegistry, type JurisdictionRegistrySource } from "../../hunt/jurisdiction-universe.ts";
import {
  certainlyOverlaps,
  unitsCertainlyIn,
  type CensusUnitTerritory,
  type PlannedScope,
  type TerritoryIndex,
} from "./membership.ts";
import { READING_LIST_CAP, isVersionedCycleReading } from "./reading.ts";
import { manualProducerInvocationMatrix } from "../../civic-data/manual-producer-invocation.ts";
import { createWorkItem } from "../work-item.ts";
import { registerWorkItem } from "../repository/coordinator.ts";
import type { ResolvedScope } from "./membership.ts";
import { buildPlaceOwedList, type PlaceOwedItem } from "../../coverage/place-owed.ts";
import { placePercent, placeMeasures } from "../../coverage/place-measures.ts";
import { percentOf } from "../../coverage/place-percent.ts";
import { loadPublishedScopeLookupState } from "../../census-geography/scope-lookup.ts";
import type { CensusGeographyLookup } from "../../census-geography/contract.ts";
import { readHeldPlaceCapture } from "../../civic-data/held-place-capture.ts";
import { ADMIN_CONFIG_ID, isAdminConfig } from "../gateway/admin-config.ts";
import { setActiveOwedOverlay } from "../../coverage/owed-overlay.ts";
import { expansionScopesOf, VERSION_PREFIX, type ExpansionScopeDecision } from "./scopes.ts";
import { resolveScopes } from "./runner-load.ts";
import { loadPublishedAreaLookupState, readPublishedPlaceMemberships } from "../../census-geography/area-lookup.ts";
import { declaredWorkMembers } from "./declared-work-scope.ts";
import { censusWorkDivision } from "../../census-geography/division-id.ts";
import { parseV6PlaceKey } from "../admin-view/v6-hunts-read.ts";
import { visitPlaceStandingWork } from "../repository/pg-store.ts";
import { DiskRows } from "../scheduler/disk-rows.ts";
import { createPlannerSpool, plannerMap, plannerSet, type PlannerSpool } from "../scheduler/planner-spool.ts";

export type PlanRows<T> = readonly T[] | DiskRows<T>;
let nextDispatchPlan = 0;

/** Fixture callers keep small arrays; the runner streams the same rows through its round index. */
function planRows<T>(planner: PlannerSpool | undefined, name: string, encode: (row: T) => unknown = row => row, decode: (row: unknown) => T = row => row as T): { rows: PlanRows<T>; add(row: T): void } {
  if (!planner) { const rows: T[] = []; return { rows, add: row => rows.push(row) }; }
  let position = 0;
  const table = planner.table<unknown>(name, () => String(position++));
  return { rows: table.rows.map(decode), add: row => table.add(encode(row)) };
}

export interface PlaceWorkReading {
  readonly key: string;
  readonly receiptId: string;
  readonly items: readonly Pick<PlaceOwedItem, "state" | "checklistId">[];
  /** A caller that folded a place's held capture can release its rows before ordering Sends. */
  readonly percent?: number | null;
}

/** Order the existing place capture rows; this creates no score or policy store. */
export function placeWorkReadings(config: unknown, places: readonly PlaceWorkReading[]) {
  const placeKey = (key: string): string => {
    const parsed = parseV6PlaceKey(key);
    return parsed?.kind === "geo" ? `${parsed.state}.${VERSION_PREFIX[parsed.type]}.${parsed.geoid.toLowerCase()}` : key;
  };
  const value = config as { placeTargets?: unknown } | null;
  const raw = value?.placeTargets;
  if (raw !== undefined && !Array.isArray(raw)) throw new Error("PLACE_TARGETS_UNREADABLE");
  const targets = new Map<string, { goalPercent: number; setAt: string }>();
  for (const entry of (raw ?? []) as unknown[]) {
    const target = entry as { key?: unknown; goalPercent?: unknown; setAt?: unknown; receiptId?: unknown } | null;
    if (!target || typeof target.key !== "string" || !target.key || typeof target.goalPercent !== "number" ||
      !Number.isFinite(target.goalPercent) || target.goalPercent < 1 || target.goalPercent > 100 ||
      typeof target.setAt !== "string" || !Number.isFinite(Date.parse(target.setAt)) ||
      typeof target.receiptId !== "string" || !target.receiptId) throw new Error("PLACE_TARGETS_UNREADABLE");
    const key = placeKey(target.key);
    const previous = targets.get(key);
    if (!previous || Date.parse(target.setAt) >= Date.parse(previous.setAt)) targets.set(key, target as { goalPercent: number; setAt: string });
  }
  const readings = places.map(place => {
    // The same percent Admin and the national list show, so the runner's order matches what the owner reads.
    const percent = place.percent ?? placePercent(place.items) ?? 0;
    const target = targets.get(placeKey(place.key));
    return { ...place, percent, target: target && percent < target.goalPercent ? target : null };
  });
  return readings.sort((a, b) => Number(Boolean(b.target)) - Number(Boolean(a.target)) ||
    (a.target && b.target ? Date.parse(a.target.setAt) - Date.parse(b.target.setAt) : 0) ||
    a.percent - b.percent || a.key.localeCompare(b.key));
}

export function orderPlaceWork(config: unknown, places: readonly PlaceWorkReading[]): string[] {
  return placeWorkReadings(config, places).map(place => place.receiptId);
}

/** National source workers use the same current capture denominator as the live hunt queue.
 * The published lookup and declared standing divisions place shared facts; ranking never fetches geography. */
export async function orderNationalPlaceWork(repos: ControlPlaneRepositories, zips: readonly string[], now: string): Promise<string[]> {
  return (await nationalPlaceWorkReading(repos, zips, now)).ordered;
}


const READING_MEMO_MS = 5 * 60_000;
const READING_MEMO_MAX = 32;
const readingMemo = new Map<string, { readonly at: number; readonly percent: number | null }>();
const memoKeyOf = (decision: ExpansionScopeDecision): string =>
  [decision.receiptId, decision.latestDecisionReceiptId ?? "", decision.decidedAt, decision.geography.type, decision.geography.geoid].join("|");
export function clearPlaceReadingMemo(): void { readingMemo.clear(); }

/** Due admission and process ordering share the owner's target and held facts. */
export async function nationalPlaceWorkReading(repos: ControlPlaneRepositories, zips: readonly string[], now: string) {
  const row = await repos.adminConfig.readNarrowed(ADMIN_CONFIG_ID, { formatVersion: true, apiFallback: true, updatedAt: true,
    expansionScopes: true, placeTargets: true, settings: true, owedOverlay: ["additions", "declines", "updatedAt"] });
  // What the owner added to, or declined from, what places are owed counts in the order the runner works in.
  setActiveOwedOverlay(row !== null && isAdminConfig(row.value) ? row.value.owedOverlay : null);
  const decisions = expansionScopesOf(row?.value ?? null);
  if (decisions.malformed) throw new Error("The owner's place scopes contain unreadable decisions");
  if (!decisions.scopes.length) return { ordered: [...zips], belowTarget: new Set<string>() };
  const planner = await createPlannerSpool();
  try {
    const selected = plannerSet(planner, "priority-selected-zips", zips);
    const inScope = planner.table<{ id:string;receipt:string;zip:string }>("priority-scope-zips", row => row.id);
    const rankOf = plannerMap<number>(planner, "priority-zip-ranks");
    const readings: PlaceWorkReading[] = [];
    const nowMs = Date.parse(now);
    const applicable = plannerSet(planner,"priority-applicable-instructions");
    for (const decision of decisions.scopes) if(decision.geography.type==="zcta"&&selected.has(decision.geography.geoid))applicable.add(decision.key);
    for(let start=0;start<zips.length;start+=128){
      const memberships=await readPublishedPlaceMemberships(zips.slice(start,start+128));
      for(const decision of decisions.scopes){const g=decision.geography;
        if(g.type!=="zcta"&&memberships.some(member=>g.type==="state"?member.type==="county"&&member.state===g.stateAbbr&&g.version===`state:${member.version.split(":")[1]}`:
          member.type===g.type&&member.geoid===g.geoid&&member.version===g.version))applicable.add(decision.key);
      }
    }
    for (const decision of decisions.scopes) {
      if(!applicable.has(decision.key))continue;
      let lookup: Awaited<ReturnType<typeof loadPublishedScopeLookupState>> | null = await loadPublishedScopeLookupState([decision.geography]);
      const [scope] = (await resolveScopes([decision], lookup, null)).scopes;
      lookup = null;
      const ownZips = scope.kind === "RESOLVED" ? scope.zctas : decision.geography.type === "zcta" ? new Set([decision.geography.geoid]) : new Set<string>();
      if (![...ownZips].some(zip => selected.has(zip))) continue;
      for (const zip of ownZips) inScope.add({ id: `${decision.receiptId}\0${zip}`, receipt: decision.receiptId, zip });
      const remembered = readingMemo.get(memoKeyOf(decision));
      let percent = remembered && nowMs - remembered.at >= 0 && nowMs - remembered.at < READING_MEMO_MS ? remembered.percent : undefined;
      if (percent === undefined) {
        const wanted = plannerSet(planner, "priority-wanted"); wanted.clear();
        const memberships = plannerMap<Awaited<ReturnType<CensusGeographyLookup["groupingsForZcta"]>>>(planner, "priority-memberships"); memberships.clear();
        const work = planner.table<{ id:string;subjectId:string;scopeDivisions?:readonly string[] }>("priority-work", item => item.id); work.clear();
        const divisions = plannerSet(planner, "priority-divisions"); divisions.clear();
        const items = planner.table<PlaceOwedItem>("priority-items", item => item.id); items.clear();
        for (const state of scope.states) {
          // Current pointers and legacy blobs are restricted by state in SQL before any source rows cross the connection.
          const area = await loadPublishedAreaLookupState([...ownZips], undefined, state.toUpperCase());
          for (const zip of ownZips) {
            const found = await area.lookup.groupingsForZcta(zip);
            if (found.status.kind !== "OK" || !found.memberships.some(item => item.geography.type === "county" && item.geography.stateAbbr.toUpperCase() === state.toUpperCase())) continue;
            const old = memberships.get(zip);
            const merged = new Map((old?.memberships ?? []).map(item => [`${item.geography.type}:${item.geography.version}:${item.geography.geoid}`,item]));
            for (const item of found.memberships) merged.set(`${item.geography.type}:${item.geography.version}:${item.geography.geoid}`,item);
            memberships.set(zip,{...found,memberships:[...merged.values()]});
            for (const item of found.memberships) {
              const id = censusWorkDivision(item.geography); if (id) wanted.add(id);
              wanted.add(`ocd-division/country:us/state:${item.geography.stateAbbr.toLowerCase()}`);
            }
          }
        }
        if (wanted.size) wanted.add("ocd-division/country:us");
        await visitPlaceStandingWork(repos,[...wanted], row => { work.add(row); });
        const lookupView = { groupingsForZcta: async (zip:string) => memberships.get(zip) ?? {
          publishedVersion:"NOT_RECORDED",zcta5:zip,status:{kind:"UNKNOWN" as const,note:"The selected place's state geography could not be read"},memberships:[],
        } };
        const members = await declaredWorkMembers([scope],work.rows,lookupView,undefined,planner);
        const memberSubjects = members.get(decision.key);
        for (const item of work.rows) if (memberSubjects?.has(item.subjectId)) {
          for (const id of item.scopeDivisions ?? []) if (wanted.has(id)) divisions.add(id);
          if (item.subjectId.startsWith("ocd-division/") && wanted.has(item.subjectId.split("#")[0])) divisions.add(item.subjectId.split("#")[0]);
        }
        for (const id of wanted) divisions.add(id);
        for (const id of divisions) {
          const capture = await readHeldPlaceCapture([id],{now,bypassCache:true});
          for (const item of buildPlaceOwedList({divisions:[{id,label:id}],subjects:capture.subjects,held:capture.held,now})) items.add(item);
        }
        for (const zip of ownZips) for (const item of buildPlaceOwedList({divisions:[],subjects:[],held:[],now,zips:[zip]})) items.add(item);
        let captured=0,owed=0;
        for (const item of items.rows) { const measured=placeMeasures([item]).completeness;captured+=measured.n;owed+=measured.of; }
        percent=percentOf(captured,owed);
        readingMemo.set(memoKeyOf(decision),{at:nowMs,percent});
        while(readingMemo.size>READING_MEMO_MAX)readingMemo.delete(readingMemo.keys().next().value as string);
        items.clear();work.clear();wanted.clear();divisions.clear();memberships.clear();
      }
      readings.push({key:decision.geography.type==="state"?`st:${decision.geography.stateAbbr.toLowerCase()}`:
        `${decision.geography.stateAbbr.toLowerCase()}.${VERSION_PREFIX[decision.geography.type]}.${decision.geography.geoid.toLowerCase()}`,
        receiptId:decision.receiptId,items:[],percent});
    }
    const orderedReadings=placeWorkReadings(row?.value,readings),belowTarget=new Set<string>();
    for(const [rank,reading]of orderedReadings.entries())for(const member of inScope.rowsWhere(["receipt"],reading.receiptId)) {
      if(!selected.has(member.zip))continue;
      rankOf.set(member.zip,Math.min(rankOf.get(member.zip)??Infinity,rank));
      if(reading.target)belowTarget.add(member.zip);
    }
    return{ordered:[...zips].sort((a,b)=>(rankOf.get(a)??Infinity)-(rankOf.get(b)??Infinity)),belowTarget};
  }finally{await planner.close();}

}

/** A Send creates every missing requirement; shared governments keep one row. */
export const DISPATCH_WORK_FORMAT_VERSION = 1;

/** Persist an owed source capability without inventing an executable route. */
export async function applyManualSourceGaps(
  repos: ControlPlaneRepositories,
  scopes: readonly ResolvedScope[],
  input: { readonly now: string },
): Promise<{ readonly created: number; readonly carried: number; readonly deferred: number }> {
  const applicable = scopes.filter(scope => scope.kind === "RESOLVED" && scope.decision.sourceWorkVersion === 1);
  let created = 0, carried = 0;
  const deferred = 0;
  if (applicable.length === 0) return { created, carried, deferred };
  for (const row of manualProducerInvocationMatrix(applicable, input.now)) {
    if (row.mode !== "SCOPED_ADAPTER_OWED") continue;
    for (const receipt of row.instructionIds) {
      const scope = applicable.find(candidate => candidate.decision.receiptId === receipt);
      if (!scope) continue;
      const work = createWorkItem({ project: "freshness", subject: `manual-source:${scope.decision.key}`,
        obligation: `source capability ${row.id} for instruction ${receipt}`,
        why: row.reason, priority: "P1", now: input.now });
      if (await repos.workItems.read(work.id)) { carried += 1; continue; }
      await registerWorkItem(repos, { ...work, manualSourceGap: {
        contractId: row.id, mode: row.mode, reason: row.reason, instructionReceipt: receipt,
        assignmentKey: scope.decision.key,
      } }, input.now);
      created += 1;
    }
  }
  return { created, carried, deferred };
}

/** Where the datasets a blocked reason names live, in the words a receipt prints. */
export const DATASET = {
  lookup: "the published Census geography lookup (CENSUS_GEOGRAPHY / US:zcta-geography-overlaps)",
  territory: "native state government references and published Census intersections",
  registry: (state: string) =>
    `the promoted ${state.toUpperCase()} jurisdiction registry (OPERATIONAL_REFERENCE / US:covered-jurisdiction-routing:v1), ` +
    `or its registration (REGISTRATION / US-${state.toUpperCase()}:registration:v1)`,
  unitTerritory: "the native state government reference (no source-established service boundary is held)",
  wiring: "the promoted meeting-partition source wiring",
  instruction: "a geography in the instruction (a state named in the words, or a geography sent from the Census lookup)",
  reader:
    "the operational-reference registry reader (lib/civic-data/operational-references.ts, the states it reads: the reviewed " +
    "registries, and every other state's registration, read by lib/registration/jurisdictions.ts)",
} as const;

/* ----------------------------------------------------------------- targets */

/** One thing the owner sent the fleet to. */
export type DispatchWorkTarget =
  | {
      readonly kind: "SCOPE";
      /** The scope key, `county:2020/04019`. */
      readonly key: string;
      readonly label: string;
      readonly requestedAt: string;
      /** The gateway receipt that carries the owner's decision. */
      readonly ref: string;
      readonly budgetUsd: number;
      readonly scope: PlannedScope;
      /** The questions the owner asked of this Send; recorded on every obligation it reaches. */
      readonly questions?: readonly WorkQuestion[];
    }
  | {
      readonly kind: "DISPATCH";
      /** `dispatch:<intent id>`. */
      readonly key: string;
      readonly label: string;
      readonly requestedAt: string;
      /** The DISPATCH intent id. */
      readonly ref: string;
      readonly target: DispatchTarget;
    };

/* ------------------------------------------------------------------- world */

/** A durable obligation row, as much of it as the classification reads. */
export interface DurableRowFacts {
  readonly active: boolean;
  readonly materializedBy?: string;
  /** The Sends already recorded on the row, so a Send is recorded on it once. */
  readonly assignments?: readonly ObligationAssignment[];
}

/** Everything the planner reads, loaded once by the runner. */
export interface DispatchWorkWorld {
  /** Every promoted jurisdiction registry, keyed by lower-case state code. */
  readonly registries: ReadonlyMap<string, JurisdictionRegistry>;
  /** The territory index the expansion plan placed with; null when not built. */
  readonly territory: TerritoryIndex | null;
  readonly territoryDetail: string | null;
  /** This cycle's registry corpus: every obligation any provider emitted. */
  readonly corpus: PlanRows<{ readonly id: string; readonly subjectId: string }>;
  /** Every durable obligation row, in the corpus or outside it, active or retired. */
  readonly durable: ReadonlyMap<string, DurableRowFacts>;
  readonly meetingPartitions: MeetingPartitionOwnership;
  /** Census units by state (upper), for a DISPATCH to a state with no registry. Null when not read. */
  readonly censusUnitsByState?: ReadonlyMap<string, number> | null;
  /** Registries the promoted bundle carries that the runtime's reader refuses, by lower-case state, with the reason. */
  readonly refusedRegistries?: ReadonlyMap<string, string>;
  /** Every division each target's place touches, by target key: one hunt packet each. Absent means not read. */
  readonly packetDivisions?: ReadonlyMap<string, readonly string[]>;
}

/* ---------------------------------------------------------- requirements */

export type RequirementKind = "MEETINGS_DISCOVERY" | "REGISTRY_ROUTE" | "HUNT_PACKET";

/** One requirement instance the registry defines for one government. */
export interface RequirementInstance {
  /** The exact row a creation writes: `standing()` of this, marked OWNER_DISPATCH. */
  readonly obligation: FreshnessObligation;
  readonly kind: RequirementKind;
  readonly executor: ExecutorKind;
  /** How it is carried when no clock exists yet. HELD never becomes a row. */
  readonly carriage: "OWED" | "MEETING_PARTITION" | "HELD_UNREAD_WIRING";
  readonly heldReason?: string;
}

function obligationOf(id: string, recordClass: string, subjectId: string, routeId: string, from: JurisdictionRegistrySource): FreshnessObligation {
  return {
    id,
    recordClass,
    subjectId,
    routeId,
    active: true,
    readerImpactAt: null,
    observedChangeRateHours: null,
    lastWorkedAt: null,
    materializedBy: OWNER_DISPATCH,
    materializedFrom: from,
  };
}


export function requirementsFor(
  reg: JurisdictionRegistry,
  j: Jurisdiction,
  need: MeetingsDiscoveryNeed | null,
  meetingPartitions: MeetingPartitionOwnership,
): RequirementInstance[] {
  const out: RequirementInstance[] = [];
  const from = registrySourceOf(reg);
  for (const r of jurisdictionRequirements(reg, j, meetingPartitions)) {
    out.push({
      obligation: obligationOf(r.obligationId, "local-jurisdiction", j.id, r.route.routeId, from),
      kind: "REGISTRY_ROUTE",
      executor: r.route.executorClass,
      carriage: r.carriage === "HERE" ? "OWED" : r.carriage,
      ...(r.heldReason ? { heldReason: r.heldReason } : {}),
    });
  }
  if (need !== null) {
    const route = meetingsDiscoveryRoute(reg, need);
    out.push({
      obligation: obligationOf(meetingsDiscoveryObligationId(need), MEETINGS_DISCOVERY_RECORD_CLASS, j.id, route.routeId, from),
      kind: "MEETINGS_DISCOVERY",
      executor: route.executorClass,
      carriage: "OWED",
    });
  }
  return out.sort((a, b) => (a.obligation.id < b.obligation.id ? -1 : a.obligation.id > b.obligation.id ? 1 : 0));
}

/* ------------------------------------------------------------------- units */

export type BlockedCode =
  | "GEOGRAPHY_UNRESOLVED"
  | "TERRITORY_UNREADABLE"
  | "NO_JURISDICTION_REGISTRY"
  | "NOT_IN_REGISTRY"
  | "REGISTRY_NOT_READ"
  | "NO_GOVERNMENT_PLACED"
  | "NO_STATE_NAMED";

/** Governments a target holds that no dataset can give requirements to, and the dataset that is missing. */
export interface BlockedUnits {
  readonly code: BlockedCode;
  /** The missing dataset, by name. */
  readonly dataset: string;
  readonly why: string;
  /** How many governments it blocks; null when the count itself cannot be taken. */
  readonly units: number | null;
  readonly states: readonly string[];
  readonly sample: readonly string[];
}

interface PlacedUnit {
  readonly reg: JurisdictionRegistry;
  readonly jurisdiction: Jurisdiction;
}

interface TargetUnits {
  readonly placed: PlanRows<PlacedUnit>;
  readonly blocked: readonly BlockedUnits[];
  /** Governments of the target's states no territory can place in or out: registry rows the join cannot place, and Census units with no ZCTA territory. */
  readonly unplaced: number;
}

const byName = (a: CensusUnitTerritory, b: CensusUnitTerritory): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** A placed row owns only its own routes. The state's full registry is released before the next state. */
function placedUnit(reg: JurisdictionRegistry, jurisdiction: Jurisdiction): PlacedUnit {
  return { jurisdiction, reg: { ...reg, jurisdictions: [jurisdiction], sourceCatalog: Object.fromEntries(jurisdiction.sourceIds.map(id => [id, reg.sourceCatalog[id]])) } };
}

function scopeUnits(scope: PlannedScope, world: DispatchWorkWorld, planner?: PlannerSpool, prefix = "scope-units"): TargetUnits {
  if (scope.kind !== "RESOLVED") {
    return {
      placed: [],
      blocked: [{ code: "GEOGRAPHY_UNRESOLVED", dataset: DATASET.lookup, why: scope.why, units: null, states: scope.states, sample: [] }],
      unplaced: 0,
    };
  }
  const index = world.territory;
  if (index === null) {
    return {
      placed: [],
      blocked: [
        {
          code: "TERRITORY_UNREADABLE",
          dataset: DATASET.territory,
          why: `the territory index could not be built (${world.territoryDetail ?? "no detail"}), so no government can be placed in this geography`,
          units: null,
          states: scope.states,
          sample: [],
        },
      ],
      unplaced: 0,
    };
  }
  const placed = planRows<PlacedUnit>(planner, `${prefix}-placed`);
  for (const state of [...scope.states].sort()) {
    const reg = world.registries.get(state.toLowerCase());
    // A bare state row is an ancestor, not an identified meeting body. Include its declared shared sources;
    // do not invent a find-own-site meeting obligation for a synthetic registration ancestor.
    if (reg) for (const jurisdiction of [...reg.jurisdictions].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
      const territory = index.bySubject.get(jurisdiction.id);
      if ((index.statewide.has(jurisdiction.id) && jurisdiction.sourceIds.length > 0) ||
        (territory !== undefined && certainlyOverlaps(territory, scope))) placed.add(placedUnit(reg, jurisdiction));
    }
  }

  const blocked: BlockedUnits[] = [];
  const sharesOf = index.unitShares ?? (() => undefined);
  for (const state of scope.states) {
    const unregistered = unitsCertainlyIn(scope, index.unregisteredUnitsByState.get(state) ?? [], sharesOf).sort(byName);
    const refusedWhy = world.refusedRegistries?.get(state.toLowerCase()) ?? null;
    if (unregistered.length > 0 && refusedWhy !== null) {
      blocked.push({
        code: "REGISTRY_NOT_READ",
        dataset: DATASET.reader,
        why:
          `${unregistered.length} Census of Governments unit(s) in ${state} lie in this geography. ${state}'s registry is promoted, and this ` +
          `runtime's registry reader refuses it (${refusedWhy}), so nothing it defines can be scheduled yet`,
        units: unregistered.length,
        states: [state],
        sample: unregistered.slice(0, READING_LIST_CAP).map((u) => u.name),
      });
    } else if (unregistered.length > 0) {
      blocked.push({
        code: "NO_JURISDICTION_REGISTRY",
        dataset: DATASET.registry(state),
        why:
          `${unregistered.length} Census of Governments unit(s) in ${state} lie in this geography, and ${state} has no promoted ` +
          "jurisdiction registry, and no registration of it was read this cycle, so nothing defines what they owe. Promoting its " +
          "registry is the whole change that unblocks them, or its registration, read at the next cycle",
        units: unregistered.length,
        states: [state],
        sample: unregistered.slice(0, READING_LIST_CAP).map((u) => u.name),
      });
    }
    const unjoined = unitsCertainlyIn(scope, index.unjoinedUnitsByState?.get(state) ?? [], sharesOf).sort(byName);
    if (unjoined.length > 0) {
      blocked.push({
        code: "NOT_IN_REGISTRY",
        dataset: DATASET.registry(state),
        why:
          `${unjoined.length} Census of Governments unit(s) in this geography are not carried by the ${state} registry ` +
          "(no row joins them by native identity or a retained identity alias), so nothing defines what they owe",
        units: unjoined.length,
        states: [state],
        sample: unjoined.slice(0, READING_LIST_CAP).map((u) => u.name),
      });
    }
  }
  /* Governments of the scope's states no territory can place in or out: registry rows the join could not place, and Census units with no ZCTA territory. */
  const scopeStates = new Set(scope.states.map((s) => s.toLowerCase()));
  let unplacedRegistered = 0;
  for (const id of index.unplaced.keys()) if (scopeStates.has(id.split(":")[0] ?? "")) unplacedRegistered += 1;
  const unplacedCensus = scope.states.reduce(
    (n, state) => n + (index.unregisteredUnitsByState.get(state) ?? []).filter((u) => u.zips.length === 0).length,
    0,
  );
  const unplaced = unplacedRegistered + unplacedCensus;
  /* A zero where the territory should have named governments is a gap in the data, never an empty geography. */
  if (placed.rows.length === 0 && blocked.length === 0) {
    blocked.push({
      code: "NO_GOVERNMENT_PLACED",
      dataset: DATASET.territory,
      why:
        `the resolved geography's ${scope.zctas.size} ZCTA(s) place no Census of Governments unit, registered or not, by the certain-overlap rule, ` +
        "so no government in it can be named — a gap in the territory data, never a geography with no government",
      units: null,
      states: scope.states,
      sample: [],
    });
  }
  return { placed: placed.rows, blocked, unplaced };
}

function dispatchUnits(target: DispatchTarget, world: DispatchWorkWorld, planner?: PlannerSpool, prefix = "dispatch-units"): TargetUnits {
  if (target.states.length === 0) {
    return {
      placed: [],
      blocked: [
        {
          code: "NO_STATE_NAMED",
          dataset: DATASET.instruction,
          why:
            "creating work needs a bounded geography: a state named in the words, or a geography sent from the Census lookup. " +
            "These words still put matching registered work first",
          units: null,
          states: [],
          sample: [],
        },
      ],
      unplaced: 0,
    };
  }
  const placed = planRows<PlacedUnit>(planner, `${prefix}-placed`);
  const blocked: BlockedUnits[] = [];
  for (const code of [...target.states].sort()) {
    const reg = world.registries.get(code);
    if (reg === undefined) {
      const count = world.censusUnitsByState?.get(code.toUpperCase()) ?? null;
      const refusedWhy = world.refusedRegistries?.get(code) ?? null;
      if (refusedWhy !== null) {
        blocked.push({
          code: "REGISTRY_NOT_READ",
          dataset: DATASET.reader,
          why:
            `${code.toUpperCase()}'s registry is promoted, and this runtime's registry reader refuses it (${refusedWhy}), ` +
            "so nothing it defines can be scheduled yet",
          units: count,
          states: [code.toUpperCase()],
          sample: [],
        });
        continue;
      }
      blocked.push({
        code: "NO_JURISDICTION_REGISTRY",
        dataset: DATASET.registry(code),
        why:
          `${target.stateNames[target.states.indexOf(code)] ?? code.toUpperCase()} has no promoted jurisdiction registry, and no registration of it ` +
          `was read this cycle, so nothing defines what its governments owe${count === null ? "" : `; the Census of Governments names ${count} of them`}. ` +
          "Promoting its registry is the whole change that unblocks it, or its registration, read at the next cycle",
        units: count,
        states: [code.toUpperCase()],
        sample: [],
      });
      continue;
    }
    for (const j of [...reg.jurisdictions].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
      if (unitMatchesTarget({ ...target, states: [code] }, { id: j.id, subjectId: j.id })) placed.add(placedUnit(reg, j));
    }
  }
  return { placed: placed.rows, blocked, unplaced: 0 };
}

/* -------------------------------------------------------------------- plan */

export type InstanceState = "CARRIED" | "CREATED" | "MISSING" | "HELD";

export interface PlannedInstance {
  readonly instance: RequirementInstance;
  readonly state: InstanceState;
  /** For a MISSING instance whose row already exists durably (retired, or live outside the corpus): it is marked, not put. */
  readonly existsUnmarked: boolean;
}

export interface TargetPlan {
  readonly target: DispatchWorkTarget;
  readonly units: TargetUnits;
  readonly instances: PlanRows<PlannedInstance>;
  /** Obligations in this cycle's corpus about the target (not materialized): the work a Send reorders. */
  readonly reordered: number;
}

/** A MISSING instance queued for writing, with the Send it is written under (the first that reached it). */
export type PlannedWrite = PlannedInstance & { readonly target: DispatchWorkTarget };


export interface PlannedMark {
  readonly obligationId: string;
  readonly target: DispatchWorkTarget;
  readonly autonomousPlan?: FreshnessObligation["autonomousPlan"];
}

export interface DispatchWorkPlan {
  readonly planner?: PlannerSpool;
  readonly targets: readonly TargetPlan[];
  /** Every MISSING instance, in write order, each once. */
  readonly writes: PlanRows<PlannedWrite>;

  readonly marks: PlanRows<PlannedMark>;
  readonly corpusSize: number;
}

/** The entry a Send leaves on an obligation it reached, with its questions when it asked any. */
export function assignmentEntry(target: DispatchWorkTarget, relation: ObligationAssignment["relation"], at: string): ObligationAssignment {
  const questions = target.kind === "SCOPE" ? (target.questions ?? []) : [];
  return {
    assignmentKey: target.key,
    ref: target.ref,
    relation,
    at,
    ...(questions.length > 0 ? { questions: [...questions] } : {}),
  };
}


export function planDispatchWork(input: {
  readonly targets: readonly DispatchWorkTarget[];
  readonly world: DispatchWorkWorld;
  readonly planner?: PlannerSpool;
}): DispatchWorkPlan {
  const world = input.world, planner = input.planner, prefix = `dispatch-${nextDispatchPlan++}`;
  const set = (name: string) => planner ? plannerSet(planner, `${prefix}-${name}`) : new Set<string>();
  const corpusIds = set("corpus");
  for (const row of world.corpus) corpusIds.add(row.id);
  const ordered = [
    ...input.targets.filter((t) => t.kind === "DISPATCH").sort((a, b) => (a.requestedAt < b.requestedAt ? -1 : a.requestedAt > b.requestedAt ? 1 : 0)),
    ...input.targets.filter((t) => t.kind === "SCOPE"),
  ];
  const targetByKey = new Map(ordered.map(target => [target.key, target]));
  // Scope membership is an indexed view, not JSON. Spool only the target key.
  type StoredWrite = Omit<PlannedWrite, "target"> & { targetKey: string };
  type StoredMark = Omit<PlannedMark, "target"> & { targetKey: string };
  const writes = planRows<PlannedWrite>(planner, `${prefix}-writes`, row => {
    const { target, ...rest } = row; return { ...rest, targetKey: target.key };
  }, stored => { const { targetKey, ...rest } = stored as StoredWrite; return { ...rest, target: targetByKey.get(targetKey)! }; });
  const marks = planRows<PlannedMark>(planner, `${prefix}-marks`, row => {
    const { target, ...rest } = row; return { ...rest, targetKey: target.key };
  }, stored => { const { targetKey, ...rest } = stored as StoredMark; return { ...rest, target: targetByKey.get(targetKey)! }; });
  const targets: TargetPlan[] = [], queued = set("queued"), marked = set("marked");
  const mark = (target: DispatchWorkTarget, obligationId: string, autonomousPlan?: FreshnessObligation["autonomousPlan"]) => {
    const key = JSON.stringify([target.key, obligationId]);
    if (marked.has(key)) return;
    marked.add(key); marks.add({ obligationId, target, ...(autonomousPlan ? { autonomousPlan } : {}) });
  };
  for (const [at, target] of ordered.entries()) {
    const units = target.kind === "SCOPE" ? scopeUnits(target.scope, world, planner, `${prefix}-${at}`) : dispatchUnits(target.target, world, planner, `${prefix}-${at}`);
    const planned = planRows<PlannedInstance>(planner, `${prefix}-${at}-instances`);
    const packetDivisions = set(`${at}-packet-divisions`), members = set(`${at}-members`);
    const recorded = (row: DurableRowFacts | undefined): boolean => (row?.assignments ?? []).some((a) => a.assignmentKey === target.key && a.ref === target.ref);
    const add = (instance: RequirementInstance): void => {
      const id = instance.obligation.id, row = world.durable.get(id);
      if (instance.carriage === "HELD_UNREAD_WIRING") { planned.add({ instance, state: "HELD", existsUnmarked: false }); return; }
      if (instance.carriage === "MEETING_PARTITION") { planned.add({ instance, state: "CARRIED", existsUnmarked: false }); return; }
      if (row?.materializedBy === OWNER_DISPATCH) {
        planned.add({ instance, state: "CREATED", existsUnmarked: false });
        if (!recorded(row) && (row.assignments ?? []).some((a) => a.relation === "CREATED")) mark(target, id, instance.obligation.autonomousPlan);
        return;
      }
      if (corpusIds.has(id) && row?.active !== false) {
        planned.add({ instance, state: "CARRIED", existsUnmarked: false });
        if (row !== undefined && !recorded(row)) mark(target, id, instance.obligation.autonomousPlan);
        return;
      }
      const entry: PlannedInstance = { instance, state: "MISSING", existsUnmarked: row !== undefined };
      planned.add(entry);
      if (!queued.has(id)) { queued.add(id); writes.add({ ...entry, target }); }
    };
    for (const { reg, jurisdiction } of units.placed) {
      members.add(jurisdiction.id);
      for (const instance of requirementsFor(reg, jurisdiction, meetingsDiscoveryNeeds([reg])[0] ?? null, world.meetingPartitions)) add(instance);
      if (target.kind === "DISPATCH" && !world.packetDivisions?.has(target.key) && jurisdiction.ocdId) packetDivisions.add(jurisdiction.ocdId);
    }
    for (const id of world.packetDivisions?.get(target.key) ?? []) packetDivisions.add(id);
    // Disk sets enumerate keys in order. Native callers contain one place and
    // sort just these division identities, not the whole country's records.
    const divisions = planner ? packetDivisions : [...packetDivisions].sort();
    for (const id of divisions) add({ obligation: huntPacketObligation(id), kind: "HUNT_PACKET", executor: "BOUNDED_MODEL_WORKER", carriage: "OWED" });
    if (target.kind === "SCOPE") for (const id of target.scope.members) members.add(id);
    let reordered = 0;
    for (const obligation of world.corpus) {
      const matches = target.kind === "SCOPE" ? members.has(obligation.subjectId) :
        (target.target.states.length > 0 || target.target.terms.length > 0) && unitMatchesTarget(target.target, obligation);
      if (!matches) continue;
      const row = world.durable.get(obligation.id);
      if (row?.materializedBy !== OWNER_DISPATCH) reordered += 1;
      if (target.kind === "SCOPE" && row !== undefined && row.active !== false && !recorded(row)) mark(target, obligation.id);
    }
    targets.push({ target, units, instances: planned.rows, reordered });
  }
  return { planner, targets, writes: writes.rows, marks: marks.rows, corpusSize: world.corpus.length };
}

/* ------------------------------------------------------------------- apply */

export interface DispatchWorkApplied {
  readonly written: PlanRows<string>;
  readonly failed: PlanRows<{ readonly obligationId: string; readonly why: string }>;
  /** Planned writes not reached this cycle: the budget or the wall ran out first. */
  readonly deferred: PlanRows<string>;
  readonly stoppedBy: "DONE";
  /** REORDERED records written this cycle. */
  readonly marked?: PlanRows<{ readonly obligationId: string; readonly assignmentKey: string }>;
  readonly markFailed?: PlanRows<{ readonly obligationId: string; readonly assignmentKey: string; readonly why: string }>;

  readonly marksDeferred?: PlanRows<{ readonly obligationId: string; readonly assignmentKey: string }>;
  /** Every Send recorded on a row this cycle — created or reordered — for the runner's assignment budgets. */
  readonly recorded?: PlanRows<{ readonly obligationId: string; readonly subjectId: string; readonly entry: ObligationAssignment }>;
}


export async function applyDispatchWork(
  repos: ControlPlaneRepositories,
  plan: DispatchWorkPlan,
  input: { readonly now: string; readonly planner?: PlannerSpool },
): Promise<DispatchWorkApplied> {
  const planner = input.planner ?? plan.planner, prefix = `dispatch-applied-${nextDispatchPlan++}`;
  const written = planRows<string>(planner, `${prefix}-written`);
  const failed = planRows<{ obligationId: string; why: string }>(planner, `${prefix}-failed`);
  const deferred = planRows<string>(planner, `${prefix}-deferred`);
  const marked = planRows<{ obligationId: string; assignmentKey: string }>(planner, `${prefix}-marked`);
  const markFailed = planRows<{ obligationId: string; assignmentKey: string; why: string }>(planner, `${prefix}-mark-failed`);
  const marksDeferred = planRows<{ obligationId: string; assignmentKey: string }>(planner, `${prefix}-marks-deferred`);
  const recorded = planRows<{ obligationId: string; subjectId: string; entry: ObligationAssignment }>(planner, `${prefix}-recorded`);
  const stoppedBy = "DONE" as const;
  for (const entry of plan.writes) {
    const id = entry.instance.obligation.id;
    const created = assignmentEntry(entry.target, "CREATED", input.now);
    try {
      /* The Send is recorded only where this write is what made the row this Send's. */
      let recordedHere = true;
      if (!entry.existsUnmarked) {
        await repos.obligations.put(id, standing({ ...entry.instance.obligation, assignments: [created] }, input.now), input.now);
      } else {
        const held = await repos.obligations.mustRead(id);
        recordedHere = held.value.materializedBy !== OWNER_DISPATCH;
        if (held.value.materializedBy !== OWNER_DISPATCH) {
          const { retiredAt: _retiredAt, retirementReason: _retirementReason, ...rest } = held.value;
          await repos.obligations.compareAndSet(
            id,
            held.revision,
            {
              ...rest,
              active: true,
              nextDueAt: held.value.active ? held.value.nextDueAt : null,
              materializedBy: OWNER_DISPATCH,
              ...(inheritPublicationConnection(held.value.autonomousPlan, entry.instance.obligation.autonomousPlan)
                ? { autonomousPlan: inheritPublicationConnection(held.value.autonomousPlan, entry.instance.obligation.autonomousPlan) } : {}),
              assignments: withAssignment(held.value.assignments, created),
              ...(entry.instance.obligation.materializedFrom === undefined ? {} : { materializedFrom: entry.instance.obligation.materializedFrom }),
              updatedAt: input.now,
            },
            input.now,
          );
        }
      }
      written.add(id);
      if (recordedHere) recorded.add({ obligationId: id, subjectId: entry.instance.obligation.subjectId, entry: created });
    } catch (error) {
      failed.add({ obligationId: id, why: error instanceof Error ? error.message : String(error) });
    }
  }
  // Read only this obligation. A later Send sees the revision written by the
  // preceding Send without retaining a country-sized held-row cache.
  for (const mark of plan.marks) {
    const key = { obligationId: mark.obligationId, assignmentKey: mark.target.key };
    const reordered = assignmentEntry(mark.target, "REORDERED", input.now);
    try {
      const held = await repos.obligations.mustRead(mark.obligationId);
      const next = withAssignment(held.value.assignments, reordered);
      const autonomousPlan = inheritPublicationConnection(held.value.autonomousPlan, mark.autonomousPlan);
      if (next !== held.value.assignments || autonomousPlan !== held.value.autonomousPlan) {
        await repos.obligations.compareAndSet(mark.obligationId, held.revision, { ...held.value, assignments: next,
          ...(autonomousPlan ? { autonomousPlan } : {}), updatedAt: input.now }, input.now);
      }
      marked.add(key);
      recorded.add({ obligationId: mark.obligationId, subjectId: held.value.subjectId, entry: reordered });
    } catch (error) {
      markFailed.add({ ...key, why: error instanceof Error ? error.message : String(error) });
    }
  }
  return { written: written.rows, failed: failed.rows, deferred: deferred.rows, stoppedBy, marked: marked.rows, markFailed: markFailed.rows, marksDeferred: marksDeferred.rows, recorded: recorded.rows };
}

/* ----------------------------------------------------------------- reading */

export interface DispatchWorkRequirementCounts {
  /** Requirement instances the registry defines for the governments placed in the target: the denominator. */
  readonly defined: number;
  /** Already on a standing clock (or a meeting partition): put first, not created. */
  readonly carried: number;
  /** Materialized by the owner's dispatch, cumulative, this cycle's included. */
  readonly created: number;
  readonly createdThisCycle: number;

  readonly deferred: number;

  /** Written this cycle and refused by the store; retried next cycle. */
  readonly failed: number;
  /** Machine-openable meetings routes held because the partition wiring could not be read. */
  readonly held: number;
  /** Of `created`, how many run on the plain-code lane and how many need a model. */
  readonly createdDeterministic: number;
  readonly createdModel: number;
  /** Of `created`, how many are meetings discovery: the free discovery walk takes them first. */
  readonly createdMeetingsDiscovery: number;
  /** Of `created`, how many belong to a government read from its state's registration. Absent on an older reading. */
  readonly createdFromRegistration?: number;
}

export interface DispatchWorkTargetReading {
  readonly key: string;
  readonly kind: DispatchWorkTarget["kind"];
  readonly label: string;
  readonly requestedAt: string;
  readonly ref: string;
  readonly units: {
    /** Governments placed in the target that the registry gives requirements to. */
    readonly placed: number;
    /** Of `placed`, how many were read from their state's registration (no reviewed registry). Absent on older readings. */
    readonly fromRegistration?: number;
    /** Governments the target holds that a missing dataset blocks; null when that count cannot be taken. */
    readonly blocked: number | null;
    /** Governments of the target's states that no territory can place in or out (registry rows and Census-only units alike). */
    readonly unplaced: number;
    readonly placedSample: readonly string[];
  };
  readonly blocked: readonly BlockedUnits[];
  readonly requirements: DispatchWorkRequirementCounts;
  /** Standing obligations about the target's governments, of every standing obligation this cycle. */
  readonly reordered: { readonly obligations: number; readonly of: number };

  readonly assignment?: { readonly recordedThisCycle: number; readonly marksDeferred: number; readonly marksFailed: number };
  /** Plain sentences: why created work waits, which budgets bind, what is not built. */
  readonly says: readonly string[];
}

export interface DispatchWorkReading {
  readonly formatVersion: 1;
  readonly at: string;
  /** PLAN_ONLY on a cycle that may not write (dry, canary, filtered, blackout, runner paused), with why. */
  readonly writes: "APPLIED" | "PLAN_ONLY";
  readonly planOnlyWhy: string | null;
  readonly written: number;
  readonly deferred: number;
  readonly failed: readonly { readonly obligationId: string; readonly why: string }[];
  /** Full count; `failed` is a bounded receipt sample. */
  readonly failedCount?: number;
  readonly stoppedBy: DispatchWorkApplied["stoppedBy"] | null;
  /** REORDERED records written this cycle, and those left for the next. Absent on older readings. */
  readonly marked?: number;
  readonly marksDeferred?: number;
  readonly targets: readonly DispatchWorkTargetReading[];
}

/** What binds the created work, from the cycle's own readings. */
export interface DispatchWorkContext {
  readonly at: string;
  /** Why the paid lane is closed this cycle, verbatim from `modelLaneClosure`; null when it is open. */
  readonly modelLaneClosed: string | null;
  /** The rolling 24-hour ceiling in force, and whether it is the owner's dial or the fallback. */
  readonly ceilingUsd: number;
  readonly ceilingSource: "OVERRIDE" | "FALLBACK";
  readonly writes: "APPLIED" | "PLAN_ONLY";
  readonly planOnlyWhy: string | null;
}

const usd = (n: number): string => `$${n.toFixed(2)}`;

/** The reading the runner writes onto the research state, and the HONORED detail reads. */
export function dispatchWorkReading(
  plan: DispatchWorkPlan,
  applied: DispatchWorkApplied | null,
  context: DispatchWorkContext,
): DispatchWorkReading {
  const prefix = `dispatch-reading-${nextDispatchPlan++}`;
  const written = plan.planner ? plannerSet(plan.planner, `${prefix}-written`, applied?.written ?? []) : new Set(applied?.written ?? []);
  const failed = plan.planner ? plannerSet(plan.planner, `${prefix}-failed`) : new Set<string>();
  for (const row of applied?.failed ?? []) failed.add(row.obligationId);
  const countFor = (rows: PlanRows<{ readonly assignmentKey: string }> | undefined, key: string): number => {
    let count = 0; for (const row of rows ?? []) if (row.assignmentKey === key) count += 1; return count;
  };
  const targets = plan.targets.map((t): DispatchWorkTargetReading => {
    let carried = 0;
    let created = 0;
    let createdThisCycle = 0;
    let deferred = 0;
    let failedHere = 0;
    let held = 0;
    let createdDeterministic = 0;
    let createdModel = 0;
    let createdMeetingsDiscovery = 0;
    let createdFromRegistration = 0;
    for (const p of t.instances) {
      const id = p.instance.obligation.id;
      const isCreated = p.state === "CREATED" || (p.state === "MISSING" && written.has(id));
      if (isCreated) {
        created += 1;
        if (p.state === "MISSING") createdThisCycle += 1;
        if (p.instance.executor === "DETERMINISTIC") createdDeterministic += 1;
        else createdModel += 1;
        if (p.instance.kind === "MEETINGS_DISCOVERY") createdMeetingsDiscovery += 1;
        if (p.instance.obligation.materializedFrom === "REGISTRATION") createdFromRegistration += 1;
      } else if (p.state === "CARRIED") carried += 1;
      else if (p.state === "HELD") held += 1;
      else if (failed.has(id)) failedHere += 1;
      else deferred += 1;
    }
    const blockedCounts = t.units.blocked.map((b) => b.units);
    const blocked = blockedCounts.some((n) => n === null) ? null : blockedCounts.reduce<number>((a, n) => a + (n ?? 0), 0);
    const says: string[] = [];
    if (context.writes === "PLAN_ONLY") says.push(`Planned only, nothing written this cycle: ${context.planOnlyWhy ?? "this cycle may not write"}.`);
    /* Where the governments came from: the reviewed registries, or a state's registration. */
    const fromRegistration = t.units.placed.filter((u) => registrySourceOf(u.reg) === "REGISTRATION");
    if (fromRegistration.length > 0) {
      const versions = [...new Map(fromRegistration.map((u) => [u.reg.stateCode, u.reg.registration?.versionId ?? ""] as const)).entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([st, v]) => `${st.toUpperCase()} version ${v}`);
      says.push(
        `${fromRegistration.length} of the ${t.units.placed.length} governments here come from registration (the 2022 Census of Governments; ` +
          `${versions.join("; ")}), not a reviewed registry: no reviewed registry exists for ${versions.length === 1 ? "that state" : "those states"}. ` +
          "Each owes its meetings discovery: on its own site where the Census recorded one, otherwise finding that site first.",
      );
    }
    if (createdMeetingsDiscovery > 0) {
      says.push(
        `${createdMeetingsDiscovery} of the created obligations are meetings discovery: the free discovery walk remains available, and a paid Scout ` +
          "may use an appropriate route within your controls without waiting for free routes to fail. Confirmed routes are reused.",
      );
    }
    if (createdModel > 0) {
      says.push(
        context.modelLaneClosed === null
          ? `${createdModel} of the created obligations need a model; they run only as the paid lane admits them.`
          : `${createdModel} of the created obligations need a model and wait: ${context.modelLaneClosed}.`,
      );
      says.push(
        `When the paid lane runs, every Scout passes the Fleet's ${usd(context.ceilingUsd)} rolling 24-hour ceiling ` +
          `(${context.ceilingSource === "OVERRIDE" ? "your dial" : "the built-in fallback"}) first` +
          (t.target.kind === "SCOPE"
            ? `, then this Send's own ${usd(t.target.budgetUsd)} ${t.target.scope.decision.budgetStartedAt ? "Anthropic token budget for this hunt" : "rolling 24-hour budget"} over the work it reached, and this geography's.`
            : ", then this Send's own budget over the work it reached, when you sent it with one.") +
          " Every applicable hunt token budget must have room; another instruction cannot override it. Legacy rolling assignments retain their recorded rules.",
      );
    }
    if (createdDeterministic > 0) says.push(`${createdDeterministic} run on the plain-code lane as they come due, at no model cost.`);
    if (deferred > 0) {
      says.push(
        `${deferred} more are owed and not yet written; the next cycle continues.`,
      );
    }
    if (held > 0) {
      const reasons = plan.planner ? plannerSet(plan.planner, `${prefix}-held-reasons-${t.target.key}`) : new Set<string>();
      for (const row of t.instances) if (row.state === "HELD" && row.instance.heldReason) reasons.add(row.instance.heldReason);
      const sample: string[] = [];
      for (const reason of reasons) { if (sample.length === READING_LIST_CAP) break; sample.push(reason); }
      const detail = sample.length ? sample.join("; ") + (reasons.size > sample.length ? `; ${reasons.size - sample.length} further distinct reasons` : "") : `${DATASET.wiring} could not be read`;
      says.push(`${held} machine-openable meetings route(s) are held: ${detail}; a second meetings clock is never risked.`);
    }
    for (const b of t.units.blocked) says.push(`Blocked (${b.dataset}): ${b.why}.`);
    if (t.target.kind === "DISPATCH" && t.units.placed.length === 0 && t.units.blocked.length === 0) {
      says.push(`No registered government in ${t.target.target.stateNames.join(", ")} carries these words, so nothing was created; the words still put matching work first.`);
    }
    if (t.units.unplaced > 0) {
      says.push(
        `${t.units.unplaced} government(s) in ${t.target.kind === "SCOPE" ? t.target.scope.states.join(", ") : "these states"} cannot be placed in or out of ` +
          `any geography — most have no ZCTA territory (${DATASET.unitTerritory}; for a state read from its registration, no Census division), ` +
          "the rest join no single Census unit — so they are counted here and never guessed in.",
      );
    }
    const planMarks = plan.marks.filter((m) => m.target.key === t.target.key).length;
    const assignment = {
      recordedThisCycle: applied === null ? 0 : countFor(applied.marked, t.target.key) + (applied.recorded ?? []).filter((r) => r.entry.assignmentKey === t.target.key && r.entry.relation === "CREATED").length,
      marksDeferred: applied === null ? planMarks : countFor(applied.marksDeferred, t.target.key),
      marksFailed: applied === null ? 0 : countFor(applied.markFailed, t.target.key),
    };
    if (assignment.marksDeferred + assignment.marksFailed > 0) {
      says.push(
        `${assignment.marksDeferred + assignment.marksFailed} obligation(s) this Send reached on an existing clock do not record it yet; ` +
          "repository failures are retried by the next cycle.",
      );
    }
    return {
      key: t.target.key,
      kind: t.target.kind,
      label: t.target.label,
      requestedAt: t.target.requestedAt,
      ref: t.target.ref,
      units: {
        placed: t.units.placed.length,
        fromRegistration: fromRegistration.length,
        blocked,
        unplaced: t.units.unplaced,
        placedSample: Array.from(t.units.placed.slice(0, READING_LIST_CAP).map((u) => u.jurisdiction.name)),
      },
      blocked: t.units.blocked,
      requirements: {
        defined: t.instances.length,
        carried,
        created,
        createdThisCycle,
        deferred,
        failed: failedHere,
        held,
        createdDeterministic,
        createdModel,
        createdMeetingsDiscovery,
        createdFromRegistration,
      },
      reordered: { obligations: t.reordered, of: plan.corpusSize },
      assignment,
      says,
    };
  });
  return {
    formatVersion: DISPATCH_WORK_FORMAT_VERSION,
    at: context.at,
    writes: context.writes,
    planOnlyWhy: context.planOnlyWhy,
    written: applied?.written.length ?? 0,
    deferred: applied?.deferred.length ?? (context.writes === "PLAN_ONLY" ? plan.writes.length : 0),
    failed: Array.from(applied?.failed.slice(0, READING_LIST_CAP) ?? []),
    failedCount: applied?.failed.length ?? 0,
    stoppedBy: applied?.stoppedBy ?? null,
    marked: applied?.marked?.length ?? 0,
    marksDeferred: applied === null ? plan.marks.length : (applied.marksDeferred?.length ?? 0),
    targets,
  };
}

/** The receipt for one target in a sentence: created, reordered and blocked, each with its denominator. */
export function dispatchWorkSentence(t: DispatchWorkTargetReading): string {
  const r = t.requirements;
  const blocked =
    t.units.blocked === null
      ? "an uncounted number of governments blocked"
      : `${t.units.blocked} of ${t.units.placed + t.units.blocked} governments blocked`;
  return (
    `${t.label}: created ${r.created} of ${r.defined} requirement(s) the registry defines here (${r.createdThisCycle} this cycle` +
    `${r.deferred > 0 ? `, ${r.deferred} deferred to the next cycles` : ""}); ` +
    `reordered ${t.reordered.obligations} of ${t.reordered.of} standing obligations; ${blocked} by missing data.`
  );
}


export interface OwnerDispatchWork {
  /** `dispatch:<intent id>`: the target reading's key. */
  readonly key: string;
  readonly defined: number;
  readonly created: number;
  readonly createdThisCycle: number;
  /** Already on a standing clock: reordered, not created. */
  readonly carried: number;
  readonly deferred: number;
  /** Governments no dataset can give requirements to; null when that count cannot be taken. */
  readonly blockedUnits: number | null;
  /** Each blocked reason: its code, and the plain sentence naming the missing dataset. */
  readonly blocked: readonly { readonly code: BlockedCode; readonly says: string }[];
}

/** The DISPATCH record's counts for one intent, or null when the cycle planned nothing for it. */
export function ownerDispatchWorkOf(reading: DispatchWorkReading | null, intentId: string): OwnerDispatchWork | null {
  const key = `dispatch:${intentId}`;
  const t = reading?.targets.find((x) => x.key === key) ?? null;
  if (t === null) return null;
  return {
    key,
    defined: t.requirements.defined,
    created: t.requirements.created,
    createdThisCycle: t.requirements.createdThisCycle,
    carried: t.requirements.carried,
    deferred: t.requirements.deferred,
    blockedUnits: t.units.blocked,
    blocked: t.blocked.map((b) => ({ code: b.code, says: `${b.why} (${b.dataset})` })),
  };
}

/* ---------------------------------------------------------- the targets */

/** A DISPATCH target from the owner's words (`fleet.deployHere`). */
export function dispatchWorkTarget(input: { readonly intentId: string; readonly note: string; readonly requestedAt: string }): DispatchWorkTarget {
  const target = parseDispatchTarget(input.note);
  return { kind: "DISPATCH", key: `dispatch:${input.intentId}`, label: target.text, requestedAt: input.requestedAt, ref: input.intentId, target };
}

/** A SCOPE target from a selected scope as the cycle planned it. */
export function scopeWorkTarget(scope: PlannedScope): DispatchWorkTarget {
  const d = scope.decision;
  return {
    kind: "SCOPE",
    key: d.key,
    label: d.geography.label,
    requestedAt: d.decidedAt,
    ref: d.receiptId,
    budgetUsd: d.budgetUsd,
    scope,
    ...(d.questions !== undefined && d.questions.length > 0 ? { questions: d.questions } : {}),
  };
}


export function carriedDispatchTargets(prior: unknown, cancelled: ReadonlySet<string> = new Set()): DispatchWorkTarget[] {
  if (!isDispatchWorkReading(prior)) return [];
  return prior.targets
    .filter(
      (t) =>
        t.kind === "DISPATCH" &&
        /* The owner took this Send back (CANCEL_DISPATCH): it is no longer carried. */
        !cancelled.has(t.ref) &&
        (t.requirements.deferred > 0 ||
          t.requirements.failed > 0 ||
          /* A Send is carried until every row it reached records it. */
          (t.assignment?.marksDeferred ?? 0) > 0 ||
          (t.assignment?.marksFailed ?? 0) > 0),
    )
    .map((t) => dispatchWorkTarget({ intentId: t.ref, note: t.label, requestedAt: t.requestedAt }));
}

/** A value on the research state that is not a reading reads as none, never as an empty list. */
export function isDispatchWorkReading(value: unknown): value is DispatchWorkReading {
  return isVersionedCycleReading(value, DISPATCH_WORK_FORMAT_VERSION, "targets");
}
