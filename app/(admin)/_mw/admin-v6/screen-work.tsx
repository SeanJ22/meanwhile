"use client";

/**
 * **WORK.** Stuck items by who moves them (plus same cause, many places), every
 * work row by stage with search and paging, and the history of instructions.
 */
import { useState } from "react";

import { useV6 } from "./context.tsx";
import { count, type Lane, type WorkStage } from "./model.ts";
import { COUNTRY_KEY, isWithin, relation } from "./places.ts";
import { HISTORY_FILTERS } from "./receipts.ts";
import { ReceiptCard } from "./receipt-view.tsx";
import { LANE_MEANS, LANE_TONE, LANE_WORDS, StuckRow, useScoped } from "./screen-now.tsx";
import { Actions, Card, cx, Empty, Pill, SourceNote, Tabs, useListView } from "./ui.tsx";
import s from "./v6.module.css";

type Tab = "lanes" | "rows" | "history";
const STAGE_WORDS: Readonly<Record<WorkStage, string>> = { waiting: "Waiting to run", stuck: "Stuck", retrying: "Retrying on its own", done: "Done last round", retired: "Retired" };

export function WorkScreen() {
  const v = useV6();
  const [tab, setTab] = useState<Tab>("lanes");
  return (
    <>
      <header>
        <p className={s.eyebrow}>{v.place.name}</p>
        <h1 className={s.h1}>Work</h1>
      </header>
      <Tabs label="Work views" value={tab} onChange={setTab} tabs={[{ id: "lanes", label: "Stuck, by who moves it" }, { id: "rows", label: "All work rows" }, { id: "history", label: "History of your instructions" }]} />
      {tab === "lanes" && <Lanes />}
      {tab === "rows" && <Rows />}
      {tab === "history" && <History />}
    </>
  );
}

