"use client";
// @server-boundary-exempt CommandCenter takes a live Executor object and callbacks; only client entry points (LiveCommandCenter, the dev preview harness) render it, never a Server Component.

/**
 * **MEANWHILE ADMIN COMMAND CENTER (v6).** The seven screens in one shell.
 *
 * This component owns only interface state: which screen, which detail, the
 * picker, the search box, the open action preview, and the receipts of sends
 * made on this page. Data arrives as `AdminV6Data` (live: from LiveSync;
 * development preview: from ./sample/). Outcomes come only from the executor.
 *
 * Scope, filters, open detail and unsent input survive data refreshes because
 * refreshing replaces `data`, never this component's state.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { easternMonth, isPeriod, periodGroups } from "@/lib/control-plane/admin-view/periods.ts";

import { ActionDialog, type DialogSend } from "./action-dialog.tsx";
import { ChangesView } from "./changes-view.tsx";
import { ChatView } from "./chat-view.tsx";
import { actionDef, isZipPlace, type PreviewContext } from "./actions.ts";
import { BulkHunts, bulkPickOf, type BulkItem, type BulkMission, type BulkPick } from "./bulk-hunts.tsx";
import type { SectionId } from "./contract.ts";
import { V6Context, VIEWS, type Detail, type V6, type View } from "./context.tsx";
import { DetailPanel } from "./details.tsx";
import { whyNot, type Access, type Connection } from "./eligibility.ts";
import type { Executor } from "./executor.ts";
import { mst, type ActionKind, type ActionRef, type AdminV6Data, type Place, type UiReceipt } from "./model.ts";
import { breadcrumbs, COUNTRY_KEY, huntAt, huntsWithin, indexPlaces, pickerMatches } from "./places.ts";
import { newActionKey, startReceipt } from "./receipts.ts";
import { ChecklistScreen } from "./screen-checklist.tsx";
import { QueueScreen } from "./screen-queue.tsx";
import { ScoreboardScreen } from "./screen-scoreboard.tsx";
import { MoneyScreen } from "./screen-money.tsx";
import { DataBusinessScreen } from "./screen-data.tsx";
import { NowScreen, Readers } from "./screen-now.tsx";
import { ReportsView, DailyBrief, AlertStrip } from "./reports-view.tsx";
import { OwedPanel } from "./owed-panel.tsx";
import { RunnerSettingsPanel, SettingsScreen } from "./screen-settings.tsx";
import { DoorsPanel } from "./doors-panel.tsx";
import { UpdatesPanel } from "./updates-panel.tsx";
import { WorkersScreen } from "./screen-workers.tsx";
import { cx } from "./ui.tsx";
import s from "./v6.module.css";

export interface CommandCenterProps {
  readonly data: AdminV6Data;
  readonly mode: "live" | "sample";
  readonly executor: Executor;
  readonly scopeKey: string;
  readonly onScopeChange: (key: string) => void;
  readonly connection: Connection;
  readonly lastGoodAt: string | null;
  readonly recovered: boolean;
  readonly access: Access;
  /** Item-state reason (eligibility rule 5), when the data source knows one. */
  readonly itemState?: (kind: ActionKind, target: string) => string | null;
  readonly initialView?: View;
  /** The console's own controls, in words, for the Ask view to list. Read on the server. */
  readonly chatControls?: readonly string[];
  readonly onViewChange?: (view: View) => void;
  /** Live paged sections: forward search, filters and cursors to the data source. */
  readonly onQuery?: (section: SectionId, params: Readonly<Record<string, string>>) => void;
  /** Extra header content for the development preview's review controls. */
  readonly reviewPanel?: ReactNode;
}

const CONN_WORDS: Readonly<Record<Connection, string>> = {
  connecting: "Connecting",
  live: "Live",
  stale: "Out of date",
  reconnecting: "Reconnecting",
  offline: "Disconnected",
};

