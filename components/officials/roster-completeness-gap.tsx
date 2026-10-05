import type { RosterReaderGap } from "@/lib/registry/body-rosters";
import { formatDateMDY } from "@/lib/map/format";

/** A partial verified roster remains useful; the unresolved identity stays explicit. */
export function RosterCompletenessGaps({ gaps }: { gaps: readonly RosterReaderGap[] }) {
  return <>{gaps.map(gap => <div key={gap.bodyId} data-roster-completeness-gap={gap.bodyId}
    data-verified-members={gap.verifiedMembers} data-expected-members={gap.expectedMembers}
    className="my-2 space-y-1 t-detail leading-relaxed text-muted">
    <p>{gap.statement}</p>
    <p className="t-caption"><a href={gap.sourceUrl} target="_blank" rel="noreferrer noopener" className="text-link underline decoration-dotted underline-offset-2">{gap.sourceOrg}</a> · Read {formatDateMDY(gap.readAt.slice(0, 10))}</p>
  </div>)}</>;
}
