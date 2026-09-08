/**
 * **THE MAP PROVIDER'S BILL** (MAPQ-6, 2026-09-07).
 *
 * The first MapTiler billing period closed at 101,863 requests against a
 * 100,000-request free allowance while public readership was tiny, and nothing
 * in this system could say which of those requests were readers and which were
 * ours. This panel exists so that question has an answer next time, and it is
 * written to the same test as every other panel here — the owner's own:
 *
 * > *"Think of someone: I'm not an engineer and I'm not a coder at all. What
 * > is it that I'm looking at? What needs to be taken action on?"*
 *
 * ## The one thing this panel must never say
 *
 * That production-key usage is a count of people. It is public-origin usage
 * plus any bounded probe we have named, and an outside crawler that genuinely
 * runs the public site is part of it. What MAPQ-1 changed is narrower and is
 * worth exactly what it is: OUR declared robots are no longer mixed into that
 * number. `lib/control-plane/maptiler/usage.ts` holds every sentence this
 * panel renders, and `tests/maptiler-usage.test.ts` walks all of them for the
 * words that would overclaim.
 *
 * ## NOT CONNECTED is not zero
 *
 * On a quota panel a zero reads as headroom. So an unasked question renders as
 * an unasked question, with the variable that would answer it named — and
 * every number on the page disappears rather than being drawn at zero.
 */
import { MAPTILER_SERVICE_TOKEN_VAR } from "@/lib/control-plane/maptiler/types.ts";
import type { MapTilerPanel } from "@/lib/control-plane/maptiler/usage.ts";

import { QueueButton, When } from "../../console-ui.tsx";
import { NeedsYouLine } from "../../status-ui.tsx";

export interface MapTilerSectionProps {
  readonly panel: MapTilerPanel;
}

const n = (value: number): string => value.toLocaleString("en-US");

