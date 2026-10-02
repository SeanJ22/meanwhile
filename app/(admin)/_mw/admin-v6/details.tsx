"use client";

/**
 * Detail panels. Every panel ends with "Instructions about this item, and what
 * happened". Technical identifiers live only under "Technical details".
 */
import type { ReactNode } from "react";

import { STATUS_COLOR, STATUS_LABEL, Swatch } from "./charts.tsx";
import { useV6, type Detail } from "./context.tsx";
import { mst, STAGE_NAMES, type ActionRef, type SavedDoc } from "./model.ts";
import { relation } from "./places.ts";
import { ReceiptCard } from "./receipt-view.tsx";
import { TaskStages } from "./screen-fix.tsx";
import { EvidenceTrail } from "./trail-view.tsx";
import { LANE_TONE, LANE_WORDS, StuckRow } from "./screen-now.tsx";
import { Actions, Card, cx, Empty, Facts, markWords, Pill, Technical } from "./ui.tsx";
import s from "./v6.module.css";

function Panel(props: { readonly eyebrow: string; readonly title: string; readonly badge?: ReactNode; readonly summary?: string; readonly actions?: readonly ActionRef[]; readonly targets: readonly string[]; readonly children?: ReactNode }) {
  const v = useV6();
  const receipts = v.receipts.filter((r) => props.targets.includes(r.target));
  return (
    <>
      <header className={s.stack} style={{ gap: 6 }}>
        <p className={s.eyebrow}>{props.eyebrow}</p>
        <div className={s.spread}><h1 className={s.h1}>{props.title}</h1>{props.badge}</div>
        {props.summary && <p className={cx(s.p, s.dim)}>{props.summary}</p>}
      </header>
      {!!props.actions?.length && <Actions actions={props.actions} primaryFirst />}
      {props.children}
      <Card title="Instructions about this item, and what happened">
        {!receipts.length && <Empty>No instructions about this item yet.</Empty>}
        <div className={s.stack}>{receipts.map((r) => <ReceiptCard key={r.key} receipt={r} />)}</div>
      </Card>
    </>
  );
}

function Doc(props: { readonly doc: SavedDoc }) {
  const v = useV6();
  const d = props.doc;
  const last = v.receipts.find((r) => r.kind === "doc-request" && r.target === d.id);
  const ready = d.access === "public" || (last?.status === "done");
  const state = d.access === "public" ? "Public copy" : d.access === "unavailable" ? "Unavailable" : last ? last.statusWords : "Private · not opened";
  return (
    <div className={s.row}>
      <div className={s.spread}><strong className={s.small}>{d.name}</strong><span className={cx(s.small, d.access === "unavailable" || last?.status === "failed" ? s.textWarn : s.dim)}>{state}</span></div>
      <span className={s.meta}>{d.meta}</span>
      <a className={s.small} href={d.sourceUrl} target="_blank" rel="noreferrer noopener">Official source ↗</a>
      {d.access === "private" && !ready && <Actions actions={[{ kind: "doc-request", target: d.id, label: last?.status === "failed" ? "Try again" : "Open the saved copy" }]} />}
      {ready && d.preview && <pre className={cx(s.tech)} style={{ whiteSpace: "pre-wrap", padding: 8 }}>{d.preview}</pre>}
    </div>
  );
}

