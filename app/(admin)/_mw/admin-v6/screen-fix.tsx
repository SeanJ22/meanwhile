"use client";

/**
 * **FIX LIST.** Needs attention · Being fixed · Waiting for update · Fixed and
 * checked · Came back. Reordering ("Move up the list") and asking for more
 * resources ("Focus more resources here") are separate controls. A fix proving
 * itself across places is a Queue row, and shows once on Now when it proves
 * out (DP-26); this list keeps no running learning status.
 */
import { useState } from "react";

import { useV6 } from "./context.tsx";
import { mstDay, TASK_STAGES, type ClosedFix, type FixTab, type OpenFix } from "./model.ts";
import { Actions, cx, Empty, Facts, Pill, Tabs, Technical, useListView } from "./ui.tsx";
import s from "./v6.module.css";

export function FixScreen() {
  const v = useV6();
  const f = v.data.fixes.data;
  const [tab, setTab] = useState<FixTab>("attention");
  const open = (f?.open ?? []).filter((o) => o.tab === tab);
  return (
    <>
      <header>
        <p className={s.eyebrow}>Whole system</p>
        <h1 className={s.h1}>Fix list</h1>
      </header>
      <Tabs label="Fix list" value={tab} onChange={setTab} tabs={[
        { id: "attention", label: "Needs attention", count: f ? f.open.filter((o) => o.tab === "attention").length : "—" },
        { id: "fixing", label: "Being fixed", count: f ? f.open.filter((o) => o.tab === "fixing").length : "—" },
        { id: "update", label: "Waiting for update", count: f ? f.open.filter((o) => o.tab === "update").length : "—" },
        { id: "done", label: "Fixed and checked", count: f ? f.closed.length : "—" },
        { id: "returned", label: "Came back", count: f ? f.returned.length : "—" },
      ]} />
      {(tab === "attention" || tab === "fixing" || tab === "update") && (
        <div className={s.stack} role="tabpanel">
          {f && !open.length && <Empty>Nothing in this list.</Empty>}
          {open.map((o) => <OpenFixCard key={o.id} fix={o} />)}
        </div>
      )}
      {(tab === "done" || tab === "returned") && <History list={tab === "done" ? f?.closed ?? [] : f?.returned ?? []} returned={tab === "returned"} />}
    </>
  );
}

export function TaskStages(props: { readonly stage: number | null }) {
  if (props.stage === null) return <span className={s.meta}>—</span>;
  return (
    <div className={s.stepper} aria-label={`Task progress: ${TASK_STAGES[props.stage]}`}>
      {TASK_STAGES.map((label, n) => <span key={label} className={cx(s.stepChip, n <= props.stage! && s.stepChipOn)}>{label}</span>)}
    </div>
  );
}

function OpenFixCard(props: { readonly fix: OpenFix }) {
  const v = useV6();
  const o = props.fix;
  return (
    <article className={s.card} aria-label={o.title}>
      <div className={s.spread}>
        <button type="button" className={s.btnLink} onClick={() => v.open({ type: "fix", id: o.id })}><strong style={{ fontSize: 15, color: "var(--text)" }}>{o.title}</strong></button>
        <Pill tone={o.tab === "attention" ? "warn" : "neutral"}>{({ attention: "Needs attention", fixing: "Being fixed", update: "Waiting for update" })[o.tab]}</Pill>
      </div>
      <p className={cx(s.p, s.small)}>{o.problem}</p>
      <Facts rows={[["Who handles it", o.owner], ["What it helps", o.helps], ["Place in line", o.placeInLine], ["Resources now", o.resourcesNow], ["Where it came from", o.origin === "automatic" ? "Automatic repair" : "Engineering"]]} />
      {o.origin === "engineering" && <TaskStages stage={o.taskStage} />}
      {!!o.linkedStuck.length && (
        <div className={s.inline}>
          <span className={s.meta}>Stuck items it clears:</span>
          {o.linkedStuck.map((id) => <button key={id} type="button" className={s.btnLink} onClick={() => v.open({ type: "stuck", id })}>{v.nameOf(id)}</button>)}
        </div>
      )}
      <Actions actions={[{ kind: "fixfirst", target: o.id }, { kind: "focus", target: o.id }, ...(o.origin === "engineering" && o.taskId === null ? [{ kind: "eng-task" as const, target: o.id }] : [])]} />
      <Technical lines={[o.technical]} />
    </article>
  );
}

function History(props: { readonly list: readonly ClosedFix[]; readonly returned: boolean }) {
  const [q, setQ] = useState("");
  const [openAll, setOpenAll] = useState(true);
  const filtered = props.list.filter((x) => (!q.trim() || [x.title, x.changed, x.places, x.saved, x.usedBy, x.since].join(" ").toLowerCase().includes(q.trim().toLowerCase())));
  const v = useV6();
  const { page, pager, reset } = useListView({ section: "fixes", page: v.data.fixes.page, list: filtered, params: { tab: props.returned ? "returned" : "done", q: q.trim() }, size: 5 });
  return (
    <details className={s.card} open={openAll} onToggle={(e) => setOpenAll((e.target as HTMLDetailsElement).open)}>
      <summary className={s.h2} style={{ cursor: "pointer" }}>{props.returned ? "Came back after a fix" : "Fixed and checked"} ({props.list.length})</summary>
      <div className={s.stack} style={{ marginTop: 12 }}>
        <div className={s.inline}>
          <input className={s.input} style={{ flex: "1 1 220px" }} aria-label="Search fixed history" placeholder="Search fixes" value={q} onChange={(e) => { setQ(e.target.value); reset(); }} />
        </div>
        {!filtered.length && <Empty>No fix matches.</Empty>}
        {page.map((x) => (
          <details key={x.id} className={s.row}>
            <summary style={{ cursor: "pointer", listStyle: "none" }}>
              <span className={s.spread}>
                <strong style={{ fontSize: 13 }}>{x.title}</strong>
              </span>
              <span className={s.meta}>{x.places} · fixed {mstDay(x.fixedAt)} · {x.origin}</span>
            </summary>
            <div className={s.stack} style={{ marginTop: 8 }}>
              <p className={cx(s.p, s.small)}>{x.changed}</p>
              <Facts rows={[
                ["What changed", x.whatChanged],
                ["Checked on the reader page", x.readerRecheck],
                ["Since the fix", x.since],
                ...(x.returnedDetail ? [["When it came back", x.returnedDetail] as const] : []),
                ...(x.history ? [["History", x.history] as const] : []),
                ["Saved to prevent it", x.saved],
                ["Used by", x.usedBy],
              ]} />
              <Technical lines={[x.technical]} />
            </div>
          </details>
        ))}
        {pager}
      </div>
    </details>
  );
}
