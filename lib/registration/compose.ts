/** Compose independently sourced governments and established bodies. Reviewed
 * body identity wins; sharing a division does not make two governments one. */
import type { Body, Division } from "../registry/types.ts";
import type { RegistrationReadModel } from "./candidate.ts";
import { bindGovernmentBodies, type RegistrationGovernmentListing } from "./listings.ts";

export interface RegistrationLayer {
  /** Postal code, upper case. */
  readonly state: string;
  /** The registration version this layer was composed from. */
  readonly versionId: string;
  readonly divisions: readonly Division[];
  readonly bodies: readonly Body[];
  readonly governments: readonly RegistrationGovernmentListing[];
}

export function composeRegistration(
  reviewed: { readonly divisions: readonly Pick<Division, "ocdId">[]; readonly bodies: readonly Pick<Body, "id" | "ocdId" | "alsoServesOcdIds" | "censusId">[] },
  model: RegistrationReadModel,
  versionId: string,
): RegistrationLayer {
  const divisionIds = new Set(reviewed.divisions.map((d) => d.ocdId));
  const bodyIds = new Set(reviewed.bodies.map((b) => b.id));
  const censusIds = new Set<string>();
  for (const body of reviewed.bodies) {
    if (body.censusId) censusIds.add(body.censusId);
  }
  return {
    state: model.state.toUpperCase(),
    versionId,
    divisions: model.divisions.filter((d) => !divisionIds.has(d.ocdId)),
    bodies: model.bodies.filter(
      (b) => !bodyIds.has(b.id) && !(b.censusId !== undefined && censusIds.has(b.censusId)),
    ),
    governments: bindGovernmentBodies(model.governments ?? [], reviewed.bodies),
  };
}
