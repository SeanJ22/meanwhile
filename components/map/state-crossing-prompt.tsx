"use client";

/**
 * Shown when the reader pans across a state line, since every fact changes
 * there. Once per ordered pair of states per session, device-local and never
 * logged. Fires only for states the outlines file covers.
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
