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
import { allDistricts } from "@/lib/control-plane/admin-view/district-catalog.ts";
import { SECTION_DEP } from "./dependencies.ts";
import type { SectionId } from "./contract.ts";
import type { SectionState } from "./live-sync.ts";
import { toSourced } from "./live-sync.ts";
import type { AdminV6Data, ChecklistView, Definition, Dependency, Hunt, Place, StateRow, WorkerStatus } from "./model.ts";
import { COUNTRY_KEY } from "./places.ts";
import { PLACE_GROUPS } from "@/lib/coverage/group-names.ts";

export interface LiveReference {
  readonly states: readonly { readonly code: string; readonly name: string; readonly tracked: boolean }[];
  readonly definitions: readonly Definition[];
  readonly profileVersion: string;
  readonly groupNames: Readonly<Record<string, string>>;
  /** The Census geography the URL scope names, when it is one, with its label. */
  readonly geo: { readonly key: string; readonly name: string; readonly kind: Place["kind"]; readonly state: string } | null;
  readonly observedAt: string;
}

/**
 * The places The country's rows stand for, so a district or ZIP the owner opens from the list is a place Change place and
 * the breadcrumbs know. States are already listed from the reference; every other row is filed under the place it sits in.
 */
export function placesFromNational(rows: readonly StateRow[] | null): readonly Place[] {
  return (rows ?? []).flatMap((r): Place[] => {
    if ((r.kind !== "District" && r.kind !== "ZIP") || r.parentKey === undefined) return [];
    const state = /^geo:([a-z]{2})\./.exec(r.placeKey)?.[1];
    const within = [...new Set([r.parentKey, ...(state ? [`st:${state}`] : [])])];
    return [{ key: r.placeKey, name: r.name, kind: r.kind === "ZIP" ? "ZIP" : "Area", navParent: r.parentKey, within }];
  });
}

/** The places held so far plus the ones these rows add; the same list when they add none, so a render that adds nothing changes nothing. */
export function rememberPlaces(held: readonly Place[], rows: readonly StateRow[] | null): readonly Place[] {
  const have = new Set(held.map((p) => p.key));
  const fresh = placesFromNational(rows).filter((p) => !have.has(p.key));
  return fresh.length === 0 ? held : [...held, ...fresh];
}

export function referencePlaces(ref: LiveReference, hunts: readonly Hunt[] = [], seen: readonly Place[] = []): readonly Place[] {
  const out: Place[] = [{ key: COUNTRY_KEY, name: "United States", kind: "Country", navParent: null, within: [] }];
  for (const s of ref.states) out.push({ key: `st:${s.code}`, name: s.name, kind: "State", navParent: COUNTRY_KEY, within: [COUNTRY_KEY], code: s.code.toUpperCase(), tracked: s.tracked });
  if (ref.geo) out.push({ key: ref.geo.key, name: ref.geo.name, kind: ref.geo.kind, navParent: `st:${ref.geo.state}`, within: [`st:${ref.geo.state}`] });
  // A live hunt's own place, filed under the state its saved Census lookup names, until a places section exists.
  for (const h of hunts) {
    const geo = /^geo:([a-z]{2})\.([a-z_]+)\.[0-9A-Za-z]+$/.exec(h.placeKey);
    if (geo && !out.some((p) => p.key === h.placeKey)) out.push({ key: h.placeKey, name: h.name.replace(/ hunt$/, ""), kind: geo[2] === "zcta" ? "ZIP" : geo[2] === "county" ? "County" : "Area", navParent: `st:${geo[1]}`, within: [`st:${geo[1]}`] });
  }
  // Every congressional district is a place before anyone opens it (AZ-06 and any district typed into Change place).
  const listed = new Set(out.map((p) => p.key));
  for (const d of allDistricts()) if (!listed.has(d.placeKey)) out.push({ key: d.placeKey, name: d.label, kind: "Area", navParent: `st:${d.state}`, within: [`st:${d.state}`] });
  // A district or ZIP opened from The country: its place is the one the list filed it under, so its breadcrumbs run through the district.
  for (const p of seen) {
    const at = out.findIndex((x) => x.key === p.key);
    if (at < 0) out.push(p);
    else if (p.navParent?.startsWith("geo:") && out[at].navParent?.startsWith("st:")) out[at] = { ...out[at], navParent: p.navParent, within: p.within };
  }
  return out;
}

/** National rows before the national read exists: every state listed, every figure unknown (never zero). */
export function referenceNational(ref: LiveReference): readonly StateRow[] {
  return ref.states.map((s) => ({ placeKey: `st:${s.code}`, code: s.code.toUpperCase(), name: s.name, hunts: null, stuck: null, checklistItems: null, tracked: s.tracked, kind: "State" as const, parentKey: COUNTRY_KEY, zipsWorked: null, zipsTotal: null, score: null }));
}

export function referenceChecklist(ref: LiveReference): ChecklistView {
  const groups = [...new Set(ref.definitions.map((d) => d.group))];
  const place = PLACE_GROUPS;
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

export function buildLiveBundle(snapshot: Readonly<Record<SectionId, SectionState>>, ref: LiveReference, pulseStatus: WorkerStatus, seenPlaces: readonly Place[] = []): AdminV6Data {
  const src = <T,>(id: SectionId, dep: Dependency, fallback: T | null = null) => toSourced<T>(snapshot[id], dep, fallback);
  const places = snapshot.places.phase === "live" ? src<readonly Place[]>("places", SECTION_DEP.places) : { ...src<readonly Place[]>("places", SECTION_DEP.places, referencePlaces(ref, snapshot.hunts.phase === "live" ? (snapshot.hunts.data as readonly Hunt[]) : [], [...seenPlaces, ...(snapshot.national.phase === "live" ? placesFromNational(snapshot.national.data as readonly StateRow[]) : [])])), state: "live" as const, load: "partial" as const, missingParts: [`Only the country and its 56 states and territories are listed yet. ${SECTION_DEP.places.need}`] };
  const workersPhase = snapshot.workers.phase;
  const workers = workersPhase === "waiting" || workersPhase === "loading"
    ? { state: "live" as const, load: "partial" as const, asOf: ref.observedAt, data: { status: pulseStatus, jobs: null, waiting: null, events: null, update: null, next: null }, missingParts: [SECTION_DEP.workers.need] }
    : workersPhase === "failed" && snapshot.workers.data !== null
      ? { ...src<NonNullable<AdminV6Data["workers"]["data"]>>("workers", SECTION_DEP.workers),
        missingParts: [...snapshot.workers.missingParts,
          "The detailed Workers read failed. These lists are the last good reading for this place; their saved read time has not advanced."] }
      : src<NonNullable<AdminV6Data["workers"]["data"]>>("workers", SECTION_DEP.workers);
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
    agents: src("agents", SECTION_DEP.agents),
    spend: src("spend", SECTION_DEP.spend),
    sends: src("sends", SECTION_DEP.sends),
    reliability: src("reliability", SECTION_DEP.reliability),
    publication: src("publication", SECTION_DEP.publication),
    money: src("money", SECTION_DEP.money),
    scoreboard: src("scoreboard", SECTION_DEP.scoreboard),
    fixes: src("fixes", SECTION_DEP.fixes),
  };
}
