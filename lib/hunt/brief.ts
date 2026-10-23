/** A packet's brief. What we hold is listed so it is never looked for again;
 * the field manual's notes are optional reading. */
import { CHECKLIST_FAMILIES } from "../coverage/checklist-map.ts";
import type { HuntPacket, PacketField } from "./packet.ts";

export type HuntRole = "HUNTER" | "DETECTIVE";

/** One earlier step on this government: a page opened, a search run, a door that shut. */
export interface TriedStep {
  readonly what: string;
  readonly result: string;
}

const HELD_LINES = 120;
const NOTE_LINES = 12;
const TRIED_LINES = 40;

/** "Name" from "Name — Current holder's name, as the source states it." */
const fieldName = (requirement: string): string => requirement.split(" — ")[0]!.trim();

function bySubject<T extends PacketField>(fields: readonly T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const field of fields) out.set(field.subjectId, [...out.get(field.subjectId) ?? [], field]);
  return out;
}

export function huntBrief(packet: HuntPacket, context: {
  readonly role: HuntRole;
  readonly tried: readonly TriedStep[];
  readonly officialWebsite?: string | null;
  readonly notes?: readonly string[];
}): string {
  const lines: string[] = [`Government: ${packet.label} [${packet.governmentId}]`];
  lines.push(context.officialWebsite ? `Official website: ${context.officialWebsite}` : "Official website: not recorded yet.");
  const directions=(packet as HuntPacket & {directions?:readonly string[]}).directions;
  if(directions?.length)lines.push("","SEAN'S DIRECTIONS FOR THIS HUNT — work the named blanks first:",...directions.map(note=>`- ${note}`));
  lines.push("", `WHAT WE ALREADY HOLD (${packet.held.length}) — never look for these again; read_held opens them.`);
  if (packet.held.length === 0) lines.push("- nothing yet");
  for (const fact of packet.held.slice(0, HELD_LINES)) {
    lines.push(`- ${fact.subjectLabel} [${fact.subjectId}] ${fact.checklistId} ${fieldName(fact.requirement)}: ${fact.value || "(held)"} <${fact.sourceUrl}>`);
  }
  if (packet.held.length > HELD_LINES) lines.push(`- and ${packet.held.length - HELD_LINES} more; read_held lists them all`);
  lines.push("", `BLANKS TO FILL (${packet.blanks.length}). Report each value with report_finding the moment a page states it: subjectId in [brackets], field = the checklist id.`);
  lines.push("A body inventory asks for newly found bodies: report each actual sourced body name separately against that inventory subject with field GOV-02. Report body names before people. Then use <government>#governing for its city/town/county council or commission, supervisors or commissioners; <government>#board for its school board; otherwise <government>#body:<body-name-in-lowercase-with-spaces-and-punctuation-as-hyphens>. Use that body identity for its officials. Never use the inventory as a person or seat.");
  const families = new Map<string, PacketField[]>();
  for (const blank of packet.blanks) families.set(blank.family, [...families.get(blank.family) ?? [], blank]);
  for (const [family, blanks] of [...families].sort(([a], [b]) => Object.keys(CHECKLIST_FAMILIES).indexOf(a) - Object.keys(CHECKLIST_FAMILIES).indexOf(b))) {
    lines.push(`${CHECKLIST_FAMILIES[family]?.name ?? family}:`);
    for (const [subjectId, fields] of bySubject(blanks)) {
      lines.push(`- ${fields[0]!.subjectLabel} [${subjectId}]: ${fields.map(f => `${f.checklistId} ${fieldName(f.requirement)}`).join("; ")}`);
    }
  }
  if (context.tried.length > 0) {
    lines.push("", "WHAT WAS TRIED BEFORE — do not repeat a step that failed unless something about it changed:");
    for (const step of context.tried.slice(-TRIED_LINES)) lines.push(`- ${step.what}: ${step.result}`);
  }
  if (packet.sourceFailures?.length) {
    lines.push("","SOURCE CHECKS THAT FAILED — investigate these reasons and use a different route when the saved page cannot prove the value:");
    for (const failed of packet.sourceFailures) lines.push(`- ${failed.label} [${failed.entityId}] ${failed.field}: ${failed.reason}; ${failed.detail}`);
  }
  if (context.notes?.length) {
    lines.push("", "NOTES FOR THIS KIND OF PLACE (optional reading):", ...context.notes.slice(0, NOTE_LINES).map(note => `- ${note}`));
  }
  lines.push("", context.role === "DETECTIVE"
    ? "These blanks were left open by an earlier hunt. Find another route to each one, report what you find, then call finish."
    : "Fill as many blanks as you can, reporting each fact as you find it, then call finish with one line.");
  return lines.join("\n");
}
