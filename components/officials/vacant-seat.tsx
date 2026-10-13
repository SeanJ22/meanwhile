import type { SeatHolder } from "@/lib/officials/lookup";
import { CheckedLink } from "@/components/ui/checked-link";

/** The sourced empty office can be followed to its publisher without opening a person card. */
export function VacantSeat({holder}: {holder: SeatHolder}) {
  return <span>{holder.name}{holder.sourceUrl && <> · <CheckedLink href={holder.sourceUrl} target="_blank" rel="noreferrer" className="text-link underline decoration-dotted">Source ↗</CheckedLink></>}</span>;
}
