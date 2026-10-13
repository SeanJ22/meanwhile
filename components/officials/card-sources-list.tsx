import { CheckedLink } from "@/components/ui/checked-link";
import type { CardSource } from "@/lib/officials/card-sources";

import { PopupRow } from "@/components/map/popup/popup-row";

/**
 * A card's source list, for the division card's Sources tab and the person
 * card's Sources section. Only held metadata renders.
 */
export function CardSourcesList({ sources }: { sources: CardSource[] }) {
  return (
    <div data-source-list>
      {sources.map((entry, i) => (
        <div key={`${entry.what}-${i}`} className="account-modal-person" {...entry.dataAttrs}>
          <p className="t-body text-paper">{entry.what}</p>
          {entry.provenance.secondHand && <p className="t-caption text-muted">Second-hand listing</p>}

          <PopupRow label="Published by">
            {entry.provenance.sourceOrg}
          </PopupRow>

          <PopupRow label="Read from">
            {entry.provenance.sourceUrl && (
              <CheckedLink
                href={entry.provenance.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-link hover:underline"
              >
                {hostOf(entry.provenance.sourceUrl)}
              </CheckedLink>
            )}
          </PopupRow>

          {[...new Set((entry.details ?? [entry]).map(detail => detail.provenance.quote).filter(Boolean))].map(quote => (
            <p key={quote} className="t-body text-muted">“{quote}”</p>
          ))}

          <PopupRow label="Last checked" mono>
            {entry.provenance.collectedAt?.slice(0, 10)}
          </PopupRow>

          <PopupRow label="Verified" mono>{entry.provenance.verifiedAt?.slice(0, 10)}</PopupRow>
          {entry.details?.filter(detail => detail.dataAttrs || detail.status).map((detail, index) => (
            <div key={index} {...detail.dataAttrs}>
              <p className="t-caption text-muted">{detail.what}</p>
              {detail.provenance.collectedAt !== entry.provenance.collectedAt && (
                <PopupRow label="Last checked" mono>{detail.provenance.collectedAt?.slice(0, 10)}</PopupRow>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
