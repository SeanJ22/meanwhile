import { statesForRegistryDivisions } from "../../civic-data/state-scopes.ts";
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
import { placePercent } from "../../coverage/place-measures.ts";
import { readHeldPlaceCapture } from "../../civic-data/held-place-capture.ts";
import { ADMIN_CONFIG_ID, isAdminConfig } from "../gateway/admin-config.ts";
import { setActiveOwedOverlay } from "../../coverage/owed-overlay.ts";
import { VERSION_PREFIX, type ExpansionScopeDecision } from "./scopes.ts";
import { readExpansionScopesForZips, resolveScopes } from "./runner-load.ts";
import { loadPublishedAreaLookupState } from "../../census-geography/area-lookup.ts";
import { declaredWorkMembers } from "./declared-work-scope.ts";
import { censusWorkDivision } from "../../census-geography/division-id.ts";
import { parseV6PlaceKey } from "../admin-view/v6-hunts-read.ts";
import { readPlaceStandingWork } from "../repository/pg-store.ts";

export interface PlaceWorkReading {
  readonly key: string;
  readonly receiptId: string;
  readonly items: readonly Pick<PlaceOwedItem, "state" | "checklistId">[];
}

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

    const percent = placePercent(place.items) ?? 0;
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

export async function orderNationalPlaceWork(repos: ControlPlaneRepositories, zips: readonly string[], now: string): Promise<string[]> {
  return (await nationalPlaceWorkReading(repos, zips, now)).ordered;
}

const READING_MEMO_MS = 5 * 60_000;
const READING_MEMO_MAX = 32;
const readingMemo = new Map<string, { readonly at: number; readonly items: PlaceOwedItem[] }>();
const memoKeyOf = (decision: ExpansionScopeDecision): string =>
  [decision.receiptId, decision.latestDecisionReceiptId ?? "", decision.decidedAt, decision.geography.type, decision.geography.geoid].join("|");

async function nationalPlaceContext(repos: ControlPlaneRepositories, zips: readonly string[]) {
  const row = await repos.adminConfig.read(ADMIN_CONFIG_ID);

  setActiveOwedOverlay(row !== null && isAdminConfig(row.value) ? row.value.owedOverlay : null);
  const decisions = await readExpansionScopesForZips(repos,zips);
  if (!decisions.scopes.length) return { lookup: null, scopes: [], targets: null };
  const lookup = decisions.lookup;
  const resolved = await resolveScopes(decisions.scopes, lookup, null);
  const scopes = resolved.scopes.filter(scope => scope.kind === "RESOLVED" && zips.some(zip => scope.zctas.has(zip)) ||
    scope.kind === "UNRESOLVED" && scope.decision.geography.type === "zcta" && zips.includes(scope.decision.geography.geoid));
  const targetKeys = scopes.flatMap(({ decision: { geography } }) => geography.type === "state"
    ? [`st:${geography.stateAbbr.toLowerCase()}`]
    : [`geo:${geography.stateAbbr.toLowerCase()}.${geography.type}.${geography.geoid.toLowerCase()}`,
      `${geography.stateAbbr.toLowerCase()}.${VERSION_PREFIX[geography.type]}.${geography.geoid.toLowerCase()}`]);
  const targets = await repos.adminConfig.read(ADMIN_CONFIG_ID, { placeTargets: { ids: targetKeys } });
  return { lookup, scopes, targets };
}

export async function nationalPlaceWorkReading(repos: ControlPlaneRepositories, zips: readonly string[], now: string) {
  return placeReading(repos, zips, now, await nationalPlaceContext(repos, zips));
}

export async function nationalPlaceBelowTarget(repos: ControlPlaneRepositories, zips: readonly string[], now: string): Promise<ReadonlySet<string>> {
  const context = await nationalPlaceContext(repos, zips);
  return context.targets?.value.placeTargets?.length ? (await placeReading(repos, zips, now, context)).belowTarget : new Set<string>();
}

