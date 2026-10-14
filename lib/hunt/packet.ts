/**
 * Hunt packets: one per government, holding what we already hold for it (never looked for again) and every open
 * blank an agent can fill. Built from the owed list, keyed by OCD division and the subject ids the Box and the fact
 * store use. Pure.
 */
import { CHECKLIST_FAMILIES, checklistItem } from "../coverage/checklist-map.ts";
import { isOpenBlank } from "../coverage/open-blanks.ts";
import type { PlaceOwedItem, PlaceSubject } from "../coverage/place-owed.ts";
import { contentHash } from "../control-plane/ids.ts";
import { askedWords, type AskedGap } from "../control-plane/ask-gap-observations.ts";
import { ASK_GAP_CODE_WORDS, type AskGapCode } from "../ask/gap-codes.ts";

export const HUNT_PACKET_CAPABILITY = "hunt-packet";
export const HUNT_PACKET_RECORD_CLASS = "HUNT_PACKET";
export const HUNT_PACKET_ROUTE_ID = "hunter:packet";
export const HUNT_PACKET_NAMESPACE = "hunt:packet:";

export const huntPacketObligationId = (governmentId: string): string => `${HUNT_PACKET_NAMESPACE}${governmentId}`;
export const governmentOfPacketObligation = (obligationId: string): string | null =>
  obligationId.startsWith(HUNT_PACKET_NAMESPACE) ? obligationId.slice(HUNT_PACKET_NAMESPACE.length) : null;

const HUNTABLE_PREDICATES: ReadonlySet<string> = new Set(["fact", "identity", "source", "freshness"]);
const VALUE_CHARS = 160;

export interface PacketField {
  readonly subjectId: string;
  readonly subjectLabel: string;
  readonly checklistId: string;
  /** The checklist family, e.g. OFF. */
  readonly family: string;
  readonly requirement: string;
}

export interface HeldFact extends PacketField {
  readonly value: string;
  readonly sourceUrl: string;
  readonly checkedAt: string;
}

export interface HuntPacket {
  /** The government's OCD division. */
  readonly governmentId: string;
  readonly label: string;
  readonly held: readonly HeldFact[];
  readonly blanks: readonly PacketField[];
}

/** A candidate is hunted for their campaign site, contact, positions, bio and photo. */
const CANDIDATE_BLANKS = new Set(["CAN-04", "CAN-05", "CAN-06", "CAN-07", "CAN-16", "CAN-17"]);

/** Items an agent can find on a public page: not system, process, delivery or ZIP geography work. */
export function huntableItem(checklistId: string): boolean {
  const rule = checklistItem(checklistId);
  return rule !== undefined && rule.unit !== "system" && rule.unit !== "zip" && HUNTABLE_PREDICATES.has(rule.predicateKind) &&
    rule.countsAs !== "superseded";
}

/** The government a subject belongs to: its own division, or the first division it lists (a body's home). */
export function governmentOf(subject: Pick<PlaceSubject, "id" | "kind" | "divisionIds">): string | null {
  if (subject.kind === "zip") return null;
  const own = subject.id.split("#")[0]!;
  if (own.startsWith("ocd-division/")) return own;
  return subject.divisionIds.find(id => id.startsWith("ocd-division/")) ?? null;
}

const familyOf = (checklistId: string): string => checklistId.slice(0, checklistId.indexOf("-"));

function fieldOf(item: PlaceOwedItem): PacketField {
  return { subjectId: item.subject.id, subjectLabel: item.subject.label, checklistId: item.checklistId,
    family: familyOf(item.checklistId), requirement: item.requirement };
}

function valueText(value: unknown): string {
  const text = typeof value === "string" ? value : value === undefined ? "" : JSON.stringify(value);
  return text.length > VALUE_CHARS ? `${text.slice(0, VALUE_CHARS - 1)}…` : text;
}

/** One packet per government the owed list touches, each with its held facts and open huntable blanks. */
export function packetsFrom(input: {
  readonly divisions: readonly { readonly id: string; readonly label: string }[];
  readonly items: readonly PlaceOwedItem[];
}): HuntPacket[] {
  const labels = new Map(input.divisions.map(division => [division.id, division.label]));
  const byGovernment = new Map<string, { held: HeldFact[]; blanks: PacketField[] }>();
  for (const item of input.items) {
    if (!huntableItem(item.checklistId)) continue;
    const government = governmentOf(item.subject);
    if (government === null || !labels.has(government)) continue;
    const packet = byGovernment.get(government) ?? { held: [], blanks: [] };
    byGovernment.set(government, packet);
    // A stale value is held: its known source is refreshed by plain code, never hunted again.
    if (item.state === "missing" && isOpenBlank(item)) {
      if (item.subject.captureKind !== "candidate" || CANDIDATE_BLANKS.has(item.checklistId)) packet.blanks.push(fieldOf(item));
      continue;
    }
    for (const field of item.held) {
      if (field.state === "unpublished") continue;
      packet.held.push({ ...fieldOf(item), value: valueText(field.value), sourceUrl: field.sourceUrl, checkedAt: field.checkedAt });
    }
  }
  return [...byGovernment].sort(([a], [b]) => a.localeCompare(b))
    .map(([governmentId, packet]) => ({ governmentId, label: labels.get(governmentId)!, held: packet.held, blanks: packet.blanks }));
}

