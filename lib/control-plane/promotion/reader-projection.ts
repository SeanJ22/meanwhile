/**
 * **WHAT THE READER WOULD RECEIVE — THE CANONICAL PROJECTION OF AN APPROVED FACT.**
 * (Fleet Promotion Readiness, PRDY-4, 2026-09-06.)
 *
 * ## What was missing (ACT-4)
 *
 * Zero of twelve sampled Fleet items had any canonical Reader projection
 * (ACT-4-G1) and nothing could write one (ACT-4-G2). This module is the
 * deterministic projection: a fact → the exact `Meeting` (and, for an agenda,
 * the exact `agendaUrl` and any retrieved `AgendaDocument`) merged into a
 * `MeetingsSnapshot` of the SAME shape `data/meetings-snapshot.json` has,
 * validated by the Reader's own `validateSnapshot`, with counts reconciled by
 * the Reader's own `snapshotCounts`. There is no audit-only renderer: the
 * meeting in the projection IS the adapter's meeting, and the snapshot is the
 * one storage shape every Reader surface reads.
 *
 * ## Inspectable without changing reader truth
 *
 * `proposeSnapshot` returns a proposed snapshot and a change set; it writes
 * nothing. The promoter writes it — to an isolated root in SHADOW, to the
 * checkout only through the READER target while the gate is OFF and the
 * promoter is unreachable. `readerRendering` says, per change, what the
 * Reader would show: the rendered clock, the body, the venue or the online
 * label, and the agenda state in the Reader's own honest vocabulary (a
 * missing link is OUR gap unless the publisher's slot was observed empty).
 */
import { MEETINGS_SNAPSHOT_STAMPS } from "../../../scripts/lib/meetings-snapshot-write.ts";
import { formatMeetingTime } from "../../map/format.ts";
import type { AgendaDocument } from "../../meetings/agenda-documents.ts";
import { snapshotCounts, validateSnapshot, type MeetingsSnapshot, type SnapshotSourceReport } from "../../meetings/snapshot.ts";
import { factsOf } from "../../ops/stamp-stable.ts";
import type { Meeting } from "../../sources/types.ts";
import { canonicalJson } from "../repository/types.ts";
import type { MeetingFact } from "./meeting-facts.ts";

/** RL-1: the meeting's observation stamps, as the canonical snapshot writer names them. */
const STAMPS = { stampKeys: MEETINGS_SNAPSHOT_STAMPS.stampKeys } as const;

function factsJson(value: unknown): string {
  return canonicalJson(factsOf(value, STAMPS));
}

export const READER_PROJECTION_VERSION = "reader-projection/1";

export type ReaderChangeKind = "ADD" | "REPLACE" | "UNCHANGED";

export interface ReaderChange {
  readonly kind: ReaderChangeKind;
  readonly recordClass: MeetingFact["recordClass"];
  readonly factKey: string;
  readonly meetingId: string;
  readonly before: Meeting | null;
  readonly after: Meeting;
  /** Top-level meeting fields whose canonical JSON differs between before and after. */
  readonly changedFields: readonly string[];
  readonly agendaDocument: AgendaDocument | null;
}

