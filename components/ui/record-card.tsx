"use client";
import { ReaderText } from "@/components/ui/reader-text";
import type { PublicRecord } from "@/lib/civic-data/types";
import { Card } from "./card";

/** Captured-at is the source read date, so it lives inside Sources. */
export function RecordCard({ record }: { record: PublicRecord }) {
  return <Card title={record.title} eyebrow={record.kindLabel} attrs={{ "data-public-record": record.id }} sources={[{
    what: record.kindLabel, dataAttrs: { "data-public-record-source": record.id },
    provenance: { sourceUrl: record.sourceUrl, sourceOrg: "", collectedAt: record.capturedAt, verifiedAt: null },
  }]}><p><ReaderText text={record.sourceSentence} names={[record.title]} /></p></Card>;
}
