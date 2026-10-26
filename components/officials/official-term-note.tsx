import type { SeatHolder } from "@/lib/officials/lookup";
import { CardSourcesContribution } from "@/components/ui/card-sources-contribution";
import { ReaderText } from "@/components/ui/reader-text";

/** The same sourced wording on official and explicitly linked candidate cards. */
export function OfficialTermNote({ holder }: { holder: SeatHolder }) {
  if (!holder.termNote?.trim()) return null;
  const note = holder.termNote.trim().replace(/^Elected\s+(?=(?:January|February|March|April|May|June|July|August|September|October|November|December)\b)/i, "Elected in ").replace(/[.\s]+$/, "");
  const endYear = holder.termEnd?.match(/^(\d{4})-\d{2}-\d{2}(?:T|$)/)?.[1];
  const sentence = `${note}${endYear && !note.includes(endYear) ? `, through ${endYear}` : ""}.`;
  return (
    <div data-official-term-note={holder.id} className="my-2 space-y-1 t-detail leading-relaxed text-paper-dim">
      <p><ReaderText text={sentence} names={holder.name ? [holder.name] : []} /></p>
      {(holder.fieldSources?.termNote || holder.provenance || holder.sourceUrl) && <CardSourcesContribution id={`term:${holder.id}`} sources={[{ what: "Their term in office", provenance: holder.fieldSources?.termNote ?? (holder.provenance ? { ...holder.provenance, sourceUrl: holder.sourceUrl ?? holder.provenance.sourceUrl } : { sourceUrl: holder.sourceUrl, sourceOrg: "", collectedAt: "", verifiedAt: null }) }]} />}
    </div>
  );
}
