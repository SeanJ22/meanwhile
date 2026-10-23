"use client";

import { useEffect, useId, useRef, useState } from "react";

import type { ActionDef, Preview } from "./actions.ts";
import { orderWhen, type OrderWhen, type WhenMode } from "./order-when.ts";
import { cx, Facts } from "./ui.tsx";
import s from "./v6.module.css";

export interface DialogSend {
  readonly option: string | null;
  readonly words: string;
  readonly amount: string;
  readonly selected: readonly string[];
  readonly when?: OrderWhen;
  /** The place chosen when the words named several. */
  readonly place?: string;
}

const CHOICES_SHOWN = 20;
type PlaceChoice = { readonly label: string; readonly words: string };
type PacketsReading =
  | { readonly state: "READ"; readonly governments: readonly unknown[]; readonly held: number; readonly blanks: number; readonly estimatedUsd: number | null;
      readonly families: readonly { readonly family: string; readonly name: string; readonly blanks: number; readonly held: number }[] }
  | { readonly state: "CHOICES"; readonly choices: readonly PlaceChoice[] }
  | { readonly state: "REFUSED"; readonly says: string };

/** What agents would hunt here, read before anything is sent. Words that name several places hand back their choices. */
function PacketsPreview(props: { readonly place: string; readonly onChoices: (choices: readonly PlaceChoice[]) => void }) {
  const { onChoices } = props;
  const [reading, setReading] = useState<PacketsReading | "loading" | "failed">("loading");
  useEffect(() => {
    const ctl = new AbortController();
    void fetch(`/api/admin/v6/hunt-preview?place=${encodeURIComponent(props.place)}`, { signal: ctl.signal, headers: { accept: "application/json" } })
      .then(res => res.ok ? res.json() as Promise<PacketsReading> : Promise.reject(new Error(`HTTP ${res.status}`)))
      .then(read => { setReading(read); if (read.state === "CHOICES") onChoices(read.choices); }, () => { if (!ctl.signal.aborted) setReading("failed"); });
    return () => ctl.abort();
  }, [props.place, onChoices]);
  if (reading === "loading") return <p className={s.meta}>Reading what we hold here…</p>;
  if (reading === "failed") return <p className={s.meta}>What we hold here could not be read just now.</p>;
  if (reading.state === "REFUSED") return <p className={s.meta}>{reading.says}</p>;
  if (reading.state === "CHOICES") return <p className={s.meta}>These words name {reading.choices.length} places. Choose the one you mean.</p>;
  const open = reading.families.filter(f => f.blanks > 0).sort((a, b) => b.blanks - a.blanks);
  return (
    <div className={s.stack} style={{ gap: 4 }}>
      <Facts rows={[
        ["Governments", reading.governments.length.toLocaleString("en-US")],
        ["Already held", `${reading.held.toLocaleString("en-US")} facts, never looked for again`],
        ["Blanks to hunt", reading.blanks.toLocaleString("en-US")],
        ["Estimated cost", reading.blanks === 0 ? "Nothing: every blank is held" : reading.estimatedUsd === null ? "Not known: the hunter's model has no stated price" : `About $${reading.estimatedUsd.toFixed(2)}`],
      ]} />
      {open.length > 0 && <p className={s.meta}>{open.slice(0, 8).map(f => `${f.name} ${f.blanks.toLocaleString("en-US")}`).join(" · ")}{open.length > 8 ? ` · and ${open.length - 8} more` : ""}</p>}
    </div>
  );
}