async function placeReading(repos: ControlPlaneRepositories, zips: readonly string[], now: string, context: Awaited<ReturnType<typeof nationalPlaceContext>>) {
  let { lookup } = context;
  if (lookup === null) return { ordered: [...zips], belowTarget: new Set<string>() };
  const { scopes, targets } = context;
  const selectedZips = new Set(zips);
  const nowMs = Date.parse(now);
  const remembered = (scope: (typeof scopes)[number]) => {
    const hit = readingMemo.get(memoKeyOf(scope.decision));
    return hit !== undefined && nowMs - hit.at >= 0 && nowMs - hit.at < READING_MEMO_MS ? hit : null;
  };

  const rebuilt = scopes.filter(scope => remembered(scope) === null);
  const scopeZips = [...new Set([...zips, ...rebuilt.flatMap(scope => scope.kind === "RESOLVED" ? [...scope.zctas] : [])])];

  if (scopeZips.some(zip => !selectedZips.has(zip))) lookup = await loadPublishedAreaLookupState(scopeZips);
  const wanted = new Set<string>(["ocd-division/country:us"]);
  for (const zip of scopeZips) {
    const grouping = await lookup.lookup.groupingsForZcta(zip);
    for (const membership of grouping.memberships) {
      const id = censusWorkDivision(membership.geography);
      if (id) wanted.add(id);
      wanted.add(`ocd-division/country:us/state:${membership.geography.stateAbbr.toLowerCase()}`);
    }
  }
  const work = await readPlaceStandingWork(repos, [...wanted]);
  const members = await declaredWorkMembers(scopes, work, lookup.lookup);
  const bySubject = new Map(work.map(item => [item.subjectId, item]));
  const divisionsByReceipt = new Map<string, Set<string>>();
  const inScope = new Map<string, ReadonlySet<string>>();
  for (const scope of scopes) {
    const receiptId = scope.decision.receiptId;
    const selected = scope.kind === "RESOLVED" ? scope.zctas :
      scope.decision.geography.type === "zcta" ? new Set([scope.decision.geography.geoid]) : new Set<string>();
    inScope.set(receiptId, selected);
    if (remembered(scope) !== null) continue;
    const divisions = new Set<string>();
    for (const subject of members.get(scope.decision.key) ?? []) {
      for (const id of bySubject.get(subject)?.scopeDivisions ?? []) if (id.startsWith("ocd-division/")) divisions.add(id);
      if (subject.startsWith("ocd-division/")) divisions.add(subject.split("#")[0]);
    }
    for (const zip of selected) {
      const grouping = await lookup.lookup.groupingsForZcta(zip);
      if (grouping.status.kind !== "OK") continue;
      for (const membership of grouping.memberships) {
        const division = censusWorkDivision(membership.geography);
        if (division) divisions.add(division);
        divisions.add(`ocd-division/country:us/state:${membership.geography.stateAbbr.toLowerCase()}`);
      }
    }
    if (divisions.size) divisions.add("ocd-division/country:us");
    divisionsByReceipt.set(receiptId, divisions);
  }
  const readingGroups = new Map<string, typeof scopes>();
  for (const scope of rebuilt) {
    const ids = [...(divisionsByReceipt.get(scope.decision.receiptId) ?? [])];
    const key = statesForRegistryDivisions(ids).join();
    readingGroups.set(key, [...(readingGroups.get(key) ?? []), scope]);
  }
  const rebuiltItems = new Map<string, PlaceOwedItem[]>();
  for (const group of readingGroups.values()) {
    const ids = [...new Set(group.flatMap(scope => [...(divisionsByReceipt.get(scope.decision.receiptId) ?? [])]))];
    const capture = ids.length ? await readHeldPlaceCapture(ids, { now, bypassCache: true }) : { subjects: [], held: [] };
    for (const scope of group) {
      const items = buildPlaceOwedList({ divisions: [...(divisionsByReceipt.get(scope.decision.receiptId) ?? [])].map(id => ({ id, label: id })),
        subjects: capture.subjects, held: capture.held, now, zips: [...(inScope.get(scope.decision.receiptId) ?? [])] });
      rebuiltItems.set(scope.decision.receiptId, items);
      readingMemo.set(memoKeyOf(scope.decision), { at: nowMs, items });
      while (readingMemo.size > READING_MEMO_MAX) readingMemo.delete(readingMemo.keys().next().value as string);
    }
  }
  const itemsOf = (scope: (typeof scopes)[number]): PlaceOwedItem[] =>
    rebuiltItems.get(scope.decision.receiptId) ?? remembered(scope)?.items ?? [];
  const readings = placeWorkReadings(targets?.value, scopes.map(scope => ({

    key: scope.decision.geography.type === "state" ? `st:${scope.decision.geography.stateAbbr.toLowerCase()}`
      : `${scope.decision.geography.stateAbbr.toLowerCase()}.${VERSION_PREFIX[scope.decision.geography.type]}.${scope.decision.geography.geoid.toLowerCase()}`,
    receiptId: scope.decision.receiptId,
    items: itemsOf(scope),
  })));
  const rank = (zip: string) => readings.findIndex(place => inScope.get(place.receiptId)?.has(zip));
  return { ordered: [...zips].sort((a, b) => (rank(a) < 0 ? Infinity : rank(a)) - (rank(b) < 0 ? Infinity : rank(b))),
    belowTarget: new Set(zips.filter(zip => readings.some(place => place.target && inScope.get(place.receiptId)?.has(zip)))) };
}

