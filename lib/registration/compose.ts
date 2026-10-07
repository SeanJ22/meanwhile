/**
 * A state's registration, as the reader composes it. Pure. The reviewed registry and the state's
 * promoted registration meet only here:
 *
 * ```
 *   reviewed wins       an id the reviewed registry holds is never composed from registration
 *   one government,     a registered body is left out when the reviewed registry already keys a
 *   one body            body on its division, or lists the same Census government
 *   nothing invented    a state with no promoted registration composes to nothing
 * ```
 */
import type { Body, Division } from "../registry/types.ts";
import type { RegistrationReadModel } from "./candidate.ts";

export interface RegistrationLayer {
  /** Postal code, upper case. */
  readonly state: string;
  /** The registration version this layer was composed from. */
  readonly versionId: string;
  readonly divisions: readonly Division[];
  readonly bodies: readonly Body[];
}

export function composeRegistration(
  reviewed: { readonly divisions: readonly Pick<Division, "ocdId">[]; readonly bodies: readonly Pick<Body, "id" | "ocdId" | "alsoServesOcdIds" | "censusId">[] },
  model: RegistrationReadModel,
  versionId: string,
): RegistrationLayer {
  const divisionIds = new Set(reviewed.divisions.map((d) => d.ocdId));
  const bodyIds = new Set(reviewed.bodies.map((b) => b.id));
  const keyedDivisions = new Set<string>();
  const censusIds = new Set<string>();
  for (const body of reviewed.bodies) {
    if (body.ocdId) keyedDivisions.add(body.ocdId);
    for (const other of body.alsoServesOcdIds ?? []) keyedDivisions.add(other);
    if (body.censusId) censusIds.add(body.censusId);
  }
  return {
    state: model.state.toUpperCase(),
    versionId,
    divisions: model.divisions.filter((d) => !divisionIds.has(d.ocdId)),
    bodies: model.bodies.filter(
      (b) => !bodyIds.has(b.id) && !keyedDivisions.has(b.ocdId) && !(b.alsoServesOcdIds ?? []).some(id => keyedDivisions.has(id)) && !(b.censusId !== undefined && censusIds.has(b.censusId)),
    ),
  };
}
