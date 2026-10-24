"use client";
import type { AliasCount } from "@/lib/core/aliases.ts";
import { Card, Empty, Loading } from "./ui.tsx";
import { useReading } from "./use-reading.ts";
import s from "./v6.module.css";

export function AliasesPanel() {
  const { reading } = useReading<{ counts: readonly AliasCount[] | null }>("/api/admin/v6/data/aliases", 60_000);
  const counts = reading.kind === "ready" ? reading.data.counts : null;
  return <Card id="record-aliases" title="Record aliases by state">
    {reading.kind === "loading" ? <Loading what="record aliases" /> : counts === null ? <Empty>—</Empty> :
      <div className={s.tableWrap}><table className={s.table}>
        <thead><tr><th scope="col">State</th><th scope="col">Aliases</th></tr></thead>
        <tbody>{counts.map(row => <tr key={row.state}><th scope="row">{row.label}</th><td className={s.num}>{row.n.toLocaleString("en-US")}</td></tr>)}</tbody>
      </table></div>}
  </Card>;
}
