"use client";

import { Fragment, useState, useSyncExternalStore } from "react";

import { useV6 } from "./context.tsx";
import { SECTION_DEP } from "./dependencies.ts";
import { count, mst, usd, WORKER_STAGE_WORDS, type AdminV6Data, type AgentRun, type WorkerJob, type WorkerStage, type WorkersRunning, type WorkerStatus } from "./model.ts";
import { relation } from "./places.ts";
import { tierShortName } from "@/lib/models.ts";
import { runnerStateWords } from "./pulse-view.ts";
import { EvidenceCopyControl } from "../evidence-copy-control.tsx";
import { Actions, Card, cx, Empty, Pill, Technical, usePager } from "./ui.tsx";
import s from "./v6.module.css";

const STAGES: readonly WorkerStage[] = ["finding", "collecting", "extracting", "checking", "publishing"];

const when = (iso: string | null | undefined, withDay = true): string => (iso && Number.isFinite(Date.parse(iso)) ? mst(iso, withDay) : "—");

const megabytes = (bytes: number): string => `${(bytes / 1e6).toLocaleString("en-US", { maximumFractionDigits: 1 })} MB`;
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

export function roundReading(st: WorkerStatus | null | undefined, now: number): RoundReading {
  const cycle = st?.cycle;
  if (cycle?.finishedAt) {
    const exit = cycle.signal ? "it was stopped from outside" : cycle.exitCode === null ? "how it ended is not recorded" : cycle.exitCode === 0 ? "it ended normally" : `it ended with an error (code ${cycle.exitCode})`;
    return { headline: `Finished ${mst(cycle.finishedAt, false)}`,
      detail: `Started ${mst(cycle.startedAt)}; finished ${mst(cycle.finishedAt)}; ${exit}.`, overdue: false };
  }
  if (cycle && st?.runnerState !== "ALIVE") return {
    headline: "No finish recorded", detail: `Started ${mst(cycle.startedAt)}. The runner's check-in is ${st?.runnerState ? runnerStateWords(st.runnerState).toLowerCase() : "unread"}.`, overdue: false,
  };
  const last = st?.lastRoundFinishedAt ? ` The last round finished ${mst(st.lastRoundFinishedAt, false)}.` : "";
  if (st?.roundStartedAt && st.noProgressSince) {
    return { headline: `Stuck: no progress since ${mst(st.noProgressSince, false)}`, detail: `This round started ${mst(st.roundStartedAt)}. Nothing has started or reported since.${last}`, overdue: true };
  }
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

/** Workers running now, as a number. A read that stopped at its row limit shows "500+", never a short exact figure; no figure is "—". */
export function runningCount(running: WorkersRunning | null | undefined, jobs: readonly WorkerJob[] | null | undefined): string {
  if (running) return `${count(running.count)}${running.lowerBound ? "+" : ""}`;
  return jobs ? count(jobs.length) : "—";
}

export function systemRunningCount(running: WorkersRunning | null | undefined): string {
  return running ? `${count(running.system)}${running.lowerBound ? "+" : ""}` : "—";
}

/** Whole-system lane totals. Running is null (unknown) when any lane's running count is unknown. */
export function laneTotals(lanes: WorkerStatus["lanes"]): { readonly running: number | null; readonly waiting: number } | null {
  if (!lanes) return null;
  return {
    running: lanes.some((l) => l.active === null) ? null : lanes.reduce((a, l) => a + (l.active ?? 0), 0),
    waiting: lanes.reduce((a, l) => a + l.waiting, 0),
  };
}

export type WorkerCard = "progress" | "jobs" | "waiting" | "events" | "other";

/** Puts each missing part beside the card it affects; an unrecognised part still shows under "other". */
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

/** The Workers page in a few plain sentences, read before any tile or table; an unknown is said as not reported. */
export function workersInWords(input: {
  readonly update: { readonly status?: string; readonly title: string } | null | undefined;
  readonly status: WorkerStatus | null | undefined;
  readonly round: RoundReading;
  readonly checkIn: string | null;
  readonly progressAge: string | null;
  readonly working: string;
  readonly waiting: number | null;
  readonly place: string | null;
  readonly live: boolean;
}): string[] {
  const st = input.status;
  const lines: string[] = [];
  if (input.update) lines.push(input.update.status === "SUCCEEDED" ? "The latest update to the workers finished." : `${input.update.title} did not finish; the card below says who is fixing it.`);
  if (!st?.lastCheckIn) lines.push("The workers have no check-in on record.");
  else if (st.runnerState && st.runnerState !== "ALIVE") lines.push(`The workers last checked in ${input.checkIn ?? mst(st.lastCheckIn)} and are ${runnerStateWords(st.runnerState)} now.`);
  else lines.push(`The workers last checked in ${input.checkIn ?? mst(st.lastCheckIn)}.`);
  const failed = !!st?.cycle && (st.cycle.lastError !== null || (st.cycle.exitCode !== null && st.cycle.exitCode !== 0));
  if (input.round.headline !== "Not reported") lines.push(input.round.overdue ? `${input.round.headline}. ${input.round.detail}`
    : `Round of work: ${input.round.headline.charAt(0).toLowerCase()}${input.round.headline.slice(1)}${failed ? ", with an error; the details are on the Round of work tile" : ""}.`);
  const where = input.place ? ` in ${input.place}` : "";
  if (input.working !== "—" || input.waiting !== null) {
    lines.push(`${input.working === "—" ? "An unreported number of" : input.working} ${input.working === "1" ? "job is" : "jobs are"} working now${where}${input.waiting === null ? "" : `, and ${count(input.waiting)} ${input.waiting === 1 ? "is" : "are"} waiting`}.`);
  }
  if (st?.lastUsefulProgress) lines.push(`The last useful progress${where} was ${input.progressAge ?? mst(st.lastUsefulProgress.at)}: ${st.lastUsefulProgress.what.charAt(0).toLowerCase()}${st.lastUsefulProgress.what.slice(1).replace(/\.$/, "")}.`);
  else lines.push(`No useful progress${where} is on record yet.`);
  if (st?.refused) lines.push(`${count(st.refused.count)} paid ${st.refused.count === 1 ? "job was" : "jobs were"} not sent to the AI because ${st.refused.why.replace(/\.$/, "")}.`);
  if (!input.live) lines.push("This page is not getting live updates right now, so these may be out of date.");
  return lines;
}

type AgentFilter = "all" | AgentRun["state"];
const AGENT_FILTERS: readonly (readonly [AgentFilter, string])[] = [["all", "Every run"], ["running", "Working now"], ["done", "Finished"], ["stopped", "Stopped"], ["did-not-finish", "Did not finish"]];
const TIER_TONE: Readonly<Record<AgentRun["model"]["tier"], "info" | "good" | "gold" | "slate" | "warn">> = { haiku: "good", sonnet: "info", opus: "gold", "plain-code": "slate", older: "warn" };
const TIER_WORDS: Readonly<Record<AgentRun["model"]["tier"], string>> = { haiku: tierShortName("haiku"), sonnet: tierShortName("sonnet"), opus: tierShortName("opus"), "plain-code": "Plain code", older: "Older model" };

function Agents() {
  const v = useV6();
  const src = v.data.agents;
  const [filter, setFilter] = useState<AgentFilter>("all");
  const all = (src.data ?? []).filter((r) => relation(v.index, [r.placeKey], v.scopeKey) !== null);
  const list = all.filter((r) => filter === "all" || r.state === filter);
  const { page, pager, reset } = usePager(list, 6);
  const priced = all.filter((r) => r.costUsd !== null);
  const total = priced.reduce((n, r) => n + (r.costUsd ?? 0), 0);
  const byTier = (["haiku", "sonnet", "opus"] as const).map((k) => [k, all.filter((r) => r.model.tier === k).reduce((n, r) => n + (r.costUsd ?? 0), 0)] as const);
  return (
    <Card title="What the agents did" aside={<span className={s.meta}>{src.data ? `${count(all.length)} recent runs · ${usd(total)}` : "—"}</span>}>
      {src.data && (
        <>
          <p className={cx(s.p, s.small, s.dim)}>{byTier.map(([k, n]) => `${TIER_WORDS[k]} ${usd(n)}`).join(" · ")}</p>
          <div className={s.tabs} role="group" aria-label="Filter agent runs">
            {AGENT_FILTERS.map(([k, label]) => (
              <button key={k} type="button" className={s.tab} aria-pressed={filter === k} onClick={() => { setFilter(k); reset(); }}>
                {label}<span className={s.tabCount}>{k === "all" ? all.length : all.filter((r) => r.state === k).length}</span>
              </button>
            ))}
          </div>
          {!list.length && <Empty>No runs</Empty>}
          <div className={s.stack}>
            {page.map((r) => (
              <div key={r.id} className={s.row}>
                <div className={s.spread}>
                  <strong style={{ fontSize: 13 }}>{r.title}</strong>
                  <span className={s.inline}><Pill tone={r.state === "running" ? "good" : r.state === "done" ? "neutral" : "warn"}>{r.stateWords}</Pill><Pill tone={TIER_TONE[r.model.tier]} title={r.model.name}>{TIER_WORDS[r.model.tier]}</Pill></span>
                </div>
                <span className={s.meta}>{r.role} · {r.model.name} · {r.costWords} · {when(r.endedAt ? r.endedAt : r.startedAt)}</span>
                <span className={s.small}>{r.found}</span>
                {r.source && (
                  <span className={s.inline}>
                    {r.source.url && <a className={s.btnLink} href={r.source.url} target="_blank" rel="noreferrer noopener">Open the source page ↗</a>}
                    <span className={s.meta}>{count(r.source.savedPages)} saved page{r.source.savedPages === 1 ? "" : "s"}</span>
                    {r.source.copy && <EvidenceCopyControl path={r.source.copy.path} byteLength={r.source.copy.byteLength} />}
                  </span>
                )}
              </div>
            ))}
          </div>
          {pager}
        </>
      )}
    </Card>
  );
}

function Reliability() {
  const v = useV6();
  const src = v.data.reliability;
  const rows = src.data ?? [];
  const { page, pager } = usePager(rows, 8);
  const failing = rows.filter((r) => r.state === "failing").length;
  return (
    <Card title="How reliable our sources are · whole country" aside={<span className={s.meta}>{src.data ? `${count(rows.length)} sources across the country · ${count(failing)} failing now` : "—"}</span>}>
      {src.data && !rows.length && <Empty>No sources</Empty>}
      <div className={s.stack}>
        {page.map((r) => (
          <div key={r.source} className={s.row}>
            <div className={s.spread}><strong style={{ fontSize: 13 }}>{r.source.replace(/^https?:\/\//, "")}</strong><Pill tone={r.state === "failing" ? "warn" : r.state === "recovering" ? "gold" : "good"}>{r.state === "failing" ? `${r.consecutiveFailures} failed in a row` : r.state === "recovering" ? "Recovered" : "Healthy"}</Pill></div>
            <span className={s.meta}>{count(r.successes)} worked · {count(r.failures)} failed · last try {when(r.lastAttemptAt)}{r.retryAt ? ` · next try ${when(r.retryAt)}` : ""}</span>
            {r.state === "failing" && <span className={s.small}>{r.detail ? r.detail : "—"}</span>}
          </div>
        ))}
      </div>
      {pager}
    </Card>
  );
}

function Publication() {
  const v = useV6();
  const src = v.data.publication;
  const p = src.data;
  const rows = p?.notVisible ?? [];
  const { page, pager } = usePager(rows, 8);
  return (
    <Card title="Published versus reader-visible" aside={<span className={s.meta}>{p ? `${count(p.total)} routine contracts` : "—"}</span>}>
      {p && (
        <div className={s.stack}>
          <div className={s.stack}>
            <h3 className={s.h3}>State ballots</h3>
            <Actions actions={[{ kind: "ballot-publish", target: "ballot-contests" }]} />
            {p.ballotPublication ? <>
              <p className={s.small}>{p.ballotPublication.status === "PUBLISHED" ? "Published" : "Held"} {when(p.ballotPublication.at)}</p>
              <p className={s.small}>Merged: {p.ballotPublication.merged.map(file => file.slice(0, 2).toUpperCase()).join(", ") || "none"}</p>
              {p.ballotPublication.reason && <p className={s.small}>{p.ballotPublication.reason}</p>}
              {p.ballotPublication.skipped.length ? <ul className={s.stack}>
                {p.ballotPublication.skipped.map(row => <li key={row.file} className={s.small}>Skipped {row.file.slice(0, 2).toUpperCase()}: {row.reason}</li>)}
              </ul> : <p className={s.small}>Skipped: none</p>}
            </> : <p className={s.small}>No ballot publication reported yet.</p>}
          </div>
          <ul className={s.stack} style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {p.counts.map((c) => <li key={c.verdict} className={s.small}><strong>{count(c.count)} of {count(p.total)}</strong> {c.words.charAt(0).toLowerCase() + c.words.slice(1)}</li>)}
            <li className={s.small}><strong>{count(p.latestAttemptFailing)} of {count(p.total)}</strong> latest attempt failed</li>
          </ul>
          {!rows.length && <Empty>None</Empty>}
          {page.map((r) => (
            <div key={r.contract} className={s.row}>
              <div className={s.spread}><strong style={{ fontSize: 13 }}>{r.contract}</strong><Pill tone={r.verdict === "READBACK_FAILED" ? "warn" : "gold"}>{r.verdict === "NOT_PUBLISHED" ? "Not published" : r.verdict === "READBACK_FAILED" ? "Readback failed" : "Not read back"}</Pill></div>
              <span className={s.meta}>{r.words}{r.publishedAt ? ` · published ${when(r.publishedAt)}` : ""}</span>
              <span className={s.meta}>{r.attempt ? `Latest attempt ${r.attempt.state.toLowerCase().replaceAll("_", " ")} ${when(r.attempt.at)}${r.attempt.failureCode ? ` · ${r.attempt.failureCode}` : ""}` : "Latest attempt —"}</span>
            </div>
          ))}
          {pager}
          {p.notVisibleHidden > 0 && <span className={s.meta}>{count(p.notVisibleHidden)} more</span>}
        </div>
      )}
    </Card>
  );
}

function StageJobs(props: { readonly stage: WorkerStage; readonly list: readonly WorkerJob[]; readonly live: boolean; readonly sample: boolean }) {
  const v = useV6();
  const { page, pager } = usePager(props.list, 10);
  return (
    <div className={s.stack}>
      <h3 className={s.h3}>{WORKER_STAGE_WORDS[props.stage]} <span className={cx(s.mono, s.dim)}>{props.list.length}</span></h3>
      {!props.list.length && <Empty>No jobs</Empty>}
      {page.map((j) => (
        <div key={j.id} className={s.row}>
          <div className={s.spread}><strong style={{ fontSize: 13 }}>{j.title}</strong><span className={s.meta}>{j.hunt}</span></div>
          <span className={s.meta}>{v.index.get(j.placeKey)?.name} · {j.requirement} · started {when(j.startedAt, false)}{props.live ? ` · ${j.elapsed}` : ""}</span>
          <dl className={s.facts}>
            <dt>Using</dt><dd>{j.method}</dd>
            <dt>AI</dt><dd>{j.model}</dd>
            {([["Cost", j.cost], ["Latest", j.latest], ["Next", j.next]] as const).map(([label, value]) => (props.sample || value !== "—") && <Fragment key={label}><dt>{label}</dt><dd>{value}</dd></Fragment>)}
          </dl>
        </div>
      ))}
      {pager}
    </div>
  );
}

export function WorkersScreen() {
  const v = useV6();
  const now = usePageClock();
  const src = v.data.workers;
  const w = src.data;
  const st = w?.status;
  const live = v.connection === "live";
  const arrived = workersSectionArrived(src);
  const isCountry = v.place.kind === "Country";
  const inScope = (applies: readonly string[]) => relation(v.index, applies, v.scopeKey) !== null;
  const jobs = w?.jobs?.filter((j) => inScope([j.placeKey])) ?? null;
  const waiting = w?.waiting?.filter((x) => inScope(x.applies)) ?? null;
  const events = w?.events?.filter((e) => inScope(e.applies)) ?? null;
  const totals = laneTotals(st?.lanes ?? null);
  const round = roundReading(st, now);
  const roundMissing = round.headline === "Not reported";
  const checkIn = ageWords(st?.lastCheckIn ?? null, now);
  const progressAge = ageWords(st?.lastUsefulProgress?.at ?? null, now);
  const connWords = { live: "Live", stale: "Out of date", reconnecting: "Reconnecting", offline: "Disconnected", connecting: "Connecting" }[v.connection];
  const running = w?.running ?? null;
  const nowWorking = runningCount(running, jobs);
  return (
    <>
      <header>
        <p className={s.eyebrow}>{v.place.name}</p>
        <h1 className={s.h1}>Workers</h1>
        {arrived && src.asOf && <p className={cx(s.p, s.meta)}>Read {mst(src.asOf)}</p>}
      </header>

      <Card title="In plain words">
        <div className={s.stack} style={{ gap: 6 }}>
          {workersInWords({ update: w?.update, status: st, round, checkIn, progressAge,
            working: jobs ? nowWorking : totals?.running != null ? count(totals.running) : "—",
            waiting: jobs ? (waiting ? waiting.length : null) : totals ? totals.waiting : null,
            place: isCountry ? null : v.place.name, live }).map((line) => <p key={line} className={s.p}>{line}</p>)}
        </div>
      </Card>

      {w?.update ? (
        <Card title={w.update.title} tone={w.update.status === "SUCCEEDED" ? undefined : "warn"} aside={<span className={s.meta}>Checked {mst(w.update.checkedAt)}</span>}>
          <p className={s.p}>{w.update.what}</p>
          <dl className={s.facts}>
            <dt>Why it matters</dt><dd>{w.update.impact}</dd>
            <dt>Who handles it</dt><dd>{w.update.owner}</dd>
            <dt>What happens next</dt><dd>{w.update.next}</dd>
            <dt>Do you need to act?</dt><dd>{w.update.youNeedToAct}</dd>
          </dl>
          {w.update.fixId && <div className={s.inline}>
            <button type="button" className={cx(s.btn, s.btnPrimary)} onClick={() => v.open({ type: "fix", id: w.update!.fixId! })}>See the update and what’s blocking it</button>
          </div>}
          <Technical lines={w.update.technical} />
        </Card>
      ) : (
        <Card title="Are the workers on the latest update?">
          <p className={cx(s.p, s.small)}>—</p>
        </Card>
      )}

      <section aria-label="Status" className={s.gridTiles}>
        <div className={cx(s.row, !live && s.cardWarn)}><span className={s.eyebrow}>Live updates</span><strong className={live ? s.textGood : s.textWarn}>{connWords}</strong></div>
        <div className={s.row}><span className={s.eyebrow}>Workers last checked in</span><strong>{when(st?.lastCheckIn)}</strong><span className={s.meta}>{checkIn ? checkIn : ""}{st?.runnerState && st.runnerState !== "ALIVE" ? `${checkIn ? ". " : ""}Workers: ${runnerStateWords(st.runnerState)}` : ""}</span></div>
        <div className={s.row}>
          <span className={s.eyebrow}>Last useful progress{isCountry ? "" : ` in ${v.place.name}`}</span>
          <strong>{when(st?.lastUsefulProgress?.at)}</strong>
          {st?.lastUsefulProgress && <span className={s.meta}>{progressAge ? `${progressAge}. ` : ""}{st.lastUsefulProgress.what}</span>}
        </div>
        <div className={cx(s.row, round.overdue && s.cardWarn)}><span className={s.eyebrow}>Round of work</span><strong className={round.overdue ? s.textWarn : undefined}>{roundMissing ? "—" : round.headline}</strong>{st?.lastRoundFinishedAt && !round.headline.startsWith("Last finished") && <span className={s.meta}>Last finished {when(st.lastRoundFinishedAt, false)}</span>}{st?.cycle && <><span className={s.meta}>{round.detail}</span>{st.cycle.lastError && <><span className={cx(s.meta, s.textWarn)}>The last round ended with an error.</span><Technical lines={[st.cycle.lastError]} /></>}</>}</div>
        <div className={s.row}>
          <span className={s.eyebrow}>Database reads, last full hour</span>
          <strong>{st?.databaseReads ? megabytes(st.databaseReads.controlPlaneBytes + st.databaseReads.readerBytes) : "—"}</strong>
          {st?.databaseReads && <><span className={s.meta}>Work records {megabytes(st.databaseReads.controlPlaneBytes)} · reader data {megabytes(st.databaseReads.readerBytes)} · hour starting {mst(st.databaseReads.hour, false)}</span>
            <Technical lines={st.databaseReads.byCaller.map(row => `${megabytes(row.bytes)} ← ${row.caller}`)} /></>}
        </div>
        {st?.refused && <div className={cx(s.row, s.cardWarn)}><span className={s.eyebrow}>Refused before the AI</span><strong className={s.textWarn}>{count(st.refused.count)} paid jobs</strong><span className={s.meta}>Not sent to the AI because {st.refused.why}.</span></div>}
        <div className={s.row}>
          <span className={s.eyebrow}>{jobs ? `Work in ${v.place.name}` : isCountry ? "Work" : "Work, all places"}</span>
          <strong>{jobs ? `${nowWorking} working now · ${waiting ? waiting.length : "—"} waiting` : totals ? `${totals.running === null ? "—" : count(totals.running)} running · ${count(totals.waiting)} waiting` : "—"}</strong>
          {jobs && running && !isCountry && <span className={s.meta}>{systemRunningCount(running)} in the whole system</span>}
        </div>
      </section>

      <Agents />

      <Reliability />

      <Publication />

      <Card title="Working now, by stage" aside={jobs ? <span className={s.meta}>{nowWorking} working now</span> : undefined}>
        {!jobs && !st?.lanes && <p className={cx(s.p, s.small)}>—</p>}
        {st?.lanes && !jobs && (
          <div className={s.gridTiles}>
            {st.lanes.map((l) => <div key={l.name} className={s.row}><strong className={s.small}>{l.name}</strong><span className={s.small}>{l.active === null ? "— running" : `${count(l.active)} running`} · {count(l.waiting)} waiting</span>{l.blockedBy && <span className={s.meta}>{l.blockedBy}</span>}</div>)}
          </div>
        )}
        {jobs && !jobs.length && <Empty>No jobs</Empty>}
        {jobs && STAGES.map((stage) => <StageJobs key={stage} stage={stage} list={jobs.filter((j) => j.stage === stage)} live={live} sample={src.state === "sample"} />)}
      </Card>

      <Card title="Waiting, and why" aside={waiting ? <span className={s.meta}>{waiting.length} {waiting.length === 1 ? "reason" : "reasons"}</span> : undefined}>
        {!waiting && <p className={cx(s.p, s.small)}>—</p>}
        {waiting && !waiting.length && <Empty>Nothing waiting</Empty>}
        <div className={s.stack}>
          {waiting?.map((x) => (
            <div key={`${x.kind}:${x.title}`} className={s.row}>
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
          {!events && <p className={cx(s.p, s.small)}>—</p>}
          {events && !events.length && <Empty>No changes</Empty>}
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
          {w?.next ? <ul className={s.stack} style={{ margin: 0, paddingLeft: 18 }}>{w.next.map((n) => <li key={n} className={s.small}>{n}</li>)}</ul> : <p className={cx(s.p, s.small)}>{st?.nextRoundDueAt ? `Next round ${round.overdue ? "was due" : "due"} ${when(st.nextRoundDueAt, false)}` : "—"}</p>}
          <Actions actions={[{ kind: "global-runner-pause", target: "runner" }]} />
        </Card>
      </div>

    </>
  );
}
