"use client";

/**
 * **WORKERS.** The workers that collect, check and publish information
 * (engineers call them the runner): what each is doing, why anything waits,
 * the last useful progress (not just a check-in), costs and the next step.
 *
 * Reads `admin-v6/workers@1` as it arrives. Each card shows what the section
 * sent and, beside it, the section's own `missingParts` for that card. A
 * partly connected page never hides a working card behind a generic "not
 * connected" note, and an unknown list or count is never shown as none or 0.
 *
 * Ages ("about 15 minutes ago") and a late round are worked out from the
 * clock each time the page draws. The existing pulse redraws the page about
 * every 45 seconds, so they move on with no new worker message and no timer
 * of their own.
 */
import { useSyncExternalStore } from "react";

import { useV6 } from "./context.tsx";
import { SECTION_DEP } from "./dependencies.ts";
import { count, mst, WORKER_STAGE_WORDS, type AdminV6Data, type Dependency, type WaitingItem, type WorkerStage, type WorkerStatus } from "./model.ts";
import { relation } from "./places.ts";
import { runnerStateWords } from "./pulse-view.ts";
import { ReceiptCard } from "./receipt-view.tsx";
import { Actions, Card, cx, Empty, Pill, SourceNote, Technical } from "./ui.tsx";
import s from "./v6.module.css";

const STAGES: readonly WorkerStage[] = ["finding", "collecting", "extracting", "checking", "publishing"];

/* ------------------------------------------------------------ the clock */

const MINUTE = 60_000;
const noSubscription = () => () => {};
const minuteNow = () => Math.floor(Date.now() / MINUTE) * MINUTE;

/** The current minute. Read on each draw; it never schedules a draw itself. */
export function usePageClock(): number {
  return useSyncExternalStore(noSubscription, minuteNow, minuteNow);
}

/** How long ago, in five-minute steps under an hour. Null when the time is unreadable. */
export function ageWords(iso: string | null, now: number): string | null {
  const at = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(at)) return null;
  const min = Math.floor((now - at) / MINUTE);
  if (min < 5) return "less than 5 minutes ago";
  if (min < 60) return `about ${Math.floor(min / 5) * 5} minutes ago`;
  const h = Math.floor(min / 60);
  if (h < 48) return `about ${h} hour${h === 1 ? "" : "s"} ago`;
  return `about ${Math.floor(h / 24)} days ago`;
}

function spanWords(ms: number): string {
  const min = Math.floor(ms / MINUTE);
  if (min < 5) return "less than 5 minutes";
  if (min < 60) return `about ${Math.floor(min / 5) * 5} minutes`;
  const h = Math.floor(min / 60);
  return h < 48 ? `about ${h} hour${h === 1 ? "" : "s"}` : `about ${Math.floor(h / 24)} days`;
}

/** A round is late once it is this far past due with no newer start saved. */
export const ROUND_LATE_AFTER_MS = 5 * MINUTE;

export interface RoundReading {
  readonly headline: string;
  readonly detail: string;
  readonly overdue: boolean;
}

/** The current or next round, including whether it is late, from saved times only. */
export function roundReading(st: WorkerStatus | null | undefined, now: number): RoundReading {
  const last = st?.lastRoundFinishedAt ? ` The last round finished ${mst(st.lastRoundFinishedAt, false)}.` : "";
  if (st?.roundStartedAt) {
    return { headline: `Running since ${mst(st.roundStartedAt, false)}`, detail: `This round has run for ${spanWords(now - Date.parse(st.roundStartedAt))}.${last}`, overdue: false };
  }
  const due = st?.nextRoundDueAt ? Date.parse(st.nextRoundDueAt) : NaN;
  if (!Number.isFinite(due)) {
    return { headline: st?.lastRoundFinishedAt ? `Last finished ${mst(st.lastRoundFinishedAt, false)}` : "Not reported", detail: "When the next round starts isn’t reported, so no finish time is shown.", overdue: false };
  }
  if (due > now) return { headline: `Next round due ${mst(st!.nextRoundDueAt, false)}`, detail: `That is in ${spanWords(due - now)}.${last}`, overdue: false };
  if (now - due < ROUND_LATE_AFTER_MS) return { headline: `Next round due ${mst(st!.nextRoundDueAt, false)}`, detail: `It was due ${spanWords(now - due)} ago. No start is saved yet.${last}`, overdue: false };
  return { headline: "The next round is late", detail: `It was due ${mst(st!.nextRoundDueAt, false)}, ${spanWords(now - due)} ago, and no newer start is saved.${last}`, overdue: true };
}

/* ---------------------------------------------------- whole-system lanes */

