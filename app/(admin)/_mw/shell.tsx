/**
 * **ONE SYSTEM, TWO AREAS, ONE SHELL.** (Admin redesign, 2026-09-23 — the
 * design package's settled decision 1.)
 *
 * Every control-centre page renders inside this shell: the header (the
 * lockup, the Fleet | Readiness toggle, the one scope filter both areas obey,
 * and "Other pages"), the area's tabs, and the context strip that names the
 * scope, the standard and when the page read what it shows. It replaces the
 * old View / State dropdown header outright — there is one way to move around.
 *
 * A server component: the tabs and the area toggle are plain links that carry
 * the scope, so switching areas keeps it (ACCEPTANCE §3). Only the scope
 * select and the Other pages menu are client islands.
 */
import Link from "next/link";
import type { ReactNode } from "react";

import { Logo } from "@/components/brand/logo";
import { formatEastern } from "@/lib/control-plane/eastern-time.ts";

import { OtherPages, ScopeSelect, type ScopeOptionGroup } from "./header-controls.tsx";
import s from "./mw.module.css";
import { LiveRefresh } from "./live-refresh.tsx";
import {
  FLEET_TABS,
  READINESS_TABS,
  areaHome,
  scopeParam,
  withScope,
  type MwArea,
  type MwScope,
  type MwTab,
} from "./scope.ts";

export interface StripItem {
  readonly label: string;
  readonly value: ReactNode;
  /** Gold, as the design colours a caution in the strip. */
  readonly warn?: boolean;
}

export interface MwShellProps {
  readonly area: MwArea;
  readonly tab: MwTab;
  readonly scope: MwScope;
  /** The scope as the strip names it, e.g. "Everywhere · 3 states". */
  readonly scopeLabel: string;
  readonly scopeGroups: readonly ScopeOptionGroup[];
  /** The path the scope select navigates on (the page's own path, with its other query kept). */
  readonly here: string;
  /** When this page read what it shows. */
  readonly observedAt: string;
  /** What the readings are measured against, or null when nothing versions it. */
  readonly standard: string | null;
  readonly extraStrip?: readonly StripItem[];
  readonly children: ReactNode;
}

export function MwShell(props: MwShellProps) {
  const tabs = props.area === "fleet" ? FLEET_TABS : READINESS_TABS;
  const scopeValue = scopeParam(props.scope) ?? "all";
  return (
    <main className={s.root} data-mw-area={props.area} data-mw-tab={props.tab}>
      <LiveRefresh />
      <header className={s.header}>
        <Link href={areaHome("fleet", props.scope)} className={s.brand} aria-label="Control centre home">
          <Logo variant="wordmark" size={20} decorative />
        </Link>
        <nav className={s.areaToggle} aria-label="Area">
          <Link
            href={areaHome("fleet", props.scope)}
            className={`${s.areaBtn} ${props.area === "fleet" ? s.areaBtnOn : ""}`}
            aria-current={props.area === "fleet" ? "page" : undefined}
          >
            Fleet
          </Link>
          <Link
            href={areaHome("readiness", props.scope)}
            className={`${s.areaBtn} ${props.area === "readiness" ? s.areaBtnOn : ""}`}
            aria-current={props.area === "readiness" ? "page" : undefined}
          >
            Readiness
          </Link>
        </nav>
        <div className={s.headerRight}>
          <span className={s.scopeLabel} id="mw-scope-label">
            Scope
          </span>
          <ScopeSelect value={scopeValue} groups={props.scopeGroups} here={props.here} />
          <OtherPages scope={scopeValue} />
        </div>
      </header>

      <nav className={s.tabs} aria-label={props.area === "fleet" ? "Fleet" : "Readiness"}>
        {tabs.map((t) => (
          <Link
            key={t.id}
            href={withScope(t.path, props.scope)}
            className={`${s.tab} ${t.id === props.tab ? s.tabOn : ""}`}
            aria-current={t.id === props.tab ? "page" : undefined}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <div className={s.strip}>
        <span>
          SCOPE <span className={s.stripVal}>{props.scopeLabel}</span>
        </span>
        <span aria-hidden="true">·</span>
        <span>
          STANDARD <span className={props.standard ? s.stripVal : s.stripWarn}>{props.standard !== null ? props.standard : "not versioned yet"}</span>
        </span>
        <span aria-hidden="true">·</span>
        <span>
          OBSERVED{" "}
          <time className={s.stripVal} dateTime={props.observedAt} title={props.observedAt}>
            {formatEastern(props.observedAt, { year: true })}
          </time>
        </span>
        {(props.extraStrip ?? []).map((item) => (
          <span key={item.label} className={s.row10}>
            <span aria-hidden="true">·</span>
            <span>
              {item.label} <span className={item.warn ? s.stripWarn : s.stripVal}>{item.value}</span>
            </span>
          </span>
        ))}
      </div>

      <div className={s.container}>{props.children}</div>
    </main>
  );
}