export const DISPATCH_WORK_FORMAT_VERSION = 1;

export async function applyManualSourceGaps(
  repos: ControlPlaneRepositories,
  scopes: readonly ResolvedScope[],
  input: { readonly now: string },
): Promise<{ readonly created: number; readonly carried: number; readonly deferred: number }> {
  const applicable = scopes.filter(scope => scope.kind === "RESOLVED" && scope.decision.sourceWorkVersion === 1);
  let created = 0, carried = 0;
  const deferred = 0;
  if (applicable.length === 0) return { created, carried, deferred };
  const heldIds = new Set((await repos.workItems.list()).map(row => row.id));
  for (const row of manualProducerInvocationMatrix(applicable, input.now)) {
    if (row.mode !== "SCOPED_ADAPTER_OWED") continue;
    for (const receipt of row.instructionIds) {
      const scope = applicable.find(candidate => candidate.decision.receiptId === receipt);
      if (!scope) continue;
      const work = createWorkItem({ project: "freshness", subject: `manual-source:${scope.decision.key}`,
        obligation: `source capability ${row.id} for instruction ${receipt}`,
        why: row.reason, priority: "P1", now: input.now });
      if (heldIds.has(work.id)) { carried += 1; continue; }
      await registerWorkItem(repos, { ...work, manualSourceGap: {
        contractId: row.id, mode: row.mode, reason: row.reason, instructionReceipt: receipt,
        assignmentKey: scope.decision.key,
      } }, input.now);
      heldIds.add(work.id);
      created += 1;
    }
  }
  return { created, carried, deferred };
}

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

export type DispatchWorkTarget =
  | {
      readonly kind: "SCOPE";

      readonly key: string;
      readonly label: string;
      readonly requestedAt: string;

      readonly ref: string;
      readonly budgetUsd: number;
      readonly scope: PlannedScope;

      readonly questions?: readonly WorkQuestion[];
    }
  | {
      readonly kind: "DISPATCH";

      readonly key: string;
      readonly label: string;
      readonly requestedAt: string;

      readonly ref: string;
      readonly target: DispatchTarget;
    };

export interface DurableRowFacts {
  readonly active: boolean;
  readonly materializedBy?: string;

  readonly assignments?: readonly ObligationAssignment[];
}

export interface DispatchWorkWorld {

  readonly registries: ReadonlyMap<string, JurisdictionRegistry>;

  readonly territory: TerritoryIndex | null;
  readonly territoryDetail: string | null;

  readonly corpus: readonly { readonly id: string; readonly subjectId: string }[];

  readonly durable: ReadonlyMap<string, DurableRowFacts>;
  readonly meetingPartitions: MeetingPartitionOwnership;

  readonly censusUnitsByState?: ReadonlyMap<string, number> | null;

  readonly refusedRegistries?: ReadonlyMap<string, string>;

  readonly packetDivisions?: ReadonlyMap<string, readonly string[]>;
}

export type RequirementKind = "MEETINGS_DISCOVERY" | "REGISTRY_ROUTE" | "HUNT_PACKET";

export interface RequirementInstance {

  readonly obligation: FreshnessObligation;
  readonly kind: RequirementKind;
  readonly executor: ExecutorKind;

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

function packetRequirements(divisions: readonly string[]): RequirementInstance[] {
  return [...new Set(divisions)].sort().map(id => ({ obligation: huntPacketObligation(id), kind: "HUNT_PACKET" as const,
    executor: "BOUNDED_MODEL_WORKER" as const, carriage: "OWED" as const }));
}

export type BlockedCode =
  | "GEOGRAPHY_UNRESOLVED"
  | "TERRITORY_UNREADABLE"
  | "NO_JURISDICTION_REGISTRY"
  | "NOT_IN_REGISTRY"
  | "REGISTRY_NOT_READ"
  | "NO_GOVERNMENT_PLACED"
  | "NO_STATE_NAMED";

export interface BlockedUnits {
  readonly code: BlockedCode;