/** Whole-system lane totals. Running is null (unknown) when any lane's running count is unknown. */
export function laneTotals(lanes: WorkerStatus["lanes"]): { readonly running: number | null; readonly waiting: number } | null {
  if (!lanes) return null;
  return {
    running: lanes.some((l) => l.active === null) ? null : lanes.reduce((a, l) => a + (l.active ?? 0), 0),
    waiting: lanes.reduce((a, l) => a + l.waiting, 0),
  };
}

/* ------------------------------------------------ what didn't arrive, by card */

export type WorkerCard = "progress" | "jobs" | "waiting" | "events" | "other";

/**
 * Put each of the section's `missingParts` beside the card it affects. The
 * wording is the backend's (`v6-workers-read.ts`); a part this does not
 * recognise is still shown, under "other", never dropped.
 */
export function missingByCard(parts: readonly string[] | undefined): Readonly<Record<WorkerCard, readonly string[]>> {
  const out: Record<WorkerCard, string[]> = { progress: [], jobs: [], waiting: [], events: [], other: [] };
  for (const m of parts ?? []) {
    if (m === SECTION_DEP.workers.need) continue; // the whole section hasn't arrived; shown on its own
    const card: WorkerCard = m.startsWith(SECTION_DEP.workerActive.id) || /paid research jobs?\b.*\b(running|checked|placed)/i.test(m) ? "jobs"
      : /last useful progress/i.test(m) ? "progress"
      : /source receipts?|^Showing the newest/i.test(m) ? "events"
      : /split by place|per-hunt reading|tasks are finished/i.test(m) ? "waiting"
      : "other";
    const plain = m.startsWith(`${SECTION_DEP.workerActive.id}: `) ? m.slice(SECTION_DEP.workerActive.id.length + 2) : m;
    out[card].push(plain.charAt(0).toUpperCase() + plain.slice(1));
  }
  return out;
}

/** False for the pulse-only stand-in: the Workers section itself hasn’t arrived. */
export function workersSectionArrived(src: AdminV6Data["workers"]): boolean {
  return src.state === "sample" || src.state === "live" && !(src.missingParts ?? []).includes(SECTION_DEP.workers.need);
}

/** What each kind of waiting item does and doesn't mean. */
export function waitingMeans(x: WaitingItem): string | null {
  switch (x.kind) {
    case "Not finished":
      return "These are the tasks assigned to this hunt. It isn’t the 325-item checklist, and a finished task isn’t proof readers can see it.";
    case "Keeps failing":
      return "One source failing again and again. It’s one problem, not separate results.";
    case "Held":
      return "Held work isn’t published, so readers don’t see it.";
    case "In line":
      return "Counted for the whole system, not one place.";
    default:
      return null;
  }
}

/* ---------------------------------------------------------------- pieces */

export function Missing(props: { readonly parts: readonly string[]; readonly dependency?: Dependency }) {
  if (!props.parts.length) return null;
  return (
    <div className={cx(s.notice, s.noticeMissing)} role="status">
      <strong>Not shown here, and why</strong>
      {props.parts.map((m) => <span key={m}>{m}</span>)}
      {props.dependency && <span className={s.meta}>Supplied by {props.dependency.owner} · {props.dependency.id}</span>}
    </div>
  );
}

function WholeSystem(props: { readonly place: string; readonly isCountry: boolean }) {
  return <Pill tone="slate" title="These counts cover every place the workers serve.">{props.isCountry ? "Whole system" : `Whole system, not just ${props.place}`}</Pill>;
}

/* ---------------------------------------------------------------- screen */

