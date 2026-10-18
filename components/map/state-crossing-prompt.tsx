"use client";

export function StateCrossingPrompt({ toName, onDismiss }: { toName: string; onDismiss: () => void }) {
  return (
    <div className="state-crossing" role="status" aria-live="polite">
      <p className="state-crossing-body">
        Now showing {toName}. Officials, meetings and ballot follow this area.
      </p>
      <button type="button" className="state-crossing-secondary" onClick={onDismiss} aria-label="Dismiss state message">
        Dismiss
      </button>
    </div>
  );
}
