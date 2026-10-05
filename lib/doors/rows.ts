/**
 * DB-12: adapters read their doors from the registry.
 *
 * `wiringRowsFromDoors` turns hand-wired meeting door records back into the
 * wiring rows the adapters already read; `doorRowsFor` is the accessor an
 * adapter uses instead of importing `SOURCE_WIRING`. A suspended door is not
 * read; an open or shut one still is (a shut door is retried, DB-32).
 *
 * Derived members stay in their state's family (read at runtime by the family
 * child), so they are not returned here unless asked for.
 *
 * PURE: no store. Row order is by body then source type; adapters key rows by
 * body and tenant, not by position.
 */

import type { BodySourceWiring } from "../registry/source-wiring.ts";
import type { AgendaSourceType } from "../registry/types.ts";
import type { DoorRecord } from "./registry.ts";

export interface DoorRowOptions {
  /** Include derived family members as well as hand-wired doors. */
  readonly includeDerived?: boolean;
}

function rowOf(door: DoorRecord): BodySourceWiring | null {
  const meeting = door.meeting;
  if (meeting === null || meeting === undefined || door.bodyIds.length !== 1) return null;
  const config: Record<string, string> = {};
  for (const [key, value] of Object.entries(door.config)) if (typeof value === "string") config[key] = value;
  return {
    bodyId: door.bodyIds[0],
    ocdId: door.ocdId as BodySourceWiring["ocdId"],
    agendaSourceType: meeting.agendaSourceType as AgendaSourceType,
    jurisdiction: meeting.jurisdiction,
    publishingOrg: meeting.publishingOrg,
    timeZone: meeting.timeZone,
    config,
    ...(meeting.noticeUrl === undefined ? {} : { noticeUrl: meeting.noticeUrl }),
    ...(meeting.publishesHistory === false ? { publishesHistory: false as const, historyGapReason: meeting.historyGapReason } : {}),
    verifiedAt: meeting.verifiedAt,
  };
}

/** DB-16: every host the registry's meeting doors read, so a door with a new host needs no edit to a host list. */
export function meetingDoorHosts(doors: readonly DoorRecord[]): string[] {
  const hosts = new Set<string>();
  for (const door of doors) {
    if (door.status === "SUSPENDED" || door.meeting == null) continue;
    for (const host of door.hosts) hosts.add(host);
  }
  return [...hosts].sort();
}

/** The wiring rows the registry's meeting doors describe, one per body and source type. */
export function wiringRowsFromDoors(doors: readonly DoorRecord[], options: DoorRowOptions = {}): BodySourceWiring[] {
  const rows = new Map<string, BodySourceWiring>();
  for (const door of doors) {
    if (door.status === "SUSPENDED") continue;
    if (door.meeting == null) continue;
    if (door.meeting.family !== null && options.includeDerived !== true) continue;
    const row = rowOf(door);
    if (row === null) continue;
    // One wiring row can produce several doors (one per source it feeds); they carry the same row.
    rows.set(`${row.bodyId}\u0000${row.agendaSourceType}\u0000${JSON.stringify(sortedConfig(row))}`, row);
  }
  return [...rows.values()].sort(compareRows);
}

/** Rows a given adapter capability should serve, read from the registry's doors. */
export function doorRowsFor(kinds: readonly AgendaSourceType[], doors: readonly DoorRecord[], options: DoorRowOptions = {}): BodySourceWiring[] {
  return wiringRowsFromDoors(doors, options).filter((row) => kinds.includes(row.agendaSourceType));
}

export function compareRows(a: BodySourceWiring, b: BodySourceWiring): number {
  return a.bodyId < b.bodyId ? -1 : a.bodyId > b.bodyId ? 1 : a.agendaSourceType < b.agendaSourceType ? -1 : a.agendaSourceType > b.agendaSourceType ? 1 : 0;
}

/**
 * How the registry's rows differ from the code's. Empty means meetings read
 * through the registry are read exactly as they are today.
 */
export function wiringParity(code: readonly BodySourceWiring[], registry: readonly BodySourceWiring[]): string[] {
  const key = (row: BodySourceWiring) => `${row.bodyId} ${row.agendaSourceType} ${JSON.stringify(sortedConfig(row))}`;
  const mine = new Map(registry.map((row) => [key(row), row]));
  const theirs = new Map(code.map((row) => [key(row), row]));
  const problems: string[] = [];
  for (const [k, row] of theirs) {
    const other = mine.get(k);
    if (other === undefined) problems.push(`missing from the registry: ${row.bodyId} (${row.agendaSourceType})`);
    else if (JSON.stringify(sortKeys(other)) !== JSON.stringify(sortKeys(row))) problems.push(`differs: ${row.bodyId} (${row.agendaSourceType})`);
  }
  for (const [k, row] of mine) if (!theirs.has(k)) problems.push(`only in the registry: ${row.bodyId} (${row.agendaSourceType})`);
  return problems;
}

function sortedConfig(row: BodySourceWiring): Record<string, string> {
  return Object.fromEntries(Object.entries(row.config).sort(([a], [b]) => (a < b ? -1 : 1)));
}

function sortKeys(row: BodySourceWiring): unknown {
  return Object.fromEntries(Object.entries({ ...row, config: sortedConfig(row) }).sort(([a], [b]) => (a < b ? -1 : 1)));
}
