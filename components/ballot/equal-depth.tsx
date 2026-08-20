import { equalDepthGate } from "@/lib/coverage/tier";
import type { CandidateDepth } from "@/lib/coverage/tier";

/**
 * RULING 7 — no candidate cards ship in a contest until every candidate in
 * that contest can ship at equal depth (item 7.2 and 7.3, 2026-08-20).
 *
 * THE TESTER'S FINDING IS THE WHOLE REASON, in her words: *"Karen might be the
 * perfect fit for me, but she has no information here. So I'm only going to
 * look at the folks that do have information... how could using this app
 * actually impact voter outcomes instead of collect information from voters."*
 *
 * The app can say nothing about anyone and still tilt a race. A thin card
 * tracks incumbency and campaign professionalism, not merit, so unequal depth
 * inside a live contest is information asymmetry the product manufactures
 * itself. That is stricter than any neutrality rule above it: those forbid us
 * from ranking, and this forbids us from ranking by accident.
 *
 * A SHARED GATE, NOT A PER-SURFACE JUDGEMENT (item 7.3). The decision lives in
 * `equalDepthGate` in `lib/coverage/tier.ts` and every surface asks it. Two
 * surfaces each deciding for themselves is two things to get wrong, and the
 * second one is always the one nobody remembers to fix.
 *
 * WHAT IT IS NOT. The rule is EQUALITY, never richness: two candidates we know
 * nothing about are equally served by the thin-candidate line and both render.
 * And nothing is deleted — a withheld contest still names its candidates and
 * says why the cards are not there, because an unexplained blank is the defect
 * one floor up.
 */
export function EqualDepth({
  candidates,
  names,
  children,
}: {
  candidates: CandidateDepth[];
  /** Every candidate's name, so a withheld contest still names them all. */
  names: string[];
  children: React.ReactNode;
}) {
  const decision = equalDepthGate(candidates);

  if (decision.render) {
    return (
      <div data-equal-depth="rendered" data-equal-depth-level={decision.depth}>
        {children}
      </div>
    );
  }

  return (
    <div
      data-equal-depth="withheld"
      data-equal-depth-reason={decision.reason}
      data-equal-depth-shallowest={decision.shallowest}
      data-equal-depth-deepest={decision.deepest}
      className="mt-3.5 rounded-md border border-dashed border-[var(--panel-border)] px-3 py-3"
    >
      {/*
        The candidates are still NAMED. Withholding the cards must never
        withhold the fact that these people are running — that would be a
        worse asymmetry than the one the gate exists to prevent, and the
        reader came here to find out who is on the ballot.
      */}
      <ul className="space-y-1 text-[0.875rem]">
        {names.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
      {/* Level register: this is a claim about our own coverage, not a joke. */}
      <p className="mt-2.5 text-[0.75rem] leading-relaxed text-muted">
        {decision.reason}
      </p>
    </div>
  );
}
