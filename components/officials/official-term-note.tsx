import type { SeatHolder } from "@/lib/officials/lookup";
import { CardSourcesContribution } from "@/components/ui/card-sources-contribution";
import { ReaderText } from "@/components/ui/reader-text";

/** The same sourced wording on official and explicitly linked candidate cards. */
export function OfficialTermNote({ holder }: { holder: SeatHolder }) {
  if (!holder.termNote) return null;
  return (
    <div data-official-term-note={holder.id} className="my-2 space-y-1 t-detail leading-relaxed text-paper-dim">
      <p>Roster term or appointment note: “<ReaderText text={holder.termNote} names={[holder.name]} />”</p>
      {(holder.provenance || holder.sourceUrl) && <CardSourcesContribution id={`term:${holder.id}`} sources={[{ what: "Roster term or appointment note", provenance: holder.provenance ? { ...holder.provenance, sourceUrl: holder.sourceUrl ?? holder.provenance.sourceUrl } : { sourceUrl: holder.sourceUrl, sourceOrg: "", collectedAt: "", verifiedAt: null } }]} />}
    </div>
  );
}
