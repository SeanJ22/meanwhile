/**
 * **READER INTELLIGENCE — WHAT AND WHERE, NEVER WHO.** (Admin Pass C, ADM-C12,
 * from the 9.6.26 owner feedback.)
 *
 * The one admin surface that reads the APPLICATION database. Every other page
 * under `app/(admin)/` reads the control plane, and §3.11 is explicit that the
 * two are never collapsed for convenience: operational state lives in the
 * control plane, what a reader did lives in the collection stores, and this
 * page opens the second by the application's own variable. The reading is in
 * `lib/control-plane/reader-intel.ts`, the cards are in `panels.tsx`, and this
 * file is the shell: it resolves the scope, opens the store, audits the numbers
 * and composes.
 *
 * ## The two things this page must never let him misread
 *
 * 1. **Whose traffic.** Roughly 537 rows on production were written by this
 *    project's own walks, and every walk adds more. The view is ORGANIC by
 *    default; the other three classes are selectable and, when one is selected,
 *    the page says on its face that nothing on the screen is a demand figure.
 * 2. **There are no users here.** Every figure is a count of EVENTS with its
 *    exact denominator. "43% of users" is not being withheld — the concept does
 *    not exist in the schema, and the page says so in as many words.
 *
 * ## Three audits, run against what is about to be drawn
 *
 * Every number carries a denominator and an interpretation contract; no
 * numerator exceeds its denominator; every stated count equals the rows
 * actually rendered. A failure replaces the numbers with a refusal — not the
 * page, and never a quietly wrong figure.
 *
 * The scope is chosen through two selects and a submit: a closed set of four
 * classes and three windows, resolved server-side, with anything unrecognised
 * falling back to the reader default. There is no free-text query anywhere on
 * this surface and no path by which one could be typed.
 */
import {
  auditRenderedNumbers,
  checkStatedEqualsRendered,
} from "@/lib/control-plane/owner-surface.ts";
import { US_STATES } from "@/lib/control-plane/readiness/catalog.ts";
import { ConsoleNav } from "../../console-nav.tsx";
import {
  DEFAULT_READER_RUN_CLASS,
  READER_RUN_CLASSES,
  READER_WINDOW_CHOICES,
  countClaimsOf,
  impossibleNumbersIn,
  openReaderStore,
  readReaderIntel,
  readerRunClassFromParam,
  readerWindow,
  readerWindowDaysFromParam,
  readerWord,
  renderedNumbersOf,
  windowSentence,
  type ReaderIntel,
} from "@/lib/control-plane/reader-intel.ts";

import { QueueForm, When } from "../../console-ui.tsx";
import { StatusBlock } from "../../status-ui.tsx";
import {
  ActivityPanel,
  AskStorePanel,
  BoundaryPanel,
  DemandPanel,
  HERE,
  QuestionsPanel,
  ReactionPanel,
  TrafficCensusPanel,
  UnreadPanel,
  WantedSoonerPanel,
  Word,
} from "./panels.tsx";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** The window with nothing in it, for the header while a store is unreachable. */
const NO_CENSUS = { organic: 0, synthetic: 0, unknown: 0, author: 0, total: 0 };

