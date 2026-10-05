"use client";

/**
 * **THE PREVIEW EVERY CHANGE GOES THROUGH.**
 *
 * Shows what the action affects, local or whole system ("Whole system · affects
 * every state" in amber), selected versus all matching, cost and undo.
 * Send is focused on open; Escape closes; focus is kept inside the
 * dialog and returns to the control that opened it. Send is one action: the
 * idempotency key is fixed when the dialog opens, and the button turns off the
 * moment it is pressed, so a double click or a retried request is one send.
 */
import { easternLocalToIso as parseEasternTime } from "@/lib/control-plane/eastern-time.ts";
import { useEffect, useId, useRef, useState } from "react";

import type { ActionDef, Preview } from "./actions.ts";
import { cx, Facts } from "./ui.tsx";
import s from "./v6.module.css";

export interface DialogSend {
  readonly option: string | null;
  readonly words: string;
  readonly amount: string;
  readonly selected: readonly string[];
  readonly fields?: Readonly<Record<string,string>>;
  readonly startAt?: string;
}

export function ActionDialog(props: {
  readonly def: ActionDef;
  readonly preview: Preview;
  readonly mode: "live" | "sample";
  /** The eligibility reason, re-checked live while the dialog is open. */
  readonly blocked: string | null;
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
  const [fields,setFields] = useState<Readonly<Record<string,string>>>(Object.fromEntries((preview.fields ?? []).map(f=>[f.key,f.initial])));
  const [startTime,setStartTime] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    opener.current = document.activeElement;
    sendRef.current?.focus();
    return () => { (opener.current as HTMLElement | null)?.focus?.(); };
  }, []);

  const items = preview.items ?? [];
  const selected = items.filter((i) => !unticked.has(i.id)).map((i) => i.id);
  const chosen = preview.options?.find((o) => o.id === option) ?? null;
  const needOption = !!preview.options?.length && !chosen;
  const invalid = option === "schedule" && !parseEasternTime(startTime) ? "Choose a valid Eastern date and time." : preview.invalid?.({ option, words, amount, selected: selected.length }) ?? null;
  const reason = props.blocked ?? (chosen?.blocked ?? null) ?? invalid;
  const off = sent || needOption || !!reason;
  const global = preview.level === "global";
  const showWords = !!chosen?.ownWords || !!preview.note || def.kind === "global-runner-pause" || def.kind === "global-runner-resume";

  const send = () => {
    if (off) return;
    setSent(true);
    props.onSend({ option, words, amount, selected, fields, ...(option === "schedule" ? {startAt:parseEasternTime(startTime)!} : {}) });
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

        {option === "change" && preview.fields?.map(field => <label key={field.key} className={s.stack}>
          <span className={s.small}>{field.label}</span>
          {field.kind === "boolean" ? <select className={s.select} value={fields[field.key]} onChange={e=>setFields(v=>({...v,[field.key]:e.target.value}))}><option value="true">On</option><option value="false">Off</option></select>
            : <input className={s.input} type={field.kind === "number" ? "number" : "text"} value={fields[field.key]} onChange={e=>setFields(v=>({...v,[field.key]:e.target.value}))}/>}
        </label>)}
        {option === "schedule" && preview.schedule && <label className={s.stack}><span className={s.small}>Send at (Eastern time)</span><input className={s.input} type="datetime-local" value={startTime} onChange={e=>setStartTime(e.target.value)}/></label>}
        {preview.amount && (
          <label className={s.stack} style={{ gap: 4 }}>
            <span className={s.small}>{preview.amount.label}</span>
            <input className={s.input} inputMode={preview.amount.text ? "text" : "decimal"} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
        )}

        {showWords && (
          <label className={s.stack} style={{ gap: 4 }}>
            <span className={s.small}>{chosen?.ownWords ? chosen.wordsLabel ?? "Note" : "Add a note (optional)"}</span>
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
