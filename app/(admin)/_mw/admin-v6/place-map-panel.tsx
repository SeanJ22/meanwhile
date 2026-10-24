"use client";
import type { PlaceMapCounts } from "@/lib/place-map/counts.ts";
import { stateName } from "@/lib/facts/entity-read.ts";
import { Card, Empty, Loading } from "./ui.tsx";
import { useReading } from "./use-reading.ts";
import s from "./v6.module.css";

export function PlaceMapPanel() {
  const { reading } = useReading<{ counts: readonly PlaceMapCounts[] | null }>("/api/admin/v6/data/places", 60_000);
  const counts = reading.kind === "ready" ? reading.data.counts : null;
  return <Card id="places" title="Places and ZIPs">
    {reading.kind === "loading" ? <Loading what="places and ZIPs" /> : counts === null ? <Empty>—</Empty> :
      <div className={s.tableWrap}><table className={s.table}>
        <thead><tr><th scope="col">State</th><th scope="col">Places mapped</th><th scope="col">ZIPs</th><th scope="col">Census areas</th><th scope="col">Districts attached to a county</th></tr></thead>
        <tbody>{counts.map(row => <tr key={row.state}><th scope="row">{stateName(row.state) ?? row.state}</th>
          <td className={s.num}>{row.places.toLocaleString("en-US")}</td><td className={s.num}>{row.zips.toLocaleString("en-US")}</td>
          <td className={s.num}>{row.zctas.toLocaleString("en-US")}</td><td className={s.num}>{row.countyAttachments.toLocaleString("en-US")}</td></tr>)}</tbody>
      </table></div>}
  </Card>;
}
