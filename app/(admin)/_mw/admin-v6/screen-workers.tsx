"use client";

/**
 * **WORKERS.** The workers that collect, check and publish information
 * (engineers call them the runner): what each is doing, why anything waits,
 * the last useful progress (not just a check-in), costs and the next step.
 */
import { useV6 } from "./context.tsx";
import { mst, WORKER_STAGE_WORDS, type WorkerStage } from "./model.ts";
import { relation } from "./places.ts";
import { runnerStateWords } from "./pulse-view.ts";
import { ReceiptCard } from "./receipt-view.tsx";
import { Actions, Card, cx, Empty, SourceNote, Technical } from "./ui.tsx";
import s from "./v6.module.css";

const STAGES: readonly WorkerStage[] = ["finding", "collecting", "extracting", "checking", "publishing"];

export function WorkersScreen() {
  const v = useV6();
  const w = v.data.workers.data;
  const st = w?.status;
  const live = v.connection === "live";
  const inScope = (applies: readonly string[]) => relation(v.index, applies, v.scopeKey) !== null;
  const jobs = w?.jobs?.filter((j) => inScope([j.placeKey])) ?? null;
  const waiting = w?.waiting?.filter((x) => inScope(x.applies)) ?? null;
  const events = w?.events?.filter((e) => inScope(e.applies)) ?? null;
  const connWords = { live: "Live", stale: "Out of date", reconnecting: "Reconnecting", offline: "Disconnected", connecting: "Connecting" }[v.connection];
  const eventsDep = { state: "not-connected" as const, load: "ready" as const, data: null, asOf: null, dependency: { id: "DEP-WORKER-EVENTS", owner: "Codex (runner progress read)", need: "Per-worker jobs, waiting reasons and a plain event feed. The live pulse only says the workers checked in, not what they did." } };
  const jobsDep = { state: "not-connected" as const, load: "ready" as const, data: null, asOf: null, dependency: { id: "DEP-WORKER-ACTIVE-INDEX", owner: "Codex (worker repository)", need: "A bounded read of every unexpired work claim, including collection jobs outside the research worker list. Until it exists, the number working in this place is unknown." } };
  const huntsOrAreas = jobs ? new Set(jobs.map((j) => j.hunt)).size : 0;
  return (
    <>
      <header>
        <p className={s.eyebrow}>{v.place.name}</p>
        <h1 className={s.h1}>Workers</h1>
        <p className={cx(s.p, s.small, s.dim)}>The workers collect, check and publish information. Engineers call them the runner.</p>
      </header>

      {w?.update ? (
        <Card title={w.update.title} tone="warn" aside={<span className={s.meta}>Checked {mst(w.update.checkedAt)}</span>}>
          <p className={s.p}>{w.update.what}</p>
          <dl className={s.facts}>
            <dt>Why it matters</dt><dd>{w.update.impact}</dd>
            <dt>Who handles it</dt><dd>{w.update.owner}</dd>
            <dt>What happens next</dt><dd>{w.update.next}</dd>
            <dt>Do you need to act?</dt><dd>{w.update.youNeedToAct}</dd>
          </dl>
          <div className={s.inline}>
            <button type="button" className={cx(s.btn, s.btnPrimary)} onClick={() => v.open({ type: "fix", id: w.update!.fixId })}>See the update and what’s blocking it</button>
            <Actions actions={[{ kind: "focus", target: w.update.fixId }]} />
          </div>
          <Technical lines={w.update.technical} />
        </Card>
      ) : (
        <Card title="Are the workers on the latest update?">
          <SourceNote source={{ state: "not-connected", load: "ready", data: null, asOf: null, dependency: { id: "DEP-WORKER-VERSION", owner: "Codex (runner adoption)", need: "The website’s version against the workers’ version, and whether an update is waiting for a restart." } }} />
        </Card>
      )}

      <section aria-label="Status" className={s.gridTiles}>
        <div className={cx(s.row, !live && s.cardWarn)}><span className={s.eyebrow}>Live updates</span><strong className={live ? s.textGood : s.textWarn}>{connWords}</strong><span className={s.meta}>{live ? "News from the workers is coming in" : "Nothing new is arriving"}</span></div>
        <div className={s.row}><span className={s.eyebrow}>Workers last checked in</span><strong>{mst(st?.lastCheckIn ?? null)}</strong><span className={s.meta}>This only means they’re switched on{st?.runnerState ? ` (${runnerStateWords(st.runnerState)})` : ""}</span></div>
        <div className={s.row}><span className={s.eyebrow}>Last useful progress</span><strong>{st?.lastUsefulProgress ? mst(st.lastUsefulProgress.at) : "Not reported"}</strong><span className={s.meta}>{st?.lastUsefulProgress ? st.lastUsefulProgress.what : "A check-in isn’t progress, so nothing is inferred from it."}</span></div>
        <div className={s.row}><span className={s.eyebrow}>Current round of work</span><strong>{st?.roundStartedAt ? `Started ${mst(st.roundStartedAt, false)}` : st?.lastRoundFinishedAt ? `Last finished ${mst(st.lastRoundFinishedAt, false)}` : "Not reported"}</strong><span className={s.meta}>{st?.nextRoundDueAt ? `Next due ${mst(st.nextRoundDueAt, false)}` : "When the next round starts isn’t reported, so no finish time is shown"}</span></div>
        <div className={s.row}><span className={s.eyebrow}>{jobs ? `Work in ${v.place.name}` : "Whole-system work"}</span><strong>{jobs ? `${jobs.length} working now · ${waiting?.length ?? 0} waiting` : st?.lanes ? `${st.lanes.reduce((a, l) => a + (l.active ?? 0), 0)} running · ${st.lanes.reduce((a, l) => a + l.waiting, 0)} waiting` : "Not reported"}</strong><span className={s.meta}>{jobs ? (live ? "The lists below add up to these counts" : "Last known, may be out of date") : st?.lanes ? "Whole-system lane counts; the number working in this place is unknown" : ""}</span></div>
      </section>
      {!!st?.unread.length && <p className={cx(s.p, s.meta)}>Not read this time: {st.unread.join("; ")}. Other readings continue to update.</p>}

      <Card title="Working now, by stage" aside={jobs ? <span className={s.meta}>{jobs.length} jobs working at the same time across {huntsOrAreas} hunts or shared areas</span> : undefined}>
        {!jobs && <SourceNote source={v.data.workers.state === "sample" ? v.data.workers : w ? jobsDep : eventsDep} />}
        {st?.lanes && !jobs && (
          <div className={s.gridTiles}>
            {st.lanes.map((l) => <div key={l.name} className={s.row}><strong className={s.small}>{l.name}</strong><span className={s.small}>{l.active ?? "—"} running · {l.waiting} waiting</span>{l.blockedBy && <span className={s.meta}>{l.blockedBy}</span>}</div>)}
          </div>
        )}
        {jobs && !jobs.length && <Empty>Nothing is running in {v.place.name} right now.</Empty>}
        {jobs && STAGES.map((stage) => {
          const list = jobs.filter((j) => j.stage === stage);
          return (
            <div key={stage} className={s.stack}>
              <h3 className={s.h3}>{WORKER_STAGE_WORDS[stage]} <span className={cx(s.mono, s.dim)}>{list.length}</span></h3>
              {!list.length && <Empty>No job at this stage.</Empty>}
              {list.map((j) => (
                <div key={j.id} className={s.row}>
                  <div className={s.spread}><strong style={{ fontSize: 13 }}>{j.title}</strong><span className={s.meta}>{j.hunt}</span></div>
                  <span className={s.meta}>{v.index.get(j.placeKey)?.name} · {j.requirement} · started {mst(j.startedAt, false)} · {live ? j.elapsed : "last known"}</span>
                  <dl className={s.facts}>
                    <dt>Using</dt><dd>{j.method}</dd>
                    <dt>AI</dt><dd>{j.model} — {j.modelWhy}</dd>
                    <dt>Cost</dt><dd>{j.cost}</dd>
                    <dt>Latest</dt><dd>{j.latest}</dd>
                    <dt>Next</dt><dd>{j.next}</dd>
                  </dl>
                  <Actions actions={[{ kind: "job-stop", target: j.id }]} />
                </div>
              ))}
            </div>
          );
        })}
      </Card>

      <Card title="Waiting, and why">
        {!waiting && <SourceNote source={v.data.workers.state === "sample" ? v.data.workers : eventsDep} />}
        {waiting && !waiting.length && <Empty>Nothing is waiting in {v.place.name}.</Empty>}
        <div className={s.stack}>
          {waiting?.map((x) => (
            <div key={x.title} className={s.row}>
              <div className={s.spread}><strong style={{ fontSize: 13 }}>{x.title}</strong><span className={cx(s.pill, s["tone-slate"])}>{x.kind}</span></div>
              <span className={s.small}>{x.why}</span>
              <span className={s.meta}>Next: {x.nextTime} · {x.owner}</span>
              <Actions actions={x.actions} />
            </div>
          ))}
        </div>
      </Card>

      <div className={s.grid2}>
        <Card title="What changed">
          {!events && <SourceNote source={v.data.workers.state === "sample" ? v.data.workers : eventsDep} />}
          {events && !events.length && <Empty>No recorded changes in {v.place.name}.</Empty>}
          <ul className={s.stack} style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {events?.map((e, i) => (
              <li key={i} className={s.small}>
                <span className={cx(s.mono, s.dim)}>{e.at}</span>{" "}
                <strong className={e.tone === "good" ? s.textGood : e.tone === "warn" ? s.textWarn : s.textInfo}>{e.kind}</strong> · {e.text}
              </li>
            ))}
          </ul>
        </Card>
        <Card title="What happens next">
          {w?.next ? <ul className={s.stack} style={{ margin: 0, paddingLeft: 18 }}>{w.next.map((n) => <li key={n} className={s.small}>{n}</li>)}</ul> : <Empty>The next steps aren’t reported yet. {st?.nextRoundDueAt ? `The next round is due ${mst(st.nextRoundDueAt, false)}.` : "No finish time is shown when none is known."}</Empty>}
          <Actions actions={[{ kind: "scope-first", target: v.scopeKey }, { kind: "global-runner-pause", target: "runner" }]} />
        </Card>
      </div>

      <Card title="Your instructions, and what the workers did with them" aside={<button type="button" className={s.btnLink} onClick={() => v.go("work")}>All history →</button>}>
        {v.data.history.state !== "live" && <SourceNote source={v.data.history} what="Saved instructions" />}
        {!v.receipts.length && <Empty>No instructions yet.</Empty>}
        <div className={s.stack}>{v.receipts.filter((r) => relation(v.index, [r.scopeKey], v.scopeKey) !== null || r.level === "global").slice(0, 8).map((r) => <ReceiptCard key={r.key} receipt={r} />)}</div>
      </Card>
    </>
  );
}
