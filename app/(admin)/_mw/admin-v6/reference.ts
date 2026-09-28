/**
 * **REAL REFERENCE DATA FOR THE LIVE PAGE.** Server-side: the states and
 * territories the Admin tracks and the adopted checklist definitions, as plain
 * data the client component can take as props.
 */
import { CHECKLIST_PROFILE } from "@/lib/control-plane/readiness/checklist-score.ts";
import { US_STATES } from "@/lib/control-plane/readiness/catalog.ts";

import type { MwScope } from "../scope.ts";
import { GROUP_NAMES } from "./groups.ts";
import type { LiveReference } from "./live-data.ts";
import type { Definition } from "./model.ts";
import { placeKeyOf } from "./places.ts";

export function checklistDefinitions(): readonly Definition[] {
  return CHECKLIST_PROFILE.definitions.map((d) => ({ id: d.id, group: d.group, requirement: d.requirement, owner: d.owner, label: d.label }));
}

export function liveReference(input: { readonly scope: MwScope; readonly geoLabel?: string | null; readonly observedAt: string }): LiveReference {
  const scope = input.scope;
  const geo = scope.kind === "geo"
    ? { key: placeKeyOf(scope), name: input.geoLabel ?? `${scope.type === "zcta" ? "ZIP" : scope.type.replace(/_/g, " ")} ${scope.geoid}`, kind: scope.type === "zcta" ? "ZIP" as const : "County" as const, state: scope.state }
    : null;
  return {
    states: US_STATES.map((s) => ({ code: s.code, name: s.name, tracked: s.pilot })),
    definitions: checklistDefinitions(),
    profileVersion: CHECKLIST_PROFILE.version,
    groupNames: GROUP_NAMES,
    geo,
    observedAt: input.observedAt,
  };
}
