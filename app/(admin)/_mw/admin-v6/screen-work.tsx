"use client";

/**
 * **WORK.** Every work row by stage, with search and paging. Orders, stuck cases, instructions sent to the fleet, hunts, shut
 * doors and fix items are on the Queue (BR-14, BR-34); this keeps only the rows themselves until they move too.
 */
import { useState } from "react";

import { plainWords } from "@/lib/control-plane/admin-view/plain-words.ts";
import { notConnected } from "./model.ts";
import { SECTION_DEP } from "./dependencies.ts";
import { useV6 } from "./context.tsx";
import { count, type WorkStage } from "./model.ts";
import { COUNTRY_KEY, isWithin } from "./places.ts";
import { cx, Card, Empty, useListView } from "./ui.tsx";
import s from "./v6.module.css";

const STAGE_WORDS: Readonly<Record<WorkStage, string>> = { waiting: "Waiting to run", stuck: "Stuck", retrying: "Retrying on its own", done: "Done last round", retired: "Retired" };

export function WorkScreen() {
  const v = useV6();
  return (
    <>
      <header>
        <p className={s.eyebrow}>{v.place.name}</p>
        <h1 className={s.h1}>Work</h1>
      </header>
      <Rows />
    </>
  );
}

function Rows() {
  const v = useV6();
  const [stage, setStage] = useState<WorkStage>("waiting");
  const [q, setQ] = useState("");
  const workRows = v.data.workRows ?? notConnected<NonNullable<NonNullable<typeof v.data.workRows>["data"]>>(SECTION_DEP.work);
  const rows = (workRows.data?.rows ?? []).filter((r) => v.scopeKey === COUNTRY_KEY || isWithin(v.index, r.placeKey, v.scopeKey));
  const totals = workRows.data?.totals ?? [];
  const filtered = rows.filter((r) => r.stage === stage && (!q.trim() || r.title.toLowerCase().includes(q.trim().toLowerCase())));
  const { page, pager, reset } = useListView({ section: "workRows", page: workRows.page, list: filtered, params: { stage, q: q.trim() }, size: 6 });
  return (
    <Card title="All work rows">
      <div className={s.tabs} role="group" aria-label="Stage">
        {(Object.keys(STAGE_WORDS) as WorkStage[]).map((k) => {
          const total = totals.find((t) => t.stage === k)?.total;
          const n = !workRows.data ? "—" : v.scopeKey === COUNTRY_KEY && total !== undefined && total !== null ? count(total) : String(rows.filter((r) => r.stage === k).length);
          return <button key={k} type="button" className={s.tab} aria-pressed={stage === k} onClick={() => { setStage(k); reset(); }}>{STAGE_WORDS[k]}<span className={s.tabCount}>{n}</span></button>;
        })}
      </div>
      <input className={s.input} aria-label="Search work rows" placeholder="Search work rows" value={q} onChange={(e) => { setQ(e.target.value); reset(); }} />
      {!filtered.length && workRows.state !== "not-connected" && <Empty>No rows in this group here.</Empty>}
      <div className={s.stack}>
        {page.map((r) => (
          <button key={r.id} type="button" className={cx(s.row, s.rowButton)} onClick={() => v.open(r.link ? (r.link.type === "stuck" ? { type: "stuck", id: r.link.id } : { type: "result", id: r.link.id }) : { type: "work", id: r.id })}>
            <span className={s.spread}><strong style={{ fontSize: 13 }}>{plainWords(r.title)}</strong><span className={s.meta}>{r.age}</span></span>
            <span className={s.meta}>{v.index.get(r.placeKey)?.name}</span>
          </button>
        ))}
      </div>
      {pager}
    </Card>
  );
}
