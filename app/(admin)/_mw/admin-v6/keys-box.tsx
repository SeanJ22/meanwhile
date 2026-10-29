"use client";

import { useState, type FormEvent } from "react";
import { KEY_NAMES, KEY_SERVICES, type KeyService, type KeyView } from "@/lib/core/keys-model.ts";
import { mst } from "./model.ts";
import { useReading } from "./use-reading.ts";
import { Pill } from "./ui.tsx";
import s from "./v6.module.css";

const ROUTE = "/api/admin/v6/keys";
export function KeysBox() {
  const { reading, reload, status } = useReading<{ rows: readonly KeyView[] }>(ROUTE);
  const [busy, setBusy] = useState(false), [says, setSays] = useState("");
  const [name, setName] = useState("");
  const [service, setService] = useState<KeyService>("anthropic");
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
    await send("POST", { name, value, service });
  }
  return <section aria-labelledby="keys-title" className={s.stack}>
    <h3 id="keys-title" className={s.h3}>Keys</h3>
    {status}
    <form onSubmit={save} className={s.stack} autoComplete="off">
      <label>Name <input name="name" required maxLength={80} value={name} onChange={event => {
        setName(event.target.value); const known = KEY_NAMES[event.target.value.trim()]; if (known) setService(known);
      }} /></label>
      <label>What it is for <select value={service} onChange={event => setService(event.target.value as KeyService)}>
        {Object.entries(KEY_SERVICES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
      <label>Key <input name="key" type="password" required maxLength={16_384} autoComplete="new-password" spellCheck={false} /></label>
      <button className={s.btn} type="submit" disabled={busy}>{busy ? "Saving and testing…" : "Save and test"}</button>
    </form>
    {says && <p role="status">{says}</p>}
    {reading.kind === "failed" && <p>The saved keys could not be read. <button className={s.btn} onClick={reload}>Try again</button></p>}
    {reading.kind === "ready" && <>
      {reading.data.rows.length === 0 && <p>No keys saved yet.</p>}
      {reading.data.rows.map(row => <div key={row.name} className={s.stack}>
        <div className={s.inline}><strong>{row.name}</strong> <Pill tone={row.working ? "good" : "warn"}>{row.working ? "Working" : "Not working"}</Pill></div>
        <p>{row.purpose}</p><p>Last tested {row.testedAt ? mst(row.testedAt) : "—"}</p>
        {!row.working && <p>{row.says}</p>}
        <p>Runner last read {row.runnerReadAt ? mst(row.runnerReadAt) : "—"}</p>
        <button type="button" className={s.btn} disabled={busy} onClick={() => void send("DELETE", { name: row.name })}>Delete {row.name}</button>
      </div>)}
    </>}
  </section>;
}
