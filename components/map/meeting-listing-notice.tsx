import type { MeetingListingMultiplicityGroup } from "@/lib/meetings/listing-identity";
import type { MeetingListing } from "@/lib/sources/types";

/**
 * A sitting its publishers listed more than once, shown as the one sitting it
 * is (`collapseDuplicateSittings`). Every listing it stands for stays named and
 * independently openable, so the merge hides no source.
 */
export function MergedListingsNotice({ listings }: { listings?: readonly MeetingListing[] }) {
  if (!listings || listings.length < 2) return null;
  return <p className="my-2 text-[0.6875rem] leading-relaxed text-muted" data-meeting-listings={listings.length}>
    Listed {listings.length} times in the calendars we read and shown here once:{" "}
    {listings.map((listing, index) => <span key={listing.id}>
      {index > 0 && " · "}
      {listing.provenance.sourceUrl
        ? <a href={listing.provenance.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline" data-calendar-listing-source={listing.id}>{listing.provenance.sourceOrg} listing {index + 1}</a>
        : <span data-calendar-listing-source={listing.id}>{listing.provenance.sourceOrg} listing {index + 1} — source link unavailable</span>}
    </span>)}
  </p>;
}

/** The same unresolved identity explanation travels with the calendar counts
 * and with each source listing. Every native source remains independently openable. */
export function MeetingListingNotice({ groups }: { groups: readonly MeetingListingMultiplicityGroup[] }) {
  if (groups.length === 0) return null;
  const reasons = [...new Set(groups.map((group) => group.reason))];
  return <div className="my-2 text-[0.6875rem] leading-relaxed text-muted" data-meeting-listing-identity="UNRESOLVED_MULTIPLICITY">
    {reasons.map((reason) => <p key={reason}>{reason}</p>)}
    <ul className="mt-1 space-y-1">
      {groups.map((group, groupIndex) => <li key={group.sourceIds.join("|")} data-meeting-listing-group={group.sourceIds.join("|")}>
        <span className="text-paper-dim">Unresolved listing group {groupIndex + 1}:</span>{" "}
        {group.sources.map((source, sourceIndex) => <span key={source.id}>
          {sourceIndex > 0 && " · "}{source.sourceUrl ? <a href={source.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline" data-calendar-listing-source={source.id}>Calendar listing {sourceIndex + 1}</a> : <span data-calendar-listing-source={source.id}>Calendar listing {sourceIndex + 1} — source link unavailable</span>}
        </span>)}
      </li>)}
    </ul>
  </div>;
}
