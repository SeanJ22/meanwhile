import { withReaderSelection } from "../db/reader-route.ts";
import { withReaderAuthorityEdge } from "../registry/runtime-edge.ts";
import { withRegistryRuntimeProjection } from "../registry/runtime-read-model.ts";
import { withStateRegistryFacts } from "../registry/state-composition.ts";
import { earlierMembersOfBody, membersOfBody } from "../registry/body-membership.ts";
import { rosterGapForBody } from "../registry/body-rosters.ts";
import { officePhoneForBody } from "../meetings/office-phone.ts";
import type { RegistryRuntimeReadModel } from "../registry/runtime-data-plane.ts";
import type { BodyFacts } from "../facts/registry-overlay.ts";
import type { CoveredBody } from "../registry/coverage.ts";

export interface ReaderBodyDetail {
  readonly bodyId: string;
  readonly roster: NonNullable<CoveredBody["readerRoster"]>;
  readonly fieldSources: CoveredBody["fieldSources"];
}

/** Compose one body's details using the same held identities as the existing reader. */
export function projectBodyDetail(state: string, bodyId: string, registry: RegistryRuntimeReadModel,
  facts: readonly BodyFacts[]): ReaderBodyDetail {
  const runtime = withStateRegistryFacts(registry, facts);
  return withReaderSelection(undefined, () => withReaderAuthorityEdge({}, () =>
    withRegistryRuntimeProjection(runtime, [state], () => {
      const earlierMembers = earlierMembersOfBody(bodyId), gap = rosterGapForBody(bodyId);
      return { bodyId, roster: { members: membersOfBody(bodyId).members,
        ...(earlierMembers.length ? { earlierMembers } : {}), gaps: gap ? [gap] : [],
        officePhone: officePhoneForBody(bodyId) },
        fieldSources: runtime.registry.bodies.find(body => body.id === bodyId)?.fieldSources ??
          facts.find(fact => fact.id === bodyId)?.fields.fieldSources };
    })));
}
