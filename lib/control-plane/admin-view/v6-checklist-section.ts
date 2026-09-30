import { CHECKLIST_PROFILE, type ChecklistInstance } from "../readiness/checklist-score.ts";
import type { ChecklistAllDefinitionsRead, ChecklistInstanceIndexRead } from "./checklist-instance-index-read.ts";

export const ADMIN_V6_CHECKLIST_CONTRACT = "admin-v6/checklist@1" as const;

/** Structurally matches Admin v6 model.ts without importing the UI bundle. */
export interface AdminV6ChecklistView {
  readonly profileVersion: string;
  readonly definitionCount: number;
  readonly definitions: readonly { readonly id: string; readonly group: string; readonly requirement: string;
    readonly owner: string; readonly label: string }[];
  readonly groupNames: Readonly<Record<string, string>>;
  readonly placeGroups: null;
  readonly items: null | readonly {
    readonly key: string; readonly definitionId: string; readonly name: string; readonly subject: string;
    readonly period: string; readonly status: "unsure"; readonly missing: string;
    readonly appliesBecause: string; readonly owner: string; readonly next: string;
    readonly parts: readonly { readonly text: string; readonly status: string; readonly proof: string;
      readonly tone: "muted" }[];
    readonly actions: readonly [];
  }[];
  readonly systemGroups: readonly { readonly group: string; readonly name: string;
    readonly counts: null; readonly audit: null }[];
}

export interface AdminV6ChecklistEnvelope {
  readonly contract: typeof ADMIN_V6_CHECKLIST_CONTRACT;
  /** An exact canonical instruction scope key. Mapping a UI place key is not inferred here. */
  readonly scope: string;
  readonly revision: string;
  readonly asOf: string;
  readonly data: AdminV6ChecklistView;
  readonly missingParts: readonly string[];
  readonly page: { readonly total: number | null; readonly nextCursor: string | null;
    readonly prevCursor: null };
}

const GROUP_NAMES: Readonly<Record<string, string>> = {
  GEO: "Geography", GOV: "Governments", OFF: "Officeholders", MTG: "Meetings", DOC: "Agendas and documents",
  LEG: "Laws and votes", ELE: "Elections", CAN: "Candidates", CAM: "Campaign finance", FIN: "Government money",
  PAR: "Taking part", ASK: "Ask", GATE: "Setup and safety checks", ACQ: "Finding sources", REC: "Recovery",
  PUB: "Publishing", SAFE: "Safety and privacy", REF: "Reference data", EXE: "Running work",
  PRL: "Working in parallel", ENG: "Engineering",
};
const PLACE_GROUPS = new Set(["GEO", "GOV", "OFF", "MTG", "DOC", "LEG", "ELE", "CAN", "CAM", "FIN", "PAR", "ASK"]);
const definitionById = new Map(CHECKLIST_PROFILE.definitions.map(definition => [definition.id, definition]));
const definitions = CHECKLIST_PROFILE.definitions.map(definition => ({ id: definition.id, group: definition.group,
  requirement: definition.requirement, owner: definition.owner, label: definition.label }));
const systemGroups = [...new Set(definitions.map(definition => definition.group))]
  .filter(group => !PLACE_GROUPS.has(group)).map(group => ({ group, name: GROUP_NAMES[group] ?? group,
    counts: null, audit: null }));

function partText(clause: string): string {
  const id = clause.slice(clause.lastIndexOf(":") + 1);
  return definitionById.get(id)?.requirement ?? clause;
}
function itemOf(instance: ChecklistInstance, definitionId: string, projectionId: string, ordinal: number) {
  const definition = definitionById.get(definitionId)!;
  const unresolved = instance.applicability.state === "UNRESOLVED" || instance.due.state === "UNRESOLVED";
  return { key: `${projectionId}:${definitionId}:${encodeURIComponent(instance.obligationKey)}:${ordinal}`, definitionId,
    name: definition.requirement.split(" — ")[0], subject: instance.objectId, period: instance.period,
    status: "unsure" as const,
    missing: unresolved ? "Applicability or effective period is unresolved; full proof has not been read here."
      : instance.blocker ?? "Clause-level proof has not been read by this section.",
    appliesBecause: `${instance.applicability.state}: ${instance.applicability.reason}`,
    owner: instance.owner, next: instance.nextAction,
    parts: instance.predicate.requiredClauses.map(clause => ({ text: partText(clause),
      status: "Not checked in this section", proof: "Qualifying verification witness not read by this indexed section.",
      tone: "muted" as const })), actions: [] as const };
}

