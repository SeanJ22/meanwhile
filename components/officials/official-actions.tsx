"use client";

import { useEffect, useState } from "react";
import type { ReaderOfficialActions } from "@/lib/officials/reader-actions";
import { CardSourcesContribution } from "@/components/ui/card-sources-contribution";
import { WorkingOnIt } from "@/components/demand/working-on-it";
import { CardSection } from "./card-section";

export function OfficialActions({ subjectId }: { subjectId: string }) {
  return <ActionsForIdentity key={subjectId} subjectId={subjectId} />;
}

function ActionsForIdentity({ subjectId }: { subjectId: string }) {
  const [answer, setAnswer] = useState<ReaderOfficialActions | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/official-actions/${encodeURIComponent(subjectId)}`, { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error(String(response.status)); return response.json() as Promise<ReaderOfficialActions>; })
      .then(payload => { if (payload.subjectId === subjectId) setAnswer(payload); })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [subjectId]);
  if (failed) return <CardSection title="Official actions"><WorkingOnIt subject={{ type: "CANDIDATE", id: subjectId }} /></CardSection>;
  if (!answer || (!answer.count && answer.status !== "IDENTITY_UNRESOLVED")) return null;
  return <CardSection title="Official actions"><OfficialActionsContent answer={answer} /></CardSection>;
}

/** Shared actual leaf for map, ballot, and exhaustive census render proof. */
export function OfficialActionsContent({ answer }: { answer: ReaderOfficialActions }) {
  return <div data-official-actions-subject={answer.subjectId} data-official-actions-target={answer.resolvedTargetId} data-official-actions-count={answer.count} className="space-y-3 t-body">
    {answer.status === "IDENTITY_UNRESOLVED" && <WorkingOnIt subject={{ type: "CANDIDATE", id: answer.subjectId }} />}
    {answer.count > 0 && <p>{answer.count} published action records held.</p>}
    <ol className="max-h-96 space-y-4 overflow-y-auto overscroll-contain">
      {answer.records.map(record => <li key={record.id} data-official-action-id={record.id} data-official-id={record.officialId}>
        <p>{record.text}</p>

      </li>)}
    </ol>
    <CardSourcesContribution id={`actions:${answer.subjectId}`} sources={answer.records.flatMap(record => [record.sourceUrl, record.documentUrl].filter((url): url is string => Boolean(url)).map(sourceUrl => ({ what: "Official action records", provenance: { sourceUrl, sourceOrg: record.sourceOrg, collectedAt: record.collectedAt, verifiedAt: null } })))} />
  </div>;
}
