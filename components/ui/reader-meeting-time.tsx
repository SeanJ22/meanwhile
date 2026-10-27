"use client";

import { useReaderTimeZone } from "@/hooks/use-reader-time-zone";
import { formatMeetingDate, formatMeetingTime } from "@/lib/map/format";
import type { Meeting } from "@/lib/sources/types";

type Sitting = Pick<Meeting, "startsAt" | "timeZone"> & Partial<Pick<Meeting, "startPrecision">>;

export function ReaderMeetingDate({ meeting }: { meeting: Sitting }) {
  const zone = useReaderTimeZone();
  return <time dateTime={meeting.startsAt}>{zone ? formatMeetingDate(meeting, zone) : ""}</time>;
}

export function ReaderMeetingTime({ meeting }: { meeting: Sitting }) {
  const zone = useReaderTimeZone();
  return <time dateTime={meeting.startsAt}>{zone ? formatMeetingTime(meeting, zone) : ""}</time>;
}
