"use client";

import { useState } from "react";
import type { DeliveryPendingRow } from "@/lib/control-plane/delivery-trail.ts";
import { mw as s } from "./ui.tsx";

/** A bounded render over all retained rows; filtering never drops the backlog. */
export function DeliveryPending({ rows }: { readonly rows: readonly DeliveryPendingRow[] }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const filtered = rows.filter(row => [row.itemId, row.subjectId, row.recordClass, row.blocker].join(" ").toLowerCase().includes(query.toLowerCase()));
  const current = Math.min(page, Math.max(0, Math.ceil(filtered.length / 25) - 1));
  return <details className={s.gap20}>
    <summary className={s.titleStrong14}>Pending records and required repairs ({rows.length.toLocaleString("en-US")})</summary>
    <div className={s.stack8}>
      <label className={s.text14}>Find a subject, item, class or failure <input value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} /></label>
      <p className={s.note}>{filtered.length.toLocaleString("en-US")} matching records. Historical refusals remain visible; a refusal of an already accepted stage does not erase its evidence.</p>
      {filtered.slice(current * 25, (current + 1) * 25).map(row => <div key={row.itemId} className={s.insetRow}>
        <div className={s.stack6}>
          <strong className={s.text14}>{row.subjectId ?? row.itemId} · {row.recordClass ?? "class not recorded"}</strong>
          <span className={s.monoSmall}>{row.itemId}</span>
          <p className={s.text14}><strong>Blocker: </strong>{row.blocker}</p>
          <p className={s.text14}><strong>Corrective path: </strong>{row.correctiveAction}</p>
          <p className={s.text14}><strong>Outcome: </strong>{row.outcome}</p>
          {row.lastRefusal && row.lastRefusal !== row.blocker && <p className={s.note}>Last historical refusal: {row.lastRefusal}</p>}
        </div>
      </div>)}
      <div className={s.row10}>
        <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)}>Previous records</button>
        <span className={s.note}>Page {current + 1} of {Math.max(1, Math.ceil(filtered.length / 25))}</span>
        <button type="button" disabled={(current + 1) * 25 >= filtered.length} onClick={() => setPage(current + 1)}>Next records</button>
      </div>
    </div>
  </details>;
}
