import { readHeldPlaceCapture, type HeldPlaceCapture } from "../civic-data/held-place-capture.ts";
import { buildPlaceOwedList } from "../coverage/place-owed.ts";
import { rateFor } from "../control-plane/model-cost.ts";
import { scoutLoopBase } from "../control-plane/scheduler/scout-executor.ts";
import { stateDivisionId, unionDivisions, zipDivisionIds } from "../control-plane/admin-view/v6-national-geography.ts";
import type { AskedGap } from "../control-plane/ask-gap-observations.ts";
import { blankFingerprint, withAskedBlanks, packetCostEstimateUsd, packetFamilies, packetsFrom, type FamilyCount, type HuntPacket } from "./packet.ts";
import { statesForRegistryDivisions } from "../civic-data/state-scopes.ts";
import { SEARCH_PRICE_USD } from "./search.ts";
import { factReader } from "../facts/db.ts";
import { readSourceCheckFailures, withSourceCheckFailures, type SourceCheckFailure } from "../facts/detective.ts";

type HeldReader = (divisionIds: readonly string[], now: string) => Promise<HeldPlaceCapture>;
const readHeld: HeldReader = (ids, now) => readHeldPlaceCapture(ids, { now, bypassCache: true });

/** Each government's packet as it stands now, recomputed from held data and what Ask could not answer. A government with nothing open has no blanks. */
export async function readGovernmentPackets(governmentIds: readonly string[], now: string, asked: readonly AskedGap[] = [],
  read: HeldReader = readHeld,
  failures: (ids: readonly string[])=>Promise<readonly SourceCheckFailure[]> = ids=>readSourceCheckFailures(factReader(),ids)): Promise<ReadonlyMap<string, HuntPacket>> {
  const ids = [...new Set(governmentIds)];
  if (ids.length === 0) return new Map();
  const groups = new Map<string, string[]>();
  for (const id of ids) {
    const key = statesForRegistryDivisions([id]).join();
    groups.set(key, [...(groups.get(key) ?? []), id]);
  }
  const packets = new Map<string, HuntPacket>();
  for (const group of groups.values()) {
    const capture = await read(group, now);
    const labelOf = new Map(capture.subjects.filter(subject => subject.kind === "division").map(subject => [subject.id, subject.label] as const));
    const divisions = group.map(id => ({ id, label: labelOf.get(id) ?? id }));
    const items = buildPlaceOwedList({ divisions, subjects: capture.subjects, held: capture.held, now });
    for (const packet of packetsFrom({ divisions, items })) packets.set(packet.governmentId, withAskedBlanks(packet, asked));
    for (const division of divisions) if (!packets.has(division.id)) packets.set(division.id, withAskedBlanks({ governmentId: division.id, label: division.label, held: [], blanks: [] }, asked));
  }
  const failed = await failures(ids);
  return new Map([...packets].map(([id,packet])=>[id,withSourceCheckFailures(packet,failed)]));
}

/** Every division a sent place touches: each ZIP's divisions, its states and the country. */
export async function divisionsOfPlace(zips: readonly string[], states: readonly string[],
  readZips: typeof zipDivisionIds = zipDivisionIds): Promise<string[]> {
  const byZip = await readZips(zips);
  const always = [{ id: "ocd-division/country:us", label: "United States" },
    ...states.flatMap(state => { const id = stateDivisionId(state); return id === null ? [] : [{ id, label: state.toUpperCase() }]; })];
  return unionDivisions([...byZip.values()], always).map(division => division.id).sort();
}

interface PacketPreview {
  readonly state: "READ";
  readonly label: string;
  readonly governments: readonly { readonly governmentId: string; readonly label: string; readonly held: number; readonly blanks: number; readonly fingerprint: string }[];
  readonly families: readonly FamilyCount[];
  readonly held: number;
  readonly blanks: number;
  /** Model turns and searches for every packet with a blank, before caching; null when the hunter's model has no stated price. */
  readonly estimatedUsd: number | null;
}

/** What sending agents to a place would hunt: held facts, blanks by family and the estimated cost. */
export async function previewPlacePackets(place: { readonly label: string; readonly divisionIds: readonly string[] }, now: string,
  read: typeof readGovernmentPackets = readGovernmentPackets): Promise<PacketPreview> {
  const packets = [...(await read(place.divisionIds, now)).values()];
  const rate = rateFor(scoutLoopBase().model);
  return {
    state: "READ",
    label: place.label,
    governments: packets.map(packet => ({ governmentId: packet.governmentId, label: packet.label, held: packet.held.length,
      blanks: packet.blanks.length, fingerprint: blankFingerprint(packet) })),
    families: packetFamilies(packets),
    held: packets.reduce((n, packet) => n + packet.held.length, 0),
    blanks: packets.reduce((n, packet) => n + packet.blanks.length, 0),
    estimatedUsd: rate === null ? null : packetCostEstimateUsd(packets,
      { inputUsdPerMillion: rate.inputUsdPerMillion, outputUsdPerMillion: rate.outputUsdPerMillion, searchUsd: SEARCH_PRICE_USD.brave }),
  };
}
