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

import { ThemeToggle } from "@/components/theme-toggle";
import { CONSOLE_VIEW_TABLE, type ConsoleView } from "@/lib/control-plane/console-paths.ts";

/*
 * ADM-59. The union, the path lookup and the labels are all DERIVED from
 * `CONSOLE_VIEW_TABLE` now. They used to be three hand-kept lists beside the
 * `<option>` list and `CONSOLE_VIEWS`, and the omission that produced six
 * unreachable admin views was invisible precisely because nothing compared
 * them. See the table's own header for what went wrong.
 */
export type { ConsoleView } from "@/lib/control-plane/console-paths.ts";

/** The path each view lives at. The readiness view is per state. */
function pathFor(view: ConsoleView, state: string): string {
  const row = CONSOLE_VIEW_TABLE.find((v) => v.view === view);
  /*
   * A null path is the per-state readiness view; an unknown view cannot occur,
   * because the type is derived from this same table. There is deliberately no
   * `default:` arm returning "/admin" any more — that arm was what silently
   * served every view somebody forgot to wire.
   */
  return row?.path ?? `/readiness/${state}`;
}

const VIEW_LABEL: Record<ConsoleView, string> = Object.fromEntries(
  CONSOLE_VIEW_TABLE.map((v) => [v.view, v.label]),
) as Record<ConsoleView, string>;

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
          {/*
            ADM-59: rendered FROM the table, so a view can never again exist in
            the union and the router and not here. A flat list on purpose —
            there is no optgroup anywhere in this product, and the admin
            select-contrast guard pins only `select` and `select option` to
            Canvas/CanvasText, so an optgroup label would reopen the exact
            light-on-dark defect that guard exists to prevent.
          */}
          {CONSOLE_VIEW_TABLE.map((v) => (
            <option key={v.view} value={v.view}>
              {v.label}
            </option>
          ))}
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

      <span className="console-nav-brand">Control centre</span>
      <ThemeToggle className="shrink-0" />
    </nav>
  );
}