function Lanes() {
  const v = useV6();
  const { stuck } = useScoped();
  const causes = (v.data.sameCause.data ?? []).map((c) => ({ c, items: (v.data.stuck.data ?? []).filter((i) => c.itemIds.includes(i.id) && relation(v.index, i.applies, v.scopeKey) !== null) })).filter((x) => x.items.length);
  return (
    <>
      <SourceNote source={v.data.stuck} what="Stuck items" />
      <div className={s.grid2}>
        {(["decision", "auto", "publisher", "software"] as Lane[]).map((lane) => {
          const list = stuck.filter((x) => x.item.lane === lane);
          return (
            <Card key={lane} title={<span className={s.inline}><Pill tone={LANE_TONE[lane]}>{LANE_WORDS[lane]}</Pill><span className={s.mono}>{v.data.stuck.data ? list.length : "—"}</span></span>}>
              <p className={cx(s.p, s.meta)}>{LANE_MEANS[lane]}</p>
              {v.data.stuck.state !== "not-connected" && !list.length && <Empty>{({ decision: "Nothing here needs your decision.", auto: "No automatic repair is recorded here.", publisher: "Nothing here is waiting on a publisher.", software: "No software fixes are waiting here." })[lane]}</Empty>}
              <div className={s.stack}>{list.map((x) => <StuckRow key={x.item.id} item={x.item} shared={x.rel === "shared"} withActions />)}</div>
            </Card>
          );
        })}
      </div>
      {!!causes.length && (
        <Card title="Same cause, many places">
          <div className={s.stack}>
            {causes.map(({ c, items }) => (
              <div key={c.key} className={s.row}>
                <div className={s.spread}><strong style={{ fontSize: 13 }}>{c.cause}</strong><Pill tone={LANE_TONE[c.lane]}>{LANE_WORDS[c.lane]}</Pill></div>
                <span className={s.meta}>{c.count} {c.count === "1" ? "item" : "items"} · {[...new Set(items.map((i) => v.index.get(i.applies[0])?.name))].join(" · ")}</span>
                <Actions actions={[{ ...c.action, target: c.action.target || v.scopeKey }]} />
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}

function Rows() {
  const v = useV6();
  const [stage, setStage] = useState<WorkStage>("waiting");
  const [q, setQ] = useState("");
  const rows = (v.data.workRows.data?.rows ?? []).filter((r) => v.scopeKey === COUNTRY_KEY || isWithin(v.index, r.placeKey, v.scopeKey));
  const totals = v.data.workRows.data?.totals ?? [];
  const filtered = rows.filter((r) => r.stage === stage && (!q.trim() || r.title.toLowerCase().includes(q.trim().toLowerCase())));
  const { page, pager, reset } = useListView({ section: "workRows", page: v.data.workRows.page, list: filtered, params: { stage, q: q.trim() }, size: 6 });
  const serverTotal = totals.find((t) => t.stage === stage)?.total ?? null;
  return (
    <Card title="All work rows">
      <SourceNote source={v.data.workRows} what="Work rows" />
      <p className={cx(s.p, s.meta)}>{v.scopeKey === COUNTRY_KEY ? "All tracked states. These are rows of work, not missing facts. Done and retired rows are counted apart so they never inflate unfinished work." : `Rows for ${v.place.name}.`}</p>
      <div className={s.tabs} role="group" aria-label="Stage">
        {(Object.keys(STAGE_WORDS) as WorkStage[]).map((k) => {
          const total = totals.find((t) => t.stage === k)?.total;
          const n = !v.data.workRows.data ? "—" : v.scopeKey === COUNTRY_KEY && total !== undefined && total !== null ? count(total) : String(rows.filter((r) => r.stage === k).length);
          return <button key={k} type="button" className={s.tab} aria-pressed={stage === k} onClick={() => { setStage(k); reset(); }}>{STAGE_WORDS[k]}<span className={s.tabCount}>{n}</span></button>;
        })}
      </div>
      <input className={s.input} aria-label="Search work rows" placeholder="Search work rows" value={q} onChange={(e) => { setQ(e.target.value); reset(); }} />
      {!filtered.length && v.data.workRows.state !== "not-connected" && <Empty>No rows in this group here.</Empty>}
      <div className={s.stack}>
        {page.map((r) => (
          <button key={r.id} type="button" className={cx(s.row, s.rowButton)} onClick={() => v.open(r.link ? (r.link.type === "stuck" ? { type: "stuck", id: r.link.id } : { type: "result", id: r.link.id }) : { type: "work", id: r.id })}>
            <span className={s.spread}><strong style={{ fontSize: 13 }}>{r.title}</strong><span className={s.meta}>{r.age}</span></span>
            <span className={s.meta}>{v.index.get(r.placeKey)?.name}</span>
          </button>
        ))}
      </div>
      {pager}
      {v.scopeKey === COUNTRY_KEY && serverTotal !== null && serverTotal > rows.filter((r) => r.stage === stage).length && (
        <p className={cx(s.p, s.meta)}>The server holds {count(serverTotal)} rows in this group. This page has {rows.filter((r) => r.stage === stage).length} of them; searching and paging the rest runs on the server once cursor paging is connected.</p>
      )}
    </Card>
  );
}

function History() {
  const v = useV6();
  const [filter, setFilter] = useState("all");
  const f = HISTORY_FILTERS.find((x) => x.id === filter)!;
  const list = v.receipts.filter((r) => !f.statuses || f.statuses.includes(r.status));
  const { page, pager, reset } = useListView({ section: "history", page: v.data.history.page, list, params: { status: filter }, size: 8 });
  return (
    <Card title="History of your instructions">
      <p className={cx(s.p, s.small, s.dim)}>Every instruction, from any page. Each one moves through: saved → read by the workers → running → one final result. “Done” means that instruction took effect; it doesn’t mean the goal is finished or that readers can see it.</p>
      {v.data.history.state !== "live" && <SourceNote source={v.data.history} what="Saved instructions" />}
      <div className={s.tabs} role="group" aria-label="Filter by result">
        {HISTORY_FILTERS.map((h) => (
          <button key={h.id} type="button" className={s.tab} aria-pressed={filter === h.id} onClick={() => { setFilter(h.id); reset(); }}>
            {h.label}<span className={s.tabCount}>{h.statuses ? v.receipts.filter((r) => h.statuses!.includes(r.status)).length : v.receipts.length}</span>
          </button>
        ))}
      </div>
      {!list.length && <Empty>No instructions match this filter.</Empty>}
      <div className={s.stack}>{page.map((r) => <ReceiptCard key={r.key} receipt={r} />)}</div>
      {pager}
    </Card>
  );
}
