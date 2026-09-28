import type { LoadedReference } from "../../registration/reference.ts";

/**
 * Resolve a Census government's body when registration omitted it because the
 * reviewed registry already owns that exact body id. The Census reference
 * supplies the government-to-division pairing; a division name alone never
 * supplies a body. Ambiguous primary/alternate matches stay unpaired.
 */
export function reviewedBodyForGovernment(
  loaded: LoadedReference,
  jurisdictionId: string,
  reviewedBodies: readonly { readonly id: string; readonly ocdId: string | null; readonly bodyClass: string }[],
): { readonly bodyId: string; readonly ocdId: string; readonly publishingOrg: string } | null {
  const government = loaded.reference.governments.find((row) => row[1] === jurisdictionId);
  if (government === undefined || government[3] === "STATE" || government[4] < 0) return null;
  const divisionIds = [government[4], government[6]]
    .filter((index) => index >= 0)
    .map((index) => loaded.reference.divisions[index]?.[0])
    .filter((id): id is string => typeof id === "string");
  const school = government[3] === "SCHOOL DISTRICT" || government[3] === "DEPENDENT SCHOOL SYSTEM";
  const slot = school ? "board" : "governing";
  const matches = reviewedBodies.filter((body) =>
    body.bodyClass === "GOVERNING" && body.ocdId !== null &&
    divisionIds.includes(body.ocdId) && body.id === `${body.ocdId}#${slot}`);
  if (matches.length !== 1) return null;
  const body = matches[0];
  const division = loaded.reference.divisions.find((row) => row[0] === body.ocdId);
  if (division === undefined || body.ocdId === null) return null;
  return { bodyId: body.id, ocdId: body.ocdId, publishingOrg: division[3] };
}
