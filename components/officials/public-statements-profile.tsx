"use client";

import { CardGapContribution } from "@/components/ui/card-gap-context";
import { useEffect, useState } from "react";
import type { PrlReaderProfile } from "@/lib/sources/prl/snapshot";
import { PRL_CATEGORIES } from "@/lib/sources/prl/types";
import { formatDateLong } from "@/lib/text/format-date";
import { CardSection } from "./card-section";
import type { PrlPersonRead } from "@/lib/sources/prl/reader";

/** Shared map and ballot presentation; the source's measurement stays attributed. */
export function PublicStatementsProfile({ subjectId, onProfile }: { subjectId: string; onProfile?: (profile: PrlReaderProfile | null) => void }) {
  return <ProfileForIdentity key={subjectId} subjectId={subjectId} onProfile={onProfile} />;
}

/** Native person IDs are hints; the server verifies the archive's exact key. */
export const PRL_SUBJECT = /^(?:congress:[A-Z]\d{6}|plural:[a-z]{2}:[0-9a-f-]{36}|[a-z]{2}-(?:legislature|general-court):[A-Za-z0-9_-]+|fec:[HSP][A-Z0-9]{8})$/;

/** Every fetch outcome settles to exactly one state, so a card never stays on "Loading". */
export type StatementsLoad =
  | { kind: "not-applicable" }
  | { kind: "loading" }
  | { kind: "held"; profile: PrlReaderProfile }
  | { kind: "none" }
  | { kind: "failed" };

export function statementsLoadFor(subjectId: string): StatementsLoad {
  return PRL_SUBJECT.test(subjectId) ? { kind: "loading" } : { kind: "not-applicable" };
}

/** A successful answer: the matching profile is held, anything else is none. */
export function settleStatementsAnswer(
  subjectId: string,
  answer: { profile?: PrlReaderProfile | null } | null | undefined,
): StatementsLoad {
  const profile = answer?.profile ?? null;
  return profile && profile.subjectId === subjectId ? { kind: "held", profile } : { kind: "none" };
}

function ProfileForIdentity({ subjectId, onProfile }: { subjectId: string; onProfile?: (profile: PrlReaderProfile | null) => void }) {
  const [load, setLoad] = useState<StatementsLoad>(() => statementsLoadFor(subjectId));
  const [archive, setArchive] = useState<PrlPersonRead | null>(null);
  useEffect(() => {
    if (!PRL_SUBJECT.test(subjectId)) return;
    const controller = new AbortController();
    void fetch(`/api/profile/${encodeURIComponent(subjectId)}`, { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error(String(response.status)); return response.json() as Promise<{ profile: PrlReaderProfile | null; archive?: PrlPersonRead }>; })
      .then(answer => { if (!controller.signal.aborted) { setLoad(settleStatementsAnswer(subjectId, answer)); setArchive(answer.archive ?? null); } })
      .catch(() => { if (!controller.signal.aborted) setLoad({ kind: "failed" }); });
    return () => controller.abort();
  }, [subjectId]);
  const heldProfile = load.kind === "held" ? load.profile : null;
  useEffect(() => { onProfile?.(heldProfile); }, [heldProfile, onProfile]);
  if (archive && (archive.statements.length > 0 || archive.summaries.length > 0)) {
    return <CardSection title="Public statements" defaultOpen>
      {heldProfile && <PublicStatementsProfileContent profile={heldProfile} statementsHeld={archive.statements.length > 0} />}
      <ArchivedStatementsContent archive={archive} />
    </CardSection>;
  }
  switch (load.kind) {
    case "not-applicable":
    case "none":
      return <CardGapContribution id={`statements:${subjectId}`} label="public statements" subject={{ type: "CANDIDATE", id: subjectId }} />;
    case "loading":
      return (
        <CardSection title="Public statements" defaultOpen>
          <p className="mw-loading-inline" role="status">Loading public statements…</p>
        </CardSection>
      );
    case "failed":
      return <CardGapContribution id={`statements:${subjectId}`} label="public statements" subject={{ type: "CANDIDATE", id: subjectId }} />;
    case "held":
      return <CardSection title="Public statements" defaultOpen><PublicStatementsProfileContent profile={load.profile} /></CardSection>;
  }
}

/**
 * Names for PRL's five categories by held category id. Definitions are in
 * `lib/sources/prl/types.ts`.
 */
const CATEGORY_NAME: Record<string, string> = {
  policy: "Policy discussion",
  "attack-policy": "Policy criticism",
  "attack-personal": "Personal attacks",
  creditclaiming: "Accomplishments",
  bipartisanship: "Bipartisanship",
};
const CATEGORY_ORDER = ["policy", "attack-policy", "attack-personal", "creditclaiming", "bipartisanship"];
const CATEGORY_TONE: Record<string, string> = {
  policy: "var(--cat-policy)",
  "attack-policy": "var(--cat-attackPolicy)",
  "attack-personal": "var(--cat-attackPersonal)",
  creditclaiming: "var(--cat-credit)",
  bipartisanship: "var(--cat-bipartisan)",
};

type HeldCategory = PrlReaderProfile["categories"][number] & { share?: number };

