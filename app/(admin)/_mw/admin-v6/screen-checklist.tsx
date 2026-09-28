"use client";

/**
 * **CHECKLIST.** Facts about places (items by group, as stacked bars), the item
 * list with search, status filter and paging, every whole-system group with
 * its full definition list, and the complete register of all definitions.
 * The definitions are the real 325 (`CHECKLIST_PROFILE`), never the sample.
 */
import { useState } from "react";

import { STATUS_COLOR, STATUS_LABEL, StatusBar, StatusLegend, StatusTable, Swatch } from "./charts.tsx";
import { useV6 } from "./context.tsx";
import { count, ITEM_STATUS_ORDER, type ItemStatus } from "./model.ts";
import { Card, cx, Empty, SourceNote, useListView, usePager } from "./ui.tsx";
import s from "./v6.module.css";

const SYS_WORDS = ["Partly built", "Known gap", "Not checked yet", "Other"];
const SYS_CLASS = ["c-blue", "c-coral", "c-hatch", "c-dark"];

export function ChecklistScreen() {
  const v = useV6();
  const c = v.data.checklist.data;
  const [group, setGroup] = useState<string>("MTG");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<ItemStatus | "all">("all");
  const items = (c?.items ?? []).filter((i) => i.definitionId.startsWith(`${group}-`) && (status === "all" || i.status === status) && (!q.trim() || `${i.definitionId} ${i.name} ${i.subject}`.toLowerCase().includes(q.trim().toLowerCase())));
  const { page, pager, reset } = useListView({ section: "checklist", page: v.data.checklist.page, list: items, params: { group, status, q: q.trim() }, size: 10 });
  const groupRow = c?.placeGroups?.find((g) => g.group === group);
  const groupN = groupRow ? groupRow.counts.reduce((a, b) => a + b, 0) : 0;
  return (
    <>
      <header>
        <p className={s.eyebrow}>{v.place.name} · checklist {c?.profileVersion ?? ""}</p>
        <h1 className={s.h1}>Checklist</h1>
        <p className={cx(s.p, s.small, s.dim)}>A checklist item is one requirement, for one body or place, over a set time period. All {c?.definitionCount ?? 325} definitions stay required.</p>
      </header>

      <Card title="Facts about places" aside={<span className={s.meta}>Choose a group to list its items</span>}>
        <SourceNote source={{ ...v.data.checklist, state: c?.placeGroups ? v.data.checklist.state : v.data.checklist.state === "sample" ? "sample" : "not-connected" }} what="Checklist counts" />
        {c?.placeGroups && (
          <>
            <StatusLegend />
            <div className={s.stack}>
              {c.placeGroups.map((g) => {
                const n = g.counts.reduce((a, b) => a + b, 0);
                if (!n) return null;
                return (
                  <button key={g.group} type="button" className={cx(s.row, s.rowButton)} aria-pressed={group === g.group} style={group === g.group ? { boxShadow: "inset 0 0 0 1px var(--ring)" } : undefined} onClick={() => { setGroup(g.group); reset(); }}>
                    <span className={s.spread}><strong style={{ fontSize: 13 }}>{g.name}</strong><span className={cx(s.meta, s.mono)}>{count(n)} items · {count(g.counts[0])} checked on the page · {count(g.counts[4])} need a fix</span></span>
                    <StatusBar counts={g.counts} label={`${g.name}: ${count(n)} items`} />
                  </button>
                );
              })}
            </div>
            <StatusTable rows={c.placeGroups.map((g) => ({ name: g.name, counts: g.counts }))} />
          </>
        )}
      </Card>

      <Card title={`${c?.groupNames[group] ?? group} checklist items in ${v.place.name}`}>
        <div className={s.inline}>
          <input className={s.input} style={{ flex: "1 1 220px" }} aria-label="Search checklist items" placeholder="Search by requirement or body" value={q} onChange={(e) => { setQ(e.target.value); reset(); }} />
          <select className={s.select} aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value as ItemStatus | "all"); reset(); }}>
            <option value="all">Every status</option>
            {ITEM_STATUS_ORDER.map((k) => <option key={k} value={k}>{STATUS_LABEL[k]}</option>)}
          </select>
        </div>
        {!c?.items && <SourceNote source={{ state: "not-connected", load: "ready", data: null, asOf: null, dependency: { id: "DEP-CHECKLIST-ITEMS", owner: "Codex (readiness)", need: "Checklist items for this place with status, proof and missing proof for each part, applicability and owner, with search and cursor paging." } }} />}
        {c?.items && !items.length && <Empty>{groupN && !c.items.some((i) => i.definitionId.startsWith(`${group}-`)) ? `${count(groupN)} items are counted here, but this list isn’t available one by one yet.` : "No checklist items match these filters."}</Empty>}
        <div className={s.stack}>
          {page.map((i) => (
            <button key={i.key} type="button" className={cx(s.row, s.rowButton)} onClick={() => v.open({ type: "item", key: i.key })}>
              <span className={s.spread}><strong style={{ fontSize: 13 }}>{i.definitionId} {i.name} · {i.subject}</strong><span className={s.legendItem}><Swatch cls={STATUS_COLOR[i.status]} /><span className={s.small}>{STATUS_LABEL[i.status]}</span></span></span>
              <span className={s.meta}>{i.missing}</span>
            </button>
          ))}
        </div>
        {pager}
      </Card>

      <Card title="Things the whole system must be able to do" aside={<span className={s.meta}>Checked once for the whole system, not per place</span>}>
        {!c?.systemGroups.some((g) => g.counts) && <SourceNote source={{ state: "not-connected", load: "ready", data: null, asOf: null, dependency: { id: "DEP-SYSTEM-AUDIT", owner: "Codex (readiness)", need: "The audit status of each whole-system definition. The definitions themselves are listed now." } }} />}
        {c?.systemGroups.some((g) => g.counts) && v.data.checklist.state === "sample" && <SourceNote source={v.data.checklist} what="Audit statuses" />}
        <div className={s.legend}>{SYS_WORDS.map((w, i) => <span key={w} className={s.legendItem}><Swatch cls={SYS_CLASS[i]} />{w}</span>)}</div>
        <div className={s.stack}>
          {c?.systemGroups.map((g) => {
            const defs = c.definitions.filter((d) => d.group === g.group).length;
            const n = g.counts?.reduce((a, b) => a + b, 0) ?? 0;
            return (
              <button key={g.group} type="button" className={cx(s.row, s.rowButton)} onClick={() => v.open({ type: "system", group: g.group })}>
                <span className={s.spread}><strong style={{ fontSize: 13 }}>{g.name}</strong><span className={cx(s.meta, s.mono)}>{defs} definitions</span></span>
                {g.counts && n ? (
                  <span className={s.bar} role="img" aria-label={`${g.name}: ${g.counts.map((x, i) => `${SYS_WORDS[i]} ${x}`).join(", ")}`}>
                    {g.counts.map((x, i) => x ? <span key={i} className={cx(s.seg, s[SYS_CLASS[i]])} style={{ width: `${(x / n) * 100}%` }} title={`${SYS_WORDS[i]}: ${x}`} /> : null)}
                  </span>
                ) : <span className={s.meta}>Audit status not reported yet · open to read every definition</span>}
              </button>
            );
          })}
        </div>
      </Card>

      <Register />
    </>
  );
}