/** A page of saved scope instances; status and clause proof remain unknown until
 * exact witness/read-model joins are added. No group or system totals are inferred. */
export function v6ChecklistSection(input: { readonly scope: string; readonly read: ChecklistInstanceIndexRead;
  readonly readAt: string }): AdminV6ChecklistEnvelope {
  const read = input.read;
  const available = read.state === "CURRENT_SNAPSHOT_CAPTURED_INSTANCES";
  const items = read.state === "CURRENT_SNAPSHOT_CAPTURED_INSTANCES"
    ? read.rows.map((instance, index) => itemOf(instance, read.definitionId,
      read.projectionId, read.ordinals[index])) : null;
  const data: AdminV6ChecklistView = { profileVersion: CHECKLIST_PROFILE.version,
    definitionCount: CHECKLIST_PROFILE.definitionCount, definitions, groupNames: GROUP_NAMES,
    placeGroups: null, systemGroups, items };
  return { contract: ADMIN_V6_CHECKLIST_CONTRACT, scope: input.scope,
    revision: available ? read.projectionId : `${CHECKLIST_PROFILE.version}:index-unavailable`,
    asOf: available ? read.observedAt : input.readAt, data,
    missingParts: [
      available ? "Only this definition's captured instances for one exact instruction receipt are listed. Expected objects, national totals and history remain unknown."
        : read.says,
      ...(read.state === "CURRENT_SNAPSHOT_CAPTURED_INSTANCES" && !read.completeness.inventoryComplete
        ? ["The expected civic object inventory is incomplete; the captured count is a lower bound."] : []),
      ...(read.state === "CURRENT_SNAPSHOT_CAPTURED_INSTANCES" && !read.completeness.readsComplete
        ? ["One or more canonical source populations were not read completely for this census."] : []),
      "Clause-level verification, publication and public-page witnesses were not joined; item statuses remain unsure.",
      "Place-group counts and whole-system audit statuses are not connected to this indexed read.",
      "UI place-key to canonical instruction-scope binding is not connected; only exact canonical scope keys are accepted.",
    ], page: { total: available ? read.matchedCapturedCount : null,
      nextCursor: available ? read.nextCursor : null, prevCursor: null } };
}

/** All 325 definitions remain present even when this bounded page has no rows. */
export function v6ChecklistAllDefinitionsSection(input: { readonly scope: string;
  readonly read: ChecklistAllDefinitionsRead; readonly readAt: string }): AdminV6ChecklistEnvelope {
  const read = input.read;
  const available = read.state === "CURRENT_SNAPSHOT_CAPTURED_INSTANCES";
  return { contract: ADMIN_V6_CHECKLIST_CONTRACT, scope: input.scope,
    revision: available ? read.projectionId : `${CHECKLIST_PROFILE.version}:index-unavailable`,
    asOf: available ? read.observedAt : input.readAt,
    data: { profileVersion: CHECKLIST_PROFILE.version, definitionCount: CHECKLIST_PROFILE.definitionCount,
      definitions, groupNames: GROUP_NAMES, placeGroups: null, systemGroups,
      items: available ? read.rows.map(row => itemOf(row.instance, row.definitionId, read.projectionId, row.ordinal)) : null },
    missingParts: [
      available ? "This page contains captured definition-instance rows for one exact instruction receipt. Expected civic objects, national totals, distinct-object totals and history remain unknown." : read.says,
      ...(available && !read.completeness.inventoryComplete
        ? ["The expected civic object inventory is incomplete; the captured row count is a lower bound."] : []),
      ...(available && !read.completeness.readsComplete
        ? ["One or more canonical source populations were not read completely for this census."] : []),
      "Clause-level verification, publication and public-page witnesses were not joined; item statuses remain unsure.",
      "Place-group counts and whole-system audit statuses are not connected to this indexed read.",
    ],
    page: { total: available ? read.matchedCapturedCount : null,
      nextCursor: available ? read.nextCursor : null, prevCursor: null } };
}
