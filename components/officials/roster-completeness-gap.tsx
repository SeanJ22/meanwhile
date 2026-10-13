import type { RosterReaderGap } from "@/lib/registry/body-rosters";
import type { CardGap } from "@/lib/design/card-gaps";
import { CardGapsContribution } from "@/components/ui/card-gap-context";
import { CardSourcesContribution } from "@/components/ui/card-sources-contribution";

export function rosterCardGaps(gaps: readonly RosterReaderGap[]): CardGap[] {
  return gaps.map(gap => ({ id: `roster:${gap.bodyId}`, label: "member names", count: gap.unresolvedSlots,
    unit: "seat", subject: { type: "BODY", id: gap.bodyId } }));
}

/** Partial rosters keep their members; missing identities join the card's single gap line. */
export function RosterCompletenessGaps({ gaps }: { gaps: readonly RosterReaderGap[] }) {
  return <>
    <CardGapsContribution id="roster-completeness" gaps={rosterCardGaps(gaps)} />
    <CardSourcesContribution id="roster-completeness" sources={gaps.map(gap => ({ what: "Roster member identities", provenance: { sourceUrl: gap.sourceUrl, sourceOrg: gap.sourceOrg, collectedAt: gap.readAt, verifiedAt: null } }))} />
  </>;
}