function Register() {
  const v = useV6();
  const c = v.data.checklist.data;
  const [q, setQ] = useState("");
  const [g, setG] = useState("all");
  const defs = (c?.definitions ?? []).filter((d) => (g === "all" || d.group === g) && (!q.trim() || `${d.id} ${d.requirement}`.toLowerCase().includes(q.trim().toLowerCase())));
  const { page, pager, reset } = usePager(defs, 12);
  const groups = [...new Set((c?.definitions ?? []).map((d) => d.group))];
  return (
    <details className={s.card}>
      <summary className={s.h2} style={{ cursor: "pointer" }}>Every definition ({c?.definitionCount ?? 0})</summary>
      <div className={s.stack} style={{ marginTop: 12 }}>
        <p className={cx(s.p, s.meta)}>The official wording of every requirement in checklist {c?.profileVersion}. None is dropped.</p>
        <div className={s.inline}>
          <input className={s.input} style={{ flex: "1 1 220px" }} aria-label="Search definitions" placeholder="Search the definitions" value={q} onChange={(e) => { setQ(e.target.value); reset(); }} />
          <select className={s.select} aria-label="Group" value={g} onChange={(e) => { setG(e.target.value); reset(); }}>
            <option value="all">Every group</option>
            {groups.map((x) => <option key={x} value={x}>{c?.groupNames[x] ?? x}</option>)}
          </select>
        </div>
        {!defs.length && <Empty>No definition matches.</Empty>}
        <ul className={s.stack} style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {page.map((d) => <li key={d.id} className={s.row}><strong className={cx(s.small, s.mono)}>{d.id}</strong><span className={s.small}>{d.requirement}</span></li>)}
        </ul>
        {pager}
      </div>
    </details>
  );
}