  readonly dataset: string;
  readonly why: string;

  readonly units: number | null;
  readonly states: readonly string[];
  readonly sample: readonly string[];
}

interface PlacedUnit {
  readonly reg: JurisdictionRegistry;
  readonly jurisdiction: Jurisdiction;
}

interface TargetUnits {
  readonly placed: readonly PlacedUnit[];
  readonly blocked: readonly BlockedUnits[];

  readonly unplaced: number;
}

const byName = (a: CensusUnitTerritory, b: CensusUnitTerritory): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

function scopeUnits(scope: PlannedScope, world: DispatchWorkWorld): TargetUnits {
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
  const placed: PlacedUnit[] = [];
  const rowsByState = new Map<string, ReadonlyMap<string, Jurisdiction>>();
  for (const state of scope.states) {
    const reg = world.registries.get(state.toLowerCase());

    if (reg) for (const jurisdiction of reg.jurisdictions) if (index.statewide.has(jurisdiction.id) && jurisdiction.sourceIds.length > 0) placed.push({ reg, jurisdiction });
  }
  for (const territory of index.bySubject.values()) {
    if (!certainlyOverlaps(territory, scope)) continue;
    const state = territory.stateCode.toLowerCase();
    const reg = world.registries.get(state);
    if (reg === undefined) continue;
    let rows = rowsByState.get(state);
    if (rows === undefined) {
      rows = new Map(reg.jurisdictions.map((row) => [row.id, row]));
      rowsByState.set(state, rows);
    }
    const j = rows.get(territory.subjectId);
    if (j !== undefined) placed.push({ reg, jurisdiction: j });
  }
  placed.sort((a, b) => (a.jurisdiction.id < b.jurisdiction.id ? -1 : a.jurisdiction.id > b.jurisdiction.id ? 1 : 0));

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

  const scopeStates = new Set(scope.states.map((s) => s.toLowerCase()));
  const unplacedRegistered = [...index.unplaced.keys()].filter((id) => scopeStates.has(id.split(":")[0] ?? "")).length;
  const unplacedCensus = scope.states.reduce(
    (n, state) => n + (index.unregisteredUnitsByState.get(state) ?? []).filter((u) => u.zips.length === 0).length,
    0,
  );
  const unplaced = unplacedRegistered + unplacedCensus;

  if (placed.length === 0 && blocked.length === 0) {
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
  return { placed, blocked, unplaced };
}

function dispatchUnits(target: DispatchTarget, world: DispatchWorkWorld): TargetUnits {
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
  const placed: PlacedUnit[] = [];
  const blocked: BlockedUnits[] = [];
  for (const code of target.states) {
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
    for (const j of reg.jurisdictions) {
      if (unitMatchesTarget({ ...target, states: [code] }, { id: j.id, subjectId: j.id })) placed.push({ reg, jurisdiction: j });
    }
  }
  placed.sort((a, b) => (a.jurisdiction.id < b.jurisdiction.id ? -1 : a.jurisdiction.id > b.jurisdiction.id ? 1 : 0));
  return { placed, blocked, unplaced: 0 };
}

export type InstanceState = "CARRIED" | "CREATED" | "MISSING" | "HELD";

export interface PlannedInstance {
  readonly instance: RequirementInstance;
  readonly state: InstanceState;

  readonly existsUnmarked: boolean;
}

export interface TargetPlan {
  readonly target: DispatchWorkTarget;
  readonly units: TargetUnits;
  readonly instances: readonly PlannedInstance[];

  readonly reordered: number;
}

export type PlannedWrite = PlannedInstance & { readonly target: DispatchWorkTarget };

export interface PlannedMark {
  readonly obligationId: string;
  readonly target: DispatchWorkTarget;
}

export interface DispatchWorkPlan {
  readonly targets: readonly TargetPlan[];

  readonly writes: readonly PlannedWrite[];

  readonly marks: readonly PlannedMark[];
  readonly corpusSize: number;
}

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
}): DispatchWorkPlan {
  const world = input.world;
  const corpusIds = new Set(world.corpus.map((o) => o.id));
  const needsByState = new Map<string, Map<string, MeetingsDiscoveryNeed>>();
  const needOf = (reg: JurisdictionRegistry, id: string): MeetingsDiscoveryNeed | null => {
    const key = reg.stateCode.toLowerCase();
    let needs = needsByState.get(key);
    if (needs === undefined) {
      needs = new Map(meetingsDiscoveryNeeds([reg]).map((n) => [n.jurisdictionId, n]));
      needsByState.set(key, needs);
    }
    return needs.get(id) ?? null;
  };

  const ordered = [
    ...input.targets.filter((t) => t.kind === "DISPATCH").sort((a, b) => (a.requestedAt < b.requestedAt ? -1 : a.requestedAt > b.requestedAt ? 1 : 0)),
    ...input.targets.filter((t) => t.kind === "SCOPE"),
  ];

  const targets: TargetPlan[] = [];
  const writes: PlannedWrite[] = [];
  const marks: PlannedMark[] = [];
  const queued = new Set<string>();
  for (const target of ordered) {
    const units = target.kind === "SCOPE" ? scopeUnits(target.scope, world) : dispatchUnits(target.target, world);
    const instances: RequirementInstance[] = [];
    for (const { reg, jurisdiction } of units.placed) {
      instances.push(...requirementsFor(reg, jurisdiction, needOf(reg, jurisdiction.id), world.meetingPartitions));
    }
    const packetDivisions = world.packetDivisions?.get(target.key) ??
      (target.kind === "DISPATCH" ? units.placed.flatMap(({ jurisdiction }) => jurisdiction.ocdId ? [jurisdiction.ocdId] : []) : []);
    instances.push(...packetRequirements(packetDivisions));

    const recorded = (row: DurableRowFacts | undefined): boolean => (row?.assignments ?? []).some((a) => a.assignmentKey === target.key && a.ref === target.ref);

    const planned: PlannedInstance[] = [];
    for (const instance of instances) {
      const id = instance.obligation.id;
      const row = world.durable.get(id);
      if (instance.carriage === "HELD_UNREAD_WIRING") {
        planned.push({ instance, state: "HELD", existsUnmarked: false });
        continue;
      }
      if (instance.carriage === "MEETING_PARTITION") {

        planned.push({ instance, state: "CARRIED", existsUnmarked: false });
        continue;
      }
      if (row?.materializedBy === OWNER_DISPATCH) {
        planned.push({ instance, state: "CREATED", existsUnmarked: false });

        if (!recorded(row) && (row.assignments ?? []).some((a) => a.relation === "CREATED")) marks.push({ obligationId: id, target });
        continue;
      }
      if (corpusIds.has(id) && row?.active !== false) {
        planned.push({ instance, state: "CARRIED", existsUnmarked: false });
        if (row !== undefined && !recorded(row)) marks.push({ obligationId: id, target });
        continue;
      }
      const entry: PlannedInstance = { instance, state: "MISSING", existsUnmarked: row !== undefined };
      planned.push(entry);
      if (!queued.has(id)) {
        queued.add(id);
        writes.push({ ...entry, target });
      }
    }

    const members = new Set([...units.placed.map((u) => u.jurisdiction.id), ...(target.kind === "SCOPE" ? target.scope.members : [])]);

    if (target.kind === "SCOPE") for (const obligation of world.corpus) {
      const row = world.durable.get(obligation.id);
      if (members.has(obligation.subjectId) && row?.active !== false && row !== undefined && !recorded(row) && !marks.some(m => m.obligationId === obligation.id && m.target.key === target.key)) {
        marks.push({ obligationId: obligation.id, target });
      }
    }
    const reordered =
      target.kind === "SCOPE"
        ? world.corpus.filter((o) => members.has(o.subjectId) && world.durable.get(o.id)?.materializedBy !== OWNER_DISPATCH).length
        : target.target.states.length === 0 && target.target.terms.length === 0
          ? 0
          : world.corpus.filter((o) => unitMatchesTarget(target.target, o) && world.durable.get(o.id)?.materializedBy !== OWNER_DISPATCH).length;
    targets.push({ target, units, instances: planned, reordered });
  }
  return { targets, writes, marks, corpusSize: world.corpus.length };
}

