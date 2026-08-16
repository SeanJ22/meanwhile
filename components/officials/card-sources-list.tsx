import type { CardSource } from "@/lib/officials/card-sources";

import { NoValue, PopupRow } from "@/components/map/popup/popup-card";

/**
 * The rendered form of a card's source list — ONE component, for the
 * division card's Sources tab and the person card's Sources section alike
 * (item 1, 2026-08-16).
 *
 * A null `sourceUrl` renders as such rather than being hidden: a source list
 * that quietly omits its unsourced rows is a worse lie than no source list,
 * because it implies everything shown was cited.
 *
 * The caller states the count from the SAME array it passes here, so the
 * stated N and the rendered rows are the same number by construction.
 */
export function CardSourcesList({ sources }: { sources: CardSource[] }) {
  return (
    <>
      {sources.map((entry, i) => (
        <div key={`${entry.what}-${i}`} className="account-modal-person">
          <p className="text-[0.8125rem] text-paper">{entry.what}</p>

          <PopupRow label="Published by">
            {entry.provenance.sourceOrg || <NoValue />}
          </PopupRow>

          <PopupRow label="Read from">
            {entry.provenance.sourceUrl ? (
              <a
                href={entry.provenance.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-link hover:underline"
              >
                {hostOf(entry.provenance.sourceUrl)}
              </a>
            ) : (
              <NoValue>no published page</NoValue>
            )}
          </PopupRow>

          <PopupRow label="Collected" mono>
            {entry.provenance.collectedAt ? (
              entry.provenance.collectedAt.slice(0, 10)
            ) : (
              <NoValue />
            )}
          </PopupRow>

          <PopupRow label="Verified" mono>
            {entry.provenance.verifiedAt ? (
              entry.provenance.verifiedAt.slice(0, 10)
            ) : (
              // Null means no human has confirmed this against the source. It
              // is the normal state and says so, rather than reading as a gap.
              <NoValue>not yet</NoValue>
            )}
          </PopupRow>
        </div>
      ))}
    </>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
