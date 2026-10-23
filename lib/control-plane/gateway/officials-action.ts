import { ensurePeopleFeedDoors, markPeopleDoorsReadNow } from "../../doors/people-feeds.ts";
import type { DoorRecord } from "../../doors/registry.ts";
import { isOfficialSource } from "../../civic-data/source-authority.ts";
import { officialLegislatureRosterRoutes } from "../../sources/people/roster-routes.ts";
import { resolveOfficialsScope, type OfficialsScope } from "../admin-view/officials-scope.ts";
import { parseV6PlaceKey } from "../admin-view/v6-hunts-read.ts";
import { standing } from "../scheduler/durable.ts";
import { OWNER_DISPATCH } from "../scheduler/obligation.ts";
import { VERSION_PREFIX } from "../expansion/scopes.ts";
import { officialsLeadBinding } from "../officials-leads.ts";
import type { AutonomousWorkPlan } from "../workers/autonomous-plan.ts";
import type { RegisteredAction } from "./registry.ts";

export const OFFICIALS_CHECK_ACTION = "officials.checkNow";
export const OFFICIALS_NOTE_MAX = 1_000;

/** The publisher a feed door reads: its own settings, a legislature's roster page, or its registered hosts. */
export function peopleSourceUrl(door: Pick<DoorRecord, "config" | "hosts">): string | null {
  const state = typeof door.config.scope === "string" ? /^US-([A-Z]{2})/.exec(door.config.scope)?.[1] : undefined;
  if (door.config.sourceId === "official-state-people" && state) return officialLegislatureRosterRoutes(state)[0] ?? null;
  for (const key of ["sourceUrl", "url", "route", "listUrl"]) {
    const raw = door.config[key];
    if (typeof raw !== "string") continue;
    try { const url = new URL(raw); if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) return url.href; } catch { /* not a URL */ }
  }
  return door.hosts[0] ? `https://${door.hosts[0]}/` : null;
}

/** Owner words are instructions for a Scout. Only the worker's independently captured official page can become evidence. */
export function officialsLeadPlan(scope: Extract<OfficialsScope, { ok: true }>, note: string, doors: readonly DoorRecord[], receiptId: string): AutonomousWorkPlan {
  const state = parseV6PlaceKey(scope.placeKey)!.kind === "state" ? scope.label : /^geo:([a-z]{2})\./.exec(scope.placeKey)?.[1]?.toUpperCase() ?? "US";
  // Mirrors are never seeds for verifying a reported change; only government publishers are.
  const states = [...new Set(scope.divisions.flatMap(id => /^ocd-division\/country:us\/(?:state|territory|district):([a-z]{2})(?=\/|$)/.exec(id)?.[1] ?? []))];
  const seedUrls = [...new Set([...states.flatMap(code => officialLegislatureRosterRoutes(code)), ...doors.flatMap(door => door.hosts.map(host => `https://${host}/`))]
    .filter(url => isOfficialSource(url)))].sort();
  return {
    version: 1, capability: "officials/offices", jurisdiction: state, sourceRegistryReferences: doors.map(door => door.doorId), seedUrls,
    sources: [], acquisition: [], auditScope: "SOURCE_UNIVERSE", ownerInstructions: [receiptId,
      `Check this lead for ${scope.label} against official government sources: ${note}. Capture the government's page and verify the seat, current holder or vacancy, and effective date. The owner's words are a lead, never source evidence.`],
    contract: { schemaVersion: 2, recordClass: "OFFICIAL_ROSTER", subjectId: scope.divisions.find(id => /\/(?:state|territory|district):[^/]+$/.test(id)) ?? scope.divisions[0],
      requiredFields: ["name", "office"], identity: { namespace: `officials-lead:${receiptId}`, keyFields: ["name", "office"] },
      jurisdiction: { country: "US", state, canonicalId: scope.divisions[0] },
      completenessScope: `What I heard in ${scope.label}: ${note}. Verify this lead on official government sources. The owner's words are an instruction, never source evidence. Independently capture each source and preserve unresolved contradictions and missing effective dates.`,
      expectedSourceDate: null, methodVersion: 0,
      sourceScope: { sourceId: `unobserved:officials-lead:${receiptId}`, publisher: `${scope.label} official government sources`, routeIds: [], canonicalUrls: [], observationArtifactIds: [] },
      extraction: { format: "UNSUPPORTED", mediaType: "unobserved", fields: {}, reason: "Discover and capture official source evidence before creating an extraction mapping." },
      verification: { required: false, authorities: [] } },
  };
}

