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
import { count, ITEM_STATUS_ORDER, mst, type ItemStatus, type PlaceScoreView, type ScoreGroup } from "./model.ts";

import { Actions, Card, cx, Empty, Loading, SourceNote, useListView, usePager } from "./ui.tsx";
import s from "./v6.module.css";

const SYS_WORDS = ["Partly built", "Known gap", "Not checked yet", "Other"];
const SYS_CLASS = ["c-blue", "c-coral", "c-hatch", "c-dark"];

/** The five parts of a captured-or-owed fact, in the order Sean reads them. Colors reuse the checklist's own status colors. */
const SCORE_PARTS = [
  { key: "published", words: "Published", cls: "c-blue" },
  { key: "held", words: "Captured, not published yet", cls: "c-amber" },
  { key: "unpublished", words: "The government doesn’t publish it", cls: "c-violet" },
  { key: "stale", words: "Captured earlier, refresh due", cls: "c-gray" },
  { key: "missing", words: "Not captured yet", cls: "c-hatch" },
] as const;

function ScoreBar(props: { readonly g: ScoreGroup; readonly label: string; readonly tall?: boolean }) {
  const { g } = props;
  const words = SCORE_PARTS.map((p) => `${p.words}: ${count(g[p.key])}`).join("; ");
  return (
    <div className={cx(s.bar, props.tall && s.barTall)} role="img" aria-label={`${props.label}. ${words}`}>
      {SCORE_PARTS.map((p) => (g[p.key] && g.total ? <span key={p.key} className={cx(s.seg, s[p.cls])} style={{ width: `${(g[p.key] / g.total) * 100}%` }} title={`${p.words}: ${count(g[p.key])}`} /> : null))}
    </div>
  );
}

const percentWords = (g: ScoreGroup) => (g.percent === null ? "—" : `${g.percent.toFixed(1)}%`);

/**
 * **SEAN'S CHECKLIST SCORE FOR THIS PLACE.** How much of what the place is owed
 * is captured, overall and by group. It counts capture only: it never holds
 * back publishing, and a fact that passes verification is published whatever
 * this says.
 */
function PlaceScoreCard(props: { readonly score: PlaceScoreView; readonly group: string; readonly onGroup: (g: string) => void }) {
  const v = useV6();
  const { score } = props;
  const o = score.overall;
  const words = score.sendWords;
  return (
    <Card title={`Checklist score · ${score.placeLabel}`} aside={<span className={s.meta}>Read {mst(score.observedAt)}</span>}>
      <div className={s.stack}>
        <div className={s.spread} style={{ alignItems: "baseline" }}>
          <span className={s.mono} style={{ fontSize: 34, fontWeight: 600 }} aria-label={`Captured: ${percentWords(o)}`}>{percentWords(o)}</span>
          <span className={cx(s.p, s.small)}>{count(o.captured)} of {count(o.total)} things this place is owed are captured. {count(o.missing)} aren’t captured yet{o.stale ? `, and ${count(o.stale)} were captured earlier and are due for a refresh` : ""}.{o.unpublished ? ` ${count(o.unpublished)} of the captured are things the government doesn’t publish; they count as resolved.` : ""}</span>
        </div>
        <ScoreBar g={o} label="Everything this place is owed" tall />
        <div className={s.legend}>{SCORE_PARTS.map((p) => <span key={p.key} className={s.legendItem}><Swatch cls={p.cls} />{p.words} · {count(o[p.key])}</span>)}</div>
        <p className={cx(s.p, s.small, s.dim)}>{score.covers} Captured means we hold it from an official source. The score never holds back publishing: a fact that passes verification goes live whatever it says.</p>
        {score.target && <p className={cx(s.p, s.small)}>Your target for this place: <strong>{score.target.goalPercent}%</strong> · now {percentWords(o)}{o.percent !== null && o.percent >= score.target.goalPercent ? " · reached" : ""} · set {mst(score.target.setAt)}. The dispatcher puts this place’s work first until it is reached; it never holds back publishing.</p>}
        <Actions actions={[{ kind: "target-set", target: v.scopeKey, label: score.target ? "Change the target" : "Set a target" }, ...(score.target ? [{ kind: "target-clear" as const, target: v.scopeKey, label: "Clear the target" }] : [])]} />
        {words && <Actions actions={[{ kind: "send-agents", target: v.scopeKey, label: "Send agents to fill the blanks", payload: { words } }]} primaryFirst />}
        <div className={s.stack}>
          {score.groups.map((g) => (
            <button key={g.group} type="button" className={cx(s.row, s.rowButton)} aria-pressed={props.group === g.group} style={props.group === g.group ? { boxShadow: "inset 0 0 0 1px var(--ring)" } : undefined} onClick={() => props.onGroup(g.group)}>
              <span className={s.spread}><strong style={{ fontSize: 13 }}>{g.name}</strong><span className={cx(s.meta, s.mono)}>{percentWords(g)} · {count(g.captured)} of {count(g.total)} captured</span></span>
              <ScoreBar g={g} label={`${g.name}: ${count(g.captured)} of ${count(g.total)} captured`} />
            </button>
          ))}
        </div>
      </div>
    </Card>
  );
}

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

      {v.data.checklist.load === "loading" && !c?.score && <Loading what="what this place is owed and what we hold for it (the first read of a place takes a few seconds)" />}
      {c?.score && <PlaceScoreCard score={c.score} group={group} onGroup={(g) => { setGroup(g); reset(); }} />}

      {!c?.score && <Card title="Facts about places" aside={<span className={s.meta}>Choose a group to list its items</span>}>
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
      </Card>}

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

      <WhatCountsAsDone />
      <Register />
    </>
  );
}

