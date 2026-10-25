import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import { ADMIN_CONFIG_ID, isAdminConfig } from "../control-plane/gateway/admin-config.ts";
import { factReader } from "../facts/db.ts";
import type { Query } from "../facts/publish.ts";
import { readPlaceNeeds } from "../coverage/owed-read.ts";
import { placesAtPoint, placesForCode } from "../place-map/read.ts";
import type { PlaceMembership } from "../place-map/types.ts";

export type HuntPlace = string | { readonly kind: "zip" | "zcta"; readonly code: string } | { readonly kind: "point"; readonly point: [number, number] };

/** One hunter call, with a fresh Admin setting on every pass. The map owns place identity. */
export async function placeNeeds(repos: Pick<ControlPlaneRepositories, "adminConfig">, place: HuntPlace,
  now = new Date().toISOString(), query: Query | null = factReader()) {
  if (!query) throw new Error("What we hold for this place could not be read");
  const row = await repos.adminConfig.read(ADMIN_CONFIG_ID);
  if (row && !isAdminConfig(row.value)) throw new Error("What this place is owed could not be read");
  let memberships: readonly PlaceMembership[] = [];
  if (typeof place !== "string") {
    memberships = (place.kind === "point" ? await placesAtPoint(query, place.point)
      : await placesForCode(query, place.kind, place.code)).memberships;
    if (!memberships.length) throw new Error("The place map has no coverage for this place yet");
  }
  const placeId = typeof place === "string" ? place : place.kind === "point" ? `point:${place.point.join(",")}` : `${place.kind}:${place.code}`;
  return { ...await readPlaceNeeds(query, row?.value ?? null, placeId, now,
    typeof place === "string" ? [place] : [...memberships.map(row => row.placeId), "ocd-division/country:us"],
    typeof place === "string" ? undefined : memberships), memberships };
}
