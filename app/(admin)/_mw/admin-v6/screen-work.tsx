"use client";

/**
 * **WORK.** Stuck items by who moves them (plus same cause, many places), every
 * work row by stage with search and paging, and the history of instructions.
 */
import { useState } from "react";

import { useV6 } from "./context.tsx";
import { count, mst, type Lane, type SameCause, type StuckItem } from "./model.ts";
import { COUNTRY_KEY, isWithin, relation } from "./places.ts";
import { HISTORY_FILTERS } from "./receipts.ts";
import { ReceiptCard } from "./receipt-view.tsx";
import { LANE_TONE, LANE_WORDS, StuckRow } from "./screen-now.tsx";
import { WorkReached } from "./trail-view.tsx";
import { Actions, Card, cx, Empty, Pill, Tabs, useListView, usePager } from "./ui.tsx";
import s from "./v6.module.css";

type Tab = "lanes" | "history";

export function WorkScreen() {
  const v = useV6();
  const [tab, setTab] = useState<Tab>("lanes");
  return (
    <>
      <header>
        <p className={s.eyebrow}>{v.place.name}</p>
        <h1 className={s.h1}>Work</h1>
      </header>
      <Tabs label="Work views" value={tab} onChange={setTab} tabs={[{ id: "lanes", label: "Stuck, by who moves it" }, { id: "history", label: "History of your instructions" }]} />
      {tab === "lanes" && <Lanes />}
      {tab === "history" && <History />}
    </>
  );
}

const LANES: readonly (Lane | "all")[] = ["all", "decision", "auto", "publisher", "software"];
const ITEMS_PER_GROUP_PAGE = 6;

/**
 * **BLOCKERS BY CAUSE.** Every stuck item across places, grouped by the cause
 * behind it in plain English, most stuck first. "Send agents" is on every item
 * and on each whole group. The server counts every stuck row in a group and
 * lists the most urgent ones, and says so when it lists fewer than it counts.
 */
function CauseGroup(props: { readonly cause: SameCause; readonly items: readonly StuckItem[]; readonly open: boolean; readonly onToggle: () => void }) {
  const v = useV6();
  const { cause, items } = props;
  const { page, pager, reset } = usePager(items, ITEMS_PER_GROUP_PAGE);
  const total = Number(cause.count);
  const places = [...new Set(items.map((i) => v.index.get(i.applies[0])?.name).filter((x): x is string => !!x))];
  return (
    <div className={s.row}>
      <div className={s.spread}>
        <strong style={{ fontSize: 14 }}>{cause.cause}</strong>
        <Pill tone={LANE_TONE[cause.lane]}>{LANE_WORDS[cause.lane]}</Pill>
      </div>
      <span className={s.meta}>
        {count(total)} {total === 1 ? "item" : "items"} stuck{places.length ? ` · ${places.slice(0, 4).join(" · ")}${places.length > 4 ? ` · and ${places.length - 4} more` : ""}` : ""}
      </span>
      <div className={s.inline}>
        <Actions actions={cause.action ? [cause.action] : []} primaryFirst />
        {!!items.length && <button type="button" className={s.btn} aria-expanded={props.open} onClick={() => { props.onToggle(); reset(); }}>{props.open ? "Hide the items" : "Show the items"}</button>}
      </div>
      {props.open && (
        <div className={s.stack}>
          {page.map((i) => <StuckRow key={i.id} item={i} withActions />)}
          {pager}
        </div>
      )}
    </div>
  );
}

/**
 * **INSTRUCTIONS YOU SENT, AND TAKING ONE BACK.** A "Deploy fleet here" instruction keeps being carried by the runner
 * while it has work left to create, so one click can keep working for many rounds. Each one is listed with where it
 * stands and a button to take it back. Taken back shows only once the runner has recorded it; until then it is a request.
 */
function Sends() {
  const v = useV6();
  const src = v.data.sends;
  const list = src.data ?? [];
  if (src.state === "live" && !list.length) return null;
  return (
    <Card title="Instructions you sent the fleet" aside={<span className={s.meta}>{src.data ? `${list.filter((x) => x.canCancel).length} running` : "—"}</span>}>
      <div className={s.stack}>
        {list.map((x) => (
          <div key={x.id} className={s.row}>
            <div className={s.spread}><strong style={{ fontSize: 13 }}>{x.words ? x.words : "—"}</strong><Pill tone={x.state === "carried" || x.state === "waiting" ? "warn" : "slate"}>{x.state === "carried" ? "Running" : x.state === "waiting" ? "Waiting" : x.state === "cancel-requested" ? "Taking back" : "Taken back"}</Pill></div>
            <span className={s.meta}>Sent {mst(x.sentAt)}</span>
            <span className={s.small}>{x.stateWords}</span>
            {x.state !== "waiting" && <WorkReached sendId={x.id} />}
            {x.canCancel && <Actions actions={[{ kind: "cancel-send", target: x.id, label: "Take it back", payload: { words: x.words } }]} />}
          </div>
        ))}
      </div>
    </Card>
  );
}

function Lanes() {
  const v = useV6();
  const [lane, setLane] = useState<Lane | "all">("all");
  const [open, setOpen] = useState<string | null>(null);
  const groups = (v.data.sameCause.data ?? []).filter((c) => lane === "all" || c.lane === lane);
  const scoped = (v.data.stuck.data ?? []).filter((i) => relation(v.index, i.applies, v.scopeKey) !== null);
  const all = v.data.sameCause.data ?? [];
  const totalStuck = all.reduce((n, c) => n + Number(c.count), 0);
  return (
    <>
      <Sends />
      <Card title="Blockers by cause" aside={<span className={s.meta}>{v.data.sameCause.data ? `${count(totalStuck)} stuck · ${count(all.length)} ${all.length === 1 ? "cause" : "causes"}` : "—"}</span>}>
        <div className={s.tabs} role="group" aria-label="Filter by who moves it">
          {LANES.map((k) => (
            <button key={k} type="button" className={s.tab} aria-pressed={lane === k} onClick={() => setLane(k)}>
              {k === "all" ? "Everything" : LANE_WORDS[k]}<span className={s.tabCount}>{v.data.sameCause.data ? count(all.filter((c) => k === "all" || c.lane === k).reduce((n, c) => n + Number(c.count), 0)) : "—"}</span>
            </button>
          ))}
        </div>
        {v.data.sameCause.state !== "not-connected" && !groups.length && <Empty>{lane === "all" ? `Nothing is stuck in ${v.place.name}.` : "Nothing in this group."}</Empty>}
        <div className={s.stack}>
          {groups.map((c) => (
            <CauseGroup key={c.key} cause={c} items={scoped.filter((i) => i.group === c.key)} open={open === c.key} onToggle={() => setOpen(open === c.key ? null : c.key)} />
          ))}
        </div>
      </Card>
    </>
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
