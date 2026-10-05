import type { SeatHolder } from "@/lib/officials/lookup";
import { formatDateMDY } from "@/lib/map/format";

/** The same sourced wording on official and explicitly linked candidate cards. */
export function OfficialTermNote({ holder }: { holder: SeatHolder }) {
  if (!holder.termNote) return null;
  return (
    <div data-official-term-note={holder.id} className="my-2 space-y-1 t-detail leading-relaxed text-paper-dim">
      <p>Roster term or appointment note: “{holder.termNote}”</p>
      <p className="t-caption text-muted">
        {holder.sourceUrl ? <a href={holder.sourceUrl} target="_blank" rel="noreferrer noopener" className="text-link underline decoration-dotted underline-offset-2">{holder.provenance?.sourceOrg ?? "Published roster"}</a> : holder.provenance?.sourceOrg}
        {holder.provenance?.collectedAt && <> · Read {formatDateMDY(holder.provenance.collectedAt.slice(0, 10))}</>}
      </p>
    </div>
  );
}
