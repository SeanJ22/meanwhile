"use client";

import { useState } from "react";
import type { FactDoorHour } from "../../../../lib/facts/admin-read.ts";
import { stateName } from "../../../../lib/facts/entity-read.ts";
import { mst } from "./model.ts";
import { Card } from "./ui.tsx";
import s from "./v6.module.css";

export function FactHours({ hours }: { readonly hours: readonly FactDoorHour[] | null }) {
  const [hour, setHour] = useState("");
  const available = [...new Set(hours?.map(row => row.hour) ?? [])];
  const selected = available.includes(hour) ? hour : available[0];
  return <Card title="Facts published, by state and hour">
    <p className={s.meta}>New and replacement facts through the door. Sending the same fact again adds nothing.</p>
    {hours === null ? <span className={s.big}>—</span> : <>
      <label>Hour <select className={s.select} value={selected ?? ""} onChange={event => setHour(event.target.value)}>
        {available.map(at => <option key={at} value={at}>{mst(at)}</option>)}
      </select></label>
      <div className={s.tableWrap}><table className={s.table}>
        <thead><tr><th scope="col">State</th><th scope="col">Official fields</th><th scope="col">Checked claims</th></tr></thead>
        <tbody>{hours.filter(row => row.hour === selected).map(row => <tr key={row.state}>
          <td>{stateName(row.state) ?? "National"}</td><td>{row.official === null ? "—" : row.official.toLocaleString("en-US")}</td>
          <td>{row.checked === null ? "—" : row.checked.toLocaleString("en-US")}</td>
        </tr>)}</tbody>
      </table></div>
    </>}
  </Card>;
}