export function MapTilerSection({ panel }: MapTilerSectionProps) {
  const connected = panel.connection === "CONNECTED";
  const pct =
    connected && panel.allowance !== null && panel.allowance > 0 && panel.used !== null
      ? Math.min(100, Math.round((panel.used / panel.allowance) * 100))
      : null;

  return (
    <section className="card mt-panel" id="maptiler">
      <h2>Map provider</h2>

      {/* 1 — what this is */}
      <p className="mt-what">
        The map on the Reader draws its background from MapTiler, and MapTiler bills by the
        request. This is their count, not ours.
      </p>

      {/* 2 — what happened */}
      <p className="mt-status">
        <strong>{connected ? "Reading taken." : "No reading."}</strong> {panel.says}
      </p>

      {/*
        ADM-58 — HOW OLD THE READING IS, ON THE FACE.

        The owner read a zero and concluded the panel was not pulling anything.
        It was: both classifiers answered 200. What the card never told him is
        WHEN it last asked, because the timestamp was two disclosures down under
        Technical details. A figure with no age on a quota card is the one shape
        that cannot be checked by looking at it.

        The second sentence is the one that matters operationally: nothing
        schedules the refresh. `pnpm maptiler:usage` is in no workflow, no
        cadence entry and no publisher list, so this timestamp does not advance
        on its own and a reading taken once will keep rendering as the current
        one. Saying so is the difference between a stale number and a stale
        number that admits it.
      */}
      {connected && (
        <p className="note">
          This reading was taken <When iso={panel.collectedAt} />, and nothing refreshes it on a schedule —
          it advances only when the usage read is run again, so treat the figure as of that moment rather than
          as of now.
        </p>
      )}

      {/*
        A CONNECTED panel used to render a confident total even when one of the
        two classifier calls had failed: the failure sat on the snapshot and
        never reached the face. That is not what happened on 9.7.26 — both
        answered 200 — but a total that silently drops half its evidence is
        worth closing while the file is open.
      */}
      {connected && panel.detail !== null && <p className="note gap">{panel.detail}</p>}
      {connected && panel.classifiers.some((c) => c.error !== null || c.status < 200 || c.status >= 300) && (
        <p className="note gap">
          One of the two readings did not succeed, so this total is incomplete and the real figure is higher:{" "}
          {panel.classifiers
            .filter((c) => c.error !== null || c.status < 200 || c.status >= 300)
            .map((c) => `${c.classifier} answered ${c.status}${c.error === null ? "" : ` (${c.error})`}`)
            .join("; ")}
          .
        </p>
      )}

      {!connected ? (
        <>
          <NeedsYouLine needs={{ needed: true, action: "connect the usage reading" }} />
          {panel.needsOwner.map((says) => (
            <p key={says} className="note gap">
              {says} <QueueButton where="Map provider · usage reading" says={says} compact />
            </p>
          ))}
        </>
      ) : (
        <>
          <div className="rq-summary mt-tiles">
            <div className="rq-tile">
              {/*
                NOT `panel.used ?? 0`. This file's own header says a zero must
                never be drawn on a quota panel, and a numeric default is exactly
                how one gets drawn: it is unreachable today only because the
                enclosing branch checks `connected`, which is a sibling guard,
                not a property of the type. A null renders as its named gap.
              */}
              <div className="rq-figure">{panel.used === null ? "not measured" : n(panel.used)}</div>
              <div className="rq-caption">
                requests this billing period
                {panel.since && panel.until ? ` (${panel.since} to ${panel.until})` : ""}
              </div>
            </div>
            <div className="rq-tile">
              <div className="rq-figure">
                {panel.allowance === null ? "not confirmed" : n(panel.allowance)}
              </div>
              <div className="rq-caption">
                allowance{panel.allowanceIsAssumed ? " — assumed, not confirmed" : ""}
              </div>
            </div>
            <div className="rq-tile">
              <div className="rq-figure">{pct === null ? "—" : `${pct}%`}</div>
              <div className="rq-caption">of the allowance used</div>
            </div>
            <div className="rq-tile">
              <div className="rq-figure">
                {panel.burn === null ? "—" : n(Math.round(panel.burn.perDay))}
              </div>
              <div className="rq-caption">
                {panel.burn === null
                  ? "no measured days to average"
                  : `a day, averaged over ${panel.burn.windowDays} day(s)`}
              </div>
            </div>
            <div className="rq-tile">
              <div className="rq-figure">{panel.burn?.exhaustionDate ?? "—"}</div>
              <div className="rq-caption">
                {panel.burn?.exhaustionDate
                  ? "runs out on this date at the current rate"
                  : "no exhaustion date at the current rate"}
              </div>
            </div>
          </div>

          <h3>Which key spent it</h3>
          <table className="mt-keys">
            <thead>
              <tr>
                <th scope="col">Key</th>
                <th scope="col" className="n">
                  Requests
                </th>
                <th scope="col">What that means</th>
              </tr>
            </thead>
            <tbody>
              {panel.byKey.map((row) => (
                <tr key={row.label} className={row.expectedZero && row.requests > 0 ? "mt-unexpected" : undefined}>
                  <th scope="row">
                    {row.label}
                    {row.expectedZero && (
                      <span className="mt-flag"> not declared by this project</span>
                    )}
                  </th>
                  <td className="n">{n(row.requests)}</td>
                  <td className="note">{row.says}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>Which service spent it</h3>
          {panel.byService.length === 0 ? (
            <p className="note gap">
              MapTiler returned no breakdown by service for this period, so Tiles and Rendered maps
              cannot be told apart in this reading.
            </p>
          ) : (
            <table className="mt-services">
              <thead>
                <tr>
                  <th scope="col">Service</th>
                  <th scope="col" className="n">
                    Requests
                  </th>
                </tr>
              </thead>
              <tbody>
                {panel.byService.map((row) => (
                  <tr key={row.service}>
                    <th scope="row">{row.service}</th>
                    <td className="n">{n(row.requests)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {panel.actors && (
            <>
              <h3>Our own robots, for comparison</h3>
              <p className="note">{panel.actors.says}</p>
              {panel.actors.defects.map((defect) => (
                <p key={defect} className="note gap">
                  {defect}
                </p>
              ))}
            </>
          )}

          {/* 3 — does this need you. It SUMMARISES: the items are listed once,
              below, and repeating the first of them here reads as two
              different asks that happen to say the same thing. */}
          <NeedsYouLine
            needs={
              panel.needsOwner.length === 0
                ? { needed: false }
                : {
                    needed: true,
                    action:
                      panel.needsOwner.length === 1
                        ? "the one thing listed below"
                        : `the ${panel.needsOwner.length} things listed below`,
                  }
            }
          />
          {panel.needsOwner.map((says) => (
            <p key={says} className="mt-next">
              {says} <QueueButton where="Map provider" says={says} compact />
            </p>
          ))}
        </>
      )}

      {/* 4 — what happens next */}
      <p className="mt-blocked">
        <strong>Is our own automation blocked from spending this?</strong>{" "}
        {panel.automationBlocked ? "Yes." : "No — and it should be."} {panel.automationSays}
      </p>

      <details className="status-detail">
        <summary>Technical details</summary>
        {/*
          **THIS BLOCK USED TO SAY A READING HAD BEEN TAKEN WHEN NONE HAD.**
          (Found at integration, 2026-09-07.)

          It read "Reading taken <timestamp>" unconditionally — and in the NOT
          CONNECTED state `collectedAt` is the moment the PAGE rendered, not the
          moment anybody asked the provider anything. So the one panel written
          to keep "we have not asked" apart from "the answer was zero" was
          quietly asserting a reading in exactly the state where none exists.
          The two states now say two different things.
        */}
        {connected ? (
          <p className="note">
            Reading taken <When iso={panel.collectedAt} />, against MapTiler&rsquo;s analytics API,
            classified by <code>api_keys</code> and by <code>services</code>. Refreshed by{" "}
            <code>pnpm maptiler:usage</code>. The service credential is server-side only and appears
            nowhere on this page.
          </p>
        ) : (
          <p className="note">
            No reading has been taken, so there is no timestamp to show. The usage read needs a
            server-side credential named <code>{MAPTILER_SERVICE_TOKEN_VAR}</code>, created on the
            MapTiler account&rsquo;s Credentials page and installed on the runner. Once it is,{" "}
            <code>pnpm maptiler:usage</code> fills this panel in. <code>docs/maptiler-keys.md</code>{" "}
            carries the full owner action.
          </p>
        )}
        {panel.estimatedIncluded > 0 && (
          <p className="note">
            MapTiler additionally projects {n(panel.estimatedIncluded)} request(s) for the rest of
            the period. That projection is reported here and is not summed into the measured total.
          </p>
        )}
      </details>
    </section>
  );
}
