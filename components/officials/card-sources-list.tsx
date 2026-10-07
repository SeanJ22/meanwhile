import { CheckedLink } from "@/components/ui/checked-link";
import type { CardSource } from "@/lib/officials/card-sources";
import { verificationOf, provenanceKind, PROVENANCE_KIND_LABELS } from "@/lib/officials/verification";

import { NoValue, PopupRow } from "@/components/map/popup/popup-row";

/**
 * A card's source list, for the division card's Sources tab and the person
 * card's Sources section. A null `sourceUrl` renders as such. The caller
 * states the count from the same array.
 */
export function CardSourcesList({ sources }: { sources: CardSource[] }) {
  return (
    <div data-card-sources>
      {sources.map((entry, i) => (
        <div key={`${entry.what}-${i}`} className="account-modal-person" {...entry.dataAttrs}>
          <p className="t-body text-paper">{entry.status ? entry.what : `${PROVENANCE_KIND_LABELS[provenanceKind(entry.provenance)]} · ${entry.what}`}</p>
          {entry.provenance.secondHand && <p className="t-caption text-muted">Second-hand listing</p>}

          <PopupRow label="Published by">
            {entry.provenance.sourceOrg || <NoValue />}
          </PopupRow>

          <PopupRow label="Read from">
            {entry.provenance.sourceUrl ? (
              <CheckedLink
                href={entry.provenance.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-link hover:underline"
              >
                {hostOf(entry.provenance.sourceUrl)}
              </CheckedLink>
            ) : (
              <NoValue>no published page</NoValue>
            )}
          </PopupRow>

          {entry.provenance.quote && <p className="t-body text-muted">“{entry.provenance.quote}”</p>}

          <PopupRow label="Last checked" mono>
            {entry.provenance.collectedAt ? (
              entry.provenance.collectedAt.slice(0, 10)
            ) : (
              <NoValue />
            )}
          </PopupRow>

          <VerifiedRow provenance={entry.provenance} />
        </div>
      ))}
    </div>
  );
}

/**
 * The Verified row: a human-confirmed date; or the read date and publisher
 * when the subject's own official source served it; otherwise "not yet".
 */
function VerifiedRow({ provenance }: { provenance: CardSource["provenance"] }) {
  const verification = verificationOf(provenance);
  return (
    <PopupRow label="Verified" mono>
      {verification.kind === "confirmed" && verification.date}
      {verification.kind === "official" && verification.date && (
        <>
          {verification.date}
          <span className="text-muted"> by {verification.by}</span>
        </>
      )}
      {(verification.kind === "unverified" || !verification.date) && <NoValue>not yet</NoValue>}
    </PopupRow>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
