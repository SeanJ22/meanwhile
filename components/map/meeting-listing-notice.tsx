import { CardSourcesContribution } from "@/components/ui/card-sources-contribution";
import type { MeetingListingMultiplicityGroup } from "@/lib/meetings/listing-identity";

/** The same unresolved identity explanation travels with the calendar counts
 * and with each source listing. Every native source remains independently openable. */
export function MeetingListingNotice({ groups }: { groups: readonly MeetingListingMultiplicityGroup[] }) {
  if (groups.length === 0) return null;
  const reasons = [...new Set(groups.map((group) => group.reason))];
  return <div className="my-2 t-caption leading-relaxed text-muted" data-meeting-listing-identity="UNRESOLVED_MULTIPLICITY">
    {reasons.map((reason) => <p key={reason}>{reason}</p>)}
    <ul className="mt-1 space-y-1">
      {groups.map((group, groupIndex) => <li key={group.sourceIds.join("|")} data-meeting-listing-group={group.sourceIds.join("|")}>
        <span className="text-paper-dim">Unresolved listing group {groupIndex + 1}:</span>{" "}
        {group.sources.map((source, sourceIndex) => <div key={source.id}>
          {sourceIndex > 0 && " · "}<span data-calendar-listing-source={source.id}>Calendar listing {sourceIndex + 1}</span><CardSourcesContribution id={`calendar-listing:${source.id}`} sources={[{ what: "Unresolved calendar listing", provenance: source }]} />
        </div>)}
      </li>)}
    </ul>
  </div>;
}