/** The resolver is injectable so action and runner connections can be tested against committed geography samples. */
export function officialsCheckAction(resolve = resolveOfficialsScope): RegisteredAction {
  return {
    definition: { type: OFFICIALS_CHECK_ACTION, label: "Check officials now", does: "Reads the people sources covering this place on the next runner pass and records their results. An optional lead is verified by a Scout using official sources.",
      doesNot: "Does not publish an owner's note or change paid-work controls.", authority: "OWNER_DECISION_REQUIRED", subjectKind: "a place", requiresStateVersion: false,
      refusals: ["INVALID_INPUT", "DOWNSTREAM_REFUSED"] },
    validate(input) {
      if (Object.keys(input).some(key => key !== "placeKey" && key !== "note")) return { ok: false, why: "the request has fields this check does not use" };
      const placeKey = typeof input.placeKey === "string" ? input.placeKey.trim() : "";
      const place = parseV6PlaceKey(placeKey);
      if (place === null || place.kind === "country") return { ok: false, why: "choose a state, county, district or ZIP" };
      if (input.note !== null && input.note !== undefined && typeof input.note !== "string") return { ok: false, why: "the note must be text" };
      const note = typeof input.note === "string" ? input.note.trim() : "";
      if (note.length > OFFICIALS_NOTE_MAX) return { ok: false, why: `the note is longer than ${OFFICIALS_NOTE_MAX.toLocaleString("en-US")} characters` };
      return { ok: true, value: { placeKey, note: note || null } };
    },
    async execute(deps, context, input) {
      const scope = await resolve(String(input.placeKey));
      if (!scope.ok) return { ok: false, refusal: "DOWNSTREAM_REFUSED", says: scope.says };
      await ensurePeopleFeedDoors(deps.repos.doors, scope.divisions, context.at);
      const counts = await markPeopleDoorsReadNow(deps.repos.doors, scope.divisions, context.at);
      if (counts.doors.length === 0) return { ok: false, refusal: "DOWNSTREAM_REFUSED", says: "No people sources are registered for this place yet." };
      const openedWork = counts.doors.map(door => ({ kind: "people-feed", id: door.doorId, title: door.notes || door.hosts[0] || "People source" }));
      if (input.note !== null) {
        const id = `officials-lead:${context.receiptId}`;
        const plan = officialsLeadPlan(scope, String(input.note), counts.doors, context.receiptId);
        const binding = await officialsLeadBinding(deps.repos, scope.divisions, context.at);
        // One immutable instruction per action key. It runs through the existing paid lane and budget admission.
        if (await deps.repos.obligations.read(id) === null) await deps.repos.obligations.put(id, standing({ id, subjectId: plan.contract.subjectId,
          recordClass: "OFFICIAL_ROSTER", routeId: null, active: binding.active, lastWorkedAt: null, readerImpactAt: null, observedChangeRateHours: null,
          autonomousPlan: plan, scopeDivisions: scope.divisions, materializedBy: OWNER_DISPATCH,
          officialsLead: { kind: "officials-change", placeKey: scope.placeKey, receiptId: context.receiptId }, assignments: binding.assignments }, context.at), context.at);
        openedWork.push({ kind: "officials-lead", id, title: "What I heard" });
      }
      const scheduled = counts.marked + counts.alreadyMarked;
      const place = parseV6PlaceKey(scope.placeKey)!;
      const scopeParam = place.kind === "state" ? place.state : place.kind === "geo" ? `${place.state}.${VERSION_PREFIX[place.type]}.${place.geoid}` : "";
      return { ok: true, outcome: scheduled > 0 || input.note !== null ? "QUEUED" : "DONE", subject: scope.placeKey, openedWork,
        says: `${scheduled} people source${scheduled === 1 ? " is" : "s are"} queued for ${scope.label}.` +
          (counts.notRead ? ` ${counts.notRead} source${counts.notRead === 1 ? " is" : "s are"} paused or closed.` : "") +
          (counts.raced ? ` ${counts.raced} source${counts.raced === 1 ? " needs" : "s need"} another marking attempt.` : "") +
          (input.note !== null ? " Your lead is saved for a Scout within the current paid-work controls." : ""),
        readBackAt: `/admin?scope=${encodeURIComponent(scopeParam)}&view=now`, undo: null };
    },
  };
}
