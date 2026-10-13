"use client";
import type { AcsLoadCounts } from "@/lib/sources/census-acs-population/national.ts";
import { Card, Empty, Loading } from "./ui.tsx";
import { useReading } from "./use-reading.ts";
import s from "./v6.module.css";

export function PopulationPanel() {
  const { reading } = useReading<{ counts: readonly AcsLoadCounts[] | null }>("/api/admin/v6/data/population", 60_000);
  const counts = reading.kind === "ready" ? reading.data.counts : null;
  return <Card id="population" title="Population coverage">
    {reading.kind === "loading" ? <Loading what="population coverage" /> : counts === null ? <Empty>—</Empty> :
      <div className={s.tableWrap}><table className={s.table}><thead><tr><th>State</th><th>Rows loaded</th><th>Joined</th><th>Unjoined</th></tr></thead>
        <tbody>{counts.map(row => <tr key={row.state}><th scope="row">{row.state}</th><td className={s.num}>{row.loaded.toLocaleString("en-US")}</td><td className={s.num}>{row.joined.toLocaleString("en-US")}</td><td className={s.num}>{row.unjoined.toLocaleString("en-US")}</td></tr>)}</tbody></table></div>}
    <details><summary>Sources</summary><ul><li><a href="https://api.census.gov/data.json">U.S. Census Bureau · American Community Survey</a> · Official</li></ul></details>
  </Card>;
}
