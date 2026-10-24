"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

import {
  getAllPicks,
  getSuppressedDerived,
  readPicksFile,
  replacePicksFile,
  setPickDistricts,
  subscribePicks,
  type StoredPick,
} from "@/lib/ballot/picks";
import {
  tallyPicks,
  tallyLine,
  resolveWithSuppression,
  type PickableContest,
} from "@/lib/ballot/pick-tally";
import {
  isForeignPick,
  pickJurisdictionLabel,
} from "@/lib/ballot/pick-jurisdiction";
import { getStoredReaction, subscribeReactions } from "@/lib/reactions/client";
import { PicksCardControls } from "@/components/ballot/picks-card";
import { privatePicksLink, privatePicksSnapshot, savePrivatePicks, startPicksSync, subscribePrivatePicks } from "@/lib/ballot/picks-sync";

/**
 * The reader's picks, grouped by contest, with N of M picked.
 * A saved list keeps its link visible after clearing. Picks from a different
 * ballot are labelled. Resolves through `lib/ballot/pick-tally.ts`, as the per-contest
 * control does, so derived picks count.
 */
export function MyPicks({
  currentJurisdictionKey = null,
  pickable = [],
}: {
  /** The ballot on screen's jurisdiction; null labels nothing. */
  currentJurisdictionKey?: string | null;
  /** Every contest on this page with a pick control; the tally's denominator. */
  pickable?: PickableContest[];
}) {
  useEffect(() => startPicksSync({ read: readPicksFile, replace: replacePicksFile }), []);
  useEffect(() => setPickDistricts(pickable), [pickable]);
  const saved = JSON.parse(useSyncExternalStore(subscribePrivatePicks, privatePicksSnapshot, () => '{"secret":null,"created":false,"status":""}')) as { secret: string | null; created: boolean; status: string };
  const raw = useSyncExternalStore(
    subscribePicks,
    () => JSON.stringify({ picks: getAllPicks(), cleared: getSuppressedDerived() }),
    () => JSON.stringify({ picks: [], cleared: {} }),
  );
  const { picks, cleared } = JSON.parse(raw) as {
    picks: StoredPick[];
    cleared: Record<string, string[]>;
  };

  /*
   * Read through `useSyncExternalStore`, never in a bare render, to avoid a
   * hydration mismatch. The snapshot is JSON: a NUL-joined string makes
   * ripgrep treat the file as binary.
   */
  const yesKey = useSyncExternalStore(
    subscribeReactions,
    useCallback(
      () =>
        JSON.stringify(
          pickable
            .flatMap((c) => c.options)
            .filter(
              (o) =>
                o.reactionTargetId &&
                getStoredReaction("CANDIDATE", o.reactionTargetId, o.reactionTargetAliases) === "YES",
            )
            .map((o) => o.reactionTargetId as string)
            .sort(),
        ),
      [pickable],
    ),
    () => "[]",
  );
  const yesTargets = new Set(JSON.parse(yesKey) as string[]);

  const tally = tallyPicks(pickable, picks, yesTargets, cleared);

  if (tally.rows.length === 0 && tally.foreign.length === 0 && !saved.secret && !saved.status) return null;

  /* The card and the clear act on the resolved set, derived picks included. */
  const cardPicks: StoredPick[] = [
    ...tally.rows.map((row) => ({
      contestId: row.contestId,
      contestTitle: row.contestTitle,
      choiceIds: row.chosen,
      labels: Object.fromEntries(row.chosen.map((label) => [label, label])),
    })),
    ...tally.foreign,
  ];

  return (
    <section className="mt-6 rounded-[10px] border border-dashed border-[var(--panel-border)] p-4">
      <h2 className="t-structure text-paper-dim">
        My picks
      </h2>
      {/* `data-pick-tally` carries both numbers so walks can check the denominator. */}
      {pickable.length > 0 && (
        <p
          data-pick-tally
          data-picked={tally.picked}
          data-pickable={tally.pickable}
          className="mt-1 t-detail leading-relaxed text-voice"
        >
          You&apos;ve picked in {tallyLine(tally)}.
        </p>
      )}
      <ul className="mt-2 space-y-1.5">
        {tally.rows.map((row) => (
          <li key={row.contestId} className="t-body leading-relaxed">
            <span className="text-muted">{row.contestTitle}:</span>{" "}
            {row.chosen.join(", ")}
            {row.basis === "DERIVED" && (
              <span className="ml-1.5 whitespace-nowrap t-caption text-voice">
                · from your answer above
              </span>
            )}
          </li>
        ))}
        {tally.foreign.map((pick) => {
          const foreign = isForeignPick(pick.contestId, currentJurisdictionKey);
          const where = foreign ? pickJurisdictionLabel(pick.contestId) : null;
          return (
            <li key={pick.contestId} className="t-body leading-relaxed">
              <span className="text-muted">{pick.contestTitle}:</span>{" "}
              {pick.choiceIds.map((id) => pick.labels[id] ?? id).join(", ")}
              {/* Only when the ballot on screen differs and we have a reader-facing name for it. */}
              {where && (
                <span className="ml-1.5 whitespace-nowrap t-caption text-voice">
                  · {where}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <PicksCardControls
        picks={cardPicks}
        pickable={pickable}
        yesTargets={yesTargets}
        cleared={cleared}
      />
      <div className="mt-3 t-detail">
        <button type="button" className="cursor-pointer text-signal underline decoration-dotted" onClick={() => {
          const derived = pickable.flatMap(contest => {
            const yes = contest.options.filter(option => option.reactionTargetId && yesTargets.has(option.reactionTargetId)).map(option => option.id);
            const resolution = resolveWithSuppression(picks.find(pick => pick.contestId === contest.contestId || contest.aliases?.includes(pick.contestId)) ?? null,
              yes, contest.voteFor, [contest.contestId, ...contest.aliases ?? []].map(id => cleared[id]).find(Boolean), contest.options);
            return resolution.basis === "DERIVED" ? [{ contestId: contest.contestId, contestTitle: contest.contestTitle,
              choiceIds: resolution.chosen, labels: Object.fromEntries(contest.options.map(option => [option.id, option.label])) }] : [];
          });
          void savePrivatePicks(derived);
        }}>
          {saved.secret ? "Sync my picks" : "Save my picks on another device"}
        </button>
        {saved.secret && saved.created && <label className="mt-2 block">
          Private picks link
          <input className="mt-1 block w-full rounded border border-[var(--panel-border)] p-2" aria-label="Private picks link" readOnly value={privatePicksLink(saved.secret)} onFocus={event => event.target.select()} />
          <span className="mt-1 block t-caption text-muted">Keep this link. Anyone with it can see and change this list.</span>
        </label>}
        {saved.status && <p role="status" className="mt-2 t-caption text-muted">{saved.status}</p>}
      </div>
    </section>
  );
}
