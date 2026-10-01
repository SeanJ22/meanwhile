"use client";

/**
 * The shell's two client islands: the one scope select and the Other pages
 * menu. (Admin redesign, 2026-09-23.)
 *
 * The scope select navigates to the same page at the new scope inside a
 * transition, so the choice shows at once and the current page stays on
 * screen until the server has rendered the scoped reading — the owner's
 * 9.4.26 complaint that a dropdown "did nothing" for a whole round trip is not
 * repeated. A container choice is scoped by its own lookup address; nothing
 * about an earlier choice survives a new one.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import s from "./mw.module.css";
import { areaHome, parseScope, withScope } from "./scope.ts";

export interface ScopeOption {
  /** The `?scope=` value, or "all". */
  readonly value: string;
  readonly label: string;
}

export interface ScopeOptionGroup {
  readonly label: string | null;
  readonly options: readonly ScopeOption[];
}

export function ScopeSelect(props: { value: string; groups: readonly ScopeOptionGroup[]; here: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [chosen, setChosen] = useState<string | null>(null);
  const shown = pending && chosen !== null ? chosen : props.value;
  return (
    <>
      <select
        className={s.select}
        value={shown}
        aria-labelledby="mw-scope-label"
        onChange={(e) => {
          const next = e.target.value;
          setChosen(next);
          startTransition(() => {
            // The page's own view parameters (an opened container, a sub-view)
            // belong to the old scope; only the path survives a scope change —
            // except on a Readiness state page, whose path IS the state.
            const path = props.here.split("?")[0];
            const scope = parseScope(next);
            router.push(/^\/readiness(\/[a-z]{2})?$/.test(path) ? areaHome("readiness", scope) : withScope(path, scope));
          });
        }}
      >
        {props.groups.map((g, i) =>
          g.label === null ? (
            g.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))
          ) : (
            <optgroup key={`${g.label}-${i}`} label={g.label}>
              {g.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ),
        )}
      </select>
      {pending && (
        <span className={s.pending} role="status" aria-live="polite">
          Loading…
        </span>
      )}
    </>
  );
}

/**
 * Pages the design does not draw a screen for. They keep their content and
 * render inside this same shell; this menu is the one way to reach them, so
 * there is no second navigation competing with the areas and tabs.
 */
export const OTHER_PAGES: readonly { readonly href: string; readonly label: string; readonly note: string }[] = [
  { href: "/admin/command-center", label: "Command center", note: "Seven connected views; unavailable readings are labelled until their backend is ready" },
  { href: "/admin/changes", label: "Changes", note: "One line per change from any session: building, on test, deploying, live" },
  { href: "/admin/research", label: "Runner and research detail", note: "Pause, resume, start a cycle now, every attempt" },
  { href: "/admin/sources", label: "Sources and APIs", note: "Published versus reader-visible, per routine contract" },
  { href: "/admin/reader", label: "What readers are doing", note: "Aggregate reader activity" },
  { href: "/admin/feedback", label: "Feedback", note: "Your feedback folders and what became of them" },
  { href: "/admin/agents", label: "Delegated work", note: "Work handed to agents and its state" },
  { href: "/admin/chat", label: "Ask the console", note: "Questions about the system, answered from its records" },
  { href: "/admin/fleet", label: "Fleet operations map", note: "Triage bands, work in flight, panels and blind spots" },
];

export function OtherPages(props: { scope: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const scope = parseScope(props.scope);
  return (
    <div ref={box} style={{ position: "relative" }}>
      <button type="button" className={s.otherBtn} aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((v) => !v)}>
        Other pages
      </button>
      {open && (
        <div className={s.otherMenu} role="menu">
          {OTHER_PAGES.map((p) => (
            <Link key={p.href} href={withScope(p.href, scope)} className={s.otherItem} role="menuitem" onClick={() => setOpen(false)}>
              {p.label}
              <span className={s.otherItemNote}>{p.note}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
