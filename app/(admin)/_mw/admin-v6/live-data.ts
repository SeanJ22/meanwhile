/**
 * **THE PRODUCTION DATA BUNDLE, BUILT FROM REAL READS ONLY.**
 *
 * Reference data the repository already holds is real and shown at once:
 * the 56 states and territories (`US_STATES`) and the 325 checklist definitions
 * (`CHECKLIST_PROFILE`), passed in by the server page. Every other section comes
 * from `LiveSync`: live when the backend announces and serves it, otherwise a
 * recoverable "waiting" state with its named dependency. Nothing here is sample
 * data, and nothing from ./sample/ is imported.
 *
 * PURE.
 */
import { SECTION_DEP } from "./dependencies.ts";
import type { SectionId } from "./contract.ts";
import type { SectionState } from "./live-sync.ts";
import { toSourced } from "./live-sync.ts";
import type { AdminV6Data, ChecklistView, Definition, Dependency, Place, StateRow, WorkerStatus } from "./model.ts";
import { COUNTRY_KEY } from "./places.ts";

export interface LiveReference {
  readonly states: readonly { readonly code: string; readonly name: string; readonly tracked: boolean }[];
  readonly definitions: readonly Definition[];
  readonly profileVersion: string;
  readonly groupNames: Readonly<Record<string, string>>;
  /** The Census geography the URL scope names, when it is one, with its label. */
  readonly geo: { readonly key: string; readonly name: string; readonly kind: Place["kind"]; readonly state: string } | null;
  readonly observedAt: string;
}

export function referencePlaces(ref: LiveReference): readonly Place[] {
  const out: Place[] = [{ key: COUNTRY_KEY, name: "United States", kind: "Country", navParent: null, within: [] }];
  for (const s of ref.states) out.push({ key: `st:${s.code}`, name: s.name, kind: "State", navParent: COUNTRY_KEY, within: [COUNTRY_KEY], code: s.code.toUpperCase(), tracked: s.tracked });
  if (ref.geo) out.push({ key: ref.geo.key, name: ref.geo.name, kind: ref.geo.kind, navParent: `st:${ref.geo.state}`, within: [`st:${ref.geo.state}`] });
  return out;
}

/** National rows before the national read exists: every state listed, every figure unknown (never zero). */
export function referenceNational(ref: LiveReference): readonly StateRow[] {
  return ref.states.map((s) => ({ placeKey: `st:${s.code}`, code: s.code.toUpperCase(), name: s.name, hunts: null, stuck: null, checklistItems: null, tracked: s.tracked }));
}

export function referenceChecklist(ref: LiveReference): ChecklistView {
  const groups = [...new Set(ref.definitions.map((d) => d.group))];
  const place = new Set(["GEO", "GOV", "OFF", "MTG", "DOC", "LEG", "ELE", "CAN", "CAM", "FIN", "PAR", "ASK"]);
  return {
    profileVersion: ref.profileVersion,
    definitionCount: ref.definitions.length,
    definitions: ref.definitions,
    groupNames: ref.groupNames,
    placeGroups: null,
    items: null,
    systemGroups: groups.filter((g) => !place.has(g)).map((g) => ({ group: g, name: ref.groupNames[g] ?? g, counts: null, audit: null })),
  };
}

export function buildLiveBundle(snapshot: Readonly<Record<SectionId, SectionState>>, ref: LiveReference, pulseStatus: WorkerStatus): AdminV6Data {
  const src = <T,>(id: SectionId, dep: Dependency, fallback: T | null = null) => toSourced<T>(snapshot[id], dep, fallback);
  const places = snapshot.places.phase === "live" ? src<readonly Place[]>("places", SECTION_DEP.places) : { ...src<readonly Place[]>("places", SECTION_DEP.places, referencePlaces(ref)), state: "live" as const, load: "partial" as const, missingParts: [`Only the country and its 56 states and territories are listed yet. ${SECTION_DEP.places.need}`] };
  const workersLive = snapshot.workers.phase === "live";
  const workers = workersLive
    ? src<NonNullable<AdminV6Data["workers"]["data"]>>("workers", SECTION_DEP.workers)
    : { state: "live" as const, load: "partial" as const, asOf: ref.observedAt, data: { status: pulseStatus, jobs: null, waiting: null, events: null, update: null, next: null }, missingParts: [SECTION_DEP.workers.need] };
  const checklistState = snapshot.checklist;
  const checklist = checklistState.phase === "live"
    ? src<ChecklistView>("checklist", SECTION_DEP.checklistItems)
    : { ...src<ChecklistView>("checklist", SECTION_DEP.checklistItems, referenceChecklist(ref)), data: referenceChecklist(ref) };
  return {
    places,
    hunts: src("hunts", SECTION_DEP.hunts),
    national: src("national", SECTION_DEP.national, referenceNational(ref)),
    results: src("results", SECTION_DEP.results),
    stuck: src("stuck", SECTION_DEP.stuck),
    sameCause: src("sameCause", SECTION_DEP.stuck),
    workRows: src("workRows", SECTION_DEP.work),
    history: src("history", SECTION_DEP.history),
    workers: workers as AdminV6Data["workers"],
    checklist,
    money: src("money", SECTION_DEP.money),
    learning: src("learning", SECTION_DEP.learning),
    fixes: src("fixes", SECTION_DEP.fixes),
    decided: src("decided", SECTION_DEP.decided),
  };
}
