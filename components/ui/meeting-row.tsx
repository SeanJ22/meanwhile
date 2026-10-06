"use client";

import { agendaSentenceFor } from "@/lib/ask/agenda-sentence";
import type { ReactNode } from "react";
import type { Meeting } from "@/lib/sources/types";
import type { EvidenceRecord } from "@/lib/ask/evidence";
import { formatMeetingDate, formatMeetingTime, formatRelativeDay, locationLine, meetingEntryTitle, meetingSubline } from "@/lib/map/format";
import { onlineAccessFor, venueGapOf, statedVenueText, venueGapLine } from "@/lib/meetings/online";
import { meetingCardSources } from "@/lib/officials/card-sources";
import { venueLink } from "@/lib/registry/links";
import { WorkingOnIt } from "@/components/demand/working-on-it";
import { CalendarLinks } from "@/components/map/popup/calendar-links";
import { MeetingStatusPill } from "@/components/map/meeting-status-pill";
import { CardSourcesContribution } from "./card-sources-contribution";
import { CheckedLink } from "./checked-link";

interface RowOptions {
  compact?: boolean;
  title?: string;
  bodyShown?: boolean;
  jurisdiction?: ReactNode;
  nearby?: boolean;
  distance?: string | null;
  onOpen?: (meeting: Meeting) => void;
  children?: ReactNode;
  /** A containing card/list assembles these exact rows once in its Sources. */
  sourcesInParent?: boolean;
}
type RowProps = RowOptions & ({ meeting: Meeting; record?: never } | { record: EvidenceRecord; meeting?: never });

/** One meeting row on map, popup, doors and Ask; missing facts are never inferred. */
export function MeetingRow(props: RowProps) {
  const { compact = false, children, sourcesInParent = false } = props;
  if (props.record) {
    const record = props.record;
    return <div data-meeting-row data-meeting-id={record.meetingId ?? record.id} className="t-detail leading-relaxed">
      <p>{record.text}</p>
      <CardSourcesContribution id={`ask-meeting:${record.kind}:${record.id}`} sources={[{ what: "Held meeting or agenda record", provenance: {
        sourceUrl: record.sourceUrl ?? "", sourceOrg: record.sourceOrg ?? "", collectedAt: record.retrievedAt ?? "", verifiedAt: null,
      } }]} />
      {children}
    </div>;
  }
  const { meeting, title = meetingEntryTitle(meeting, { bodyShown: props.bodyShown ?? false }), jurisdiction, nearby, distance, onOpen } = props;
  const access = onlineAccessFor(meeting);
  const agendaState = agendaSentenceFor(meeting);
  const gap = venueGapOf(meeting);
  const where = meeting.location ? "physical" : access ? "online" : gap ? statedVenueText(gap) !== null ? "stated" : "not-stated" : "unrecorded";
  const directions = meeting.location && meeting.status !== "CONCLUDED" ? venueLink(meeting.location) : null;
  const body = meeting.bodyId ? { type: "BODY" as const, id: meeting.bodyId } : null;
  return <article data-meeting-row data-meeting-id={meeting.id} className={compact ? "py-2 t-detail leading-relaxed" : "px-5 pb-5 pt-4 t-body leading-relaxed"}>
    <h3 className="font-display t-heading font-semibold text-paper">
      {onOpen ? <button type="button" className="text-left hover:text-signal" onClick={() => onOpen(meeting)}>{title}</button> : title}
    </h3>
    {meetingSubline(meeting) && <p className="mt-1 text-paper-dim">{meetingSubline(meeting)}</p>}
    {jurisdiction && <div className="mt-2">{jurisdiction}</div>}
    <p className="mt-2 flex flex-wrap items-baseline gap-2 font-mono tabular-nums">
      {meeting.status === "CANCELED" && <MeetingStatusPill status="canceled" />}
      {meeting.status === "CONCLUDED" && <MeetingStatusPill status="concluded" />}
      {nearby && <span data-meeting-nearby className="text-muted">Nearby</span>}
      <span>{formatMeetingDate(meeting)}</span><span>{formatMeetingTime(meeting)}</span>
      {distance && <span className="text-muted">{distance}</span>}
    </p>
    {!compact && <p className="t-caption text-muted">{formatRelativeDay(meeting.startsAt)}</p>}
    <div className="mt-2 t-detail text-muted" data-meeting-where={where}>
      {meeting.location ? <>{locationLine(meeting.location.name, meeting.location.address)}{directions && <> · <CheckedLink href={directions.url} target="_blank" rel="noreferrer" className="text-link underline">Directions</CheckedLink></>}</>
        : access ? <><MeetingStatusPill status="online" /> {access.label}{access.joinUrl ? <> · <CheckedLink href={access.joinUrl} target="_blank" rel="noreferrer" className="text-link underline">Join online</CheckedLink></> : <> · <WorkingOnIt inline subject={body} /></>}</>
          : gap && statedVenueText(gap) !== null ? venueGapLine(gap) : <WorkingOnIt inline subject={body} state={gap?.kind === "NOT_STATED_BY_PUBLISHER" ? { kind: "not-published", item: "Meeting place" } : undefined} />}
    </div>
    <div className="mt-2 flex flex-wrap items-baseline gap-2 t-detail">
      {meeting.agendaUrl ? <CheckedLink href={meeting.agendaUrl} target="_blank" rel="noreferrer" className="text-link underline">Read the agenda</CheckedLink>
        : <WorkingOnIt inline subject={body} state={agendaState.whose === "THEIRS" ? { kind: "not-published", item: "Agenda" } : undefined} />}
      {meeting.status === "CONCLUDED" && meeting.videoUrl && <CheckedLink href={meeting.videoUrl} target="_blank" rel="noreferrer" className="text-link underline">Watch the recording</CheckedLink>}
    </div>
    {!compact && meeting.status === "SCHEDULED" && <CalendarLinks meeting={meeting} />}
    {!sourcesInParent && <CardSourcesContribution id={`meeting:${meeting.id}`} sources={meetingCardSources(meeting, [])} />}
    {children}
  </article>;
}
