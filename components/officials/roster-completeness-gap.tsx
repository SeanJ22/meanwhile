import type { RosterReaderGap } from "@/lib/registry/body-rosters";
import { CardSourcesContribution } from "@/components/ui/card-sources-contribution";

/** A partial verified roster remains useful; the unresolved identity stays explicit. */
export function RosterCompletenessGaps({ gaps }: { gaps: readonly RosterReaderGap[] }) {
  return <>{gaps.map(gap => <div key={gap.bodyId} data-roster-completeness-gap={gap.bodyId}
    data-verified-members={gap.verifiedMembers} data-expected-members={gap.expectedMembers}
    className="my-2 space-y-1 t-detail leading-relaxed text-muted">
    <p>{gap.statement}</p>
    <CardSourcesContribution id={`roster-gap:${gap.bodyId}`} sources={[{ what: "Roster member identities", provenance: { sourceUrl: gap.sourceUrl, sourceOrg: gap.sourceOrg, collectedAt: gap.readAt, verifiedAt: null } }]} />
  </div>)}</>;
}
