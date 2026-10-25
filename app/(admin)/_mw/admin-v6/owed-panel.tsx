"use client";

import { useRef, useState } from "react";
import type { OwedRule, OwedTable } from "@/lib/coverage/owed-table.ts";
import type { StateOwedCounts } from "@/lib/coverage/owed-read.ts";
import type { SettingRow } from "@/lib/control-plane/admin-view/v6-settings-read.ts";
import type { ActionOutcome } from "@/lib/control-plane/gateway/contract.ts";
import { DEFAULT_KINDS } from "@/lib/registry/kinds.ts";
import { US_STATES } from "@/lib/control-plane/readiness/catalog.ts";
import { Card, Empty, Loading } from "./ui.tsx";
import { mst } from "./model.ts";
import { useReading } from "./use-reading.ts";
import s from "./v6.module.css";

type OwedData = { readonly table: OwedTable; readonly setting: SettingRow; readonly counts: readonly StateOwedCounts[] | null };
const kindWords: Record<string, string> = { place: "Place", government: "Government", body: "Board or commission", seat: "Seat", person: "Officeholder",
  meeting: "Meeting", agenda_item: "Agenda item", bill: "Bill", vote_event: "Vote", election: "Election", contest: "Contest", candidacy: "Candidate",
  measure: "Ballot measure", measure_provision: "Part of a ballot measure", committee: "Campaign committee", statement: "Public statement", law_question: "Law question", news_item: "Government news" };
const clockWords: Record<string, string> = { officeholder: "Officeholder", contact: "Contact", comment_rule: "Taking part", meeting: "Meeting", agenda: "Agenda",
  outcome: "Decision", vote: "Vote", money: "Funding", statement: "Statement", portrait: "Portrait", ballot: "Election", law: "Law", news: "News", same_person_link: "Person identity" };
const placeWords: Record<string, string> = { county: "County", place: "City or town", school_district: "School district", sldu: "State senate district",
  sldl: "State house district", cd: "Congressional district", special_district: "Special district", fire_district: "Fire district", water_district: "Water district", sanitation_district: "Sanitation district",
  country: "Country", state: "State", district: "District of Columbia", territory: "Territory" };
const placeKinds = [...DEFAULT_KINDS.division, ...["country", "state", "district", "territory"].map(key => ({ key, label: placeWords[key] }))];
const size = (table: OwedTable) => table.base.length + Object.values(table.states).reduce((n, rows) => n + rows.length, 0);

