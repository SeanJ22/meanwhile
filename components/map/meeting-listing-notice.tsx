import type { MeetingListingMultiplicityGroup } from "@/lib/meetings/listing-identity";

/** The same unresolved identity explanation travels with the calendar counts
 * and with each source listing. Every native source remains independently openable. */
export function MeetingListingNotice({ groups }: { groups: readonly MeetingListingMultiplicityGroup[] }) {
  if (groups.length === 0) return null;
  return <div className="my-2 text-[0.6875rem] leading-relaxed text-muted" data-meeting-listing-identity="UNRESOLVED_MULTIPLICITY">
    {groups.map(group => <div key={group.sourceIds.join("|")} className="mt-1">
      <p>{group.reason}</p>
      <p>{group.sources.map((source, index) => <span key={source.id}>
        {index > 0 && " · "}{source.sourceUrl ? <a href={source.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline" data-calendar-listing-source={source.id}>Calendar listing {index + 1}</a> : <span data-calendar-listing-source={source.id}>Calendar listing {index + 1} — source link unavailable</span>}
      </span>)}</p>
    </div>)}
  </div>;
}