export function WorkersScreen() {
  const v = useV6();
  const now = usePageClock();
  const src = v.data.workers;
  const w = src.data;
  const st = w?.status;
  const live = v.connection === "live";
  const arrived = workersSectionArrived(src);
  const sample = src.state === "sample";
  const miss = missingByCard(arrived ? src.missingParts?.map((m) => v.scopeKey.includes(":") ? m.replaceAll(v.scopeKey, v.place.name) : m) : undefined);
  const isCountry = v.place.kind === "Country";
  const inScope = (applies: readonly string[]) => relation(v.index, applies, v.scopeKey) !== null;
  const jobs = w?.jobs?.filter((j) => inScope([j.placeKey])) ?? null;
  const waiting = w?.waiting?.filter((x) => inScope(x.applies)) ?? null;
  const events = w?.events?.filter((e) => inScope(e.applies)) ?? null;
  const totals = laneTotals(st?.lanes ?? null);
  const round = roundReading(st, now);
  const checkIn = ageWords(st?.lastCheckIn ?? null, now);
  const progressAge = ageWords(st?.lastUsefulProgress?.at ?? null, now);
  const connWords = { live: "Live", stale: "Out of date", reconnecting: "Reconnecting", offline: "Disconnected", connecting: "Connecting" }[v.connection];
  const notArrived = { state: "not-connected" as const, load: "ready" as const, data: null, asOf: null, dependency: SECTION_DEP.workers };
  const huntsOrAreas = jobs ? new Set(jobs.map((j) => j.hunt)).size : 0;
  return (
    <>
      <header>
        <p className={s.eyebrow}>{v.place.name}</p>
        <h1 className={s.h1}>Workers</h1>
        <p className={cx(s.p, s.small, s.dim)}>The workers collect, check and publish information. Engineers call them the runner.</p>
        {!isCountry && <p className={cx(s.p, s.small)}>Lists on this page cover work sent to a hunt in {v.place.name}. Counts marked <strong>Whole system</strong> cover every place.</p>}
        {arrived && src.asOf && <p className={cx(s.p, s.meta)}>Read {mst(src.asOf)}{live ? "" : ". Nothing newer is arriving right now, so this may be out of date"}.</p>}
      </header>

      {!arrived && !sample && (
        <div className={cx(s.notice, s.noticeMissing)} role="status">
          <strong>The detailed Workers reading hasn’t arrived{src.state === "live" ? "" : " yet"}.</strong>
          <span>The check-in and whole-system counts below come from the live pulse. Waiting reasons and changes appear here by themselves once the reading arrives. You don’t need to reload.</span>
        </div>
      )}

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
          <p className={cx(s.p, s.small)}>Unknown. Whether the workers run the same version as the website isn’t read yet, so no answer is shown.</p>
          <SourceNote source={{ state: "not-connected", load: "ready", data: null, asOf: null, dependency: SECTION_DEP.workerVersion }} />
        </Card>
      )}

      <section aria-label="Status" className={s.gridTiles}>
        <div className={cx(s.row, !live && s.cardWarn)}><span className={s.eyebrow}>Live updates</span><strong className={live ? s.textGood : s.textWarn}>{connWords}</strong><span className={s.meta}>{live ? "News from the workers is coming in" : "Nothing new is arriving. What’s shown is the last good reading"}</span></div>
        <div className={s.row}><span className={s.eyebrow}>Workers last checked in</span><strong>{mst(st?.lastCheckIn ?? null)}</strong><span className={s.meta}>{checkIn ? `${checkIn}. ` : ""}{st?.runnerState && st.runnerState !== "ALIVE" ? `Workers: ${runnerStateWords(st.runnerState)}. ` : ""}A check-in only means they’re switched on, not that they made progress.</span></div>
        <div className={s.row}>
          <span className={s.eyebrow}>Last useful progress{isCountry ? "" : ` in ${v.place.name}`}</span>
          <strong>{st?.lastUsefulProgress ? mst(st.lastUsefulProgress.at) : "Unknown"}</strong>
          <span className={s.meta}>{st?.lastUsefulProgress ? `${progressAge ? `${progressAge}. ` : ""}${st.lastUsefulProgress.what}` : miss.progress.length ? miss.progress.join(" ") : "A check-in isn’t progress, so nothing is inferred from it."}</span>
        </div>
        <div className={cx(s.row, round.overdue && s.cardWarn)}><span className={s.eyebrow}>Round of work</span><strong className={round.overdue ? s.textWarn : undefined}>{round.headline}</strong><span className={s.meta}>{round.detail}</span></div>
        <div className={s.row}>
          <span className={s.eyebrow}>{jobs ? `Work in ${v.place.name}` : "Whole-system work"}</span>
          <strong>{jobs ? `${jobs.length} working now · ${waiting?.length ?? "unknown"} waiting` : totals ? `${totals.running === null ? "Unknown number" : count(totals.running)} running · ${count(totals.waiting)} waiting` : "Not reported"}</strong>
          <span className={s.meta}>{jobs ? (live ? "The lists below add up to these counts" : "Last known, may be out of date") : totals ? (isCountry ? "Across every place" : `Across every place, not just ${v.place.name}. How many are working in ${v.place.name} is unknown`) : "The lane counts weren’t read"}</span>
        </div>
      </section>
      {!!st?.unread.length && <p className={cx(s.p, s.meta)}>Not read this time: {st.unread.join("; ")}. Other readings continue to update.</p>}

      <Card title="Working now, by stage" aside={jobs ? <span className={s.meta}>{jobs.length} jobs working at the same time across {huntsOrAreas} hunts or shared areas</span> : totals ? <WholeSystem place={v.place.name} isCountry={isCountry} /> : undefined}>
        {!jobs && sample && <SourceNote source={src} />}
        {!jobs && !sample && (
          <>
            <p className={cx(s.p, s.small)}>The full list of jobs running now isn’t available, so how many are working {isCountry ? "right now" : `in ${v.place.name}`} is unknown, not zero.</p>
            <Missing parts={arrived ? miss.jobs : [SECTION_DEP.workerActive.need]} dependency={SECTION_DEP.workerActive} />
          </>
        )}
        {st?.lanes && !jobs && (
          <div className={s.gridTiles}>
            {st.lanes.map((l) => <div key={l.name} className={s.row}><strong className={s.small}>{l.name}</strong><span className={s.small}>{l.active === null ? "Running: unknown" : `${count(l.active)} running`} · {count(l.waiting)} waiting</span>{l.blockedBy && <span className={s.meta}>{l.blockedBy}</span>}</div>)}
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

      <Card title="Waiting, and why" aside={waiting ? <span className={s.meta}>{waiting.length} {waiting.length === 1 ? "reason" : "reasons"}</span> : undefined}>
        {!waiting && (sample ? <SourceNote source={src} /> : (
          <p className={cx(s.p, s.small)}>{arrived ? `A complete waiting list for ${v.place.name} isn’t available. Unknown doesn’t mean nothing is waiting.` : "Waiting reasons arrive with the detailed Workers reading. Unknown doesn’t mean nothing is waiting."}</p>
        ))}
        {waiting && !waiting.length && <Empty>Nothing is waiting in {v.place.name}.</Empty>}
        <div className={s.stack}>
          {waiting?.map((x) => {
            const means = waitingMeans(x);
            return (
              <div key={`${x.kind}:${x.title}`} className={s.row}>
                <div className={s.spread}><strong style={{ fontSize: 13 }}>{x.title}</strong><span className={cx(s.pill, s["tone-slate"])}>{x.kind === "In line" && !isCountry ? "In line · whole system" : x.kind}</span></div>
                <span className={s.small}>{x.why}</span>
                {means && <span className={s.meta}>{means}</span>}
                <span className={s.meta}>Next: {x.nextTime} · {x.owner}</span>
                <Actions actions={x.actions} />
              </div>
            );
          })}
        </div>
        {!arrived && !sample && <SourceNote source={notArrived} />}
        <Missing parts={miss.waiting} />
      </Card>

      <div className={s.grid2}>
        <Card title="What changed">
          {!events && (sample ? <SourceNote source={src} /> : (
            <p className={cx(s.p, s.small)}>{arrived ? `No change for ${v.place.name} is in the readings this page can see. That doesn’t mean nothing happened: plain-code jobs don’t record changes this page can read yet.` : "Changes arrive with the detailed Workers reading."}</p>
          ))}
          {events && !events.length && <Empty>No recorded changes in {v.place.name}.</Empty>}
          <ul className={s.stack} style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {events?.map((e, i) => (
              <li key={i} className={s.small}>
                <span className={cx(s.mono, s.dim)}>{e.at}</span>{" "}
                <strong className={e.tone === "good" ? s.textGood : e.tone === "warn" ? s.textWarn : s.textInfo}>{e.kind}</strong> · {e.text}
              </li>
            ))}
          </ul>
          {events && events.length > 0 && <p className={cx(s.p, s.meta)}>A run that ended isn’t proof readers can see its result. A run whose work claim ran out isn’t proof it delivered nothing.</p>}
          <Missing parts={miss.events} />
        </Card>
        <Card title="What happens next">
          {w?.next ? <ul className={s.stack} style={{ margin: 0, paddingLeft: 18 }}>{w.next.map((n) => <li key={n} className={s.small}>{n}</li>)}</ul> : <Empty>The next steps aren’t reported yet. {st?.nextRoundDueAt ? `The next round ${round.overdue ? "was" : "is"} due ${mst(st.nextRoundDueAt, false)}.` : "No finish time is shown when none is known."}</Empty>}
          <Actions actions={[{ kind: "scope-first", target: v.scopeKey }, { kind: "global-runner-pause", target: "runner" }]} />
        </Card>
      </div>

      {miss.other.length > 0 && <Card title="Also not available"><Missing parts={miss.other} /></Card>}

      <Card title="Your instructions, and what the workers did with them" aside={<button type="button" className={s.btnLink} onClick={() => v.go("work")}>All history →</button>}>
        {v.data.history.state !== "live" && <SourceNote source={v.data.history} what="Saved instructions" />}
        {!v.receipts.length && <Empty>No instructions yet.</Empty>}
        <div className={s.stack}>{v.receipts.filter((r) => relation(v.index, [r.scopeKey], v.scopeKey) !== null || r.level === "global").slice(0, 8).map((r) => <ReceiptCard key={r.key} receipt={r} />)}</div>
      </Card>
    </>
  );
}