const fieldKey = (field: PacketField): string => `${field.subjectId}\u0000${field.checklistId}`;

/** The checklist item whose fact answers each kind of question Ask could not answer about a body. */
const ASKED_ITEM: Readonly<Record<AskGapCode, string>> = {
  MEETINGS_NOT_HELD: "MTG-01", CALENDAR_STALE: "MTG-04", AGENDA_NOT_HELD: "DOC-01", OUTCOME_NOT_READ: "DOC-08", OUTCOMES_UNREADABLE: "DOC-08",
};

/** Each question Ask could not answer about one of this government's bodies is a blank on that body's calendar, held value or not. */
export function withAskedBlanks(packet: HuntPacket, asked: readonly AskedGap[]): HuntPacket {
  const labels = new Map([...packet.held, ...packet.blanks].map(field => [field.subjectId, field.subjectLabel] as const));
  const fields = new Map<string, PacketField>();
  for (const gap of asked) {
    if (gap.bodyId.split("#")[0] !== packet.governmentId) continue;
    const subjectId = `${gap.bodyId}#calendar`;
    const checklistId = ASKED_ITEM[gap.code];
    const field: PacketField = { subjectId, checklistId, family: familyOf(checklistId),
      subjectLabel: labels.get(subjectId) ?? `${labels.get(gap.bodyId) ?? gap.bodyId}: calendar`,
      requirement: `${ASK_GAP_CODE_WORDS[gap.code]}. ${askedWords(gap)}` };
    const prior = fields.get(fieldKey(field));
    fields.set(fieldKey(field), prior ? { ...prior, requirement: `${prior.requirement} ${field.requirement}` } : field);
  }
  if (fields.size === 0) return packet;
  return { ...packet, held: packet.held.filter(fact => !fields.has(fieldKey(fact))),
    blanks: [...packet.blanks.filter(blank => !fields.has(fieldKey(blank))), ...fields.values()] };
}

/** Changes whenever a blank opens or closes, so a packet is re-sent only when something changed. */
export function blankFingerprint(packet: Pick<HuntPacket, "blanks">): string {
  return contentHash(packet.blanks.map(fieldKey).sort().join("\n"));
}

/** Subject ids a finding may be reported for: the government itself and every subject in its packet. */
export function reportableSubjects(packet: HuntPacket): ReadonlySet<string> {
  return new Set([packet.governmentId, ...packet.blanks.map(blank => blank.subjectId), ...packet.held.map(fact => fact.subjectId)]);
}

export interface FamilyCount {
  readonly family: string;
  readonly name: string;
  readonly blanks: number;
  readonly held: number;
}

/** Held facts and open blanks by checklist family, in family order. */
export function packetFamilies(packets: readonly HuntPacket[]): FamilyCount[] {
  const counts = new Map<string, { blanks: number; held: number }>();
  for (const packet of packets) {
    for (const blank of packet.blanks) counts.set(blank.family, { ...counts.get(blank.family) ?? { blanks: 0, held: 0 }, blanks: (counts.get(blank.family)?.blanks ?? 0) + 1 });
    for (const fact of packet.held) counts.set(fact.family, { ...counts.get(fact.family) ?? { blanks: 0, held: 0 }, held: (counts.get(fact.family)?.held ?? 0) + 1 });
  }
  const order = Object.keys(CHECKLIST_FAMILIES);
  return [...counts].sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
    .map(([family, count]) => ({ family, name: CHECKLIST_FAMILIES[family]?.name ?? family, ...count }));
}

/** What sending these packets is expected to cost: model turns plus searches, before any caching. */
export interface PacketCostRates {
  readonly inputUsdPerMillion: number;
  readonly outputUsdPerMillion: number;
  readonly searchUsd: number;
}

const BASE_INPUT_TOKENS = 40_000;
const INPUT_TOKENS_PER_BLANK = 3_000;
const OUTPUT_TOKENS_PER_BLANK = 400;
const SEARCHES_PER_BLANK = 0.5;
const MAX_SEARCHES = 20;

export function packetCostEstimateUsd(packets: readonly Pick<HuntPacket, "blanks">[], rates: PacketCostRates): number {
  let usd = 0;
  for (const packet of packets) {
    const n = packet.blanks.length;
    if (n === 0) continue;
    const input = BASE_INPUT_TOKENS + INPUT_TOKENS_PER_BLANK * n;
    usd += (input * rates.inputUsdPerMillion + OUTPUT_TOKENS_PER_BLANK * n * rates.outputUsdPerMillion) / 1_000_000;
    usd += Math.min(MAX_SEARCHES, Math.ceil(n * SEARCHES_PER_BLANK)) * rates.searchUsd;
  }
  return usd;
}
