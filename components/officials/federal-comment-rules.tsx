"use client";

import { useEffect, useState } from "react";
import { CheckedLink } from "@/components/ui/checked-link";
import { CardGapContribution } from "@/components/ui/card-gap-context";
import { CardSourcesContribution } from "@/components/ui/card-sources-contribution";
import type { FederalRuleRead } from "@/lib/sources/congress/reader";
import { federalCardSources, federalDeadlineDate } from "@/lib/sources/congress/presentation";

export function FederalCommentRules() {
  const [held, setHeld] = useState<FederalRuleRead | null>(null);
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/federal-civic?offset=${offset}`, { signal: controller.signal }).then(response => {
      if (!response.ok) throw new Error("Federal comment periods unavailable");
      return response.json() as Promise<FederalRuleRead>;
    }).then(result => { if (!controller.signal.aborted) setHeld(result); }).catch(() => { /* Keep the visible coverage gap. */ });
    return () => controller.abort();
  }, [offset]);
  if (!held?.rules.length && !(held && Object.values(held.coverage).every(value => value === "PROMOTED"))) {
    return <CardGapContribution id="federal-comment-periods" label="federal comment periods" />;
  }
  return <details className="how-to-be-heard mt-3 pl-4">
    <summary className="trailing-space-trimmed-14 how-to-be-heard-summary font-mono t-caption uppercase tracking-[0.14em] text-paper-dim">Make your voice heard</summary>
    <p className="mt-2 t-detail">Federal rules open for public comment</p>
    {!held.rules.length ? <p className="t-detail text-muted">No open comment periods in the federal records last checked.</p>
      : <ul className="mt-2 space-y-3">{held.rules.map(({ rule, sources }) => <li key={rule.id} className="t-detail">
        <CheckedLink href={rule.sourceUrl} target="_blank" rel="noreferrer" className="text-link hover:underline">{rule.title}</CheckedLink>
        <p>Comments close {federalDeadlineDate(rule)}</p>
        {sources.filter(row => row.closesAt && federalDeadlineDate(row) !== federalDeadlineDate(rule)).map(row => <p key={row.id} className="text-muted">{row.publisher} lists {federalDeadlineDate(row)}.</p>)}
        {rule.commentUrl && <CheckedLink href={rule.commentUrl} target="_blank" rel="noreferrer" className="text-link hover:underline">{rule.commentUrl.includes("regulations.gov/commenton/") ? "Submit a comment" : "How to comment"}</CheckedLink>}
      </li>)}</ul>}
    {held && <div className="mt-3 flex gap-4">
      {offset > 0 && <button type="button" className="text-link" onClick={() => setOffset(Math.max(0, offset - 20))}>Previous comment periods</button>}
      {offset + held.rules.length < held.totalRules && <button type="button" className="text-link" onClick={() => setOffset(offset + 20)}>More comment periods</button>}
    </div>}
    <CardSourcesContribution id="federal-comment-rules" sources={federalCardSources(held?.rules.flatMap(row => row.sources) ?? [])} />
  </details>;
}
