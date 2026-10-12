"use client";
import { useState } from "react";
import type { playbookEditView } from "@/lib/control-plane/playbook-edit.ts";
import { mst } from "./model.ts";
import s from "./v6.module.css";

type Row = ReturnType<typeof playbookEditView>;
export interface PlaybookSend {
  readonly type: "playbook.update"; readonly role: Row["role"]; readonly text: string;
  readonly expectedVersion: string; readonly why: string; readonly undoOf?: string;
}

export function PlaybookEditor({ row, onSend }: { readonly row: Row; readonly onSend: (send: PlaybookSend) => Promise<void> }) {
  const [text, setText] = useState(row.text);
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(false);
  async function send(undo = false) {
    setBusy(true); setFailure(false);
    try { await onSend({ type: "playbook.update", role: row.role, expectedVersion: row.version, text: undo ? row.undo!.text : text,
      why: undo ? "Undo" : why, ...(undo ? { undoOf: row.undo!.id } : {}) }); }
    catch { setFailure(true); }
    finally { setBusy(false); }
  }
  return <section className={s.stack}>
    <h3>{row.label}</h3>
    <p>{row.changedAt ? `Changed ${mst(row.changedAt)}` : "Original instructions"}</p>
    <label>Instructions<textarea value={text} maxLength={100_000} rows={12} onChange={e => setText(e.target.value)} disabled={busy} /></label>
    <label>Note<input value={why} maxLength={2000} onChange={e => setWhy(e.target.value)} disabled={busy} /></label>
    <div className={s.inline}><button className={s.btn} type="button" disabled={busy || !text.trim() || text === row.text} onClick={() => void send()}>Change</button>
      {row.undo && <button className={s.btn} type="button" disabled={busy} onClick={() => void send(true)}>Undo</button>}</div>
    {failure && <p role="status">The instructions could not be saved. Refresh and try again.</p>}
    {row.history.length > 0 && <details><summary>Earlier instructions</summary>{[...row.history].reverse().map(change =>
      <div key={change.id}><p>{mst(change.at)}{change.factory ? ` · ${change.factory}` : ""}{change.why ? ` · ${change.why}` : ""}</p>
        <details><summary>Before</summary><pre>{change.before}</pre></details><details><summary>After</summary><pre>{change.after}</pre></details></div>)}</details>}
  </section>;
}