/**
 * **WHAT COUNTS AS DONE.** The definition the score is measured against (rulings §0 and §3), in the words a resident's
 * coverage is judged by. Nothing here is a second gate: it explains the score, and the score never holds back publishing.
 */
function WhatCountsAsDone() {
  const v = useV6();
  const c = v.data.checklist.data;
  return (
    <details className={s.card}>
      <summary className={s.h2} style={{ cursor: "pointer" }}>What counts as done</summary>
      <div className={s.stack} style={{ marginTop: 12 }}>
        <p className={cx(s.p, s.small)}>A place is done when everything a resident there is owed is either published or shown to be unpublished by the government, and nothing is overdue for a refresh. The target is Sean’s checklist {c?.profileVersion ?? ""}: {count(c?.definitionCount ?? 325)} requirements, none dropped.</p>
        <ul className={s.stack} style={{ listStyle: "none", padding: 0, margin: 0 }}>
          <li className={s.row}><span className={s.legendItem}><Swatch cls="c-blue" /><strong className={s.small}>Published</strong></span><span className={s.small}>The fact passed verification and readers can see it. Verified means its value appears in a saved source document about the right jurisdiction, captured within that kind of fact’s freshness window, and code confirmed the value is on that page. A fact that passes publishes on its own, without waiting for the rest of the place.</span></li>
          <li className={s.row}><span className={s.legendItem}><Swatch cls="c-amber" /><strong className={s.small}>Captured, not published yet</strong></span><span className={s.small}>We hold it from a source but it hasn’t passed verification, or hasn’t reached readers yet. It stays standing work.</span></li>
          <li className={s.row}><span className={s.legendItem}><Swatch cls="c-violet" /><strong className={s.small}>The government doesn’t publish it</strong></span><span className={s.small}>The source shows the government does not make it public. That closes the item. The page tells readers so plainly.</span></li>
          <li className={s.row}><span className={s.legendItem}><Swatch cls="c-gray" /><strong className={s.small}>Captured earlier, refresh due</strong></span><span className={s.small}>We held it, but its freshness window has passed, so it is owed again.</span></li>
          <li className={s.row}><span className={s.legendItem}><Swatch cls="c-hatch" /><strong className={s.small}>Not captured yet</strong></span><span className={s.small}>Owed and still blank. It stays open until it is filled or shown to be unpublished.</span></li>
        </ul>
        <p className={cx(s.p, s.small, s.dim)}>The score counts capture only. It never holds back publishing: a fact that passes verification goes live whatever the score says. A fact researched once for a county, city or district counts for every ZIP it covers.</p>
      </div>
    </details>
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
