/**
 * **THE MAP PROVIDER, IN DETAIL.** (MAPQ-5, MAPQ-6, MAPQ-7; drawn in the
 * redesign's Money screen, 2026-09-23.)
 *
 * The map on the Reader draws its background from MapTiler, which bills by the
 * request, and the first billing period overran its allowance while nothing in
 * this system could say whose requests they were. This panel is the provider's
 * own count, read by the standing publisher: usage against the allowance, the
 * burn rate and the day it runs out, which key and which service spent it, our
 * own robots for comparison, whether our automation is blocked from spending
 * it, and the append-only history of every automatic collection.
 *
 * It renders the ONE projection the Money screen audits (`projectPanel` once,
 * `maptilerSectionNumbers` and `maptilerHistoryNumbers` pushed into the page's
 * audit before it runs), so it can never show numbers the page did not check.
 * A reading that is not connected draws no figures at all — a zero here would
 * read as headroom.
 */
import type { MapTilerAttemptHistory, MapTilerHistoryAttempt, MapTilerPanel } from "@/lib/control-plane/maptiler/usage.ts";
import { formatEastern } from "@/lib/control-plane/eastern-time.ts";

import { Dash, Pill, mw as s } from "./ui.tsx";

const n = (value: number): string => value.toLocaleString("en-US");

function attemptSays(attempt: MapTilerHistoryAttempt): string {
  if (attempt.disposition === "PROMOTED_CURRENT") return "Complete provider reading promoted to current.";
  if (attempt.disposition === "RETAINED_LKG") return "Collection failed; the prior good reading stayed live.";
  if (attempt.disposition === "UNKNOWN_NO_LKG") return "Collection failed and no prior good reading was available.";
  return "Receipt is inconsistent, so it licenses no health claim.";
}