export default async function ReaderIntelligencePage({
  searchParams,
}: {
  searchParams: Promise<{ class?: string | string[]; days?: string | string[] }>;
}) {
  const params = await searchParams;
  const runClass = readerRunClassFromParam(params.class);
  const days = readerWindowDaysFromParam(params.days);
  const window = readerWindow(new Date().toISOString(), days);
  const classWords = readerWord(runClass).label;

  const store = openReaderStore();
  if (!store.ok) {
    return (
      <main className="admin console-page">
      <ConsoleNav view="reader" currentState={null} states={US_STATES} />
        <QueueForm returnTo={HERE} />
        <p className="note">
          <a href="/admin">← Pilot health</a>
        </p>
        <h1>Reader intelligence</h1>
        <div className="refusal">
          <StatusBlock
            what={<strong>Nothing has been counted, because the store was never opened.</strong>}
            happened={store.detail}
            next={
              <>
                Bind the application database on the host that serves this page, then reload. Until then
                this page states nothing about readers in either direction.
              </>
            }
            needsYou={{
              needed: true,
              action: "bind the application database on this host, then reload this page",
            }}
          />
        </div>
      </main>
    );
  }

  const intel: ReaderIntel = await readReaderIntel(store.sql, window, runClass);
  const numbers = renderedNumbersOf(intel);
  const audit = auditRenderedNumbers(numbers);
  const impossible = impossibleNumbersIn(numbers);
  const claims = checkStatedEqualsRendered(countClaimsOf(intel));
  const numbersStand = audit.ok && impossible.length === 0 && claims.ok;

  const census = intel.activity.kind === "HELD" ? intel.activity.value.census : NO_CENSUS;
  const reconciles = intel.activity.kind === "HELD" ? intel.activity.value.reconciles : true;

  return (
    <main className="admin console-page">
      <ConsoleNav view="reader" currentState={null} states={US_STATES} />
      <QueueForm returnTo={HERE} />
      <p className="note">
        <a href="/admin">← Pilot health</a> — this page reads the application database, where what readers
        did is recorded. It never reads the control plane, and the control-plane pages never read this.
      </p>
      <h1>Reader intelligence</h1>
      <p className="plain">
        What people looked up, opened, asked and answered — <strong>what and where, never who</strong>.
        There is no person, session or device recorded anywhere in these stores, so every number below is a
        count of events with the exact denominator it came out of. A percentage of users is not being
        withheld here: the concept does not exist in the data.
      </p>

      <form className="controls-row" method="get" action={HERE}>
        <label>
          Whose traffic
          <select name="class" defaultValue={runClass}>
            {READER_RUN_CLASSES.map((c) => (
              <option key={c} value={c}>
                {readerWord(c).label}
              </option>
            ))}
          </select>
        </label>
        <label>
          How far back
          <select name="days" defaultValue={String(days)}>
            {READER_WINDOW_CHOICES.map((d) => (
              <option key={d} value={d}>
                The last {d} days
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="primary">
          Show this
        </button>
      </form>

      <p className="plain">
        Showing <span className="state-green">{classWords}</span> from <When iso={window.fromIso} /> to{" "}
        <When iso={window.toIso} />. {windowSentence(window)}
      </p>
      {runClass !== DEFAULT_READER_RUN_CLASS && (
        <p className="plain state-amber">
          This is not a reader view. You have selected <Word raw={runClass} />, so nothing on this screen is
          a figure about demand. Switch back to{" "}
          <strong>{readerWord(DEFAULT_READER_RUN_CLASS).label}</strong> for that.
        </p>
      )}

      {!numbersStand && (
        <div className="refusal">
          <StatusBlock
            what={
              <strong>The numbers on this page did not pass their own check, so they are not shown.</strong>
            }
            happened={
              <>
                {audit.ok ? "" : `${audit.detail} `}
                {impossible.length === 0
                  ? ""
                  : `A count came out larger than what it was counted from: ${impossible.join("; ")}. `}
                {claims.ok ? "" : `${claims.detail} `}A figure with no denominator, or a headline over a
                list that does not match it, is worse than no figure at all.
              </>
            }
            next={
              <>The reading itself is intact. Reload; if it repeats, the projection is wrong and needs fixing.</>
            }
            needsYou={{ needed: true, action: "tell someone the reader page is refusing its own numbers" }}
          />
        </div>
      )}

      {numbersStand && (
        <>
          <h2>Whose traffic this is</h2>
          <TrafficCensusPanel census={census} reconciles={reconciles} runClass={runClass} />

          <h2>What people did</h2>
          {intel.activity.kind === "HELD" ? (
            <ActivityPanel a={intel.activity.value} runClass={runClass} days={days} />
          ) : (
            <UnreadPanel
              what={<strong>What people did.</strong>}
              detail={intel.activity.detail}
              reached={intel.activity.kind === "NOT_RECORDED"}
              whenEmpty={<>The next event lands when somebody next uses the site.</>}
              whenUnreachable="the application database did not answer — check that it is reachable from this host"
            />
          )}

          {intel.activity.kind === "HELD" && (
            <>
              <h2>Where the demand is</h2>
              <DemandPanel a={intel.activity.value} runClass={runClass} days={days} />
              <h2>What people asked</h2>
              <QuestionsPanel a={intel.activity.value} runClass={runClass} days={days} />
            </>
          )}

          <h2>What people said</h2>
          {intel.reactions.kind === "HELD" ? (
            <ReactionPanel r={intel.reactions.value} runClass={runClass} days={days} />
          ) : (
            <UnreadPanel
              what={<strong>What people said.</strong>}
              detail={intel.reactions.detail}
              reached={intel.reactions.kind === "NOT_RECORDED"}
              whenEmpty={<>The next answer lands when somebody next reacts on a card.</>}
              whenUnreachable="the reaction store did not answer — check that it is reachable from this host"
            />
          )}

          <h2>What people want sooner</h2>
          {intel.demand.kind === "HELD" ? (
            <WantedSoonerPanel d={intel.demand.value} runClass={runClass} />
          ) : (
            <UnreadPanel
              what={<strong>The &ldquo;get this sooner&rdquo; button.</strong>}
              detail={intel.demand.detail}
              reached={intel.demand.kind === "NOT_RECORDED"}
              whenEmpty={<>The next request lands when somebody next presses it.</>}
              whenUnreachable="the demand-signal store did not answer — check that it is reachable from this host"
            />
          )}

          <h2>The ask store</h2>
          {intel.ask.kind === "HELD" ? (
            <AskStorePanel ask={intel.ask.value} />
          ) : (
            <UnreadPanel
              what={<strong>The ask store.</strong>}
              detail={intel.ask.detail}
              reached={intel.ask.kind === "NOT_RECORDED"}
              whenEmpty={<>Nothing has been written to it in this window.</>}
              whenUnreachable="the ask store did not answer — check that it is reachable from this host"
            />
          )}

          <h2>What this page will not do</h2>
          <BoundaryPanel />
          <p className="note">
            Every number above passed its checks before it was drawn: {audit.detail}; {claims.detail}.
          </p>
        </>
      )}
    </main>
  );
}
