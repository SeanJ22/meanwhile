import { compositionFor } from "../registry/body-membership.ts";
import { withRosterPeople } from "../registry/roster-people.ts";
import type { RegistryRuntimeReadModel } from "../registry/runtime-data-plane.ts";

export interface BodyRosterSummary {
  readonly memberCount: number;
  readonly hasSelectBoard: boolean;
}

/** Count the same resolved identities as the body card, without constructing holder cards. */
export function bodyRosterSummaries(runtime: RegistryRuntimeReadModel, bodyIds: readonly string[]): {
  readonly summaries: ReadonlyMap<string, BodyRosterSummary>;
  readonly memberIds: ReadonlySet<string>;
} {
  const rosters = new Map(withRosterPeople(runtime).bodyRosters.map(roster => [roster.bodyId, roster]));
  const summaries = new Map<string, BodyRosterSummary>(), memberIds = new Set<string>();
  for (const bodyId of new Set(bodyIds)) {
    const direct = rosters.get(bodyId), composition = compositionFor(bodyId);
    const aliased = composition && (composition.kind === "EXPLICIT_LEGAL_ALIAS" || composition.kind === "ALIAS_PLUS_ADDITIONAL_SEATS");
    const alias = !direct?.members.length && aliased && composition.aliasOfBodyId ? rosters.get(composition.aliasOfBodyId) : undefined;
    const members = direct?.members.length ? direct.members : alias?.members ?? [];
    const extras = !direct?.members.length && members.length && aliased
      ? composition.additionalSeats?.filter(seat => seat.name !== null) ?? [] : [];
    for (const member of members) memberIds.add(member.id);
    extras.forEach((_, index) => memberIds.add(`composition:${bodyId}#seat-${index}`));
    summaries.set(bodyId, { memberCount: members.length + extras.length,
      hasSelectBoard: members.some(member => /select\s?board/i.test(member.officeTitle)) || extras.some(seat => /select\s?board/i.test(seat.officeTitle)) });
  }
  return { summaries, memberIds };
}