export function MapTilerSection({ panel, history, historyGap }: { readonly panel: MapTilerPanel; readonly history: MapTilerAttemptHistory | null; readonly historyGap: string | null }) {
  const connected = panel.readingState !== "UNKNOWN";
  const pct = connected && panel.allowance !== null && panel.allowance > 0 && panel.used !== null ? Math.min(100, Math.round((panel.used / panel.allowance) * 100)) : null;
  return (
    <section className={`${s.card} ${s.gap32}`} aria-labelledby="maptiler" id="maptiler">
      <div className={s.row10}>
        <h2 id="maptiler" className={s.h2Inline}>
          Map tiles, in detail
        </h2>
        <Pill tone={panel.readingState === "MEASURED_CURRENT" ? "teal" : panel.readingState === "MEASURED_LKG" ? "amber" : "gold"}>
          {panel.readingState === "MEASURED_CURRENT" ? "CURRENT READING" : panel.readingState === "MEASURED_LKG" ? "LAST GOOD READING" : "NO READING"}
        </Pill>
      </div>
      <p className={s.lede}>
        The map on the Reader draws its background from MapTiler, and MapTiler bills by the request. This is their count, not ours. {panel.says}
      </p>
      {panel.latestAttemptSays && <p className={`${s.goldNote} ${s.gap14}`}>{panel.latestAttemptSays}</p>}

      {!connected ? (
        <div className={s.stack8}>
          {panel.needsOwner.map((says) => (
            <p key={says} className={s.body}>
              {says}
            </p>
          ))}
        </div>
      ) : (
        <>
          <div className={`${s.gridAuto220} ${s.gap20}`}>
            <div className={`${s.insetTile} ${s.stack6}`}>
              {panel.used === null ? <Dash>NOT MEASURED</Dash> : <span className={s.fig}>{n(panel.used)}</span>}
              <span className={s.note}>requests this billing period{panel.since && panel.until ? ` (${panel.since} to ${panel.until})` : ""}</span>
            </div>
            <div className={`${s.insetTile} ${s.stack6}`}>
              {panel.allowance === null ? <Dash>NOT CONFIRMED</Dash> : <span className={s.fig}>{n(panel.allowance)}</span>}
              <span className={s.note}>allowance{panel.allowanceIsAssumed ? " — assumed, not confirmed" : ""}</span>
            </div>
            <div className={`${s.insetTile} ${s.stack6}`}>
              {pct === null ? <Dash>NOT MEASURED</Dash> : <span className={s.fig}>{pct}%</span>}
              <span className={s.note}>of the allowance used</span>
            </div>
            <div className={`${s.insetTile} ${s.stack6}`}>
              {panel.burn === null ? <Dash>NO MEASURED DAYS</Dash> : <span className={s.fig}>{n(Math.round(panel.burn.perDay))}</span>}
              <span className={s.note}>{panel.burn === null ? "no measured days to average" : `a day, averaged over ${panel.burn.windowDays} day(s)`}</span>
            </div>
            <div className={`${s.insetTile} ${s.stack6}`}>
              {panel.burn?.exhaustionDate ? <span className={s.fig}>{panel.burn.exhaustionDate}</span> : <Dash>NONE AT THIS RATE</Dash>}
              <span className={s.note}>{panel.burn?.exhaustionDate ? "runs out on this date at the current rate" : "no exhaustion date at the current rate"}</span>
            </div>
          </div>

          <h3 className={s.h3}>Which key spent it</h3>
          <div className={`${s.stack6} ${s.gap20}`}>
            {panel.byKey.map((row) => (
              <div key={row.label} className={s.insetRow}>
                <span className={s.titleStrong14}>
                  {row.label}
                  {row.expectedZero ? " — not declared by this project" : ""}
                </span>
                <span className={s.figSm}>{n(row.requests)}</span>
                <span className={s.note}>{row.says}</span>
              </div>
            ))}
          </div>

          <h3 className={s.h3}>Which service spent it</h3>
          {panel.byService.length === 0 ? (
            <p className={`${s.note} ${s.gap20}`}>MapTiler returned no breakdown by service for this period, so Tiles and Rendered maps cannot be told apart in this reading.</p>
          ) : (
            <div className={`${s.stack6} ${s.gap20}`}>
              {panel.byService.map((row) => (
                <div key={row.service} className={s.insetRow}>
                  <span className={s.titleStrong14}>{row.service}</span>
                  <span className={s.figSm}>{n(row.requests)}</span>
                </div>
              ))}
            </div>
          )}

          <h3 className={s.h3}>Our own robots, for comparison</h3>
          {panel.actors === null ? (
            <p className={`${s.goldNote} ${s.gap20}`}>Our side of the comparison was not read, so it is unknown — not zero.</p>
          ) : (
            <div className={`${s.stack6} ${s.gap20}`}>
              <p className={panel.actors.state === "MEASURED" ? s.body : s.goldNote}>{panel.actors.says}</p>
              {panel.actors.defects.map((defect) => (
                <p key={defect} className={s.goldNote}>
                  {defect}
                </p>
              ))}
            </div>
          )}

          {panel.needsOwner.length > 0 && (
            <div className={`${s.stack6} ${s.gap20}`}>
              <span className={s.label}>Needs you</span>
              {panel.needsOwner.map((says) => (
                <p key={says} className={s.body}>
                  {says}
                </p>
              ))}
            </div>
          )}
        </>
      )}

      <p className={`${s.text14} ${s.gap20}`}>
        <span className={s.strong}>Is our own automation blocked from spending this? </span>
        {panel.automationBlocked ? "Yes." : "No — and it should be."} {panel.automationSays}
      </p>

      <h3 className={s.h3}>Automatic collection history</h3>
      <p className={s.note}>
        Every attempt below is an append-only control-plane receipt. The current or last-known-good reading above can move; this history cannot be replaced by a later run.
      </p>
      {history === null ? (
        <p className={s.goldNote}>{historyGap !== null ? historyGap : "The append-only map-provider history was not read, and nothing here claims it is empty."}</p>
      ) : (
        <>
          <div className={`${s.gridAuto220} ${s.gap14}`}>
            {history.windows.map((window) => (
              <div key={window.id} className={`${s.insetTile} ${s.stack6}`}>
                <span className={s.fig}>{n(window.attempts)}</span>
                <span className={s.note}>
                  attempt(s) in {window.label}: {n(window.promotedCurrent)} promoted, {n(window.retainedLkg)} kept the last good reading, {n(window.unknownNoLkg)} had none, {n(window.inconsistent)} inconsistent
                </span>
              </div>
            ))}
          </div>
          {history.unplaced.length > 0 && (
            <p className={s.goldNote}>At least one durable receipt has an unreadable or future finish time. It is not counted into a healthy window; the receipts are listed below.</p>
          )}
          <div className={s.stack8}>
            {history.attempts.map((attempt) => (
              <div key={attempt.digestId} className={s.insetRow}>
                <div className={s.stack2}>
                  <span className={s.text14}>
                    <span className={s.strong}>{attemptSays(attempt)}</span> Finished {formatEastern(attempt.outcome.finishedAt)}. Provider result {attempt.outcome.attempt.connection}.
                    {attempt.outcome.attempt.detail ? ` ${attempt.outcome.attempt.detail}` : ""}
                    {attempt.outcome.visibleMeasurement ? ` Visible measurement: ${formatEastern(attempt.outcome.visibleMeasurement.collectedAt)}.` : " No measured reading was visible."}
                    {attempt.issue ? ` Evidence issue: ${attempt.issue}` : ""}
                  </span>
                  <span className={s.monoSmall}>
                    Receipt <code>{attempt.digestId}</code>; candidate <code>{attempt.outcome.candidate.canonicalSha256}</code>.
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
