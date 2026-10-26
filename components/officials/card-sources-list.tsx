import { CheckedLink } from "@/components/ui/checked-link";
import { CardGapContribution } from "@/components/ui/card-gap-context";
import type { CardSource } from "@/lib/officials/card-sources";

import { PopupRow } from "@/components/map/popup/popup-row";

/**
 * A card's source list, for the division card's Sources tab and the person
 * card's Sources section. Only held metadata renders.
 */
export function CardSourcesList({ sources }: { sources: CardSource[] }) {
  if (!sources.length) return <CardGapContribution id="sources" label="sources" />;
  return (
    <div data-source-list>
      {sources.map((entry, i) => (
        <div key={`${entry.what}-${i}`} className="account-modal-person" {...entry.dataAttrs}>
          {[...new Set((entry.details ?? [entry]).filter(detail => !detail.status || !entry.details).map(detail => detail.what))].map(what => <p key={what} className="t-body text-paper">{what}</p>)}
          {entry.provenance.secondHand && <p className="t-caption text-muted">Reported by another publisher.</p>}

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

          {[...new Set((entry.details ?? [entry]).flatMap(detail => readableSourceQuotes(detail.provenance.quote)))].map(quote => (
            <p key={quote} className="t-body text-muted">“{quote}”</p>
          ))}

          {[...new Set((entry.details ?? [entry]).map(detail => sourceDate(detail.publishedAt)).filter(Boolean))].map(date => <PopupRow key={`published:${date}`} label="Published">{date}</PopupRow>)}
          {[...new Set((entry.details ?? [entry]).map(detail => sourceDate(detail.updatedAt)).filter(Boolean))].map(date => <PopupRow key={`updated:${date}`} label="File last updated">{date}</PopupRow>)}

          <PopupRow label="Last checked">
            {sourceDate(entry.provenance.collectedAt)}
          </PopupRow>

          <PopupRow label="Confirmed">{sourceDate(entry.provenance.verifiedAt) !== sourceDate(entry.provenance.collectedAt) ? sourceDate(entry.provenance.verifiedAt) : null}</PopupRow>
          {entry.details?.filter(detail => detail.dataAttrs || detail.status).map((detail, index) => (
            <div key={index} {...detail.dataAttrs}>
              {detail.status && <p className="t-caption text-muted">{detail.what}</p>}
              {detail.provenance.collectedAt !== entry.provenance.collectedAt && (
                <PopupRow label="Last checked">{sourceDate(detail.provenance.collectedAt)}</PopupRow>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

const dateFormat = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
function sourceDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? dateFormat.format(time) : null;
}

/** Show exact readable spans from the saved evidence, leaving API syntax in the linked source. */
export function readableSourceQuotes(value: string | undefined): string[] {
  if (!value || /^\s*[\[{]/.test(value)) return [];
  return value.split(/\b\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?\b|\b[A-Za-z0-9+/]{8,}={1,2}(?=\s|$|[,;])|https?:\/\/\S+|\bocd-division\/\S+|\b[0-9a-f]{8}-[0-9a-f-]{27,}\b|\b\w*(?:Id|ID|_id)\s*[:=]\s*\S+|\b(?:OfficeRecord|Person|Body|Event)[A-Z][A-Za-z]*\b(?:\s*[:=]?\s*\d+)?|[\r\n]+/g)
    .map(span => span.replace(/\b[A-Za-z]+(?:[A-Z][a-z]+)+\s*[:=]\s*/g, "").replace(/(?:\s+\d+){2,}\s*$/, "").replace(/^[\s,;:|]+|[\s,;:|]+$/g, "").trim())
    .filter(span => /\p{L}/u.test(span) && !/[{}\[\]]|\b[a-z]+_[a-z_]+\b|\b(?:Ocd Id|Roster term or appointment note|Term start date|Term end date)\b/.test(span));
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
