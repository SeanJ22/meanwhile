"use client";

import { CheckedLink } from "@/components/ui/checked-link";
import { CardGapContribution } from "@/components/ui/card-gap-context";
import type { CardSource } from "@/lib/officials/card-sources";
import { readerText } from "@/lib/text/reader-names";
import { useReaderTimeZone } from "@/hooks/use-reader-time-zone";
import { useReaderNames } from "@/components/ui/reader-names-context";

import { PopupRow } from "@/components/map/popup/popup-row";

/**
 * A card's source list, for the division card's Sources tab and the person
 * card's Sources section. Only held metadata renders.
 */
export function CardSourcesList({ sources }: { sources: CardSource[] }) {
  const knownNames = useReaderNames();
  const timeZone = useReaderTimeZone();
  if (!sources.length) return <CardGapContribution id="sources" label="sources" />;
  return (
    <div data-source-list>
      {sources.map((entry, i) => (
        <div key={`${entry.what}-${i}`} className="account-modal-person" {...entry.dataAttrs}>
          {[...new Set((entry.details ?? [entry]).filter(detail => !detail.status || !entry.details).map(detail => detail.verbatim ? detail.what : readerText(detail.what, "title")))].map(what => <p key={what} className="t-body text-paper">{what}</p>)}
          {entry.provenance.secondHand && <p className="t-caption text-muted">Reported by another publisher.</p>}

          <PopupRow label="Published by">
            {readerText(entry.provenance.sourceOrg, "title")}
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
            <p key={quote} className="t-body text-voice">“{readerText(quote, "sentence", [...knownNames, entry.provenance.sourceOrg])}”</p>
          ))}

          {[...new Set((entry.details ?? [entry]).map(detail => sourceDate(detail.publishedAt, timeZone)).filter(Boolean))].map(date => <PopupRow key={`published:${date}`} label="Published">{date}</PopupRow>)}
          {[...new Set((entry.details ?? [entry]).map(detail => sourceDate(detail.updatedAt, timeZone)).filter(Boolean))].map(date => <PopupRow key={`updated:${date}`} label="File last updated">{date}</PopupRow>)}

          <PopupRow label="Last checked">
            {sourceDate(entry.provenance.collectedAt, timeZone)}
          </PopupRow>

          <PopupRow label="Confirmed">{sourceDate(entry.provenance.verifiedAt, timeZone) !== sourceDate(entry.provenance.collectedAt, timeZone) ? sourceDate(entry.provenance.verifiedAt, timeZone) : null}</PopupRow>
          {entry.details?.filter(detail => detail.dataAttrs || detail.status).map((detail, index) => (
            <div key={index} {...detail.dataAttrs}>
              {detail.status && <p className="t-caption text-muted">{detail.verbatim ? detail.what : readerText(detail.what, "title")}</p>}
              {detail.provenance.collectedAt !== entry.provenance.collectedAt && (
                <PopupRow label="Last checked">{sourceDate(detail.provenance.collectedAt, timeZone)}</PopupRow>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

const dateFormats = new Map<string, Intl.DateTimeFormat>();
/** Official calendar dates keep their day; instants wait for the reader's zone. */
export function sourceDate(value: string | null | undefined, timeZone: string | null): string | null {
  if (!value) return null;
  const zone = /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? "UTC" : timeZone;
  const time = Date.parse(value);
  if (!zone || !Number.isFinite(time)) return null;
  let format = dateFormats.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: zone });
    dateFormats.set(zone, format);
  }
  return format.format(time);
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
