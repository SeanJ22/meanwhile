"use client";

/**
 * **THE ONE HEADER ON EVERY CONTROL-CENTRE PAGE.** (Unified console, 2026-09-04.)
 *
 * Two dropdowns, present on both views, so the whole control centre is one
 * surface on the admin host and nothing is a "different site":
 *   - View: Pilot health ⇄ State readiness.
 *   - State: every state/DC/territory; picking one shows its readiness inline.
 *
 * Switching is a CLIENT navigation (`router.push`) — the Next App Router swaps
 * the server-rendered view without a full reload, so a state change is instant
 * and same-origin. History belongs to the router; this never touches it directly.
 */
import { useRouter } from "next/navigation";

export function ConsoleNav(props: {
  view: "pilot-health" | "readiness";
  /** The state the readiness view is showing, or null on pilot health. */
  currentState: string | null;
  states: readonly { readonly code: string; readonly name: string }[];
}) {
  const router = useRouter();
  const stateForReadiness = props.currentState ?? "az";

  return (
    <nav className="console-nav" aria-label="Control centre">
      <label>
        View
        <select
          value={props.view}
          aria-label="Choose a view"
          onChange={(e) => {
            router.push(e.target.value === "pilot-health" ? "/admin" : `/readiness/${stateForReadiness}`);
          }}
        >
          <option value="pilot-health">Pilot health</option>
          <option value="readiness">State readiness</option>
        </select>
      </label>

      <label>
        State
        <select
          value={props.currentState ?? ""}
          aria-label="Choose a state"
          onChange={(e) => {
            if (e.target.value) router.push(`/readiness/${e.target.value}`);
          }}
        >
          {props.view !== "readiness" && <option value="">— select a state —</option>}
          {props.states.map((s) => (
            <option key={s.code} value={s.code}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      <span className="console-nav-brand">Control centre</span>
    </nav>
  );
}
