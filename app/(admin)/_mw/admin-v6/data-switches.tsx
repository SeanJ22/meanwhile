"use client";

import { useState } from "react";

import type { SwitchRow } from "@/lib/control-plane/data-business/switches.ts";
import { audienceWords } from "@/lib/control-plane/data-business/types.ts";

import { mst } from "./model.ts";
import { Actions, Card, cx, Empty, Loading, Pill } from "./ui.tsx";
import { useReading } from "./use-reading.ts";
import s from "./v6.module.css";

interface SwitchesView { readonly observedAt: string; readonly rows: readonly SwitchRow[] }
const CUSTOMER_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function DataSwitchesPanel() {
  const { reading, reload } = useReading<SwitchesView>("/api/admin/v6/data/switches", 20_000);
  const [recipe, setRecipe] = useState("");
  const [customer, setCustomer] = useState("");
  const data = reading.kind === "ready" ? reading.data : null;
  const audiences = data?.rows[0]?.cells.map((c) => c.audience) ?? [];
  const chosen = recipe === "" ? data?.rows[0]?.recipe ?? "" : recipe;
  return (
    <Card title="Who can see each number" id="data-switches">
      {reading.kind === "loading" && <Loading what="the switches" />}
      {reading.kind === "failed" && <p className={s.p}>— <button type="button" className={s.btn} onClick={reload}>Try again</button></p>}
      {data && (
        <div className={s.stack}>
          {!data.rows.length && <Empty>No numbers</Empty>}
          {!!data.rows.length && (
            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead><tr><th scope="col">Number</th>{audiences.map((a) => <th key={a} scope="col">{audienceWords(a)}</th>)}</tr></thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.recipe}>
                      <th scope="row" style={{ textTransform: "none", fontSize: 13, color: "var(--text)" }}>{r.label}</th>
                      {r.cells.map((c) => (
                        <td key={c.audience}>
                          <Pill tone={c.on ? "good" : "neutral"}>{c.on ? "On" : "Off"}</Pill>{!c.decided && <span className={cx(s.small, s.dim)}> default</span>}
                          <Actions actions={[{ kind: c.on ? "data-switch-off" : "data-switch-on", target: `${r.recipe}@${c.audience}`, label: c.on ? "Switch off" : "Switch on" }]} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!!data.rows.length && (
            <div className={s.stack} style={{ gap: 6 }}>
              <div className={s.inline}>
                <select className={s.select} aria-label="Number" value={chosen} onChange={(e) => setRecipe(e.target.value)}>
                  {data.rows.map((r) => <option key={r.recipe} value={r.recipe}>{r.label}</option>)}
                </select>
                <input className={s.input} aria-label="Customer short name" placeholder="customer short name" value={customer} onChange={(e) => setCustomer(e.target.value.trim().toLowerCase())} />
                {CUSTOMER_ID.test(customer) && <Actions actions={[{ kind: "data-switch-on", target: `${chosen}@customer:${customer}`, label: `Switch on for ${customer}` }]} />}
              </div>
            </div>
          )}
          <p className={cx(s.p, s.meta)}>Read {mst(data.observedAt)}</p>
        </div>
      )}
    </Card>
  );
}