export function ActionDialog(props: {
  readonly def: ActionDef;
  readonly preview: Preview;
  readonly mode: "live" | "sample";
  readonly blocked: string | null;
  readonly afterOrders?: readonly {id:string;label:string}[];
  readonly onSend: (send: DialogSend) => void;
  readonly onClose: () => void;
}) {
  const { preview, def } = props;
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const sendRef = useRef<HTMLButtonElement>(null);
  const opener = useRef<Element | null>(null);
  const [option, setOption] = useState<string | null>(null);
  const [words, setWords] = useState("");
  const [amount, setAmount] = useState(preview.amount?.initial ?? "");
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(new Set());
  const [startTime,setStartTime] = useState("");
  const [whenMode,setWhenMode] = useState<WhenMode>("now");
  const [afterOrder,setAfterOrder] = useState("");
  const [repeat,setRepeat] = useState<"hourly"|"daily"|"weekly">("daily");
  const [finishTime,setFinishTime] = useState("");
  const offersWhen = !!def.gateway && !def.gateway.requiresStateVersion && !def.gateway.type.startsWith("orders.");
  const timing = orderWhen(whenMode,startTime,afterOrder,repeat,finishTime);
  const [sent, setSent] = useState(false);
  const [placeChoices, setPlaceChoices] = useState<readonly PlaceChoice[] | null>(null);
  const [chosenPlace, setChosenPlace] = useState<string | null>(null);

  useEffect(() => {
    opener.current = document.activeElement;
    sendRef.current?.focus();
    return () => { (opener.current as HTMLElement | null)?.focus?.(); };
  }, []);

  const items = preview.items ?? [];
  const selected = items.filter((i) => !unticked.has(i.id)).map((i) => i.id);
  const chosen = preview.options?.find((o) => o.id === option) ?? null;
  const needOption = !!preview.options?.length && !chosen;
  const whenInvalid = offersWhen && timing===null ? "Choose when this order should run." : null;
  const placeInvalid = placeChoices !== null && chosenPlace === null ? "Choose which place you mean." : null;
  const invalid = whenInvalid ?? placeInvalid ?? preview.invalid?.({ option, words, amount, selected: selected.length }) ?? null;
  const reason = props.blocked ?? (chosen?.blocked ?? null) ?? invalid;
  const off = sent || needOption || !!reason;
  const global = preview.level === "global";
  const showWords = !!chosen?.ownWords || !!preview.note || def.kind === "global-runner-pause" || def.kind === "global-runner-resume";

  const send = () => {
    if (off) return;
    setSent(true);
    props.onSend({ option, words, amount, selected, ...(offersWhen && timing ? {when:timing} : {}), ...(chosenPlace !== null ? { place: chosenPlace } : {}) });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.stopPropagation(); props.onClose(); return; }
    if (e.key !== "Tab" || !dialogRef.current) return;
    const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>("button, input, textarea, select, a[href]")].filter((el) => !el.hasAttribute("disabled"));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  return (
    <div className={s.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className={cx(s.dialog, global && s.dialogGlobal)} onKeyDown={onKeyDown}>
        <div className={s.inline}>
          <span className={cx(s.pill, global ? s["tone-warn"] : s["tone-neutral"])}>{global ? "Whole system · affects every state" : "Local"}</span>
          {props.mode === "sample" && <span className={cx(s.pill, s["tone-gold"])}>Sample preview</span>}
        </div>
        <h2 id={titleId} className={s.h2}>{preview.title}</h2>
        <Facts rows={preview.rows.map(([k, v]) => [k, v] as const).concat(items.length ? [["Selected", `${selected.length} of ${items.length}`] as const] : [])} />
        {preview.packetsFor && props.mode === "live" && <PacketsPreview place={chosenPlace ?? preview.packetsFor} onChoices={setPlaceChoices} />}
        {placeChoices !== null && (
          <div className={s.stack} role="radiogroup" aria-label="Which place">
            {placeChoices.length > CHOICES_SHOWN && <p className={s.meta}>Showing {CHOICES_SHOWN} of {placeChoices.length}. Add the state, like “Springfield, IL”, to narrow them.</p>}
            {placeChoices.slice(0, CHOICES_SHOWN).map((c) => (
              <button key={c.words} type="button" role="radio" aria-checked={chosenPlace === c.words} className={s.option} onClick={() => setChosenPlace(c.words)}>
                <strong style={{ fontSize: 13 }}>{c.label}</strong>
              </button>
            ))}
          </div>
        )}

        {!!preview.options?.length && (
          <div className={s.stack} role="radiogroup" aria-label="Choose one">
            {preview.options.map((o) => (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={option === o.id}
                aria-disabled={o.blocked ? "true" : undefined}
                className={s.option}
                onClick={() => setOption(o.id)}
              >
                <strong style={{ fontSize: 13 }}>{o.label}</strong>
                <span className={s.meta}>{o.note}</span>
                {o.blocked && <span className={s.why}>{o.blocked}</span>}
              </button>
            ))}
          </div>
        )}

        {!!items.length && (
          <fieldset className={s.stack} style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className={s.meta} style={{ marginBottom: 6 }}>Items</legend>
            {items.map((i) => (
              <label key={i.id} className={s.check}>
                <input type="checkbox" checked={!unticked.has(i.id)} onChange={() => setUnticked((u) => { const n = new Set(u); if (n.has(i.id)) n.delete(i.id); else n.add(i.id); return n; })} />
                <span>{i.name} <span className={s.meta}>· {i.where}</span></span>
              </label>
            ))}
          </fieldset>
        )}

        {offersWhen && <fieldset className={s.stack} style={{border:0,padding:0}}><legend>When</legend>
          <select className={s.select} aria-label="When" value={whenMode} onChange={e=>setWhenMode(e.target.value as WhenMode)}>
            <option value="now">Start now</option><option value="at">At a time</option><option value="after">After another order</option><option value="repeat">Repeat</option><option value="finish-by">Finish by a date</option>
          </select>
          {(whenMode==="at"||whenMode==="repeat") && <label>Start (Eastern time)<input className={s.input} type="datetime-local" value={startTime} onChange={e=>setStartTime(e.target.value)}/></label>}
          {whenMode==="after" && <label>After this order is Done<select className={s.select} value={afterOrder} onChange={e=>setAfterOrder(e.target.value)}><option value="">Choose an order</option>{props.afterOrders?.map(o=><option key={o.id} value={o.id}>{o.label}</option>)}</select></label>}
          {whenMode==="repeat" && <label>Repeat<select className={s.select} value={repeat} onChange={e=>setRepeat(e.target.value as typeof repeat)}><option value="hourly">Every hour</option><option value="daily">Every day</option><option value="weekly">Every week</option></select></label>}
          {whenMode==="finish-by" && <label>Finish by (Eastern time)<input className={s.input} type="datetime-local" value={finishTime} onChange={e=>setFinishTime(e.target.value)}/></label>}
        </fieldset>}
        {preview.amount && (
          <label className={s.stack} style={{ gap: 4 }}>
            <span className={s.small}>{preview.amount.label}</span>
            <input className={s.input} inputMode={preview.amount.text ? "text" : "decimal"} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
        )}

        {showWords && (
          <label className={s.stack} style={{ gap: 4 }}>
            <span className={s.small}>{chosen?.ownWords ? "Note" : preview.noteLabel ?? "Add a note (optional)"}</span>
            <textarea className={s.textarea} value={words} maxLength={1000} onChange={(e) => setWords(e.target.value)} />
          </label>
        )}

        {reason && <p className={s.why} role="alert">{reason}</p>}
        <div className={s.inline}>
          <button ref={sendRef} type="button" className={cx(s.btn, global ? s.btnGlobal : s.btnPrimary)} aria-disabled={off ? "true" : undefined} onClick={send}>
            {sent ? "Sending…" : needOption ? "Choose one first" : "Send"}
          </button>
          <button type="button" className={cx(s.btn, s.btnGhost)} onClick={props.onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