export interface DispatchWorkApplied {
  readonly written: readonly string[];
  readonly failed: readonly { readonly obligationId: string; readonly why: string }[];

  readonly deferred: readonly string[];
  readonly stoppedBy: "DONE";

  readonly marked?: readonly { readonly obligationId: string; readonly assignmentKey: string }[];
  readonly markFailed?: readonly { readonly obligationId: string; readonly assignmentKey: string; readonly why: string }[];

  readonly marksDeferred?: readonly { readonly obligationId: string; readonly assignmentKey: string }[];

  readonly recorded?: readonly { readonly obligationId: string; readonly subjectId: string; readonly entry: ObligationAssignment }[];
}

export async function applyDispatchWork(
  repos: ControlPlaneRepositories,
  plan: DispatchWorkPlan,
  input: { readonly now: string },
): Promise<DispatchWorkApplied> {
  const written: string[] = [];
  const failed: { obligationId: string; why: string }[] = [];
  const deferred: string[] = [];
  const marked: { obligationId: string; assignmentKey: string }[] = [];
  const markFailed: { obligationId: string; assignmentKey: string; why: string }[] = [];
  const marksDeferred: { obligationId: string; assignmentKey: string }[] = [];
  const recorded: { obligationId: string; subjectId: string; entry: ObligationAssignment }[] = [];
  const stoppedBy = "DONE" as const;
  for (const entry of plan.writes) {
    const id = entry.instance.obligation.id;
    const created = assignmentEntry(entry.target, "CREATED", input.now);
    try {

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
      written.push(id);
      if (recordedHere) recorded.push({ obligationId: id, subjectId: entry.instance.obligation.subjectId, entry: created });
    } catch (error) {
      failed.push({ obligationId: id, why: error instanceof Error ? error.message : String(error) });
    }
  }

  const heldMarks = new Map((plan.marks.length ? await repos.obligations.list() : []).map(row => [row.id, row]));
  for (const mark of plan.marks) {
    const key = { obligationId: mark.obligationId, assignmentKey: mark.target.key };
    const reordered = assignmentEntry(mark.target, "REORDERED", input.now);
    try {
      const held = heldMarks.get(mark.obligationId) ?? await repos.obligations.mustRead(mark.obligationId);
      const next = withAssignment(held.value.assignments, reordered);
      const autonomousPlan = inheritPublicationConnection(held.value.autonomousPlan, plan.targets.find(target => target.target.key === mark.target.key)?.instances
        .find(instance => instance.instance.obligation.id === mark.obligationId)?.instance.obligation.autonomousPlan);
      const stopped = held.value.materializedBy === OWNER_DISPATCH && !held.value.active && mark.obligationId.startsWith("hunt:packet:");
      if (next !== held.value.assignments || autonomousPlan !== held.value.autonomousPlan || stopped) {
        heldMarks.set(mark.obligationId, await repos.obligations.compareAndSet(mark.obligationId, held.revision, { ...held.value, assignments: next,
          ...(autonomousPlan ? { autonomousPlan } : {}), ...(stopped ? { active: true, nextDueAt: null } : {}), updatedAt: input.now }, input.now));
      }
      marked.push(key);
      recorded.push({ obligationId: mark.obligationId, subjectId: held.value.subjectId, entry: reordered });
    } catch (error) {
      markFailed.push({ ...key, why: error instanceof Error ? error.message : String(error) });
    }
  }
  return { written, failed, deferred, stoppedBy, marked, markFailed, marksDeferred, recorded };
}

