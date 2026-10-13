"use client";
import { useEffect, useState } from "react";
import type { PublicRecord } from "@/lib/civic-data/types";
import { publicRecordIssue } from "@/lib/civic-data/public-record-contract";
import { RecordCard } from "@/components/ui/record-card";
import { CardGapContribution } from "@/components/ui/card-gap-context";

export function PublicRecords({ divisionId, records, bodyId }: { divisionId: string; records: readonly PublicRecord[]; bodyId?: string }) {
  const held = records.filter(record => record.ocdId === divisionId && (!bodyId || record.bodyId === bodyId));
  if (!held.length) return null;
  return <section aria-label="Public records" className="flex flex-col gap-3">{held.map(record => <RecordCard key={record.id} record={record} />)}</section>;
}
const requests = new Map<string, Promise<readonly PublicRecord[]>>();
function load(divisionId: string) {
  const existing = requests.get(divisionId);
  if (existing) return existing;
  const pending = fetch(`/api/public-records?division=${encodeURIComponent(divisionId)}`)
    .then(async response => {
      if (!response.ok) throw new Error("Public records unavailable");
      const payload = await response.json() as { division?: string; status?: string; records?: unknown[] };
      if (payload.division !== divisionId || !["HELD", "NOT_HELD"].includes(payload.status ?? "") || !Array.isArray(payload.records)) throw new Error("Public records unavailable");
      return payload.records.filter(record => !publicRecordIssue(record)) as PublicRecord[];
    }).finally(() => { requests.delete(divisionId); });
  requests.set(divisionId, pending);
  return pending;
}
/** Mounted by the actual place/body/district card; late answers never cross places. */
export function PlacePublicRecords({ divisionId, bodyId }: { divisionId: string; bodyId?: string }) {
  const [state, setState] = useState<{ division: string; records: readonly PublicRecord[]; failed: boolean } | null>(null);
  useEffect(() => {
    let active = true;
    void load(divisionId).then(records => { if (active) setState({ division: divisionId, records, failed: false }); })
      .catch(() => { if (active) setState({ division: divisionId, records: [], failed: true }); });
    return () => { active = false; };
  }, [divisionId]);
  if (state?.division !== divisionId) return <p role="status" className="t-body text-muted">Loading public records…</p>;
  if (state.failed) return <p role="status" className="t-body text-muted">Couldn’t load public records just now.</p>;
  const held = state.records.filter(record => record.ocdId === divisionId && (!bodyId || record.bodyId === bodyId));
  return held.length ? <PublicRecords divisionId={divisionId} bodyId={bodyId} records={held} /> : <CardGapContribution id={`public-records:${bodyId ?? divisionId}`} label="public records" subject={bodyId ? { type: "BODY", id: bodyId } : undefined} />;
}
