"use client";
import { useRef, useState } from "react";
import type { playbookEditView } from "@/lib/control-plane/playbook-edit.ts";
import { mst } from "./model.ts";
import s from "./v6.module.css";

type Row = ReturnType<typeof playbookEditView>;
export interface PlaybookSend {
  readonly type: "playbook.update"; readonly role: Row["role"]; readonly text: string;
  readonly expectedVersion: string; readonly why: string; readonly undoOf?: string;
}

export function PlaybookEditor({ row, onSend }: { readonly row: Row; readonly onSend: (send: PlaybookSend, key: string) => Promise<string> }) {
  const [text, setText] = useState(row.text);
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const pending = useRef<{ body: string; key: string } | null>(null);
  async function send(undo = false) {
    setBusy(true); setStatus("");
    const change: PlaybookSend = { type: "playbook.update", role: row.role, expectedVersion: row.version, text: undo ? row.undo!.text : text,
      why: undo ? "Undo" : why, ...(undo ? { undoOf: row.undo!.id } : {}) };
    const body = JSON.stringify(change);
    if (pending.current?.body !== body) pending.current = { body, key: crypto.randomUUID() };
    try { setStatus(await onSend(change, pending.current.key)); }
    catch (error) { setStatus(error instanceof Error ? error.message : "The instructions could not be saved. Try again."); }
    finally { setBusy(false); }
  }
  return <section className={s.stack}>
    <h3>{row.label}</h3>
    {row.stuck && <p role="status">Stuck: {row.stuck}</p>}
    <p>{!row.text.trim() ? "Instructions need to be restored." : row.changedAt ? `Changed ${mst(row.changedAt)}` : "Original instructions"}</p>
    <label>Instructions<textarea className={s.textarea} aria-label={row.label} value={text} maxLength={100_000} rows={12} onChange={e => setText(e.target.value)} disabled={busy} /></label>
    <label>Note<input value={why} maxLength={2000} onChange={e => setWhy(e.target.value)} disabled={busy} /></label>
    <div className={s.inline}><button className={s.btn} type="button" disabled={busy || !text.trim() || text === row.text} onClick={() => void send()}>Save</button>
      {row.undo && <button className={s.btn} type="button" disabled={busy} onClick={() => void send(true)}>Undo</button>}</div>
    {status && <p role="status">{status}</p>}
    {row.history.length > 0 && <details><summary>Earlier instructions</summary>{[...row.history].reverse().map(change =>
      <div key={change.id}><p>{mst(change.at)}{change.factory ? ` · ${change.factory}` : ""}{change.why ? ` · ${change.why}` : ""}</p>
        <details><summary>Before</summary><pre>{change.before}</pre></details><details><summary>After</summary><pre>{change.after}</pre></details></div>)}</details>}
  </section>;
}
