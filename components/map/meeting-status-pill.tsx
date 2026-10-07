import {
  STATUS_MARK,
  STATUS_QUALIFIER,
  STATUS_WORD,
  type MeetingPillStatus,
} from "@/lib/meetings/status-marks";

/**
 * The one sitting-status pill. Vocabulary lives in
 * `lib/meetings/status-marks.ts`. The icon is decorative; the word and spoken
 * qualifier carry the meaning. Geometry stays in `.meeting-status-pill`.
 */
export function MeetingStatusPill({ status }: { status: MeetingPillStatus }) {
  return (
    <span className="meeting-status-pill" data-status={status}>
      <span aria-hidden="true" className="mr-1 inline-block">
        {STATUS_MARK[status]}
      </span>
      {STATUS_WORD[status]}
      <span className="sr-only">{STATUS_QUALIFIER[status]}</span>
    </span>
  );
}