/** The held numeric share, only when the reader contract carries one. */
function shareOf(category: HeldCategory): number | null {
  const value = category.share;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

/** The same measured, attributed reader body for fetched UI and census render proof. */
export function PublicStatementsProfileContent({ profile, statementsHeld = false }: { profile: PrlReaderProfile; statementsHeld?: boolean }) {
  const [selected, setSelected] = useState<string | null>(null);
  const categories = [...(profile.categories as HeldCategory[])].sort(
    (a, b) => CATEGORY_ORDER.indexOf(a.id) - CATEGORY_ORDER.indexOf(b.id),
  );
  const numeric = categories.length > 0 && categories.every((c) => shareOf(c) !== null);
  const chosen = selected ? categories.find((c) => c.id === selected) ?? null : null;
  const definition = chosen ? PRL_CATEGORIES.find((c) => c.key === chosen.id) : null;

  return (
      <div className="space-y-3 t-body">
        {numeric ? (
          <>
            {/* One shared 0–100% scale. Categories overlap, so bars never sum to 100 and are never normalized. */}
            <p className="mw-chart-note">
              The share of this member&apos;s tracked statements that PRL&apos;s
              classifier placed in each category. Categories overlap, so they
              don&apos;t add up to 100%.
            </p>
            <div className="mw-bars" role="group" aria-label="Public statements by category">
              {categories.map((category) => {
                const share = shareOf(category) ?? 0;
                const on = selected === category.id;
                return (
                  <button
                    key={category.id}
                    type="button"
                    className="mw-bar-row"
                    aria-pressed={on}
                    data-dim={selected !== null && !on ? "" : undefined}
                    onClick={() => setSelected(on ? null : category.id)}
                  >
                    <span className="mw-bar-label">{CATEGORY_NAME[category.id] ?? category.id}</span>
                    <span className="mw-bar-track" aria-hidden="true">
                      <span
                        className="mw-bar-fill"
                        style={{ width: `${share}%`, background: CATEGORY_TONE[category.id] ?? "var(--bar)" }}
                      />
                    </span>
                    <span className="mw-bar-value">{Math.round(share)}%</span>
                  </button>
                );
              })}
              <span className="mw-bar-scale" aria-hidden="true">
                <span>0</span><span>20</span><span>40</span><span>60</span><span>80</span><span>100%</span>
              </span>
            </div>
            {/* The same figures in PRL's own sentences, for screen readers; collapsed by default. */}
            <details className="mw-chart-words">
              <summary>The same figures in words</summary>
              {categories.map(category => <p key={category.id}>{category.sentence}</p>)}
            </details>
            {chosen && (
              <div className="mw-definition" role="status">
                <p className="mw-definition-head">
                  {CATEGORY_NAME[chosen.id] ?? chosen.id} · {Math.round(shareOf(chosen) ?? 0)}%
                </p>
                {definition && <p>{definition.explainer}</p>}
                <p>{chosen.sentence}</p>
                {definition && (
                  <p className="mw-dim">
                    PRL field <code>{definition.column}</code>
                  </p>
                )}
                <button type="button" className="mw-link-btn" onClick={() => setSelected(null)}>
                  ← All categories
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <CardGapContribution id={`statement-shares:${profile.subjectId}`} label="public statement category shares" />
            {categories.map(category => <p key={category.id}>{category.sentence}</p>)}
          </>
        )}
        {!statementsHeld && <CardGapContribution id={`individual-statements:${profile.subjectId}`} label="individual public statements" />}
        <p className="t-detail text-muted-foreground">
          {profile.statementCount.toLocaleString("en-US")} statements tracked. Measured {formatDateLong(profile.measuredAt)}. Read {formatDateLong(profile.readAt.slice(0, 10))}.
        </p>
        <p className="break-words t-detail text-muted-foreground">
          <a className="underline underline-offset-2" href={profile.attribution.url} target="_blank" rel="noreferrer">{profile.attribution.citation}</a>
          {" · "}<a className="underline underline-offset-2" href={profile.attribution.licenceUrl} target="_blank" rel="noreferrer">{profile.attribution.licence}</a>
        </p>
      </div>
  );
}

/** Literal source text and separate attributed measurements; no inferred personal stance. */
export function ArchivedStatementsContent({ archive }: { archive: PrlPersonRead }) {
  return <div className="mt-3 space-y-3 t-body" data-statement-feed="held">
    {archive.summaries.map(summary => <details key={summary.kind}>
      <summary className="cursor-pointer text-link">{summary.kind === "state" ? "State legislator statement measurements" : "Primary campaign statement measurements"}</summary>
      <p>{summary.profile.statementCount.toLocaleString("en-US")} statements classified by {summary.attribution.text}.</p>
      {PRL_CATEGORIES.map(category => {
        const share = summary.profile.shares[category.key];
        return share === null ? null : <p key={category.key}>{category.label}: {share.toFixed(1)}%.</p>;
      })}
      <p className="t-detail">{summary.kind === "primary" ? "Shares calculated from PRL’s classifications of the acquired statements. " : "PRL’s published shares. "}Categories can overlap.</p>
      <p className="t-detail"><a href={summary.sourceUrl} target="_blank" rel="noreferrer" className="text-link">Source</a>{" · "}Retrieved {summary.retrievedAt.slice(0, 10)}.</p>
    </details>)}
    {archive.statements.map(statement => <details key={statement.id}>
      <summary className="cursor-pointer text-link">{formatDateLong(statement.date.slice(0, 10))} · {statement.sourceLabel}</summary>
      <blockquote className="mt-2 whitespace-pre-wrap">{statement.text}</blockquote>
      <p className="mt-1 t-detail">Attributed by {statement.attribution.text}. <a href={statement.sourceUrl} target="_blank" rel="noreferrer" className="text-link">Original source</a>{" · "}Retrieved {statement.retrievedAt.slice(0, 10)}.</p>
    </details>)}
    {archive.gaps.length > 0 && <CardGapContribution id="statement-archive-gaps" label="public statement records" />}
    <p className="t-detail"><a href="https://americaspoliticalpulse.com/elites/data" target="_blank" rel="noreferrer" className="text-link">America’s Political Pulse — Congressional Rhetoric Dataset</a>{" · "}<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer" className="text-link">CC BY</a></p>
  </div>;
}
