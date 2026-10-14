/** Reads of what we hold and what is still blank, as hunt packets. Nothing here runs an agent or writes. */
import { readHeldPlaceCapture, type HeldPlaceCapture } from "../civic-data/held-place-capture.ts";
import { buildPlaceOwedList } from "../coverage/place-owed.ts";
import { readPlaceOwed, type PlaceOwedDeps, defaultPlaceOwedDeps } from "../control-plane/admin-view/place-owed-read.ts";
import { stateDivisionId, unionDivisions, zipDivisionIds } from "../control-plane/admin-view/v6-national-geography.ts";
import { MODELS } from "../models.ts";
import { blankFingerprint, mergePackets, packetCostEstimateUsd, packetFamilies, packetsFrom, type FamilyCount, type HuntPacket } from "./packet.ts";
import { SEARCH_PRICE_USD } from "./search.ts";

export type HeldReader = (divisionIds: readonly string[], now: string) => Promise<HeldPlaceCapture>;
const readHeld: HeldReader = (ids, now) => readHeldPlaceCapture(ids, { now, bypassCache: true });

/** Each government's packet as it stands now, recomputed from held data. A government with nothing open has no blanks. */
export async function readGovernmentPackets(governmentIds: readonly string[], now: string, read: HeldReader = readHeld): Promise<ReadonlyMap<string, HuntPacket>> {
  const ids = [...new Set(governmentIds)];
  if (ids.length === 0) return new Map();
  const capture = await read(ids, now);
  const labelOf = new Map(capture.subjects.filter(subject => subject.kind === "division").map(subject => [subject.id, subject.label] as const));
  const divisions = ids.map(id => ({ id, label: labelOf.get(id) ?? id }));
  const items = buildPlaceOwedList({ divisions, subjects: capture.subjects, held: capture.held, now });
  const packets = new Map(packetsFrom({ divisions, items }).map(packet => [packet.governmentId, packet] as const));
  for (const division of divisions) if (!packets.has(division.id)) packets.set(division.id, { governmentId: division.id, label: division.label, held: [], blanks: [] });
  return packets;
}

/** Every division a sent place touches: each ZIP's divisions, its states and the country. */
export async function divisionsOfPlace(zips: readonly string[], states: readonly string[],
  readZips: typeof zipDivisionIds = zipDivisionIds): Promise<string[]> {
  const byZip = await readZips(zips);
  const always = [{ id: "ocd-division/country:us", label: "United States" },
    ...states.flatMap(state => { const id = stateDivisionId(state); return id === null ? [] : [{ id, label: state.toUpperCase() }]; })];
  return unionDivisions([...byZip.values()], always).map(division => division.id).sort();
}

export interface PacketPreview {
  readonly state: "READ";
  readonly places: readonly { readonly placeKey: string; readonly label: string }[];
  readonly governments: readonly { readonly governmentId: string; readonly label: string; readonly held: number; readonly blanks: number; readonly fingerprint: string }[];
  readonly families: readonly FamilyCount[];
  readonly held: number;
  readonly blanks: number;
  /** Model turns and searches for every packet with a blank, before caching. */
  readonly estimatedUsd: number;
}

export type PacketPreviewRefusal = { readonly state: "REFUSED"; readonly placeKey: string; readonly says: string };

/** What sending agents to these places would hunt: held facts, blanks by family and the estimated cost. */
export async function previewPlacePackets(placeKeys: readonly string[], deps: PlaceOwedDeps = defaultPlaceOwedDeps): Promise<PacketPreview | PacketPreviewRefusal> {
  const reads = await Promise.all(placeKeys.map(key => readPlaceOwed(key, deps)));
  const groups: HuntPacket[][] = [];
  const places: { placeKey: string; label: string }[] = [];
  for (const [i, read] of reads.entries()) {
    if (read.state === "REFUSED") return { state: "REFUSED", placeKey: placeKeys[i]!, says: read.says };
    places.push({ placeKey: read.placeKey, label: read.label });
    groups.push(packetsFrom({ divisions: read.divisions, items: read.rows }));
  }
  const packets = mergePackets(groups);
  const rates = { inputUsdPerMillion: MODELS.haiku.inputUsdPerMillion, outputUsdPerMillion: MODELS.haiku.outputUsdPerMillion, searchUsd: SEARCH_PRICE_USD.brave };
  return {
    state: "READ",
    places,
    governments: packets.map(packet => ({ governmentId: packet.governmentId, label: packet.label, held: packet.held.length,
      blanks: packet.blanks.length, fingerprint: blankFingerprint(packet) })),
    families: packetFamilies(packets),
    held: packets.reduce((n, packet) => n + packet.held.length, 0),
    blanks: packets.reduce((n, packet) => n + packet.blanks.length, 0),
    estimatedUsd: packetCostEstimateUsd(packets, rates),
  };
}
