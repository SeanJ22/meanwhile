import { CHECKLIST_PROFILE } from "@/lib/control-plane/readiness/checklist-score.ts";
import { US_STATES } from "@/lib/control-plane/readiness/catalog.ts";
import { districtLabelOf } from "@/lib/control-plane/admin-view/district-label.ts";

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
    ? { key: placeKeyOf(scope), name: input.geoLabel ?? (scope.type === "congressional_district" ? districtLabelOf(scope.state, scope.geoid) : `${scope.type === "zcta" ? "ZIP" : scope.type.replace(/_/g, " ")} ${scope.geoid}`),
      kind: scope.type === "zcta" ? "ZIP" as const : scope.type === "county" ? "County" as const : "Area" as const, state: scope.state }
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