/** The meeting the Reader would hold after this fact, given what it holds now. */
export function projectFactToReader(fact: MeetingFact, current: MeetingsSnapshot | null): ReaderChange {
  const before = current?.meetings.find((m) => m.id === fact.meetingId) ?? null;
  /*
   * A fact asserts what it measured. The Events feed exposes no agenda items,
   * so a fact carries no `actingBodies`; the Reader's row may carry them from
   * its own agenda read (D19), and "nobody asked" must not erase "somebody
   * read". Everything the fact does measure — time, body, venue, provenance,
   * the agenda link — is the fact's, and replaces the row's.
   */
  const preserved = before !== null && before.actingBodies !== undefined && fact.meeting.actingBodies === undefined ? { actingBodies: before.actingBodies } : {};
  const proposed: Meeting = fact.recordClass === "meeting-times"
    ? { ...fact.meeting, ...preserved }
    : { ...(before ?? { ...fact.meeting, ...preserved }), agendaUrl: fact.agenda.documentUrl };
  /*
   * RL-1 — a re-observation with unchanged civic facts must not rewrite the
   * Reader's bytes. Fields are compared with the observation stamps removed;
   * a row that differs only by when it was looked at is UNCHANGED and keeps
   * the bytes it has. A factual change replaces the row, stamps included.
   */
  const changedFields = before === null
    ? Object.keys(proposed).sort()
    : [...new Set([...Object.keys(before), ...Object.keys(proposed)])].sort().filter((key) =>
        factsJson((before as unknown as Record<string, unknown>)[key] ?? null) !== factsJson((proposed as unknown as Record<string, unknown>)[key] ?? null));
  const agendaDocument = fact.recordClass === "agendas" ? fact.agenda.document : null;
  const documentHeld = agendaDocument !== null && (current?.agendaDocuments.some((d) => d.id === agendaDocument.id) ?? false);
  const kind: ReaderChangeKind = before === null ? "ADD" : changedFields.length === 0 && (agendaDocument === null || documentHeld) ? "UNCHANGED" : "REPLACE";
  const after: Meeting = kind === "UNCHANGED" && before !== null ? before : proposed;
  return { kind, recordClass: fact.recordClass, factKey: fact.factKey, meetingId: fact.meetingId, before, after, changedFields, agendaDocument };
}

export interface ProposedSnapshot {
  readonly version: typeof READER_PROJECTION_VERSION;
  readonly snapshot: MeetingsSnapshot;
  readonly changes: readonly ReaderChange[];
  readonly validation: { readonly ok: true } | { readonly ok: false; readonly error: string };
  /** Sources the current snapshot did not account for and this projection adds a report for. */
  readonly sourcesAdded: readonly string[];
}

function sourceReportFor(source: string, meetings: readonly Meeting[]): SnapshotSourceReport {
  return {
    source, ok: true, error: null,
    fetched: meetings.length, normalized: meetings.length,
    drops: { placeless: meetings.filter((m) => m.location === null).length, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 },
  };
}

/**
 * Merge facts into a copy of the current snapshot. Meetings replace by id,
 * agenda documents by id, and the counts are re-derived by the Reader's own
 * function; the result is validated by the Reader's own validator and the
 * outcome is reported rather than thrown, so a refusal is a fact about the
 * proposal.
 */
