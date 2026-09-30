"use client";

/**
 * **THE HEADER ON A PAGE THE DESIGN DOES NOT DRAW.** (Admin redesign,
 * 2026-09-23 — replacing the unified console's View / State header.)
 *
 * The redesign has one way to move around: the header every screen carries —
 * the lockup, the Fleet | Readiness areas, the scope, and "Other pages" — with
 * the area's tabs beneath it. The pages the design package does not draw
 * (runner and research detail, sources, release review, shipping, readers,
 * feedback, delegated work, the console chat, the system map) keep their own
 * content, and this component gives them the same header, so there is no
 * second navigation: the old View and State dropdowns and the theme switch are
 * gone (the control centre is always dark, as the design is).
 *
 * The name and props are kept so each of those pages changes nothing but the
 * header it draws. `currentState` and `states` are accepted and ignored — a
 * state is chosen with the scope, on Readiness.
 */
import Link from "next/link";

import { Logo } from "@/components/brand/logo";

import { OtherPages } from "./_mw/header-controls.tsx";
import s from "./_mw/mw.module.css";

export type ConsoleView =
  | "changes"
  | "research"
  | "release-review"
  | "system-map"
  | "steward"
  | "sources"
  | "reader"
  | "feedback"
  | "agents"
  | "chat"
  | "fleet";

const VIEW_LABEL: Readonly<Record<ConsoleView, string>> = {
  changes: "Changes",
  research: "Runner and research detail",
  "release-review": "Software release review",
  "system-map": "System map",
  steward: "Shipping and integration",
  sources: "Sources and APIs",
  reader: "What readers are doing",
  feedback: "Feedback",
  agents: "Delegated work",
  chat: "Ask the console",
  fleet: "Fleet operations map",
};

export function ConsoleNav(props: {
  view: ConsoleView;
  currentState?: string | null;
  states?: readonly { readonly code: string; readonly name: string }[];
}) {
  return (
    <div className={s.frame}>
      <header className={s.header}>
        <Link href="/admin" className={s.brand} aria-label="Control centre home">
          <Logo variant="wordmark" size={20} decorative />
        </Link>
        <nav className={s.areaToggle} aria-label="Area">
          <Link href="/admin" className={s.areaBtn}>
            Fleet
          </Link>
          <Link href="/readiness" className={s.areaBtn}>
            Readiness
          </Link>
        </nav>
        <div className={s.headerRight}>
          <span className={s.scopeLabel}>Other page</span>
          <OtherPages scope="all" />
        </div>
      </header>
      <div className={s.strip}>
        <span>
          PAGE <span className={s.stripVal}>{VIEW_LABEL[props.view]}</span>
        </span>
        <span aria-hidden="true">·</span>
        <span>
          Not part of Fleet or Readiness — back to <Link href="/admin">Fleet · Now</Link>
        </span>
      </div>
    </div>
  );
}
