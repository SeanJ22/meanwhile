"use client";

/**
 * **CHECKLIST.** Facts about places (items by group, as stacked bars), the item
 * list with search, status filter and paging, every whole-system group with
 * its full definition list, and the complete register of all definitions.
 * The definitions are the real 325 (`CHECKLIST_PROFILE`).
 */
import { useState } from "react";

import { STATUS_COLOR, STATUS_LABEL, StatusBar, StatusLegend, StatusTable, Swatch } from "./charts.tsx";
import { useV6 } from "./context.tsx";
import { count, ITEM_STATUS_ORDER, mst, mstDay, type ItemStatus, type MeasureView, type PlaceScoreView, type ScoreGroup } from "./model.ts";

import { Actions, Card, cx, Empty, Loading, useListView, usePager } from "./ui.tsx";
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
const FOUND_WORDS: Readonly<Record<string, string>> = { "local-jurisdiction": "Local governments", "candidate-enrichment": "Candidates", "meetings-discovery": "Meetings" };

/** Three figures, each "N of M", with the counts beside it. They are never added or averaged. */
const BESIDE_WORDS: Readonly<Record<string, string>> = { blocked: "blocked", notChecked: "not checked", awaitingPublication: "awaiting publication", noProducer: "no producer", unresolved: "unresolved", notYetDue: "not yet due",
  notPublishedByGovernment: "not published by the government", refreshDue: "refresh due", notSeen: "not seen on the page" };
function MeasureFigures(props: { readonly measures: PlaceScoreView["measures"] & object }) {
  const rows: readonly [string, string, MeasureView][] = [["Completeness", "of what is owed now, held", props.measures.completeness], ["Freshness", "of what we hold, current", props.measures.freshness], ["Delivery", "of what is published, seen on the page", props.measures.delivery]];
  return (
    <div className={s.stack}>
      {rows.map(([name, what, m]) => (
        <div key={name} className={s.spread} style={{ alignItems: "baseline" }}>
          <span><strong style={{ fontSize: 13 }}>{name}</strong> <span className={cx(s.meta)}>{what}</span></span>
          <span className={s.mono} aria-label={`${name}: ${count(m.n)} of ${count(m.of)}`}>{m.percent === null ? "—" : `${m.percent.toFixed(1)}%`} · {count(m.n)} of {count(m.of)}</span>
          <span className={cx(s.meta, s.small)}>{Object.entries(m.beside).map(([k, n]) => `${n === null ? "—" : count(n)} ${BESIDE_WORDS[k] ?? k}`).join(" · ")}</span>
        </div>
      ))}
    </div>
  );
}

