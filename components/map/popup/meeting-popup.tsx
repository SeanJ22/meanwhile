"use client";

import { ExternalLink } from "lucide-react";

import {
  formatMeetingDate,
  formatMeetingTime,
  formatRelativeDay,
  shortOcdId,
} from "@/lib/map/format";
import { tierForOcdId } from "@/lib/ocd/tiers";
import type { SeatHolder } from "@/lib/officials/lookup";
import type { Meeting } from "@/lib/sources/types";

import {
  Copyable,
  NoValue,
  PopupCard,
  PopupRow,
  PopupSectionLabel,
  type PopupBadge,
} from "./popup-card";

/**
 * One sitting of one body.
 *
 * Times render through `lib/map/format.ts`, which formats in the **meeting's**
 * zone rather than the reader's — someone checking a Tucson agenda from
 * Philadelphia needs the time they will be expected in the room. The instant
 * itself was built by `lib/time/zoned.ts` at ingest, which is DST-tested.
 * Neither is reimplemented here.
 */

const STATUS_BADGE: Record<Meeting["status"], PopupBadge | null> = {
  SCHEDULED: null,
  CONCLUDED: { label: "Concluded", status: "CONCLUDED" },
  CANCELED: { label: "Canceled", status: "CANCELED" },
};

interface MeetingPopupProps {
  meeting: Meeting;
  /**
   * People sourced as sitting on **this body**.
   *
   * Empty today for every body: officeholders exist for legislative divisions
   * (Congress, state chambers) and a county board or school board is neither.
   * That is tier 3, the curated local seed, and it has not been built.
   *
   * **The federal and state people we do hold must not be shown here.** A US
   * Representative does not sit on the Pima County Board, and putting them
   * under this heading because they share an OCD-ID would be exactly the
   * unsourced attribution CLAUDE.md line 17 forbids.
   */
  representation?: SeatHolder[];
  onExpand?: () => void;
  onClose?: () => void;
}

export function MeetingPopup({
  meeting,
  representation = [],
  onExpand,
  onClose,
}: MeetingPopupProps) {
  const tier = tierForOcdId(meeting.ocdId) ?? "local";
  const badge = STATUS_BADGE[meeting.status];

  return (
    <PopupCard
      type={meeting.jurisdiction}
      tier={tier}
      title={meeting.title}
      copyTitle={meeting.title}
      badges={badge ? [badge] : []}
      onExpand={onExpand}
      onClose={onClose}
    >
      <PopupRow label="Body">{meeting.bodyName}</PopupRow>

      <PopupRow label="Date">
        {formatMeetingDate(meeting)}
        <span className="ml-1.5 text-muted">
          {formatRelativeDay(meeting.startsAt)}
        </span>
      </PopupRow>

      <PopupRow label="Time" mono>
        {formatMeetingTime(meeting)}
      </PopupRow>

      <PopupRow label="Location">
        <Copyable text={meeting.location.address ?? meeting.location.name}>
          {meeting.location.name}
        </Copyable>
      </PopupRow>

      <PopupRow label="Status">{STATUS_LABEL[meeting.status]}</PopupRow>

      <PopupRow label="Agenda">
        {meeting.agendaUrl ? (
          <a
            href={meeting.agendaUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-baseline gap-1 text-signal hover:underline"
          >
            Open
            <ExternalLink className="size-3 translate-y-0.5" />
          </a>
        ) : (
          // Never a constructed link. 4.5.3 nulled the fabricated fixture URLs
          // for exactly this reason, and a plausible fake is worse than a blank
          // because nothing surfaces it until a reader clicks.
          <NoValue>no agenda posted yet</NoValue>
        )}
      </PopupRow>

      <PopupSectionLabel>Representation</PopupSectionLabel>
      {representation.length > 0 ? (
        representation.map((holder) => (
          <PopupRow key={holder.id} label={holder.officeTitle}>
            {holder.name}
          </PopupRow>
        ))
      ) : (
        <p className="mt-1.5 text-[0.6875rem] leading-relaxed text-muted">
          We haven&apos;t sourced who sits on this body yet. The people we hold
          for this area represent it in Congress and the state legislature, which
          is a different thing — they are on the district card, not here.
        </p>
      )}

      <PopupSectionLabel>Notes</PopupSectionLabel>
      <p className="mt-1.5 text-[0.6875rem] leading-relaxed text-muted">
        Notes arrive in Phase 7. They stay on this device — never synced, never
        shown to another reader.
      </p>
    </PopupCard>
  );
}

const STATUS_LABEL: Record<Meeting["status"], string> = {
  SCHEDULED: "Scheduled",
  CONCLUDED: "Concluded",
  CANCELED: "Canceled",
};

/** The OCD-ID row, shared with the district popup. Mono, and copyable. */
export function OcdIdRow({ ocdId }: { ocdId: string }) {
  return (
    <PopupRow label="OCD-ID" mono>
      <Copyable text={ocdId}>{shortOcdId(ocdId)}</Copyable>
    </PopupRow>
  );
}
