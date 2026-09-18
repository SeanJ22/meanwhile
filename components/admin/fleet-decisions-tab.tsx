"use client";

/**
 * Decisions tab (BUILD.md §E, WIRING.md §5, §6a, §7).
 *
 * Opens with the worked answer mechanism — the owner's actual complaint was
 * that pressing a decision felt like pressing nothing — then the fleet
 * decisions FIRST, then the 43 that are not fleet work, accounted for but held
 * apart. Nothing here is built: the answerable queue is the existing
 * `DecisionQueue` (options with consequences, optimistic decide, undo by
 * superseding record, state-version refusal, the three-leg receipt). This tab
 * scopes it to fleet work and frames it, per §7's fix for a project-wide store
 * shown on a fleet page.
 */

import { useMemo, useState } from "react";

import { DecisionQueue, type PriorityGroupView } from "@/app/(admin)/admin/decisions.tsx";
import { groupWaiting, waitingCardView, waitingSummary } from "@/lib/control-plane/decision-queue.ts";
import type { OwnerDecisionCard } from "@/lib/control-plane/owner-surface.ts";

const FLEET_PREFIXES = /^(NH|D\d|ASK|NW|RO)/i;
function isFleetRowId(rowId: string): boolean {
  return FLEET_PREFIXES.test(rowId);
}

const NON_FLEET_GROUPS: readonly { readonly label: string; readonly test: RegExp; readonly blurb: string }[] = [
  { label: "Business, legal and trust", test: /^[BT]\d/i, blurb: "Incorporation, counsel questions, trust structure." },
  { label: "Design and console calls", test: /^NS/i, blurb: "Console and design decisions, not fleet operations." },
  { label: "Defect reports", test: /^OWN/i, blurb: "Bugs filed as decisions — they want a fix, not an answer." },
  { label: "Commercial and product", test: /.*/, blurb: "Buyer pricing, product surface, outreach." },
];

function classifyNonFleet(rowId: string): number {
  for (let i = 0; i < NON_FLEET_GROUPS.length; i += 1) {
    if (NON_FLEET_GROUPS[i].test.test(rowId)) return i;
  }
  return NON_FLEET_GROUPS.length - 1;
}

export function FleetDecisionsTab({
  cards,
  stateVersion,
}: {
  readonly cards: readonly OwnerDecisionCard[];
  readonly stateVersion: string;
}) {
  const [flat, setFlat] = useState(false);

  const { fleetCards, nonFleetCards } = useMemo(() => {
    const fleet: OwnerDecisionCard[] = [];
    const other: OwnerDecisionCard[] = [];
    for (const c of cards) (isFleetRowId(c.rowId) ? fleet : other).push(c);
    return { fleetCards: fleet, nonFleetCards: other };
  }, [cards]);

  const fleetGroups = useMemo<readonly PriorityGroupView[]>(
    () =>
      groupWaiting(fleetCards).map((g) => ({
        priority: g.priority,
        count: g.count,
        types: g.types.map((t) => ({ type: t.type, cards: t.cards.map(waitingCardView) })),
      })),
    [fleetCards],
  );

  const allGroups = useMemo<readonly PriorityGroupView[]>(
    () =>
      groupWaiting(cards).map((g) => ({
        priority: g.priority,
        count: g.count,
        types: g.types.map((t) => ({ type: t.type, cards: t.cards.map(waitingCardView) })),
      })),
    [cards],
  );

  const nonFleetByGroup = useMemo(() => {
    const buckets = NON_FLEET_GROUPS.map((g) => ({ ...g, cards: [] as OwnerDecisionCard[] }));
    for (const c of nonFleetCards) buckets[classifyNonFleet(c.rowId)].cards.push(c);
    return buckets.filter((b) => b.cards.length > 0);
  }, [nonFleetCards]);

  return (
    <section className="fleet-tab" aria-label="Decisions">
      <div className="fleet-tab-head">
        <div>
          <h2>
            {cards.length} decisions. <span className="ft-accent">{fleetCards.length} of them are fleet work.</span>
          </h2>
          <p className="note">
            The decision store is project-wide, so business, legal, commercial and design decisions
            appear here alongside fleet work. They are grouped, fleet first, and held apart below.
          </p>
        </div>
        <button type="button" className="ft-toggle" aria-pressed={flat} onClick={() => setFlat((f) => !f)}>
          {flat ? "Show grouped" : "Show as shipped (flat)"}
        </button>
      </div>

      {flat ? (
        <DecisionQueue
          groups={allGroups}
          total={cards.length}
          summary={waitingSummary(groupWaiting(cards))}
          actionRoute="/api/admin/action"
          returnTo="/admin/fleet?tab=decisions"
          stateVersion={stateVersion}
          heading="All decisions, as shipped (flat)"
          defaultOpen
        />
      ) : (
        <>
          <div className="ft-worked">
            <h3>How you answer one</h3>
            <p className="note">
              A decision resolves in three legs, and only the first is a button. Pressing an option
              appends an intent to the decision log — durable, authenticated, timestamped — and{" "}
              <strong>nothing else has happened yet</strong>. The runner closes the tracker row in your
              name at its next sync, about every twenty minutes while it is running, and opens the work
              your choice implies in the same sync. Each option shows its consequence before you choose,
              and your answer quotes the revision this card was drawn from, so a stale answer is refused
              rather than silently applied.
            </p>
          </div>

          <DecisionQueue
            groups={fleetGroups}
            total={fleetCards.length}
            summary={waitingSummary(groupWaiting(fleetCards))}
            actionRoute="/api/admin/action"
            returnTo="/admin/fleet?tab=decisions"
            stateVersion={stateVersion}
            heading="Fleet decisions waiting on you"
            defaultOpen
          />

          {nonFleetCards.length > 0 && (
            <div className="ft-non-fleet">
              <div className="ft-group-header">
                <span className="ft-chip" aria-hidden="true" />
                <span className="ft-group-label">Not fleet work · {nonFleetCards.length}</span>
                <span className="ft-rule" aria-hidden="true" />
              </div>
              <div className="ft-summary-grid">
                {nonFleetByGroup.map((g) => (
                  <div key={g.label} className="ft-summary-card">
                    <strong>{g.label}</strong>
                    <span className="ft-summary-count">{g.cards.length}</span>
                    <span className="note">{g.blurb}</span>
                    <span className="ft-mono note">
                      {g.cards.map((c) => c.rowId).slice(0, 8).join(" · ")}
                      {g.cards.length > 8 ? ` · +${g.cards.length - 8}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="ft-correction">
            <p className="note">
              This grouping is by <code>rowId</code> prefix only because the fleet page&rsquo;s projection
              kept two of the card&rsquo;s eleven fields. <code>priority</code>, <code>ageDays</code> and{" "}
              <code>openedOn</code> are on every card already; reading them replaces this prefix grouping
              with the right one.
            </p>
          </div>
        </>
      )}
    </section>
  );
}
