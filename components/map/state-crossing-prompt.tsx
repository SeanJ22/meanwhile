"use client";

/**
 * The border-crossing prompt — e's 6b2, built in g3 item 10 (M91).
 *
 * ## Why an interruption is allowed here at all
 *
 * `CLAUDE.md` calls reader friction a defect and names exactly four
 * exceptions. This is not one of them, and it is still right — because it is
 * not friction. The reason is semantic, not stylistic: **inside a state,
 * panning is browsing.** Same laws, same deadlines, same bodies; the quiet-map
 * rules stand absolutely. **Crossing a state line is a context switch**, where
 * every fact this product asserts changes at once. The interruption IS the
 * information, and a map that silently swapped one state's answers for
 * another's would be the quiet version of a wrong number.
 *
 * The doctrine, for the rules document: **quiet within a state, explicit
 * between states.**
 *
 * ## Once per border per session
 *
 * A clarification, not a toll booth. The reader who wobbles back and forth
 * over a line while panning gets told once; `seen` is keyed on the ordered
 * pair, so Arizona → New Mexico and New Mexico → Arizona are separate
 * clarifications and neither repeats. Session-scoped, device-local, logged
 * nowhere — it is view state, exactly like the location it follows.
 *
 * ## Coverage honesty
 *
 * The prompt names the destination, so it fires only where we can name one.
 * The outlines file carries the states the product covers; panning into a
 * state we hold no outline for changes nothing and claims nothing, rather
 * than announcing a border we cannot describe the far side of. That is a real
 * limitation and it is the honest shape of it — never an implied fullness.
 */
export function StateCrossingPrompt({
  fromName,
  toName,
  onSee,
  onStay,
}: {
  /** The state the reader is leaving. */
  fromName: string;
  /** The state they have panned into. */
  toName: string;
  onSee: () => void;
  onStay: () => void;
}) {
  return (
    <div className="state-crossing" role="dialog" aria-label={`Leaving ${fromName}`}>
      {/* Level register: this is a claim surface — it states what changes at a
          border, and nothing here is cute about a government. */}
      <p className="state-crossing-body">
        You&apos;re leaving {fromName}. {toName} is a different world —
        different governments, different laws, different election deadlines.
        Want to see their info?
      </p>
      <div className="state-crossing-actions">
        <button type="button" className="state-crossing-primary" onClick={onSee}>
          See {toName}
        </button>
        <button type="button" className="state-crossing-secondary" onClick={onStay}>
          Stay in {fromName}
        </button>
      </div>
    </div>
  );
}