function PlaceScoreCard(props: { readonly score: PlaceScoreView; readonly group: string; readonly onGroup: (g: string) => void }) {
  const v = useV6();
  const { score } = props;
  const o = score.overall;
  const words = score.sendWords;
  const found = v.data.spend.data?.scoutOutcomes ?? null;
  return (
    <Card title={`Checklist score · ${score.placeLabel}`} aside={<span className={s.meta}>Read {mst(score.observedAt)}</span>}>
      <div className={s.stack}>
        {score.measures ? <MeasureFigures measures={score.measures} /> : (
          <div className={s.spread} style={{ alignItems: "baseline" }}>
            <span className={s.mono} style={{ fontSize: 34, fontWeight: 600 }} aria-label={`Held: ${percentWords(o)}`}>{percentWords(o)}</span>
            <span className={cx(s.p, s.small)}>{count(o.captured)} of {count(o.total)} held</span>
          </div>
        )}
        {score.growth && (
          <p className={cx(s.p, s.small)} aria-label="Starting list and grown list">
            Starting list (owed when the mission started, {mst(score.growth.missionStart)}): <strong>{score.growth.starting.percent === null ? "—" : `${score.growth.starting.percent.toFixed(1)}%`}</strong> · {count(score.growth.starting.n)} of {count(score.growth.starting.of)}
            {" · "}Grown list (owed now): <strong>{score.growth.grown.percent === null ? "—" : `${score.growth.grown.percent.toFixed(1)}%`}</strong> · {count(score.growth.grown.n)} of {count(score.growth.grown.of)}
            {score.growth.added > 0 ? ` · ${count(score.growth.added)} added since` : ""}
          </p>
        )}
        <ScoreBar g={o} label="Everything this place is owed" tall />
        <div className={s.legend}>{SCORE_PARTS.map((p) => <span key={p.key} className={s.legendItem}><Swatch cls={p.cls} />{p.words} · {count(o[p.key])}</span>)}</div>
        {found && found.length > 0 && <p className={cx(s.p, s.small)}>Agents found in the last 24 hours, across all places: {found.map((f) => `${FOUND_WORDS[f.recordClass] ?? f.recordClass.replace(/-/g, " ")} ${count(f.found)} evidence, ${count(f.route)} routes`).join(" · ")}</p>}
        {score.target && <p className={cx(s.p, s.small)}>Target: <strong>{score.target.goalPercent}%</strong> · now {score.measures ? (score.measures.completeness.percent === null ? "—" : `${score.measures.completeness.percent.toFixed(1)}%`) : percentWords(o)}{(score.measures ? score.measures.completeness.percent : o.percent) !== null && (score.measures ? score.measures.completeness.percent : o.percent)! >= score.target.goalPercent ? " · reached" : ""} · set {mst(score.target.setAt)}</p>}
        <Actions actions={[{ kind: "target-set", target: v.scopeKey, label: score.target ? "Change the target" : "Set a target" }, ...(score.target ? [{ kind: "target-clear" as const, target: v.scopeKey, label: "Clear the target" }] : [])]} />
        {words && <Actions actions={[{ kind: "send-agents", target: v.scopeKey, label: "Send agents to fill the blanks", payload: { words } }]} primaryFirst />}
        {!words && /^geo:[a-z]{2}\.(congressional_district|county)\./.test(v.scopeKey) && <Actions actions={[{ kind: "hunt-start", target: v.scopeKey, label: "Start hunts for the ZIPs here" }]} primaryFirst />}
        {score.extension && <p className={cx(s.p, s.small)}>Extra items beyond the core list, counted apart: {count(score.extension.captured)} of {count(score.extension.total)} captured{score.extension.percent === null ? "" : ` · ${percentWords(score.extension)}`}</p>}
        {score.trend && score.trend.previousPercent !== null && <p className={cx(s.p, s.small)}>{score.trend.direction === "up" ? "▲ Up" : score.trend.direction === "down" ? "▼ Down" : "■ Unchanged"} from {score.trend.previousPercent.toFixed(1)}% on {score.trend.previousDay}</p>}
        {score.notCaptured && (score.notCaptured.huntedNotFound > 0 || score.notCaptured.nothingHunts > 0) && <p className={cx(s.p, s.small)}>Not captured: {count(score.notCaptured.huntedNotFound)} hunted, not found yet · {count(score.notCaptured.nothingHunts)} nothing hunts this yet (no squad or door covers these items yet)</p>}
        {score.profiles && <p className={cx(s.p, s.small)}>{score.profiles.words} · {score.profiles.figures.fields.map((f) => `${f.label} ${f.held === null ? "—" : count(f.held)} of ${count(f.applies)}`).join(" · ")}{score.profiles.figures.notMeasured.length ? ` · not measured yet: ${score.profiles.figures.notMeasured.join(", ").toLowerCase()}` : ""}</p>}
        {score.coverage && <p className={cx(s.p, s.small)}>{score.coverage.words.join(" · ")}</p>}
        {score.summary && <p className={cx(s.p, s.small)}>Summary items, counted through their detail items and left out of the headline: {count(score.summary.captured)} of {count(score.summary.total)} captured</p>}
        <div className={s.stack}>
          {score.groups.map((g) => (
            <button key={g.group} type="button" className={cx(s.row, s.rowButton)} aria-pressed={props.group === g.group} style={props.group === g.group ? { boxShadow: "inset 0 0 0 1px var(--ring)" } : undefined} onClick={() => props.onGroup(g.group)}>
              <span className={s.spread}><strong style={{ fontSize: 13 }}>{g.name}</strong><span className={cx(s.meta, s.mono)}>{percentWords(g)} · {count(g.captured)} of {count(g.total)} captured{(() => { const n = score.familyNotCaptured?.find((f) => f.group === g.group)?.nothingHunts ?? 0; return n > 0 ? ` · nothing hunts ${count(n)}` : ""; })()}</span></span>
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
      </header>

      {v.data.checklist.load === "loading" && !c?.score && <Loading what="the checklist" />}
      {c?.score && <PlaceScoreCard score={c.score} group={group} onGroup={(g) => { setGroup(g); reset(); }} />}

      {!c?.score && <Card title="Facts about places">
        {!c?.placeGroups && <span className={s.big}>—</span>}
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
        {!c?.items && <span className={s.meta}>—</span>}
        {c?.items && !items.length && <Empty>{groupN && !c.items.some((i) => i.definitionId.startsWith(`${group}-`)) ? "—" : "No items"}</Empty>}
        <div className={s.stack}>
          {page.map((i) => (
            <button key={i.key} type="button" className={cx(s.row, s.rowButton)} onClick={() => v.open({ type: "item", key: i.key })}>
              <span className={s.spread}><strong style={{ fontSize: 13 }}>{i.definitionId} {i.name} · {i.subject}</strong><span className={s.legendItem}><Swatch cls={STATUS_COLOR[i.status]} /><span className={s.small}>{STATUS_LABEL[i.status]}</span></span></span>
              <span className={s.meta}>{i.missing}{i.nextCheckAt ? ` · next check ${mst(i.nextCheckAt)}` : ""}{i.addedAt ? ` · added ${mstDay(i.addedAt)}` : ""}</span>
            </button>
          ))}
        </div>
        {pager}
      </Card>

      <Card title="Things the whole system must be able to do">
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
                ) : <span className={s.meta}>—</span>}
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