export function CommandCenter(props: CommandCenterProps) {
  const { data } = props;
  const [view, setView] = useState<View>(props.initialView === "work" ? "queue" : props.initialView ?? "now");
  const [stack, setStack] = useState<readonly { readonly view: View; readonly detail: Detail | null }[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQ, setPickerQ] = useState("");
  const [query, setQuery] = useState("");
  const [period, setPeriod] = useState(() => easternMonth(new Date()));
  const [sent, setSent] = useState<readonly UiReceipt[]>([]);
  const [dialog, setDialog] = useState<{ readonly ref: ActionRef; readonly key: string } | null>(null);
  const [announce, setAnnounce] = useState("");
  /** The many-hunts panel: closed (null), or open with the place it was opened from, if any. */
  const [bulk, setBulk] = useState<{ readonly pick: BulkPick | null } | null>(null);
  const sendingKeys = useRef(new Set<string>());
  const pickerInput = useRef<HTMLInputElement>(null);
  const pickerButton = useRef<HTMLButtonElement>(null);
  const mainRef = useRef<HTMLElement>(null);

  /** ZIPs the owner typed into Change place that no hunt or visit had listed: the state comes from the national ZIP index. */
  const [typedZips, setTypedZips] = useState<readonly Place[]>([]);
  const places = useMemo(() => {
    const listed = data.places.data ?? [];
    // The hunts read answers only for hunts the server bound to a district or county (their ZIPs are in it), so each is inside the place in view.
    const proven = /^geo:[a-z]{2}\.(congressional_district|county)\./.test(props.scopeKey) ? new Set((data.hunts.data ?? []).map((h) => h.placeKey)) : null;
    const base = proven === null || proven.size === 0 ? listed
      : listed.map((p) => (proven.has(p.key) && !p.within.includes(props.scopeKey) ? { ...p, within: [...p.within, props.scopeKey] } : p));
    const have = new Set(base.map((p) => p.key));
    const extra = typedZips.filter((p) => !have.has(p.key));
    return extra.length === 0 ? base : [...base, ...extra];
  }, [data.places.data, data.hunts.data, props.scopeKey, typedZips]);
  const typedZip = /^[0-9]{5}$/.test(pickerQ.trim()) ? pickerQ.trim() : null;
  const typedZipListed = typedZip !== null && places.some((p) => p.key.endsWith(`.zcta.${typedZip}`));
  const index = useMemo(() => indexPlaces(places), [places]);
  const hunts = useMemo(() => data.hunts.data ?? [], [data.hunts.data]);
  const place: Place = index.get(props.scopeKey) ?? index.get(COUNTRY_KEY) ?? { key: COUNTRY_KEY, name: "United States", kind: "Country", navParent: null, within: [] };
  const scopeKey = place.key;
  const hunt = huntAt(index, hunts, scopeKey);
  const inHunts = huntsWithin(index, hunts, scopeKey);
  const clock = new Date();
  const earliestMonth = (data.spend.data?.byMonth ?? []).map((m) => m.month).sort()[0] ?? null;
  const effectivePeriod = isPeriod(period, clock, earliestMonth) ? period : easternMonth(clock);

  const receipts = useMemo(() => {
    const keys = new Set(sent.map((r) => r.key));
    // History rows carry the place key; the page names it from its own place list.
    return [...sent, ...(data.history.data ?? []).filter((r) => !keys.has(r.key)).map((r) => ({ ...r,
      scopeName: index.get(r.scopeKey)?.name ?? r.scopeName, targetName: index.get(r.target)?.name ?? r.targetName }))];
  }, [sent, data.history.data, index]);

  const nameOf = (id: string): string => {
    const stuck = data.stuck.data?.find((i) => i.id === id);
    if (stuck) return stuck.title;
    const res = data.results.data?.find((r) => r.id === id);
    if (res) return res.title;
    const fix = data.fixes.data?.open.find((f) => f.id === id);
    if (fix) return fix.title;
    const p = index.get(id);
    if (p) return p.name;
    for (const r of data.results.data ?? []) for (const st of r.trail) for (const d of st.docs ?? []) if (d.id === id) return d.name;
    const job = data.workers.data?.jobs?.find((j) => j.id === id);
    if (job) return job.title;
    const dec = data.stuck.data?.find((i) => i.decision?.id === id);
    if (dec) return dec.title;
    return id;
  };

  const previewCtx = (ref: ActionRef): PreviewContext => {
    const openFix = data.fixes.data?.open.find((f) => f.id === ref.target);
    const stuckForFix = data.stuck.data?.find((i) => i.fixId === ref.target);
    return {
      target: ref.target,
      targetName: ref.payload?.name ?? nameOf(ref.target || scopeKey),
      scopeName: index.get(ref.target)?.name ?? place.name,
      scopeIsCountry: (index.get(ref.target)?.kind ?? place.kind) === "Country",
      hunt: hunts.find((h) => h.placeKey === ref.target) ?? null,
      decision: data.stuck.data?.find((i) => i.decision?.id === ref.target)?.decision,
      fix: openFix ? { id: openFix.id, title: openFix.title, owner: openFix.owner, resourcesNow: openFix.resourcesNow, helps: openFix.helps, needsCode: openFix.origin === "engineering" && openFix.tab !== "update" }
        : stuckForFix ? { id: ref.target, title: nameOf(ref.target), owner: stuckForFix.owner, resourcesNow: "Not reported", helps: stuckForFix.title, needsCode: true } : undefined,
      url: ref.payload?.url,
      words: ref.payload?.words,
      payload: ref.payload,
      outreachAuthorized: props.access.outreachAuthorized,
    };
  };

  const whyNotRef = (ref: ActionRef): string | null => {
    const def = actionDef(ref.kind);
    const target = ref.target;
    return whyNot({ connection: props.connection, access: props.access, def, target, receipts, mode: props.mode, supported: props.executor.supports(def), itemState: props.itemState?.(ref.kind, target) ?? null });
  };

  const update = (next: UiReceipt) => {
    setSent((list) => list.some((r) => r.key === next.key) ? list.map((r) => (r.key === next.key ? next : r)) : [next, ...list]);
    setAnnounce(`${next.label}: ${next.statusWords}.`);
  };

  const doSend = (ref: ActionRef, key: string, send: DialogSend) => {
    if (sendingKeys.current.has(key)) return; // one send per preview, however many clicks
    sendingKeys.current.add(key);
    const def = actionDef(ref.kind);
    const target = ref.target;
    const ctx = previewCtx({ ...ref, target });
    const pv = def.preview(ctx);
    const optionLabel = pv.options?.find((o) => o.id === send.option)?.label;
    const receipt = startReceipt({
      key, def, target, targetName: ctx.targetName, label: optionLabel ? `${def.label}: ${optionLabel}` : ref.label ?? def.label,
      scopeKey, scopeName: place.name, level: pv.level, at: new Date().toISOString(), simulated: props.mode === "sample", words: send.words.trim() || undefined,
    });
    update(receipt);
    setDialog(null);
    void props.executor.send(receipt, { def, target, scopeKey, option: send.option, words: send.words, amount: send.amount, selectedItems: send.selected, fields:send.fields, startAt:send.startAt, when:send.when, payload: ref.payload }, update);
  };

  const doSendBulk = (send: { readonly items: readonly BulkItem[]; readonly missions: readonly BulkMission[]; readonly priority: number }) => {
    const def = actionDef("hunt-start-many");
    const key = newActionKey();
    if (sendingKeys.current.has(key)) return;
    sendingKeys.current.add(key);
    const receipt = startReceipt({
      key, def, target: "hunts", targetName: send.missions.length > 0 && send.items.length === 0 ? `${send.missions.length.toLocaleString("en-US")} mission${send.missions.length === 1 ? "" : "s"}` : `${(send.items.length + send.missions.length).toLocaleString("en-US")} hunts`, label: def.label,
      scopeKey, scopeName: place.name, level: "global", at: new Date().toISOString(), simulated: props.mode === "sample",
    });
    update(receipt);
    setBulk(null);
    void props.executor.send(receipt, { def, target: "hunts", scopeKey, option: null, words: "", amount: "", selectedItems: [], payload: { items: JSON.stringify([...send.items, ...send.missions.map((m) => ({ geography: m.geography, budgetUsd: m.budgetUsd, group: null }))]), priority: String(send.priority) } }, update);
  };

  const openDetail = (d: Detail) => {
    setStack((st) => [...st, { view, detail }].slice(-20));
    setDetail(d);
    requestAnimationFrame(() => { window.scrollTo(0, 0); mainRef.current?.focus(); });
  };

  const goView = (requested: View) => {
    const v = requested === "work" ? "queue" : requested;
    setStack((st) => (v === view && !detail ? st : [...st, { view, detail }].slice(-20)));
    setView(v);
    setDetail(null);
    props.onViewChange?.(v);
    requestAnimationFrame(() => window.scrollTo(0, 0));
  };

  const back = () => {
    const last = stack[stack.length - 1];
    if (!last) return;
    setStack(stack.slice(0, -1));
    setView(last.view);
    setDetail(last.detail);
  };

  const setScope = (key: string) => {
    setPickerOpen(false);
    setPickerQ("");
    if (detail) setDetail(null);
    props.onScopeChange(key);
    setPeriod(easternMonth(new Date()));
  };

  useEffect(() => {
    if (pickerOpen) pickerInput.current?.focus();
  }, [pickerOpen]);
  useEffect(() => {
    if (typedZip === null || typedZipListed) return;
    const ctl = new AbortController();
    void fetch(`/api/admin/v6/zip?zip=${typedZip}`, { signal: ctl.signal, headers: { accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { zip?: string; state?: string } | null) => {
        if (!body || body.zip !== typedZip || !/^[a-z]{2}$/.test(body.state ?? "")) return;
        const state = body.state as string;
        setTypedZips((held) => (held.some((p) => p.key.endsWith(`.zcta.${typedZip}`)) ? held
          : [...held, { key: `geo:${state}.zcta.${typedZip}`, name: `ZIP ${typedZip}`, kind: "ZIP", navParent: `st:${state}`, within: [`st:${state}`] }]));
      })
      .catch(() => undefined);
    return () => ctl.abort();
  }, [typedZip, typedZipListed]);

  const v6: V6 = {
    data, mode: props.mode, scopeKey, place, places, index, hunts, connection: props.connection, access: props.access, receipts, period: effectivePeriod,
    go: goView,
    open: openDetail,
    setScope,
    whyNot: whyNotRef,
    act: (ref) => {
      if (whyNotRef(ref)) return;
      // A single hunt starts from a ZIP; from a state, county or district the many-hunts panel does it.
      if (ref.kind === "hunt-start" && !isZipPlace(ref.target)) { setBulk({ pick: bulkPickOf(ref.target, nameOf(ref.target)) }); return; }
      setDialog({ ref, key: newActionKey() });
    },
    check: (r) => { const p = props.executor.check(r, actionDef(r.kind), update); if (p) void p; },
    canCheck: () => {
      if (props.connection !== "live") return "Reconnect first.";
      return props.executor.canCheck() ? null : "Checking isn’t available yet.";
    },
    defOf: (ref) => actionDef(ref.kind),
    nameOf,
    query: (section, params) => props.onQuery?.(section, params),
  };

  const crumbs = breadcrumbs(index, scopeKey);
  const scopeKind = `${place.kind}${hunt ? (hunt.placeKey === scopeKey ? ` · has a hunt (${hunt.name})` : ` · inside ${hunt.name}`) : inHunts.length ? ` · ${inHunts.length} ${inHunts.length === 1 ? "hunt" : "hunts"} inside` : data.hunts.state === "live" ? " · no hunt" : ""}`;
  const pickerHits = pickerMatches(places, hunts, pickerQ);
  const connWarn = props.connection !== "live";
  const lastGood = props.lastGoodAt ? mst(props.lastGoodAt, false) : null;
  const connLabel = props.connection === "live" ? (lastGood ? `Live · updated ${lastGood}` : "Live") : `${CONN_WORDS[props.connection]}${lastGood ? ` · last update ${lastGood}` : ""}`;
  const dialogDef = dialog ? actionDef(dialog.ref.kind) : null;
  const dialogTarget = dialog ? dialog.ref.target : "";

  return (
    <V6Context.Provider value={v6}>
      <div className={s.root}>
        <a className={s.skip} href="#v6-main">Skip to the page</a>
        <header className={s.header}>
          <div className={s.headerTop}>
            <span className={s.brand}>meanwhile<span style={{ color: "var(--pill-teal-text)" }}> …</span></span>
            <nav className={s.nav} aria-label="Admin">
              {VIEWS.map(([id, label]) => (
                <button key={id} type="button" className={s.navBtn} aria-current={view === id && !detail ? "page" : undefined} onClick={() => goView(id)}>{label}</button>
              ))}
            </nav>
            {props.mode === "sample" ? <span className={s.badge}>SAMPLE DATA</span> : null}
            <button type="button" className={s.navBtn} onClick={() => setBulk({ pick: isZipPlace(scopeKey) ? null : bulkPickOf(scopeKey, place.name) })}>Start many hunts</button>
            <form className={s.search} role="search" onSubmit={(e) => { e.preventDefault(); if (query.trim()) openDetail({ type: "search", query: query.trim() }); }}>
              <input className={s.input} aria-label="Search everything in the selected place" placeholder="Search bodies, people, meetings, requirements, failures" value={query}
                onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setQuery(""); }} />
            </form>
          </div>
          <div className={s.scopeBar}>
            <nav className={s.crumbs} aria-label="Where you are">
              {crumbs.map((c, i) => (
                <span key={c.key} className={s.inline} style={{ gap: 6 }}>
                  <button type="button" className={s.crumb} aria-current={i === crumbs.length - 1 ? "location" : undefined} onClick={() => i < crumbs.length - 1 && setScope(c.key)}>{c.name}</button>
                  {i < crumbs.length - 1 && <span className={s.crumbSep} aria-hidden="true">›</span>}
                </span>
              ))}
            </nav>
            {scopeKey !== COUNTRY_KEY && <button type="button" className={cx(s.btn, s.btnPrimary)} onClick={() => setScope(COUNTRY_KEY)}>← United States</button>}
            <button ref={pickerButton} type="button" className={s.btn} aria-expanded={pickerOpen} aria-controls="v6-picker" onClick={() => setPickerOpen((o) => !o)}>Change place</button>
            <span className={s.dim}>{scopeKind}</span>
            <label className={s.inline} style={{ gap: 6 }}>
              <span className={s.dim}>Period</span>
              <select className={s.select} value={effectivePeriod} onChange={(e) => setPeriod(e.target.value)}>
                {periodGroups(clock, earliestMonth).map((g) => g.label === null
                  ? g.options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)
                  : <optgroup key={g.label} label={g.label}>{g.options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</optgroup>)}
              </select>
            </label>
            <span role="status" aria-live="polite" className={cx(s.connection, connWarn ? s.connWarn : s.connLive)}>
              <span aria-hidden="true" className={cx(s.connDot, props.connection === "reconnecting" && s.pulse)} />
              {connLabel}
            </span>
          </div>
          {pickerOpen && (
            <div id="v6-picker" className={s.picker} role="dialog" aria-label="Choose a place"
              onKeyDown={(e) => { if (e.key === "Escape") { setPickerOpen(false); pickerButton.current?.focus(); } }}>
              <input ref={pickerInput} className={s.input} aria-label="Find a state, district, county, ZIP, body or hunt" placeholder="Type a state, district (AZ-06), county, ZIP or hunt" value={pickerQ}
                onChange={(e) => setPickerQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && pickerHits[0]) setScope(pickerHits[0].key); }} />
              <div className={s.pickerGrid}>
                {pickerHits.map((p) => {
                  const h = hunts.find((x) => x.placeKey === p.key && x.status !== "stopped");
                  return (
                    <button key={p.key} type="button" className={s.pickerHit} onClick={() => setScope(p.key)}>
                      <span style={{ fontSize: 13 }}>{p.name}</span>
                      <span className={s.meta}>{p.kind} · {h ? `hunt: ${h.name}` : p.kind === "State" ? (p.tracked ? "tracked" : "no hunt") : p.navParent ? `in ${index.get(p.navParent)?.name ?? ""}` : ""}</span>
                    </button>
                  );
                })}
                {!pickerHits.length && <span className={s.meta}>No place matches “{pickerQ}”.</span>}
              </div>
            </div>
          )}
        </header>

        <main id="v6-main" ref={mainRef} tabIndex={-1} className={s.main} style={{ outline: "none" }}>
          {props.reviewPanel}
          {props.mode==="live"&&<AlertStrip/>}
          {connWarn && props.connection !== "connecting" && (
            <div className={cx(s.banner, props.connection === "reconnecting" && s.bannerCalm)} role="status">
              <strong>{props.connection === "stale" ? "These figures are out of date." : props.connection === "reconnecting" ? "Reconnecting." : "Disconnected."}</strong>
              {lastGood && <span className={s.small}>Last good data from {lastGood}</span>}
            </div>
          )}
          {props.recovered && (
            <div className={cx(s.banner, s.bannerGood)} role="status">
              <strong>Back online.</strong>
            </div>
          )}
          {detail && stack.length > 0 && (
            <div><button type="button" className={s.btnLink} onClick={back}>← Back</button></div>
          )}
          {detail ? <DetailPanel detail={detail} /> : (
            <>
              {view === "now" && <>{props.mode==="live"&&<DailyBrief/>}<NowScreen key={scopeKey} /><UpdatesPanel /></>}
              {view === "data" && <DataBusinessScreen />}
              {view === "workers" && <><WorkersScreen /><RunnerSettingsPanel /><DoorsPanel /></>}
              {view === "checklist" && <><ChecklistScreen /><Readers /></>}
              {view === "money" && <MoneyScreen />}
              {view === "queue" && <QueueScreen />}
              {view === "scoreboard" && <ScoreboardScreen />}
              {view === "settings" && <><SettingsScreen /><OwedPanel /></>}
              {view === "reports" && <ReportsView />}
              {view === "changes" && <ChangesView />}
              {view === "chat" && <ChatView controls={props.chatControls ?? []} />}
            </>
          )}
        </main>
        <span className={s.srOnly} role="status" aria-live="polite">{announce}</span>

        {bulk && (
          <BulkHunts
            initialPick={bulk.pick}
            blocked={whyNotRef({ kind: "hunt-start-many", target: "hunts" })}
            onSend={doSendBulk}
            onClose={() => setBulk(null)}
          />
        )}

        {dialog && dialogDef && (
          <ActionDialog
            def={dialogDef}
            preview={dialogDef.preview(previewCtx({ ...dialog.ref, target: dialogTarget }))}
            mode={props.mode}
            blocked={whyNotRef({ ...dialog.ref, target: dialogTarget })}
            onClose={() => setDialog(null)}
            afterOrders={receipts.filter(r=>r.gatewayReceiptId).map(r=>({id:r.gatewayReceiptId!,label:r.label}))}
            onSend={(send) => doSend(dialog.ref, dialog.key, send)}
          />
        )}
      </div>
    </V6Context.Provider>
  );
}
