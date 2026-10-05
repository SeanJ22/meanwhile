"use client";

/**
 * Small building blocks every v6 screen uses. Each control that changes
 * something is an `ActionButton`: it asks the one eligibility rule, shows the
 * first reason it is off, and opens the preview dialog. Nothing here sends.
 */
import { hasTechnicalText, plainWords } from "@/lib/control-plane/admin-view/plain-words.ts";
import { useEffect, useState, type ReactNode } from "react";

import type { SectionId } from "./contract.ts";

import { useV6 } from "./context.tsx";
import { STAGE_NAMES, type ActionRef, type Sourced, type StageMark, type UiReceipt } from "./model.ts";
import { STATUS_TONE } from "./receipts.ts";
import s from "./v6.module.css";

export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}

export function Card(props: { readonly title?: ReactNode; readonly aside?: ReactNode; readonly id?: string; readonly tone?: "warn" | "global"; readonly children: ReactNode; readonly labelledBy?: string }) {
  const headId = props.id ? `${props.id}-h` : undefined;
  return (
    <section id={props.id} aria-labelledby={props.title ? headId : props.labelledBy} className={cx(s.card, props.tone === "warn" && s.cardWarn, props.tone === "global" && s.cardGlobal)}>
      {(props.title || props.aside) && (
        <div className={s.cardHead}>
          {props.title && <h2 id={headId} className={s.h2}>{typeof props.title === "string" ? plainWords(props.title) : props.title}</h2>}
          {props.aside}
        </div>
      )}
      {props.children}
    </section>
  );
}

export function Pill(props: { readonly tone?: "neutral" | "info" | "good" | "gold" | "warn" | "slate"; readonly children: ReactNode; readonly title?: string }) {
  return <span className={cx(s.pill, s[`tone-${props.tone ?? "neutral"}`])} title={props.title}>{props.children}</span>;
}

export function ReceiptChip(props: { readonly receipt: UiReceipt }) {
  const r = props.receipt;
  return <Pill tone={r.notPickedUp ? "warn" : STATUS_TONE[r.status]}>{r.statusWords}{r.simulated ? " (sample)" : ""}</Pill>;
}

export function Loading(props: { readonly what: string }) {
  return <p className={cx(s.p, s.dim)} role="status">Loading {props.what}…</p>;
}

export function Failed(props: { readonly what: string; readonly retry?: () => void }) {
  return (
    <p className={cx(s.p, s.dim)} role="alert" aria-label={`${props.what} couldn’t be read`}>
      —{props.retry && <> <button type="button" className={s.btn} onClick={props.retry}>Try again</button></>}
    </p>
  );
}

/** A control that changes something. Off controls stay focusable and say why. */
export function ActionButton(props: { readonly action: ActionRef; readonly primary?: boolean; readonly label?: string }) {
  const v = useV6();
  const def = v.defOf(props.action);
  const why = v.whyNot(props.action);
  const global = def.preview({ target: props.action.target, targetName: "", scopeName: v.place.name, scopeIsCountry: v.place.kind === "Country", outreachAuthorized: v.access.outreachAuthorized }).level === "global";
  const label = props.label ?? props.action.label ?? def.label;
  return (
    <button
      type="button"
      className={cx(s.btn, global ? s.btnGlobal : props.primary && s.btnPrimary)}
      aria-disabled={why ? "true" : undefined}
      title={why ?? undefined}
      onClick={() => { if (!why) v.act(props.action); }}
    >
      {label}
    </button>
  );
}

/** A row of controls, followed once by the reasons any of them are off. */
export function Actions(props: { readonly actions: readonly ActionRef[]; readonly primaryFirst?: boolean }) {
  const v = useV6();
  if (!props.actions.length) return null;
  const reasons = [...new Set(props.actions.map((a) => v.whyNot(a)).filter((x): x is string => !!x))];
  return (
    <div className={s.stack} style={{ gap: 6 }}>
      <div className={s.inline}>
        {props.actions.map((a, i) => <ActionButton key={`${a.kind}|${a.target}|${i}`} action={a} primary={props.primaryFirst && i === 0} />)}
      </div>
      {reasons.map((r) => <p key={r} className={s.why}>{r}</p>)}
    </div>
  );
}

