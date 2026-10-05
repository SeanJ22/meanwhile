"use client";

import { useEffect, useState } from "react";
import type { ReaderOfficialActions } from "@/lib/officials/reader-actions";
import { formatDateLong } from "@/lib/text/format-date";
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
  if (failed) return <CardSection title="Official actions"><p className="t-body">We couldn’t check our official-action records just now.</p></CardSection>;
  if (!answer || (!answer.count && answer.status !== "IDENTITY_UNRESOLVED")) return null;
  return <CardSection title="Official actions"><OfficialActionsContent answer={answer} /></CardSection>;
}

/** Shared actual leaf for map, ballot, and exhaustive census render proof. */
export function OfficialActionsContent({ answer }: { answer: ReaderOfficialActions }) {
  return <div data-official-actions-subject={answer.subjectId} data-official-actions-target={answer.resolvedTargetId} data-official-actions-count={answer.count} className="space-y-3 t-body">
    {answer.status === "IDENTITY_UNRESOLVED" && <p>We haven’t resolved which official these action records belong to.</p>}
    {answer.count > 0 && <p>{answer.count} records in our holdings. This is a partial record of published actions.</p>}
    <ol className="max-h-96 space-y-4 overflow-y-auto overscroll-contain">
      {answer.records.map(record => <li key={record.id} data-official-action-id={record.id} data-official-id={record.officialId}>
        <p>{record.text}</p>
        <p className="mt-1 t-detail text-muted-foreground">
          <a className="underline underline-offset-2" href={record.sourceUrl} target="_blank" rel="noreferrer">{record.sourceOrg}</a>
          {record.documentUrl && <> · <a className="underline underline-offset-2" href={record.documentUrl} target="_blank" rel="noreferrer">Source document</a></>}
          {" · "}Read {formatDateLong(record.collectedAt.slice(0, 10))}.
        </p>
      </li>)}
    </ol>
  </div>;
}