function OwedEditor({ data, reload }: { readonly data: OwedData; readonly reload: () => void }) {
  const [draft, setDraft] = useState<OwedTable | null>(null);
  const [scope, setScope] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const pending = useRef<{ readonly body: string; readonly key: string } | null>(null);
  const table = draft ?? data.table;
  const rows = scope ? table.states[scope] ?? [] : table.base;
  function update(next: readonly OwedRule[]) {
    setDraft(scope ? { ...table, states: { ...table.states, [scope]: next } } : { ...table, base: next });
    setMessage("");
  }
  function edit(index: number, patch: Partial<OwedRule>) { update(rows.map((row, n) => n === index ? { ...row, ...patch } : row)); }
  async function save(value: OwedTable, undoOf?: string) {
    setSaving(true); setMessage("");
    try {
      const input = { key: data.setting.key, value, why: undoOf ? "Undo" : "", ...(undoOf ? { undoOf } : {}) };
      const body = JSON.stringify(input);
      if (pending.current?.body !== body) pending.current = { body, key: crypto.randomUUID() };
      const response = await fetch("/api/admin/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ type: "config.setSetting", subject: data.setting.key, idempotencyKey: pending.current.key, returnTo: "/admin?view=settings", input }) });
      const result = await response.json() as ActionOutcome;
      if (!response.ok || !result.ok || result.receipt.outcome !== "DONE") throw new Error(result.receipt?.says ?? "The list could not be saved.");
      pending.current = null; setDraft(null); setMessage(undoOf ? "The previous list is restored." : "Saved."); reload();
    } catch (error) { setMessage(error instanceof Error ? error.message : "The list could not be saved."); }
    finally { setSaving(false); }
  }
  const previous = data.setting.undo ? JSON.parse(data.setting.undo.value) as OwedTable : null;
  return <fieldset className={s.stack} disabled={saving} style={{ border: 0, padding: 0, minWidth: 0 }}>
    <label className={s.small}>Applies in <select className={s.select} aria-label="Where items are owed" value={scope} onChange={event => setScope(event.target.value)}>
      <option value="">Every state</option>{US_STATES.map(state => <option key={state.code} value={state.code.toUpperCase()}>{state.name} additions</option>)}
    </select></label>
    <div className={s.inline}>
      <button type="button" className={s.btn} disabled={saving} onClick={() => update([...rows, { kind: "body", field: "", label: "", clock: "officeholder", checklist: [] }])}>Add item</button>
      <button type="button" className={s.btn} disabled={saving || !draft} onClick={() => void save(table)}>Save list</button>
      {draft && <button type="button" className={s.btn} disabled={saving} onClick={() => setDraft(null)}>Discard edits</button>}
      {previous && data.setting.undo && <button type="button" className={s.btn} disabled={saving} onClick={() => void save(previous, data.setting.undo!.changeId)}>Undo last change</button>}
    </div>
    <div className={s.tableWrap}><table className={s.table}>
      <thead><tr><th scope="col">Kind of place or record</th><th scope="col">What readers are owed</th><th scope="col">Changes</th></tr></thead>
      <tbody>{rows.map((row, index) => <tr key={index}>
        <td><select className={s.select} aria-label={`Kind for item ${index + 1}`} value={row.kind} onChange={event => edit(index, { kind: event.target.value as OwedRule["kind"], placeKind: undefined })}>
          {Object.entries(kindWords).map(([kind, words]) => <option key={kind} value={kind}>{words}</option>)}
        </select>{row.kind === "place" && <select className={s.select} aria-label={`Place kind for item ${index + 1}`} value={row.placeKind ?? ""} onChange={event => edit(index, { placeKind: event.target.value || undefined })}>
          <option value="">Every kind</option>{placeKinds.map(kind => <option key={kind.key} value={kind.key}>{placeWords[kind.key] ?? kind.label}</option>)}
        </select>}</td>
        <td><input className={s.input} style={{ width: "100%", boxSizing: "border-box" }} aria-label={`What is owed for item ${index + 1}`} value={row.label} maxLength={200} onChange={event => edit(index, { label: event.target.value })} />
          <details><summary>Technical details</summary><label>Field <input className={s.input} value={row.field} onChange={event => edit(index, { field: event.target.value })} /></label>
            <label>Freshness clock <select className={s.select} value={row.clock} onChange={event => edit(index, { clock: event.target.value as OwedRule["clock"] })}>
              {Object.entries(clockWords).map(([clock, words]) => <option key={clock} value={clock}>{words}</option>)}
            </select></label></details></td>
        <td><button type="button" className={s.btn} disabled={saving} onClick={() => update(rows.filter((_, n) => n !== index))}>Remove</button></td>
      </tr>)}</tbody>
    </table></div>
    {!rows.length && <Empty>No additions for this state.</Empty>}
    {message && <p role="status" className={s.small}>{message}</p>}
    <p className={s.meta}>{data.setting.changedAt ? `Changed ${mst(data.setting.changedAt)}` : "No changes yet"}</p>
    {previous && <details><summary>Previous list ({size(previous).toLocaleString("en-US")} items)</summary>
      <ul>{previous.base.map((row, index) => <li key={index}>{kindWords[row.kind] ?? "Record"}: {row.label}</li>)}
        {Object.entries(previous.states).flatMap(([state, items]) => items.map((row, index) => <li key={`${state}:${index}`}>{US_STATES.find(entry => entry.code.toUpperCase() === state)?.name}: {row.label}</li>))}</ul>
    </details>}
  </fieldset>;
}

export function OwedPanel() {
  const [countState, setCountState] = useState("US");
  const { reading, reload } = useReading<{ readonly data: OwedData }>(`/api/admin/v6/owed?state=${countState}`, 60_000);
  const data = reading.kind === "ready" ? reading.data.data : null;
  const measured = data?.counts?.filter(row => row.state === countState);
  const stateName = countState === "US" ? "National government" : US_STATES.find(row => row.code.toUpperCase() === countState)!.name;
  return <Card title="What readers are owed" id="owed" aside={<button type="button" className={s.btn} onClick={reload}>Refresh</button>}>
    <div className={s.stack}>
      {reading.kind === "loading" && <Loading what="what readers are owed" />}
      {reading.kind === "failed" && <p className={s.p}>—</p>}
      {reading.kind === "ready" && reading.stale && <p className={s.small}>Showing the last reading. Refresh is pending.</p>}
      {data && <>
        <label className={s.small}>State <select className={s.select} aria-label="State counts" value={countState} onChange={event => setCountState(event.target.value)}>
          <option value="US">National government</option>{US_STATES.map(state => <option key={state.code} value={state.code.toUpperCase()}>{state.name}</option>)}
        </select></label>
        <div className={s.tableWrap}><table className={s.table}><caption>What readers have by state</caption>
          <thead><tr><th scope="col">State</th><th scope="col">Owed</th><th scope="col">Held</th><th scope="col">Missing</th><th scope="col">Refresh due</th><th scope="col">Stuck</th></tr></thead>
          <tbody>{(measured?.length ? measured : [{ state: countState, name: stateName, owed: null, held: null, missing: null, stale: null, stuck: null }]).map(row => <tr key={row.state}>
            <th scope="row">{row.name}</th>{(["owed", "held", "missing", "stale", "stuck"] as const).map(key => <td key={key}>{row[key]?.toLocaleString("en-US") ?? "—"}</td>)}
          </tr>)}</tbody>
        </table></div>
        <OwedEditor data={data} reload={reload} />
      </>}
    </div>
  </Card>;
}