export function proposeSnapshot(current: MeetingsSnapshot, facts: readonly MeetingFact[], generatedAt: string): ProposedSnapshot {
  const meetings = new Map(current.meetings.map((m) => [m.id, m]));
  const documents = new Map(current.agendaDocuments.map((d) => [d.id, d]));
  const changes: ReaderChange[] = [];
  const touched = new Map<string, Meeting[]>();
  /* Meeting-time facts first, so an agenda fact for the same sitting layers onto the projected meeting. */
  const ordered = [...facts].sort((a, b) => (a.recordClass === b.recordClass ? 0 : a.recordClass === "meeting-times" ? -1 : 1));
  const working = (): MeetingsSnapshot => ({ ...current, meetings: [...meetings.values()], agendaDocuments: [...documents.values()] });
  for (const fact of ordered) {
    const change = projectFactToReader(fact, working());
    changes.push(change);
    meetings.set(change.after.id, change.after);
    if (change.agendaDocument !== null) documents.set(change.agendaDocument.id, change.agendaDocument);
    const source = fact.source.sourceId;
    touched.set(source, [...(touched.get(source) ?? []), change.after]);
  }
  const known = new Set(current.sources.map((s) => s.source));
  const sourcesAdded = [...touched.keys()].filter((s) => !known.has(s)).sort();
  const rows = [...meetings.values()];
  /*
   * The Reader's arithmetic: fresh rows plus collapsed duplicates equal what
   * the sources claim to have normalized. A sitting this projection ADDS is
   * one more row its source fetched and normalized; a replaced or unchanged
   * one is not. The per-source report is the run's accounting, and it moves
   * by exactly the rows that moved.
   */
  const addedBySource = new Map<string, number>();
  for (const change of changes) {
    if (change.kind !== "ADD") continue;
    const source = change.meetingId.split(":")[0];
    addedBySource.set(source, (addedBySource.get(source) ?? 0) + 1);
  }
  const sources: SnapshotSourceReport[] = [
    ...current.sources.map((report) => {
      const added = addedBySource.get(report.source) ?? 0;
      return added === 0 ? report : { ...report, fetched: report.fetched + added, normalized: report.normalized + added };
    }),
    ...sourcesAdded.map((s) => sourceReportFor(s, (touched.get(s) ?? []).filter((m) => changes.some((c) => c.kind === "ADD" && c.meetingId === m.id)))),
  ];
  const snapshot: MeetingsSnapshot = {
    formatVersion: 1,
    generatedAt,
    counts: { ...snapshotCounts(rows, current.counts.duplicatesCollapsed ?? 0) },
    sources,
    meetings: rows,
    agendaDocuments: [...documents.values()],
  };
  let validation: ProposedSnapshot["validation"];
  try {
    validateSnapshot(snapshot);
    validation = { ok: true };
  } catch (error) {
    validation = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  return { version: READER_PROJECTION_VERSION, snapshot, changes, validation, sourcesAdded };
}

export type ReaderAgendaState = "LINK" | "DOCUMENT" | "PUBLISHER_SLOT_EMPTY" | "NOT_CARRIED_OUR_GAP";

/** What the Reader would show for one change, in its own vocabulary. */
export interface ReaderRendering {
  readonly meetingId: string;
  readonly body: string;
  readonly title: string;
  readonly jurisdiction: string;
  /** `formatMeetingTime` on the projected meeting — the honest line for a DAY-precision row. */
  readonly time: string;
  readonly timeZone: string;
  readonly startsAt: string;
  readonly where: string;
  readonly agenda: ReaderAgendaState;
  readonly agendaUrl: string | null;
  readonly source: string | null;
  readonly publishedBy: string;
  readonly status: Meeting["status"];
  /** Fields the projection leaves honestly unknown. */
  readonly missing: readonly string[];
}

export function readerRendering(change: ReaderChange): ReaderRendering {
  const m = change.after;
  const missing: string[] = [];
  if (m.location === null && !m.online) missing.push("a place or an online access");
  if (m.agendaUrl === null) missing.push("an agenda link");
  if (m.provenance.sourceUrl === null) missing.push("a source page");
  let time: string;
  try { time = formatMeetingTime(m); } catch { time = "unrenderable"; missing.push("a renderable clock"); }
  const agenda: ReaderAgendaState = change.agendaDocument !== null ? "DOCUMENT" : m.agendaUrl !== null ? "LINK" : m.agendaSlotObservedEmpty ? "PUBLISHER_SLOT_EMPTY" : "NOT_CARRIED_OUR_GAP";
  return {
    meetingId: m.id, body: m.bodyName, title: m.title, jurisdiction: m.jurisdiction, time, timeZone: m.timeZone, startsAt: m.startsAt,
    where: m.location ? `${m.location.name}${m.location.address ? `, ${m.location.address}` : ""}` : m.online ? `online: ${m.online.label}${m.online.joinUrl ? ` (${m.online.joinUrl})` : " (no join link published)"}` : "(nowhere a reader could attend)",
    agenda, agendaUrl: m.agendaUrl, source: m.provenance.sourceUrl, publishedBy: m.provenance.sourceOrg, status: m.status, missing,
  };
}

/** One line per change, for a digest or a canary report. */
export function projectionLines(proposal: ProposedSnapshot): string[] {
  const out = [
    `  reader projection  ${proposal.changes.length} change(s): ${proposal.changes.filter((c) => c.kind === "ADD").length} add, ${proposal.changes.filter((c) => c.kind === "REPLACE").length} replace, ${proposal.changes.filter((c) => c.kind === "UNCHANGED").length} unchanged; ` +
      `validateSnapshot ${proposal.validation.ok ? "accepts" : `REFUSES: ${proposal.validation.error}`}; ${proposal.snapshot.meetings.length} meeting(s) after`,
  ];
  for (const change of proposal.changes) {
    const r = readerRendering(change);
    out.push(`      ${change.kind} ${change.recordClass} ${r.meetingId}: ${r.body} — ${r.time} ${r.startsAt.slice(0, 10)} at ${r.where}; agenda ${r.agenda}${change.changedFields.length ? `; fields ${change.changedFields.join(",")}` : ""}`);
  }
  return out;
}
