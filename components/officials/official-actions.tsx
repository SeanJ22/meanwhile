"use client";

import { useEffect, useState } from "react";
import type { ReaderOfficialActions } from "@/lib/officials/reader-actions";
import { CardSourcesContribution } from "@/components/ui/card-sources-contribution";
import { CardGapContribution } from "@/components/ui/card-gap-context";
import { CardSection } from "./card-section";

type ActionContext = { zip?: string | null; lat?: number | null; lng?: number | null } | null;

/** `gapWhenEmpty` is false for an office whose actions are its votes and bills: nothing is missing when none are held here. */
export function OfficialActions({ subjectId, divisionIds = [], context, gapWhenEmpty = true }: { subjectId: string; divisionIds?: readonly string[]; context?: ActionContext; gapWhenEmpty?: boolean }) {
  return <ActionsForIdentity key={subjectId} subjectId={subjectId} divisionIds={divisionIds} context={context} gapWhenEmpty={gapWhenEmpty} />;
}

function ActionsForIdentity({ subjectId, divisionIds, context, gapWhenEmpty }: { subjectId: string; divisionIds: readonly string[]; context?: ActionContext; gapWhenEmpty: boolean }) {
  const query = new URLSearchParams([
    ...divisionIds.map(id => ["division", id]),
    ...(context?.zip ? [["zip", context.zip]] : []),
    ...(context?.lat != null && context?.lng != null ? [["lat", String(context.lat)], ["lng", String(context.lng)]] : []),
  ]).toString();
  const [answer, setAnswer] = useState<ReaderOfficialActions | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/official-actions/${encodeURIComponent(subjectId)}?${query}`, { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error(String(response.status)); return response.json() as Promise<ReaderOfficialActions>; })
      .then(payload => { if (payload.subjectId === subjectId) setAnswer(payload); })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [subjectId, query]);
  if (failed || (answer && !answer.count)) return gapWhenEmpty ? <CardGapContribution id={`actions:${subjectId}`} label="official actions" subject={{ type: "CANDIDATE", id: subjectId }} /> : null;
  if (!answer) return null;
  return <CardSection title="Official actions"><OfficialActionsContent answer={answer} /></CardSection>;
}

/** Shared actual leaf for map, ballot, and exhaustive census render proof. */
export function OfficialActionsContent({ answer }: { answer: ReaderOfficialActions }) {
  if (!answer.count) return <CardGapContribution id={`actions:${answer.subjectId}`} label="official actions" subject={{ type: "CANDIDATE", id: answer.subjectId }} />;
  return <div data-official-actions-subject={answer.subjectId} data-official-actions-target={answer.resolvedTargetId} data-official-actions-count={answer.count} className="space-y-3 t-body">
    {answer.count > 0 && <p>{answer.count} published action records held.</p>}
    <ol className="max-h-96 space-y-4 overflow-y-auto overscroll-contain">
      {answer.records.map(record => <li key={record.id} data-official-action-id={record.id} data-official-id={record.officialId}>
        <p>{record.text}</p>

      </li>)}
    </ol>
    <CardSourcesContribution id={`actions:${answer.subjectId}`} sources={answer.records.flatMap(record => [record.sourceUrl, record.documentUrl].filter((url): url is string => Boolean(url)).map(sourceUrl => ({ what: "Official action records", provenance: { sourceUrl, sourceOrg: record.sourceOrg, collectedAt: record.collectedAt, verifiedAt: null } })))} />
  </div>;
}
