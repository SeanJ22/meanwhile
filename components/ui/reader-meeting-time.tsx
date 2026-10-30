import { formatMeetingDate, formatMeetingTime } from "@/lib/map/format";
import type { Meeting } from "@/lib/sources/types";

type Sitting = Pick<Meeting, "startsAt" | "timeZone"> & Partial<Pick<Meeting, "startPrecision">>;

export function ReaderMeetingDate({ meeting }: { meeting: Sitting }) {
  return <time dateTime={meeting.startsAt}>{formatMeetingDate(meeting)}</time>;
}

export function ReaderMeetingTime({ meeting }: { meeting: Sitting }) {
  return <time dateTime={meeting.startsAt}>{formatMeetingTime(meeting)}</time>;
}
