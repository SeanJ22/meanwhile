"use client";

import { useRef, useState, type FormEvent } from "react";
import { knownKeyService, KEY_SERVICES, type KeyService, type KeyView } from "@/lib/core/keys-model.ts";
import { mst } from "./model.ts";
import { useReading } from "./use-reading.ts";
import { Pill } from "./ui.tsx";
import s from "./v6.module.css";

const ROUTE = "/api/admin/v6/keys";
export function KeysBox() {
  const { reading, reload, status } = useReading<{ rows: readonly KeyView[] }>(ROUTE);
  const [busy, setBusy] = useState(false), [says, setSays] = useState("");
  const [name, setName] = useState("");
  const [replacing, setReplacing] = useState<KeyView | null>(null);
  const keyInput = useRef<HTMLInputElement>(null);
  const [service, setService] = useState<KeyService>("anthropic");
  function replace(row: KeyView | null) {
    setReplacing(row); setName(row?.label ?? ""); setService(row?.service ?? "anthropic"); setSays("");
    if (keyInput.current) { keyInput.current.value = ""; keyInput.current.focus(); }
  }
  async function send(method: "POST" | "DELETE", body: unknown) {
    setBusy(true); setSays("");
    try {
      const response = await fetch(ROUTE, { method, credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as { says?: string };
      setSays(result.says ?? "The change could not be completed.");
      reload();
    } catch { setSays("The Keys box could not be reached. Check the saved keys before trying again."); }
    finally { setBusy(false); }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget, data = new FormData(form);
    const value = String(data.get("key") ?? "");
    // Clear before the request starts; a response, reload or validation error cannot redisplay it.
    const input = form.elements.namedItem("key") as HTMLInputElement;
    input.value = "";
    await send("POST", { name: replacing?.name ?? name, value, service });
  }
  return <section aria-labelledby="keys-title" className={s.stack}>
    <h3 id="keys-title" className={s.h3}>Keys</h3>
    {status}
    <form onSubmit={save} className={s.stack} autoComplete="off">
      <label className={s.stack}>Name <input className={s.input} name="name" required maxLength={80} value={name} readOnly={Boolean(replacing)} onChange={event => {
        setName(event.target.value); const known = knownKeyService(event.target.value.trim()); if (known) setService(known);
      }} /></label>
      <div className={s.stack}><label htmlFor="saved-key-service">What it is for</label><select id="saved-key-service" className={s.select} value={service} disabled={Boolean(knownKeyService(replacing?.name ?? name))} onChange={event => setService(event.target.value as KeyService)}>
        {Object.entries(KEY_SERVICES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></div>
      <label className={s.stack}>Key <input ref={keyInput} className={s.input} name="key" type="password" required maxLength={16_384} autoComplete="new-password" spellCheck={false} /></label>
      <button className={s.btn} type="submit" disabled={busy}>{busy ? "Saving and testing…" : replacing ? "Replace and test" : "Save and test"}</button>
      {replacing && <button type="button" className={s.btn} disabled={busy} onClick={() => replace(null)}>Add a different key</button>}
    </form>
    {says && <p role="status">{says}</p>}
    {reading.kind === "failed" && <p>The saved keys could not be read. <button className={s.btn} onClick={reload}>Try again</button></p>}
    {reading.kind === "ready" && <>
      {reading.data.rows.every(row => row.deleted) && <p>No keys saved yet.</p>}
      {reading.data.rows.filter(row => !row.deleted).map(row => <div key={row.name} className={s.stack}>
        <div className={s.inline}><strong>{row.label}</strong> <Pill tone={row.working ? "good" : "warn"}>{row.working ? "Working" : "Not working"}</Pill></div>
        <p>{row.purpose}</p><p>Last tested {row.testedAt ? mst(row.testedAt) : "—"}</p>
        {!row.working && <p>{row.says}</p>}
        <p>Runner last read {row.runnerReadAt ? mst(row.runnerReadAt) : "—"}</p>
        <p>Changed {mst(row.changedAt)}</p>
        <button type="button" className={s.btn} disabled={busy} onClick={() => replace(row)}>Replace {row.label}</button>
        <button type="button" className={s.btn} disabled={busy} onClick={() => void send("DELETE", { name: row.name })}>Delete {row.label}</button>
        {row.canUndo && <button type="button" className={s.btn} disabled={busy} onClick={() => void send("POST", { name: row.name, action: "undo" })}>Undo last change</button>}
        <details><summary>Earlier changes</summary>{row.history.map((change, i) => <p key={i}>{mst(change.at)} · {change.before} → {change.after}</p>)}</details>
        <details><summary>Technical details</summary><p>{row.name}</p></details>
      </div>)}
      {reading.data.rows.some(row => row.deleted) && <details><summary>Deleted keys</summary>
        {reading.data.rows.filter(row => row.deleted).map(row => <p key={row.name}>{row.label} · Deleted {mst(row.changedAt)} {row.canUndo &&
          <button type="button" className={s.btn} disabled={busy} onClick={() => void send("POST", { name: row.name, action: "undo" })}>Undo deletion</button>}</p>)}
      </details>}
    </>}
  </section>;
}
