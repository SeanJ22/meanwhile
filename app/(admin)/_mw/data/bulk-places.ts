import "server-only";

/**
 * **WHICH ZIPS A PICK MEANS, AND WHICH ZIPS ARE REAL.** (S11.)
 *
 * The owner sends hunts by ZIP. A pasted list or a file already is ZIPs. A pick
 * of a congressional district, a county or a whole state is turned into ZIPs
 * here, from the published Census lookup (`data/geography.ts`, the same read
 * every Admin geography page uses: membership of each ZIP area in each
 * container). A state is the union of its counties' ZIP areas, because the
 * lookup has no state container and a county tiles the state without a gap.
 *
 * `describeZips` then says, for each ZIP, which state it is in and whether the
 * reader's national ZIP index knows it. A ZIP the index does not know is named
 * and left out of the send, never sent as a hunt that can find nothing.
 */
import type { GeographyType } from "@/lib/census-geography/contract.ts";
import { stateOfZip } from "@/lib/control-plane/bulk-hunts/zip-state.ts";

import { oneContainer, stateContainers } from "@/lib/control-plane/admin-view/promoted-slices.ts";

import { listContainers, loadContainer, loadContainersWithCodes } from "./geography.ts";
import { readerQuery } from "./reader-query.ts";

export type PlacePick =
  | { readonly kind: "state"; readonly state: string }
  | { readonly kind: "county" | "congressional_district"; readonly state: string; readonly geoid: string };

export interface PickedZips {
  readonly ok: true;
  readonly zips: readonly { readonly zip: string; readonly group: string }[];
}
export type PickResult = PickedZips | { readonly ok: false; readonly why: string };

const STATE = /^[A-Za-z]{2}$/;
const GEOID = /^[0-9A-Za-z]{2,12}$/;

export function validPick(raw: unknown): PlacePick | null {
  if (raw === null || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const state = typeof p.state === "string" && STATE.test(p.state) ? p.state.toUpperCase() : null;
  if (state === null) return null;
  if (p.kind === "state") return { kind: "state", state };
  if ((p.kind === "county" || p.kind === "congressional_district") && typeof p.geoid === "string" && GEOID.test(p.geoid)) {
    return { kind: p.kind, state, geoid: p.geoid };
  }
  return null;
}

/**
 * The ZIPs one pick means, each tagged with the name the owner picked it by.
 *
 * Reads the published slice itself, which carries the ZIP areas of a container,
 * and not `loadContainer`, which also joins every ZIP to the reader's index with
 * one database read each: a whole state took 11 s that way, and any action over
 * three seconds fails. The joined read stays as the fallback where the store
 * holds no published pointer (local work on the Arizona bootstrap).
 */
export async function zipsForPick(pick: PlacePick): Promise<PickResult> {
  const query = readerQuery();
  if (query !== null) {
    const slice = pick.kind === "state" ? await stateContainers(pick.state, ["county"], true, query) : await oneContainer(pick.kind as GeographyType, pick.geoid, query);
    if (slice.kind === "UNREAD") return { ok: false, why: slice.detail };
    if (slice.kind === "HELD") {
      const out = new Map<string, string>();
      for (const c of slice.value.containers) {
        for (const o of c.overlaps ?? []) if (!out.has(o.zcta5)) out.set(o.zcta5, pick.kind === "state" ? pick.state : c.ref.label);
      }
      if (out.size === 0) return { ok: false, why: "The published lookup holds no ZIP areas for that pick." };
      return { ok: true, zips: [...out.entries()].map(([zip, group]) => ({ zip, group })) };
    }
  }
  if (pick.kind === "state") {
    const read = await loadContainersWithCodes(pick.state, "county");
    if (read.kind === "UNREAD") return { ok: false, why: read.detail };
    const out = new Map<string, string>();
    for (const c of read.value) for (const z of c.zctas) if (!out.has(z.zcta5)) out.set(z.zcta5, pick.state);
    return { ok: true, zips: [...out.entries()].map(([zip, group]) => ({ zip, group })) };
  }
  const read = await loadContainer(pick.kind as GeographyType, pick.geoid);
  if (read.kind === "UNREAD") return { ok: false, why: read.detail };
  return { ok: true, zips: read.value.zctas.map((z) => ({ zip: z.zcta5, group: read.value.geography.label })) };
}

/** The districts or counties of one state that can be picked. */
export async function pickable(state: string, type: "county" | "congressional_district"): Promise<
  | { readonly ok: true; readonly items: readonly { readonly geoid: string; readonly label: string }[] }
  | { readonly ok: false; readonly why: string }
> {
  const read = await listContainers(state, [type]);
  if (read.kind === "UNREAD") return { ok: false, why: read.detail };
  return { ok: true, items: (read.value[type] ?? []).map((g) => ({ geoid: g.geoid, label: g.label })) };
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
