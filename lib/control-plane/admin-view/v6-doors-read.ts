/** A door is named by what it holds and the website it reads, never by its id. */
import type { ActionReceipt } from "../gateway/contract.ts";
import type { DoorRecord } from "../../doors/registry.ts";

/** Every door is listed, shut and set-aside ones first; the cap only guards the page's size. */
export const DOORS_SHOWN = 400;
export const DOOR_CHANGES_SHOWN = 10;

export interface DoorRowView {
  readonly name: string;
  /** The adapter kind in words ("Board portal"), never its code name. */
  readonly kind: string;
  /** Who publishes the records (the public body), or "—". */
  readonly body: string;
  readonly status: "Open" | "Shut" | "Set aside";
  readonly why: string | null;
  readonly since: string | null;
  readonly lastWorked: string | null;
  readonly lastFailed: string | null;
}
export interface DoorChangeView { readonly at: string; readonly says: string }
export interface DoorsView {
  readonly observedAt: string;
  readonly counts: { readonly open: number; readonly shut: number; readonly setAside: number; readonly unreadable: number };
  /** How many doors the registry holds in all; `rows` may be fewer only past the cap. */
  readonly total: number;
  readonly rows: readonly DoorRowView[];
  readonly changes: readonly DoorChangeView[];
}

const HOLD_WORDS: Readonly<Record<string, string>> = {
  meetings: "meetings", votes: "votes", money: "money filings", officials: "officials", agendas: "agendas", minutes: "minutes",
};

export function doorName(door: DoorRecord): string {
  const holds = door.holds.map((h) => HOLD_WORDS[h] ?? h.replace(/-/g, " ")).join(", ") || "records";
  const who = door.meeting?.jurisdiction ? ` for ${door.meeting.jurisdiction}` : "";
  const host = door.hosts[0] ? ` on ${door.hosts[0]}` : "";
  return `${holds[0].toUpperCase()}${holds.slice(1)}${who}${host}`;
}

/** An adapter kind in plain words: `official-page-events` reads as "Official page events". */
export function kindName(kind: string): string {
  const words = kind.replace(/[-_]+/g, " ").trim();
  return words ? `${words[0].toUpperCase()}${words.slice(1)}` : "—";
}

const STATE_ORDER: Readonly<Record<string, number>> = { SHUT: 0, SUSPENDED: 1, OPEN: 2 };

export function projectDoors(input: { readonly doors: readonly DoorRecord[]; readonly unreadable: number;
  readonly saves: readonly ActionReceipt[]; readonly observedAt: string }): DoorsView {
  const { doors } = input;
  const byId = new Map(doors.map((d) => [d.doorId, d] as const));
  const status = (d: DoorRecord): DoorRowView["status"] => d.status === "OPEN" ? "Open" : d.status === "SHUT" ? "Shut" : "Set aside";
  const ordered = doors.map((d, n) => ({ d, n })).sort((a, b) => (STATE_ORDER[a.d.status] ?? 3) - (STATE_ORDER[b.d.status] ?? 3) || a.n - b.n);
  const rows = ordered.slice(0, DOORS_SHOWN).map(({ d }) => ({
    name: doorName(d), kind: kindName(d.kind), body: d.meeting?.publishingOrg || d.meeting?.jurisdiction || "—", status: status(d),
    why: d.shutReason ?? (d.lastFailureReason ? /API_KEY|key.*unavailable/i.test(d.lastFailureReason)
      ? "The source's API key is unavailable in this runtime."
      : /PUBLISHER_DOCUMENT_INVALID|schema|parse/i.test(d.lastFailureReason)
        ? "The publisher's response could not be read."
        : "The latest source check could not reach the publisher." : null),
    since: d.shutSince ?? null, lastWorked: d.lastSuccessAt, lastFailed: d.lastFailureAt,
  }));
  const changes = [...input.saves].filter((r) => r.outcome === "DONE")
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, DOOR_CHANGES_SHOWN)
    .map((r) => {
      const door = byId.get(r.subject);
      const what = /^Added/.test(r.says) ? "Door added" : "Door changed";
      return { at: r.completedAt ?? r.startedAt, says: door ? `${what}: ${doorName(door)} (${status(door).toLowerCase()})` : `${what}` };
    });
  return {
    observedAt: input.observedAt,
    counts: { open: doors.filter((d) => d.status === "OPEN").length, shut: doors.filter((d) => d.status === "SHUT").length,
      setAside: doors.filter((d) => d.status === "SUSPENDED").length, unreadable: input.unreadable },
    total: doors.length, rows, changes,
  };
}