export function DetailPanel(props: { readonly detail: Detail }) {
  const v = useV6();
  const d = props.detail;

  if (d.type === "result") {
    const r = v.data.results.data?.find((x) => x.id === d.id);
    if (!r) return <Empty>This result isn’t available.</Empty>;
    const stuck = (v.data.stuck.data ?? []).filter((i) => i.resultId === r.id);
    const containRef = stuck.flatMap((i) => i.actions).find((a) => a.kind === "contain" || a.kind === "uncontain");
    return (
      <Panel eyebrow={`${v.index.get(r.applies[0])?.name}${r.kind === null ? "" : ` · ${r.kind}`} · delivery trail`} title={r.title} summary={r.readerSees} badge={r.kind === null ? undefined : <Pill tone={r.kind === "New" ? "good" : r.kind === "Updated" ? "info" : "neutral"}>{r.kind}</Pill>}
        actions={[{ kind: "recheck", target: r.id }, ...(containRef ? [containRef] : [])]} targets={[r.id, ...stuck.map((i) => i.id), ...r.trail.flatMap((t) => t.docs?.map((x) => x.id) ?? [])]}>
        <Card title="From source to reader">
          <Facts rows={[["Applies to", r.applies.map((a) => v.index.get(a)?.name ?? a).join(", ")], ...(r.kind === null ? [] : [["Kind", r.kind] as const])]} />
          <ol className={s.trail}>
            {r.trail.map((st, i) => (
              <li key={i} className={s.trailStep}>
                <span className={cx(s.dot, s[`mark-${st.mark}`])} style={{ width: 16, height: 16, marginTop: 2 }} aria-hidden="true" />
                <div className={s.stack} style={{ gap: 6 }}>
                  <div className={s.spread}><strong style={{ fontSize: 13 }}>{i + 1}. {STAGE_NAMES[i] ?? st.name}</strong><span className={s.meta}>{markWords(st.mark)} · {/^d{4}-dd-ddT/.test(st.when) ? mst(st.when) : st.when}</span></div>
                  <span className={s.small}>{st.what}</span>
                  {st.missing && <span className={cx(s.small, s.textWarn)}>Missing: {st.missing}</span>}
                  {st.next && <span className={s.small}><span className={s.dim}>Next:</span> {st.next}</span>}
                  {st.docs?.map((doc) => <Doc key={doc.id} doc={doc} />)}
                  {st.facts && (
                    <div className={s.tableWrap}><table className={s.table}><tbody>{st.facts.map((f) => <tr key={f.field}><td>{f.field}</td><td>{f.value}</td><td className={/conflict|retained|missing|not|wrong|hidden/i.test(f.note) ? s.textWarn : s.textGood}>{f.note}</td></tr>)}</tbody></table></div>
                  )}
                  {st.publicLink && <span className={s.small}><a href={st.publicLink.url} target="_blank" rel="noreferrer noopener">{st.publicLink.label} ↗</a>{st.publicLink.seenAt ? <span className={s.dim}> · seen {mst(st.publicLink.seenAt)}</span> : <span className={s.textWarn}> · not seen on the page</span>}</span>}
                  <Technical lines={st.technical ?? []} />
                </div>
              </li>
            ))}
          </ol>
        </Card>
        {!!stuck.length && <Card title="Stuck items on this result"><div className={s.stack}>{stuck.map((i) => <StuckRow key={i.id} item={i} />)}</div></Card>}
      </Panel>
    );
  }

  if (d.type === "stuck") {
    const i = v.data.stuck.data?.find((x) => x.id === d.id);
    if (!i) return <Empty>This item isn’t available.</Empty>;
    const res = v.data.results.data?.find((r) => r.id === i.resultId);
    const same = (v.data.stuck.data ?? []).filter((x) => x.group && x.group === i.group && x.id !== i.id);
    return (
      <Panel eyebrow={`${v.index.get(i.applies[0])?.name} · stuck item`} title={i.title} summary={i.cause} badge={<Pill tone={LANE_TONE[i.lane]}>{LANE_WORDS[i.lane]}</Pill>}
        actions={[...i.actions, ...(i.lane === "software" && i.fixId ? [{ kind: "eng-task" as const, target: i.fixId }] : [])]} targets={[i.id, i.resultId ?? "", i.fixId ?? "", i.decision?.id ?? "", ...i.actions.map((a) => a.target)]}>
        <Card title="What we know">
          <Facts rows={[["Reader result", res ? res.title : "—"], ["Stuck for", i.age], ["What was tried", i.tried], ["Did it help", i.helped], ["Next", i.next], ["Who moves it", i.owner], ...(i.latest ? [["Latest", i.latest] as const] : []), ...(i.readersAffected ? [["Readers", "Affected right now"] as const] : [])]} />
          <div className={s.inline}>
            {res && <button type="button" className={s.btnLink} onClick={() => v.open({ type: "result", id: res.id })}>Delivery trail: {res.title} →</button>}
            {i.fixId && <button type="button" className={s.btnLink} onClick={() => v.open({ type: "fix", id: i.fixId! })}>The fix: {v.nameOf(i.fixId)} →</button>}
          </div>
          <Technical lines={[`stuck ${i.id}`, ...(i.fixId ? [`fix ${i.fixId}`] : [])]} />
        </Card>
        <Card title="What was saved for this work"><EvidenceTrail id={i.id} /></Card>
        {!!same.length && <Card title="Same cause"><div className={s.stack}>{same.map((x) => <StuckRow key={x.id} item={x} />)}</div></Card>}
      </Panel>
    );
  }

  if (d.type === "item") {
    const it = v.data.checklist.data?.items?.find((x) => x.key === d.key);
    if (!it) return <Empty>This checklist item isn’t available.</Empty>;
    const def = v.data.checklist.data?.definitions.find((x) => x.id === it.definitionId);
    return (
      <Panel eyebrow={`Checklist item · checklist ${v.data.checklist.data?.profileVersion}`} title={`${it.definitionId} ${it.name} · ${it.subject}`}
        badge={<span className={s.legendItem}><Swatch cls={STATUS_COLOR[it.status]} /><span className={s.small}>{STATUS_LABEL[it.status]}</span></span>} actions={it.actions} targets={[it.key, ...it.actions.map((a) => a.target)]}>
        <Card title="The requirement, part by part">
          {def && <p className={cx(s.p, s.small)}><span className={s.dim}>Official wording:</span> {def.requirement}</p>}
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead><tr><th scope="col">Part</th><th scope="col">Status</th><th scope="col">Proof, or what’s missing</th></tr></thead>
              <tbody>{it.parts.map((p, n) => <tr key={n}><td className={s.small}>{p.text}</td><td className={cx(s.small, p.tone === "warn" ? s.textWarn : p.tone === "good" ? s.textGood : s.dim)} style={{ whiteSpace: "nowrap" }}>{p.status}</td><td className={s.small}>{p.proof}</td></tr>)}</tbody>
            </table>
          </div>
          <Facts rows={[["Subject", it.subject], ["Period", it.period], ["Missing", it.missing], ["Applies because", it.appliesBecause], ["Who moves it", it.owner], ["Next", it.next]]} />
          {it.resultId && <button type="button" className={s.btnLink} onClick={() => v.open({ type: "result", id: it.resultId! })}>Related delivery trail →</button>}
        </Card>
      </Panel>
    );
  }

  if (d.type === "system") {
    const c = v.data.checklist.data;
    const g = c?.systemGroups.find((x) => x.group === d.group);
    const defs = (c?.definitions ?? []).filter((x) => x.group === d.group);
    return (
      <Panel eyebrow="Whole system" title={g?.name ?? d.group} summary={`${defs.length} definitions`} targets={[d.group]}>
        <Card title="Definitions">
          <ul className={s.stack} style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {defs.map((x) => {
              const note = g?.audit?.[x.id];
              const st = !note ? null : note.startsWith("PARTIAL") ? ["Partly built", s.textInfo] : note.startsWith("GAP") ? ["Known gap", s.textWarn] : note.startsWith("UNPROVED") || note.startsWith("RISK") ? ["Not yet checked", s.dim] : ["Other", s.dim];
              return (
                <li key={x.id} className={s.row}>
                  <div className={s.spread}><strong className={cx(s.small, s.mono)}>{x.id}</strong>{st && <span className={cx(s.small, st[1])}>{st[0]}</span>}</div>
                  <span className={s.small}>{x.requirement}</span>
                  {note && <Technical label="Audit note" lines={[note]} />}
                </li>
              );
            })}
          </ul>
        </Card>
      </Panel>
    );
  }

  if (d.type === "fix") {
    const f = v.data.fixes.data?.open.find((x) => x.id === d.id);
    if (!f) return <Empty>This fix isn’t available.</Empty>;
    return (
      <Panel eyebrow={`Fix list · ${f.owner}`} title={f.title} summary={f.problem} badge={<Pill>{({ attention: "Needs attention", fixing: "Being fixed", update: "Waiting for update" })[f.tab]}</Pill>}
        actions={[{ kind: "fixfirst", target: f.id }, { kind: "focus", target: f.id }]} targets={[f.id]}>
        <Card title="Where it stands">
          <Facts rows={[["What it helps", f.helps], ["Place in line", f.placeInLine], ["Resources now", f.resourcesNow]]} />
          {f.origin === "engineering" && <TaskStages stage={f.taskStage} />}
          {!!f.linkedStuck.length && <div className={s.stack}>{f.linkedStuck.map((id) => { const i = v.data.stuck.data?.find((x) => x.id === id); return i ? <StuckRow key={id} item={i} /> : null; })}</div>}
          <Technical lines={[f.technical]} />
        </Card>
      </Panel>
    );
  }

  if (d.type === "work") {
    const r = v.data.workRows.data?.rows.find((x) => x.id === d.id);
    if (!r) return <Empty>This work row isn’t available.</Empty>;
    return (
      <Panel eyebrow={`${v.index.get(r.placeKey)?.name} · work row`} title={r.title} summary={`Stage: ${r.stage} · ${r.age}`} targets={[r.id]}>
        <Card title="Details"><Facts rows={[["Where", v.index.get(r.placeKey)?.name ?? r.placeKey], ["Attempts, evidence and costs", "—"]]} /></Card>
      </Panel>
    );
  }

  // search
  const q = d.query.toLowerCase();
  const hits: { type: string; title: string; sub: string; go: () => void }[] = [
    ...(v.data.results.data ?? []).filter((r) => relation(v.index, r.applies, v.scopeKey)).map((r) => ({ type: "Reader result", title: r.title, sub: `${v.index.get(r.applies[0])?.name}${r.kind === null ? "" : ` · ${r.kind}`}`, go: () => v.open({ type: "result", id: r.id }) })),
    ...(v.data.stuck.data ?? []).filter((i) => relation(v.index, i.applies, v.scopeKey)).map((i) => ({ type: "Stuck item", title: i.title, sub: `${v.index.get(i.applies[0])?.name} · ${LANE_WORDS[i.lane]}`, go: () => v.open({ type: "stuck", id: i.id }) })),
    ...(v.data.fixes.data?.open ?? []).map((f) => ({ type: "Fix", title: f.title, sub: f.owner, go: () => v.open({ type: "fix", id: f.id }) })),
    ...(v.data.checklist.data?.definitions ?? []).map((x) => ({ type: "Definition", title: `${x.id} ${x.requirement.split(" — ")[0]}`, sub: v.data.checklist.data?.groupNames[x.group] ?? x.group, go: () => v.go("checklist") })),
    ...v.places.map((p) => ({ type: "Place", title: p.name, sub: p.kind, go: () => v.setScope(p.key) })),
    ...(v.data.workRows.data?.rows ?? []).filter((r) => relation(v.index, [r.placeKey], v.scopeKey)).map((r) => ({ type: `Work row · ${r.stage}`, title: r.title, sub: v.index.get(r.placeKey)?.name ?? "", go: () => v.open({ type: "work", id: r.id }) })),
  ].filter((h) => `${h.type} ${h.title} ${h.sub}`.toLowerCase().includes(q)).slice(0, 40);
  return (
    <>
      <header><p className={s.eyebrow}>Search · {v.place.name}</p><h1 className={s.h1}>“{d.query}”</h1></header>
      <Card title={`${hits.length} ${hits.length === 1 ? "match" : "matches"}`}>
        {!hits.length && <Empty>Nothing matches “{d.query}” here.</Empty>}
        <div className={s.stack}>{hits.map((h, i) => <button key={i} type="button" className={cx(s.row, s.rowButton)} onClick={h.go}><span className={s.meta}>{h.type}</span><strong style={{ fontSize: 13 }}>{h.title}</strong><span className={s.meta}>{h.sub}</span></button>)}</div>
      </Card>
    </>
  );
}