export interface DispatchWorkRequirementCounts {

  readonly defined: number;

  readonly carried: number;

  readonly created: number;
  readonly createdThisCycle: number;

  readonly deferred: number;

  readonly failed: number;

  readonly held: number;

  readonly createdDeterministic: number;
  readonly createdModel: number;

  readonly createdMeetingsDiscovery: number;

  readonly createdFromRegistration?: number;
}

export interface DispatchWorkTargetReading {
  readonly key: string;
  readonly kind: DispatchWorkTarget["kind"];
  readonly label: string;
  readonly requestedAt: string;
  readonly ref: string;
  readonly units: {

    readonly placed: number;

    readonly fromRegistration?: number;

    readonly blocked: number | null;

    readonly unplaced: number;
    readonly placedSample: readonly string[];
  };
  readonly blocked: readonly BlockedUnits[];
  readonly requirements: DispatchWorkRequirementCounts;

  readonly reordered: { readonly obligations: number; readonly of: number };

  readonly assignment?: { readonly recordedThisCycle: number; readonly marksDeferred: number; readonly marksFailed: number };

  readonly says: readonly string[];
}

export interface DispatchWorkReading {
  readonly formatVersion: 1;
  readonly at: string;

  readonly writes: "APPLIED" | "PLAN_ONLY";
  readonly planOnlyWhy: string | null;
  readonly written: number;
  readonly deferred: number;
  readonly failed: readonly { readonly obligationId: string; readonly why: string }[];
  readonly stoppedBy: DispatchWorkApplied["stoppedBy"] | null;

