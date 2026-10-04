"use client";

import { useEffect, useState } from "react";
import type { PrlReaderProfile } from "@/lib/sources/prl/snapshot";
import { PRL_CATEGORIES } from "@/lib/sources/prl/types";
import { formatDateLong } from "@/lib/text/format-date";
import { CardSection } from "./card-section";

/** Shared map and ballot presentation; the source's measurement stays attributed. */
export function PublicStatementsProfile({ subjectId, onProfile }: { subjectId: string; onProfile?: (profile: PrlReaderProfile | null) => void }) {
  return <ProfileForIdentity key={subjectId} subjectId={subjectId} onProfile={onProfile} />;
}

/** Only congressional identities have a PRL profile to look for. */
export const PRL_SUBJECT = /^congress:[A-Z]\d{6}$/;

/**
 * What the Public statements section is showing (lead review of 49e7b4a4):
 * every fetch outcome SETTLES to exactly one state, so a card can never stay
 * on "Loading" after the answer arrived.
 */
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
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!PRL_SUBJECT.test(subjectId)) return;
    const controller = new AbortController();
    void fetch(`/api/profile/${encodeURIComponent(subjectId)}`, { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error(String(response.status)); return response.json() as Promise<{ profile: PrlReaderProfile | null }>; })
      .then(answer => { if (!controller.signal.aborted) setLoad(settleStatementsAnswer(subjectId, answer)); })
      .catch(() => { if (!controller.signal.aborted) setLoad({ kind: "failed" }); });
    return () => controller.abort();
  }, [subjectId, attempt]);
  const heldProfile = load.kind === "held" ? load.profile : null;
  useEffect(() => { onProfile?.(heldProfile); }, [heldProfile, onProfile]);
  switch (load.kind) {
    case "not-applicable":
    case "none":
      // A blank never reads as "nothing here": the section says what is not
      // held, and why it might not be.
      return (
        <CardSection title="Public statements">
          <p className="mw-feed-gap" data-statement-feed="not-held">
            {load.kind === "none"
              ? "We’re working on getting this info."
              : "We’re working on getting this info."}
          </p>
        </CardSection>
      );
    case "loading":
      return (
        <CardSection title="Public statements" defaultOpen>
          <p className="mw-loading-inline" role="status">Loading public statements…</p>
        </CardSection>
      );
    case "failed":
      return (
        <CardSection title="Public statements" defaultOpen>
          <p className="text-sm">We couldn’t check for a public-statements profile just now.</p>
          <button
            type="button"
            className="mw-pill-btn mt-2"
            onClick={() => {
              setLoad({ kind: "loading" });
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </button>
        </CardSection>
      );
    case "held":
      return <CardSection title="Public statements" defaultOpen><PublicStatementsProfileContent profile={load.profile} /></CardSection>;
  }
}

/**
 * The approved design's names for PRL's five categories, keyed by the held
 * category id. Definitions are the product's own explainers in
 * `lib/sources/prl/types.ts` (checked against PRL's codebook there), never
 * the prototype's paraphrase.
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
export function PublicStatementsProfileContent({ profile }: { profile: PrlReaderProfile }) {
  const [selected, setSelected] = useState<string | null>(null);
  const categories = [...(profile.categories as HeldCategory[])].sort(
    (a, b) => CATEGORY_ORDER.indexOf(a.id) - CATEGORY_ORDER.indexOf(b.id),
  );
  const numeric = categories.length > 0 && categories.every((c) => shareOf(c) !== null);
  const chosen = selected ? categories.find((c) => c.id === selected) ?? null : null;
  const definition = chosen ? PRL_CATEGORIES.find((c) => c.key === chosen.id) : null;

  return (
      <div className="space-y-3 text-sm">
        {numeric ? (
          <>
            {/*
              Approved design: five bars on ONE shared 0–100% scale. PRL's
              categories overlap — a statement can be several at once — so the
              bars never add to 100, are never normalized, and carry no
              per-category count (the tracked total is not their denominator).
            */}
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
            {/*
              The same figures in PRL's own sentences — for a screen reader, and
              because the reader proof renders this component and checks every
              held sentence reaches the page. Collapsed by default; in the
              markup either way.
            */}
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
            <p className="mw-feed-gap" data-statement-chart="not-held">
              The chart of each category&apos;s share isn&apos;t available for this member yet. The Polarization Research Lab&apos;s own sentences follow.
            </p>
            {categories.map(category => <p key={category.id}>{category.sentence}</p>)}
          </>
        )}
        {/*
          R2 (lead holding inventory, 2026-09-29): no verified per-statement
          rows are held for any member, so the design's recent-statements feed
          is stated as unavailable — never a sample, never a fixed state.
        */}
        <p className="mw-feed-gap" data-statement-feed="not-held">
          Individual statements aren&apos;t held here yet — only PRL&apos;s category
          shares.{" "}
          <a className="underline underline-offset-2" href={profile.attribution.url} target="_blank" rel="noreferrer">
            See PRL&apos;s data ↗
          </a>
        </p>
        <p className="text-xs text-muted-foreground">
          {profile.statementCount.toLocaleString("en-US")} statements tracked. Measured {formatDateLong(profile.measuredAt)}. Read {formatDateLong(profile.readAt.slice(0, 10))}.
        </p>
        <p className="break-words text-xs text-muted-foreground">
          <a className="underline underline-offset-2" href={profile.attribution.url} target="_blank" rel="noreferrer">{profile.attribution.citation}</a>
          {" · "}<a className="underline underline-offset-2" href={profile.attribution.licenceUrl} target="_blank" rel="noreferrer">{profile.attribution.licence}</a>
        </p>
      </div>
  );
}