export function Facts(props: { readonly rows: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl className={s.facts}>
      {props.rows.map(([k, val]) => (
        <div key={k} style={{ display: "contents" }}>
          <dt>{k}</dt>
          <dd>{typeof val === "string" ? <>{plainWords(val)}{hasTechnicalText(val) && <Technical lines={[val]} />}</> : val}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Technical(props: { readonly lines: readonly string[]; readonly label?: string }) {
  if (!props.lines.length) return null;
  return (
    <details className={s.details}>
      <summary>{props.label === undefined ? "Technical details" : props.label}</summary>
      <ul className={s.tech}>{props.lines.map((l) => <li key={l}>{l}</li>)}</ul>
    </details>
  );
}

const MARK_WORDS: Readonly<Record<StageMark, string>> = {
  done: "done",
  "not-yet": "not yet",
  waiting: "waiting on an earlier step",
  wrong: "wrong",
  partial: "partly",
  reported: "reported, not checked on the page",
  unreported: "not reported",
};

export function StageDots(props: { readonly stages: readonly StageMark[] }) {
  const words = props.stages.map((m, i) => `${STAGE_NAMES[i]}: ${MARK_WORDS[m]}`).join(", ");
  return (
    <span className={s.dots} role="img" aria-label={words} title={words}>
      {props.stages.map((m, i) => (
        <span key={i} style={{ display: "inline-flex", alignItems: "center" }}>
          <span className={cx(s.dot, s[`mark-${m}`])} />
          {i < props.stages.length - 1 && <span className={cx(s.dotLine, m === "done" && props.stages[i + 1] === "done" && s.dotLineDone)} />}
        </span>
      ))}
    </span>
  );
}

export function markWords(m: StageMark): string {
  return MARK_WORDS[m];
}

export function Tabs<T extends string>(props: { readonly label: string; readonly tabs: readonly { readonly id: T; readonly label: string; readonly count?: number | string }[]; readonly value: T; readonly onChange: (id: T) => void }) {
  return (
    <div className={s.tabs} role="tablist" aria-label={props.label}>
      {props.tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={props.value === t.id}
          tabIndex={props.value === t.id ? 0 : -1}
          className={s.tab}
          onClick={() => props.onChange(t.id)}
          onKeyDown={(e) => {
            if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
            const i = props.tabs.findIndex((x) => x.id === props.value);
            const next = props.tabs[(i + (e.key === "ArrowRight" ? 1 : props.tabs.length - 1)) % props.tabs.length];
            props.onChange(next.id);
            const parent = e.currentTarget.parentElement;
            requestAnimationFrame(() => (parent?.querySelector('[aria-selected="true"]') as HTMLElement | null)?.focus());
          }}
        >
          {t.label}
          {t.count !== undefined && <span className={s.tabCount}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Paging over a list this page already holds. The note says what the full total is. */
export function usePager<T>(list: readonly T[], size: number): { readonly page: readonly T[]; readonly pager: ReactNode; readonly reset: () => void } {
  const [p, setP] = useState(0);
  const pages = Math.max(1, Math.ceil(list.length / size));
  const at = Math.min(p, pages - 1);
  const page = list.slice(at * size, at * size + size);
  const pager = list.length > size ? (
    <div className={s.inline}>
      <button type="button" className={s.btn} aria-disabled={at === 0 ? "true" : undefined} onClick={() => at > 0 && setP(at - 1)}>Previous</button>
      <span className={s.meta} aria-live="polite">Showing {at * size + 1}–{Math.min(list.length, at * size + size)} of {list.length}</span>
      <button type="button" className={s.btn} aria-disabled={at >= pages - 1 ? "true" : undefined} onClick={() => at < pages - 1 && setP(at + 1)}>Next</button>
    </div>
  ) : list.length ? <span className={s.meta}>Showing all {list.length}</span> : null;
  return { page, pager, reset: () => setP(0) };
}

export function Empty(props: { readonly children: ReactNode }) {
  return <p className={cx(s.p, s.dim, s.small)}>{props.children}</p>;
}

/**
 * Search, filters and paging for a list that may live on the server. When the
 * section arrived with page information (a live, indexed read), the filters go
 * to the server and the pager moves by cursor, so search covers the whole
 * population. Otherwise it pages the list this page holds.
 */
export function useListView<T>(input: {
  readonly section: SectionId;
  readonly page: Sourced<unknown>["page"];
  readonly list: readonly T[];
  readonly params: Readonly<Record<string, string>>;
  readonly size: number;
}): { readonly page: readonly T[]; readonly pager: ReactNode; readonly reset: () => void; readonly server: boolean } {
  const v = useV6();
  const server = !!input.page;
  const local = usePager(input.list, input.size);
  const key = JSON.stringify(input.params);
  const [cursor, setCursor] = useState("");
  useEffect(() => {
    if (server) v.query(input.section, { ...input.params, ...(cursor ? { cursor } : {}) });
    // v.query is stable in behaviour; the params key is the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server, key, cursor, input.section]);
  if (!server) return { ...local, server };
  const pg = input.page!;
  const pager = (
    <div className={s.inline}>
      <button type="button" className={s.btn} aria-disabled={pg.prevCursor ? undefined : "true"} onClick={() => pg.prevCursor && setCursor(pg.prevCursor)}>Previous</button>
      <span className={s.meta} aria-live="polite">{input.list.length} shown · {pg.total === null ? "total not counted yet" : `${pg.total.toLocaleString("en-US")} in all`}</span>
      <button type="button" className={s.btn} aria-disabled={pg.nextCursor ? undefined : "true"} onClick={() => pg.nextCursor && setCursor(pg.nextCursor)}>Next</button>
    </div>
  );
  return { page: input.list, pager, reset: () => setCursor(""), server };
}
