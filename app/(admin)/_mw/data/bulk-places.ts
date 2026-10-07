import "server-only";

import { stateOfZip } from "@/lib/control-plane/bulk-hunts/zip-state.ts";
import { US_STATES } from "@/lib/control-plane/readiness/catalog.ts";

import { listContainers } from "./geography.ts";

export const PICKABLE_TYPES = ["county", "congressional_district", "cbsa", "state_leg_upper", "state_leg_lower"] as const;
export type PickableType = (typeof PICKABLE_TYPES)[number];

export type PlacePick =
  | { readonly kind: "state"; readonly state: string }
  | { readonly kind: PickableType; readonly state: string; readonly geoid: string };

const STATE = /^[A-Za-z]{2}$/;
const GEOID = /^[0-9A-Za-z]{2,12}$/;

export function validPick(raw: unknown): PlacePick | null {
  if (raw === null || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const state = typeof p.state === "string" && STATE.test(p.state) ? p.state.toUpperCase() : null;
  if (state === null) return null;
  if (p.kind === "state") return { kind: "state", state };
  if ((PICKABLE_TYPES as readonly unknown[]).includes(p.kind) && typeof p.geoid === "string" && GEOID.test(p.geoid)) {
    return { kind: p.kind as PickableType, state, geoid: p.geoid };
  }
  return null;
}

export async function pickable(state: string, type: PickableType): Promise<
  | { readonly ok: true; readonly items: readonly { readonly geoid: string; readonly label: string }[] }
  | { readonly ok: false; readonly why: string }
> {
  const read = await listContainers(state, [type]);
  if (read.kind === "UNREAD") return { ok: false, why: read.detail };
  return { ok: true, items: (read.value[type] ?? []).map((g) => ({ geoid: g.geoid, label: g.label })) };
}

/** A whole state has no container in the lookup, so its plan follows the county plan it is built from. Nothing here expands a mission into ZIPs. */
export async function missionForPick(pick: PlacePick): Promise<
  | { readonly ok: true; readonly geography: { readonly type: string; readonly geoid: string; readonly version: string; readonly label: string; readonly stateAbbr: string } }
  | { readonly ok: false; readonly why: string }
> {
  const read = await listContainers(pick.state, pick.kind === "state" ? ["county"] : [pick.kind]);
  if (read.kind === "UNREAD") return { ok: false, why: read.detail };
  if (pick.kind === "state") {
    const county = (read.value.county ?? []).find((c) => c.stateAbbr === pick.state);
    if (county === undefined) return { ok: false, why: `The published lookup holds no counties for ${pick.state}, so it cannot name the state's plan.` };
    const name = US_STATES.find((st) => st.code.toUpperCase() === pick.state)?.name ?? pick.state;
    return { ok: true, geography: { type: "state", geoid: county.stateFips, version: `state:${county.version.split(":")[1]}`, label: name, stateAbbr: pick.state } };
  }
  const found = (read.value[pick.kind] ?? []).find((g) => g.geoid === pick.geoid);
  if (found === undefined) return { ok: false, why: "The published lookup has no such place in that state." };
  return { ok: true, geography: { type: found.type, geoid: found.geoid, version: found.version, label: found.label, stateAbbr: found.stateAbbr } };
}

export interface ZipFact {
  readonly zip: string;
  /** Null when the national ZIP index does not know this ZIP. */
  readonly stateAbbr: string | null;
}

/** Which state each ZIP is in, from the reader's national ZIP index; null where the index has no such ZIP. */
export async function describeZips(zips: readonly string[]): Promise<readonly ZipFact[]> {
  return Promise.all(zips.map(async (zip) => ({ zip, stateAbbr: await stateOfZip(zip) })));
}
