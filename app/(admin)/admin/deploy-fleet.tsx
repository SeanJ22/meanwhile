"use client";

/**
 * **DEPLOY FLEET.** (ADM-8, 9.4.26 admin feedback.)
 *
 * The owner's words: "I want an option, like a button, almost to say, 'Hey
 * deploy fleet,' and then it prompts me to say, 'Well what is it that you want
 * to go do?' 'Oh I want to go deep dive on Illinois.'"
 *
 * The button opens a prompt (React state only — never history). The words go
 * to `/api/admin/research` as a DISPATCH intent; the standing runner reads it
 * on its next look, puts every registered unit that matches the target first,
 * and records what matched — or, for a place nothing is registered for, says
 * so by name. The dashboard shows each deployment and its outcome below the
 * fleet. Nothing here touches the runner directly: an intent is pending until
 * the runner records that it honored it.
 */
import { useState } from "react";

export function DeployFleet(props: { readonly returnTo: string; readonly maxChars: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="deploy">
      {!open ? (
        <div className="actions">
          <button type="button" className="primary" onClick={() => setOpen(true)}>
            Deploy fleet
          </button>
          <span className="note">
            Tell the fleet where to go next. It reorders the work it already has; it never invents work.
          </span>
        </div>
      ) : (
        <form method="post" action="/api/admin/research">
          <input type="hidden" name="action" value="DISPATCH" />
          <input type="hidden" name="returnTo" value={props.returnTo} />
          <label>
            What do you want the fleet to go do?
            <textarea
              name="note"
              required
              maxLength={props.maxChars}
              placeholder="For example: deep dive on Illinois, or Pima County campaign finance"
              autoFocus
            />
          </label>
          <div className="actions">
            <button type="submit" className="primary">
              Send the fleet
            </button>
            <button type="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
