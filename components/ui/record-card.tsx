"use client";
import type { PublicRecord } from "@/lib/civic-data/types";
import { Card } from "./card";

/** Captured-at is the source read date, so it lives inside Sources. */
export function RecordCard({ record }: { record: PublicRecord }) {
  return <Card title={record.title} eyebrow={record.kindLabel} attrs={{ "data-public-record": record.id }} sources={[{
    what: record.kindLabel, dataAttrs: { "data-public-record-source": record.id },
    provenance: { sourceUrl: record.sourceUrl, sourceOrg: "Public record", collectedAt: record.capturedAt, verifiedAt: null },
  }]}><p>{record.sourceSentence}</p></Card>;
}
