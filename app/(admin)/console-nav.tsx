"use client";

/**
 * **THE ONE HEADER ON EVERY CONTROL-CENTRE PAGE.** (Unified console, 2026-09-04;
 * selection acknowledgement and the theme switch added for the 9.4.26 feedback.)
 *
 * Three dropdown views, present everywhere, so the whole control centre is one
 * surface on the admin host and nothing is a "different site":
 *   - View: Pilot health (the fleet) ⇄ State readiness ⇄ Research detail.
 *   - State: every state/DC/territory; picking one shows its readiness inline.
 *
 * Switching is a CLIENT navigation (`router.push`) inside a transition
 * (ADM-2): the chosen value shows the instant it is chosen, a status line says
 * what is loading, and the current page stays on screen until the server has
 * rendered the new one. Before this, nothing changed for the whole server
 * round trip, which read as broken. History belongs to the router; this never
 * touches it directly.
 *
 * The theme switch (ADM-9) is the map's own `ThemeToggle` — one component, one
 * storage key, one pre-paint script — so the choice persists exactly as it
 * does on the reader surfaces.
 */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme-toggle";

export type ConsoleView =
  | "pilot-health"
  | "readiness"
  | "research"
  | "release-review"
  | "steward"
  | "sources"
  | "reader"
  | "feedback"
  | "agents"
  | "chat";

/** The path each view lives at. The readiness view is per state. */
function pathFor(view: ConsoleView, state: string): string {
  switch (view) {
    case "readiness":
      return `/readiness/${state}`;
    case "research":
      return "/admin/research";
    case "release-review":
      return "/admin/release-review";
    case "steward":
      return "/admin/steward";
    case "sources":
      return "/admin/sources";
    case "reader":
      return "/admin/reader";
    case "feedback":
      return "/admin/feedback";
    case "agents":
      return "/admin/agents";
    case "chat":
      return "/admin/chat";
    default:
      return "/admin";
  }
}

const VIEW_LABEL: Record<ConsoleView, string> = {
  "pilot-health": "Pilot health",
  readiness: "State readiness",
  research: "Research detail",
  "release-review": "Software release review",
  steward: "Shipping and integration",
  sources: "Sources and APIs",
  reader: "What readers are doing",
  feedback: "Feedback",
  agents: "Delegated work",
  chat: "Ask the console",
};

export function ConsoleNav(props: {
  view: ConsoleView;
  /** The state the readiness view is showing, or null on the other views. */
  currentState: string | null;
  states: readonly { readonly code: string; readonly name: string }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  /*
   * What the owner just chose, shown at once. It is stamped with the props it
   * was chosen under, so it applies only until the router delivers a page
   * with different props — no effect, no setState-in-render: a stale choice is
   * simply ignored by comparison.
   */
  const signature = `${props.view}|${props.currentState ?? ""}`;
  const [choice, setChoice] = useState<{
    view: ConsoleView;
    state: string | null;
    under: string;
  } | null>(null);
  const chosen = choice !== null && choice.under === signature && isPending ? choice : null;

  const view = chosen?.view ?? props.view;
  const currentState = chosen ? chosen.state : props.currentState;
  const stateForReadiness = currentState ?? props.currentState ?? "az";
  const chosenStateName = chosen?.state ? props.states.find((s) => s.code === chosen.state)?.name : undefined;
  const loadingLabel =
    chosen === null
      ? null
      : chosen.view === "readiness"
        ? chosenStateName
          ? `Loading ${chosenStateName}…`
          : "Loading…"
        : `Loading ${VIEW_LABEL[chosen.view]}…`;

  function go(next: ConsoleView, state: string | null) {
    const target = pathFor(next, state ?? stateForReadiness);
    if (target === pathFor(props.view, props.currentState ?? "az")) return;
    setChoice({ view: next, state, under: signature });
    startTransition(() => {
      router.push(target);
    });
  }

  return (
    <nav className="console-nav" aria-label="Control centre" aria-busy={chosen !== null}>
      <label>
        View
        <select
          value={view}
          aria-label="Choose a view"
          onChange={(e) => {
            const next = e.target.value as ConsoleView;
            go(next, next === "readiness" ? stateForReadiness : null);
          }}
        >
          <option value="pilot-health">{VIEW_LABEL["pilot-health"]}</option>
          <option value="readiness">{VIEW_LABEL.readiness}</option>
          <option value="research">{VIEW_LABEL.research}</option>
          <option value="release-review">{VIEW_LABEL["release-review"]}</option>
        </select>
      </label>

      <label>
        State
        <select
          value={currentState ?? ""}
          aria-label="Choose a state"
          onChange={(e) => {
            if (e.target.value) go("readiness", e.target.value);
          }}
        >
          {view !== "readiness" && <option value="">— select a state —</option>}
          {props.states.map((s) => (
            <option key={s.code} value={s.code}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      {loadingLabel && (
        <span className="console-nav-pending" role="status" aria-live="polite">
          {loadingLabel}
        </span>
      )}

      {/* Admin parity (design handoff 2026-09-13): the admin shell consumes the
          same Logo lockup as the reader shell — "Meanwhile" is never inline
          display text in Admin either, and --mark stays scoped to the Logo.
          "Control centre" stays as the surface-context caption beside it. */}
      <span className="console-nav-brand">
        <Logo variant="wordmark" size={18} />
        <span className="console-nav-context">Control centre</span>
      </span>
      <ThemeToggle className="shrink-0" />
    </nav>
  );
}
