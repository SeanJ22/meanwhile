"use client";

import type { ReactNode } from "react";
import type { Meeting } from "@/lib/sources/types";
import type { SeatHolder } from "@/lib/officials/lookup";
import { meetingCardSources, type CardSource } from "@/lib/officials/card-sources";
import { meetingEntryTitle } from "@/lib/map/format";
import { tierForMeeting } from "@/lib/state/derive";
import { LevelTag } from "./level-tag";
import { Card } from "./card";
import { MeetingRow } from "./meeting-row";

/** The shared reader Card owns all fetched and held meeting citations. */
export function MeetingCard({ meeting, representation = [], sources = [], children, jurisdiction, onClose, onExpand, title, subtitle, compact = false }:
  { meeting: Meeting; representation?: SeatHolder[]; sources?: CardSource[]; children?: ReactNode; jurisdiction?: ReactNode; onClose?: () => void; onExpand?: () => void; title?: string; subtitle?: string | null; compact?: boolean }) {
  return <Card title={title ?? meetingEntryTitle(meeting, { bodyShown: true })} eyebrow={<>{subtitle ?? meeting.jurisdiction} <LevelTag tier={tierForMeeting(meeting)} /></>} onClose={onClose} sources={[...meetingCardSources(meeting, representation), ...sources]}>
    <div data-meeting-card={meeting.id}>
      <MeetingRow meeting={meeting} title={meeting.bodyName} jurisdiction={jurisdiction} compact={compact} sourcesInParent />
      {children}
      {onExpand && <button type="button" className="mt-2 t-detail text-link underline" onClick={onExpand}>More about this meeting</button>}
    </div>
  </Card>;
}