  readonly marked?: number;
  readonly marksDeferred?: number;
  readonly targets: readonly DispatchWorkTargetReading[];
}

export interface DispatchWorkContext {
  readonly at: string;

  readonly modelLaneClosed: string | null;

  readonly ceilingUsd: number;
  readonly ceilingSource: "OVERRIDE" | "FALLBACK";
  readonly writes: "APPLIED" | "PLAN_ONLY";
  readonly planOnlyWhy: string | null;
}

const usd = (n: number): string => `$${n.toFixed(2)}`;

export function dispatchWorkReading(
  plan: DispatchWorkPlan,
  applied: DispatchWorkApplied | null,
  context: DispatchWorkContext,
): DispatchWorkReading {
  const written = new Set(applied?.written ?? []);
  const failed = new Set((applied?.failed ?? []).map((f) => f.obligationId));
  const countFor = (rows: readonly { readonly assignmentKey: string }[] | undefined, key: string): number => (rows ?? []).filter((r) => r.assignmentKey === key).length;
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

    const fromRegistration = t.units.placed.filter((u) => registrySourceOf(u.reg) === "REGISTRATION");
    if (fromRegistration.length > 0) {
      const versions = [...new Map(fromRegistration.map((u) => [u.reg.stateCode, u.reg.registration?.versionId ?? ""])).entries()]
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
      const reasons = [...new Set(t.instances.filter(p => p.state === "HELD").map(p => p.instance.heldReason).filter((reason): reason is string => Boolean(reason)))];
      says.push(`${held} machine-openable meetings route(s) are held: ${reasons.length ? reasons.join("; ") : `${DATASET.wiring} could not be read`}; a second meetings clock is never risked.`);
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
        placedSample: t.units.placed.slice(0, READING_LIST_CAP).map((u) => u.jurisdiction.name),
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
    failed: applied?.failed ?? [],
    stoppedBy: applied?.stoppedBy ?? null,
    marked: applied?.marked?.length ?? 0,
    marksDeferred: applied === null ? plan.marks.length : (applied.marksDeferred?.length ?? 0),
    targets,
  };
}

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

  readonly key: string;
  readonly defined: number;
  readonly created: number;
  readonly createdThisCycle: number;

  readonly carried: number;
  readonly deferred: number;

  readonly blockedUnits: number | null;

  readonly blocked: readonly { readonly code: BlockedCode; readonly says: string }[];
}

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

export function dispatchWorkTarget(input: { readonly intentId: string; readonly note: string; readonly requestedAt: string }): DispatchWorkTarget {
  const target = parseDispatchTarget(input.note);
  return { kind: "DISPATCH", key: `dispatch:${input.intentId}`, label: target.text, requestedAt: input.requestedAt, ref: input.intentId, target };
}

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

export function carriedDispatchTargets(prior: unknown, activeRefs: ReadonlySet<string>): DispatchWorkTarget[] {
  if (!isDispatchWorkReading(prior)) return [];
  return prior.targets
    .filter(
      (t) =>
        t.kind === "DISPATCH" &&

        activeRefs.has(t.ref) &&
        (t.requirements.deferred > 0 ||
          t.requirements.failed > 0 ||

          (t.assignment?.marksDeferred ?? 0) > 0 ||
          (t.assignment?.marksFailed ?? 0) > 0),
    )
    .map((t) => dispatchWorkTarget({ intentId: t.ref, note: t.label, requestedAt: t.requestedAt }));
}

export function isDispatchWorkReading(value: unknown): value is DispatchWorkReading {
  return isVersionedCycleReading(value, DISPATCH_WORK_FORMAT_VERSION, "targets");
}
