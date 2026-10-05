import type { CardSource } from "@/lib/officials/card-sources";
import { verificationOf } from "@/lib/officials/verification";

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
          <p className="t-body text-paper">{entry.what}</p>

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
    </>
  );
}

/**
 * The Verified row — g3 item 5 (2026-08-16).
 *
 * This row used to say "not yet" for everything a human had not personally
 * re-checked, which on production meant a fact read off the Governor of
 * Arizona's own website sat under the words "Verified: not yet" with the link
 * to that website two rows above it. The rule: **a read from the subject's
 * own official source IS the verification**, by that source, on the date we
 * read it.
 *
 * Three states, and each says exactly what it knows — never more:
 *
 * - a human confirmed it, and the row is that date;
 * - the subject's own official publisher served it, and the row is the read
 *   date and who served it, so the claim is checkable rather than asserted;
 * - nobody has stood behind it yet, and "not yet" is the honest word — now
 *   reserved for the aggregators and third-party pages it was written for.
 *
 * Level register throughout: this is a claim surface, and nothing here is
 * cute about where a fact came from.
 */
function VerifiedRow({ provenance }: { provenance: CardSource["provenance"] }) {
  const verification = verificationOf(provenance);
  return (
    <PopupRow label="Verified" mono>
      {verification.kind === "confirmed" && verification.date}
      {verification.kind === "official" && (
        <>
          {verification.date}
          <span className="text-muted"> by {verification.by}</span>
        </>
      )}
      {verification.kind === "unverified" && <NoValue>not yet</NoValue>}
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
