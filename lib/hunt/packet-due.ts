/** A packet runs again only while a blank is open and something changed since its last job:
 * its blanks, a new order, a door that shut, or the longest a dead end may wait. */
import { createHash } from "node:crypto";
import type { HuntRole, TriedStep } from "./brief.ts";
import { blankFingerprint, type HuntPacket, type PacketField } from "./packet.ts";

/** What the last job on this packet left on record. */
export interface LastPacketJob {
  readonly recordedAt: string;
  readonly blankFingerprint: string;
  readonly blankDigests: readonly string[];
}

/** A door of this government that went shut, with what its record says broke. */
export interface ShutDoorNote {
  readonly doorId: string;
  readonly shutSince: string | null;
  readonly evidence: string;
}

export const blankDigest = (field: Pick<PacketField, "subjectId" | "checklistId">): string =>
  createHash("sha256").update(`${field.subjectId}\u0000${field.checklistId}`).digest("hex").slice(0, 12);

export type PacketDue =
  | { readonly due: true; readonly role: HuntRole; readonly why: string }
  | { readonly due: false; readonly why: string };

export function packetDue(input: {
  readonly packet: HuntPacket;
  readonly last: LastPacketJob | null;
  /** When the newest order reached this packet; null when none is recorded. */
  readonly orderedAt: string | null;
  readonly shutDoors: readonly ShutDoorNote[];
  readonly now: string;
  /** The longest a dead end waits before another try, from Admin. */
  readonly maxWaitMs: number;
}): PacketDue {
  const { packet, last } = input;
  if (packet.blanks.length === 0) return { due: false, why: "every blank is held or not owed" };
  if (last === null) return { due: true, role: packet.sourceFailures?.length ? "DETECTIVE" : "HUNTER", why: `first hunt: ${packet.blanks.length} open blank(s)` };
  const since = Date.parse(last.recordedAt);
  const tried = new Set(last.blankDigests);
  const retried = packet.blanks.filter(blank => tried.has(blankDigest(blank))).length;
  const role: HuntRole = packet.sourceFailures?.length || retried * 2 >= packet.blanks.length ? "DETECTIVE" : "HUNTER";
  const shut = input.shutDoors.find(door => door.shutSince === null || Date.parse(door.shutSince) > since);
  if (shut) return { due: true, role: "DETECTIVE", why: `door ${shut.doorId} shut since the last hunt` };
  if (input.orderedAt !== null && Date.parse(input.orderedAt) > since) return { due: true, role, why: "a new order since the last hunt" };
  if (blankFingerprint(packet) !== last.blankFingerprint) return { due: true, role, why: "the open blanks changed since the last hunt" };
  if (Date.parse(input.now) - since >= input.maxWaitMs) return { due: true, role: "DETECTIVE", why: `${Math.round(input.maxWaitMs / 86_400_000)} day(s) since the last hunt left these blanks open` };
  return { due: false, why: `nothing changed since the last hunt at ${last.recordedAt}` };
}

/** What a detective is told was tried: the last job's steps and unfillable blanks, and the doors that shut. */
export function triedSteps(input: {
  readonly steps: readonly { readonly tool: string; readonly target: string; readonly observed: string }[];
  readonly unfilled: readonly { readonly subjectId: string; readonly field: string; readonly tried: string; readonly unlock: string }[];
  readonly shutDoors: readonly ShutDoorNote[];
}): TriedStep[] {
  return [
    ...input.shutDoors.map(door => ({ what: `door ${door.doorId}`, result: door.evidence })),
    ...input.unfilled.map(blank => ({ what: `${blank.subjectId} ${blank.field}`, result: `${blank.tried}${blank.unlock ? `; would unlock: ${blank.unlock}` : ""}` })),
    ...input.steps.map(step => ({ what: `${step.tool} ${step.target}`, result: step.observed })),
  ];
}
