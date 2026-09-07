/**
 * **SOURCES AND OUTSIDE INTERFACES — the capability registry.** (ADM-C11, and
 * §6 and §7 of the Admin C brief, 2026-09-06.)
 *
 * Reachable only on the admin host with a valid session, both enforced upstream
 * in `middleware.ts` before this component is invoked.
 *
 * The owner's four questions, answered in that order for every route:
 * *what am I looking at, does this need me, what happened, what happens next.*
 *
 * ## THIS PAGE MAKES NO SOURCE CALLS
 *
 * *"Do not burn API calls merely because a key exists."* Nothing here fetches
 * anything. Three inputs, all cheap:
 *
 * ```
 *   the registers      TypeScript constants, read at build time — the adapters,
 *                      the wiring, the cadence table, the tenancy sweep
 *   the run record     docs/refresh-run.json, imported statically so it travels
 *                      in the bundle; the record carries its OWN run date, so a
 *                      stale copy shows as an old date rather than as a fresh one
 *   the environment    presence only, and never a value or a name
 * ```
 *
 * The static import is deliberate rather than lazy. A runtime `readFileSync`
 * from an admin page is the failure this codebase has been bitten by before: an
 * untraced read returns nothing, the catch returns null, and the page renders
 * its own gap wording — which is indistinguishable from honest missing data. A
 * static import cannot fail that way, and the run date it carries is the whole
 * of its own freshness claim.
 *
 * ## WHAT THE ENVIRONMENT READING IS AND IS NOT
 *
 * `process.env` is read once, through `readCredentialPresence`, which returns
 * booleans keyed by ROUTE and never by variable name. A key absent from this
 * process is only evidence about routes whose key belongs in the website's own
 * settings; for the nightly job's secrets and the workstation's private file,
 * the registry returns a named gap saying this page cannot see that store. No
 * value and no variable name reaches the browser.
 */
import DEBT_FILE from "@/data/ops/refresh-debt.json" with { type: "json" };
import { US_STATES } from "@/lib/control-plane/readiness/catalog.ts";
import { ConsoleNav } from "../../console-nav.tsx";
import RUN_FILE from "@/docs/refresh-run.json" with { type: "json" };

import { formatCalendarDate } from "@/lib/control-plane/eastern-time.ts";
import {
  auditRenderedNumbers,
  checkStatedEqualsRendered,
  type HealthLevel,
} from "@/lib/control-plane/owner-surface.ts";
import {
  DISPOSITIONS,
  DISPOSITION_MEANS,
  DISPOSITION_TONE,
  HEALTH_WORDS,
  HOLDER_SAYS,
  buildSourceRegistry,
  readCredentialPresence,
  sourceRegistryCountClaims,
  sourceRegistryRenderedNumbers,
  type SourceRow,
} from "@/lib/control-plane/source-registry.ts";
import { utcDay } from "@/lib/ops/refresh-cadence.ts";
import type { RefreshDebt, RefreshRun } from "@/lib/ops/refresh-report.ts";

import { Band, GapNote, QueueButton, QueueForm, When, gapLabel } from "../../console-ui.tsx";
import { Bar, Code, DefinedTile, NeedsYouLine, Plain, StatusBlock, type NeedsYou } from "../../status-ui.tsx";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Where a queued gap says it came from, and where the queue form returns to. */
const HERE = "/admin/sources";

/**
 * The run record and the debt file as the orchestrator writes them.
 *
 * Both are checked rather than asserted: a format version this page does not
 * understand becomes null, and null renders as the named gap the registry
 * builds for it. Reading a record of an unknown shape and printing whatever
 * fell out of it is how a page states a confident wrong date.
 */
const LAST_RUN: RefreshRun | null =
  RUN_FILE.formatVersion === 1 ? (RUN_FILE as unknown as RefreshRun) : null;

const OPEN_DEBT: readonly RefreshDebt[] =
  DEBT_FILE.formatVersion === 1 ? (DEBT_FILE.debts as unknown as RefreshDebt[]) : [];

const RUN_PROVENANCE =
  "The nightly refresh writes its own run record beside the data it committed, and this page carries the copy that was in the code the site was built from.";

const READ_IN = "this website's own server settings";

/** The four grades in the words that fit a source, for the legend. */
const GRADE_MEANS: readonly (readonly [HealthLevel, string])[] = [
  ["GREEN", "A run read this route and recorded what came back."],
  ["AMBER", "Nothing is watching this route. What is committed may still be right; nothing would notice if it stopped being."],
  ["RED", "A run tried and could not read it, or it is carrying debt from a run that failed."],
  ["UNKNOWN", "Nothing calls this route, so nothing measures it. That is a standing decision rather than a failure."],
];

/* ------------------------------------------------------------------ *
 * SMALL RENDER PIECES
 * ------------------------------------------------------------------ */

/** A grade, in the word that fits a source rather than the constant. */
function Grade({ level }: { level: HealthLevel }) {
  return <Band level={level}>{HEALTH_WORDS[level]}</Band>;
}

/** A calendar day the owner reads, with the machine form on the element. */
function Day({ ymd }: { ymd: string }) {
  return (
    <time className="when" dateTime={ymd} title={ymd}>
      {formatCalendarDate(ymd)}
    </time>
  );
}

/** Whether a route needs the owner, in the shape every card on this console uses. */
function needsOf(row: SourceRow): NeedsYou {
  return row.ownerAction === null ? { needed: false } : { needed: true, action: row.ownerAction };
}

/** The credential cell: required or not, and what a reading of it established. */
function KeyCell({ row }: { row: SourceRow }) {
  if (!row.credential.required) {
    return <span className="src-key src-key-none">No key needed</span>;
  }
  if (!row.credentialReading.held) {
    return (
      <span className="src-key src-key-unknown">
        <GapNote gap={row.credentialReading.gap} where={`Sources · ${row.source} · key`} returnTo={HERE} />
      </span>
    );
  }
  const configured = row.credentialReading.value.configured;
  return (
    <span className={configured ? "src-key src-key-yes" : "src-key src-key-no"}>
      {configured ? "Key needed, and it is set here" : "Key needed, and it is not set here"}
      <span className="src-note"> Read in {row.credentialReading.value.readIn}.</span>
    </span>
  );
}

/** One row of the registry table. */
function Row({ row }: { row: SourceRow }) {
  const needs = needsOf(row);
  return (
    <tr className={`src-row src-${DISPOSITION_TONE[row.disposition]}`}>
      <th scope="row" className="src-name">
        <span className="src-source">{row.source}</span>
        <span className="src-provider">{row.provider}</span>
        <details className="src-detail">
          <summary>What this is, what it costs, what proves it</summary>
          <dl>
            <dt>What it can tell a reader</dt>
            <dd>{row.capability}</dd>
            <dt>What the product does with it today</dt>
            <dd>{row.productUsage}</dd>
            <dt>Adapter</dt>
            <dd>
              {row.adapter.says}
              {row.adapter.at !== null && <span className="src-note"> Module: {row.adapter.at}.</span>}
            </dd>
            <dt>Rate limit or spend</dt>
            <dd>{row.spendConcern}</dd>
            <dt>Where the key would live</dt>
            <dd>{HOLDER_SAYS[row.credential.holder]}</dd>
            <dt>Why it has this standing</dt>
            <dd>{row.dispositionWhy}</dd>
            <dt>Why it is graded this way</dt>
            <dd>{row.healthWhy === "" ? "No grade has been recorded." : <Plain text={row.healthWhy} />}</dd>
            <dt>Evidence</dt>
            <dd>
              <ul className="src-evidence">
                {row.evidence.map((e) => (
                  <li key={e.at}>
                    {e.what} — <code>{e.at}</code>
                  </li>
                ))}
              </ul>
            </dd>
          </dl>
        </details>
      </th>

      <td className="src-standing">
        <Code raw={row.disposition} />
        <span className="src-note">{DISPOSITION_MEANS[row.disposition]}</span>
      </td>

      <td>
        <KeyCell row={row} />
      </td>

      <td className="src-adapter">
        {row.adapter.active ? "Yes" : "No"}
        {row.adapter.at !== null && <span className="src-note" title={row.adapter.at}> reads it</span>}
      </td>

      <td className="src-refresh">
        {row.refresh.says}
        {row.refresh.legacyWorkflow !== null && (
          <span className="src-note">
            A button named {row.refresh.legacyWorkflow} still exists and runs on no clock.
          </span>
        )}
      </td>

      <td className="src-last">
        {row.lastSuccess.held ? (
          <When iso={row.lastSuccess.value} />
        ) : (
          <span className="src-gap" title={row.lastSuccess.gap.says}>
            {gapLabel(row.lastSuccess.gap)}
          </span>
        )}
      </td>

      <td className="src-next">
        {row.nextDue.held ? (
          <Day ymd={row.nextDue.value} />
        ) : (
          <span className="src-gap" title={row.nextDue.gap.says}>
            nothing is owed
          </span>
        )}
      </td>

      <td className="src-health">
        <Grade level={row.health} />
      </td>

      <td className="src-coverage">
        {row.coverage.held ? (
          <Bar
            value={row.coverage.value.value}
            of={row.coverage.value.denominator}
            tone={row.coverage.value.value > 0 ? "info" : "none"}
            label={`${row.coverage.value.value} of ${row.coverage.value.denominator}`}
            title={`${row.coverage.value.contract} — denominator from ${row.coverage.value.denominatorSource}`}
          />
        ) : (
          <span className="src-gap" title={row.coverage.gap.says}>
            {gapLabel(row.coverage.gap)}
          </span>
        )}
      </td>

      <td className="src-needs">
        <NeedsYouLine needs={needs} />
        {row.blocker !== null && (
          <p className="src-blocker">
            <span className="src-blocker-whose">
              {row.blocker.whose === "THEIRS" ? "On the source's side" : null}
              {row.blocker.whose === "OURS" ? "Engineering owed" : null}
              {row.blocker.whose === "UNKNOWABLE_NOW" ? "Cannot tell yet" : null}
            </span>{" "}
            {row.blocker.what}
            <QueueButton where={`Sources · ${row.source}`} says={row.blocker.what} returnTo={HERE} compact />
          </p>
        )}
      </td>
    </tr>
  );
}

/* ------------------------------------------------------------------ *
 * THE PAGE
 * ------------------------------------------------------------------ */

export default async function SourcesPage() {
  const now = new Date();
  const view = buildSourceRegistry({
    today: utcDay(now),
    nowIso: now.toISOString(),
    credentialPresence: readCredentialPresence(process.env),
    credentialReadIn: READ_IN,
    lastRun: LAST_RUN,
    lastRunProvenance: RUN_PROVENANCE,
    openDebt: OPEN_DEBT,
  });

  /*
   * The page checks its own numbers before it shows any of them, the way the
   * readiness panel does. A wrong number on an operator's page is worse than no
   * number, because he acts on it.
   */
  const audit = auditRenderedNumbers(sourceRegistryRenderedNumbers(view));
  const claims = checkStatedEqualsRendered(sourceRegistryCountClaims(view));

  if (!audit.ok || !claims.ok) {
    return (
      <main className="admin console-page sources-page">
      <ConsoleNav view="sources" currentState={null} states={US_STATES} />
        <QueueForm returnTo={HERE} />
        <h1>Sources and outside interfaces</h1>
        <p className="refusal">
          <strong>These numbers did not check out against themselves, so none of them is shown.</strong>{" "}
          {audit.ok ? claims.detail : audit.detail}
        </p>
        <p className="note">
          Nothing below is missing and nothing below is zero. The page refused to print a figure it could
          not stand behind.
        </p>
      </main>
    );
  }

  const needsYouCount = view.needsYou.length;

  return (
    <main className="admin console-page sources-page">
      <ConsoleNav view="sources" currentState={null} states={US_STATES} />
      <QueueForm returnTo={HERE} />

      <h1>Sources and outside interfaces</h1>
      <p className="plain">
        Every source and outside interface this product can name, one line per route: whether it needs a
        key, whether the key is set, whether anything reads it, when it last answered and when it is next
        owed. Nothing on this page calls a source — a key is never spent to draw a screen.
      </p>
      <p className="note">
        Read <When iso={view.asOf} />. <Plain text={view.refreshProvenance} />
      </p>

      {/* ---------------------------------------------------------- SUMMARY */}
      <section className="src-summary" aria-label="The registry in five numbers">
        <DefinedTile
          figure={`${view.inUse.value} of ${view.inUse.denominator}`}
          label="Routes something reads"
          means="A route is in use when the product actually reads it today, with or without a key. The rest are held, waiting on somebody, or waiting on engineering."
          needsYou={{ needed: false }}
        />
        <DefinedTile
          figure={`${view.credentialsHeldAndUnspent.value} of ${view.credentialsHeldAndUnspent.denominator}`}
          label="Keys held and not spent"
          means="Keys that work and that nothing calls, on purpose. Each one has a reason on its row, and a held key costs nothing until it is used."
          needsYou={{ needed: false }}
        />
        <DefinedTile
          figure={`${view.namedOnly.value} of ${view.namedOnly.denominator}`}
          label="Named to me, absent here"
          means="Sources named in the handoff inventory that appear nowhere in this repository. Each one is waiting on a decision about what question it should answer."
          needsYou={
            view.namedOnly.value > 0
              ? { needed: true, action: "say what each should answer, or rule it out" }
              : { needed: false }
          }
        />
        <DefinedTile
          figure={`${view.onNightlyRefresh.value} of ${view.onNightlyRefresh.denominator}`}
          label="On the one scheduled run"
          means="Routes that ride the single daily refresh. Everything else is read by hand, is a committed file, or is not read at all."
          needsYou={{ needed: false }}
        />
        <DefinedTile
          figure={`${view.meetingCoverage.value} of ${view.meetingCoverage.denominator}`}
          label="Meeting routes readable"
          means="Wired meeting routes an adapter can actually read. A route with no adapter means a government that publishes its agendas and cannot be shown."
          needsYou={{ needed: false }}
        />
      </section>

      {/* -------------------------------------------------------- NEEDS YOU */}
      <h2>Does this need you?</h2>
      {needsYouCount === 0 ? (
        <StatusBlock
          what="Nothing on this page is waiting on a decision from you."
          happened="Every route either has a standing somebody already decided, or is running."
          next="The nightly refresh reads what is due tonight."
          needsYou={{ needed: false }}
        />
      ) : (
        <StatusBlock
          what={`${needsYouCount} route${needsYouCount === 1 ? "" : "s"} on this page waiting on a decision from you.`}
          happened="Each one is named in the handoff inventory or held with no schedule, and nobody can pick a reader question for it but you."
          next="Say what each should answer, or rule it out. Either answer closes the row."
          needsYou={{ needed: true, action: "answer the questions below" }}
          detail={
            <p>
              Every one of these is a decision only you can make, so no run and no worker will close them.
              Adding one to the queue records the decision to work it; it does not answer it.
            </p>
          }
          detailLabel="Why nothing else can close these"
        >
          <ul className="src-needs-list">
            {view.needsYou.map((row) => (
              <li key={row.id}>
                <strong>{row.source}</strong> — {row.ownerAction}
                <QueueButton
                  where={`Sources · ${row.source}`}
                  says={row.dispositionWhy}
                  returnTo={HERE}
                  compact
                />
              </li>
            ))}
          </ul>
        </StatusBlock>
      )}

      {/* -------------------------------------------------------- SCHEDULER */}
      <h2>How refreshing actually works right now</h2>
      <StatusBlock
        what={`One scheduled run reads every source that is due: ${view.scheduler.theOneRun}.`}
        happened={view.scheduler.whenItRuns}
        next={`${view.onNightlyRefresh.value} of the ${view.onNightlyRefresh.denominator} routes below ride it. Everything else is read by hand or is a committed file.`}
        needsYou={{ needed: false }}
        detail={
          <>
            <p>{view.scheduler.authority}</p>
            <p>{view.scheduler.migration}</p>
          </>
        }
        detailLabel="Which clock is in charge, and where it is going"
      >
        <p className="note">
          The {view.scheduler.legacy.length} per-source jobs below still exist as buttons somebody can
          press. <strong>None of them runs on a clock any more</strong>, and this page will not show them
          as though it did.
        </p>
        <ul className="src-legacy">
          {view.scheduler.legacy.map((w) => (
            <li key={w.file}>
              <strong>{w.name}</strong> — press-only, no schedule. <code>{w.file}</code>
            </li>
          ))}
        </ul>
      </StatusBlock>

      {/* ----------------------------------------------------- DISAGREEMENTS */}
      <h2>Where two registers disagree</h2>
      {view.disagreements.length === 0 ? (
        <p className="plain">
          The adapter table, the wiring table and the platform sweep agree with each other today. This is
          checked every time the page draws, not written down once.
        </p>
      ) : (
        <>
          <p className="plain">
            This product keeps several lists of what it can read, each built to answer a different
            question. Where two of them say different things, the difference is shown here rather than
            settled quietly in favour of whichever was read last.
          </p>
          <ul className="src-disagreements">
            {view.disagreements.map((d) => (
              <li key={d.about}>
                <strong>{d.about}</strong> — {d.says}
                <QueueButton where={d.where} says={d.says} returnTo={HERE} compact />
              </li>
            ))}
          </ul>
        </>
      )}

      {/* ---------------------------------------------------------- LEGEND */}
      <h2>What the words mean</h2>
      <dl className="src-legend">
        {DISPOSITIONS.map((d) => (
          <div key={d} className={`src-legend-item src-${DISPOSITION_TONE[d]}`}>
            <dt>
              <Code raw={d} />
            </dt>
            <dd>{DISPOSITION_MEANS[d]}</dd>
          </div>
        ))}
      </dl>
      {/*
        The console's shared HealthScale is not used here on purpose: its
        sentences are about the three pilot contracts ("all three contracts are
        met"), and none of them is true of a source. Same four grades, the words
        that fit a route.
      */}
      <dl className="src-legend src-grades">
        {GRADE_MEANS.map(([level, means]) => (
          <div key={level} className="src-legend-item">
            <dt>
              <Grade level={level} />
            </dt>
            <dd>{means}</dd>
          </div>
        ))}
      </dl>

      {/* --------------------------------------------------------- THE ROWS */}
      {view.families.map((group) => (
        <section key={group.family} className="src-family" aria-label={group.family}>
          <h2>
            {group.family} <span className="src-count">{group.rows.length}</span>
          </h2>
          <div className="src-table-scroll">
            <table className="src-table">
              <thead>
                <tr>
                  <th scope="col">Source</th>
                  <th scope="col">Standing</th>
                  <th scope="col">Key</th>
                  <th scope="col">Adapter</th>
                  <th scope="col">Refresh</th>
                  <th scope="col">Last read</th>
                  <th scope="col">Next due</th>
                  <th scope="col">Health</th>
                  <th scope="col">Coverage</th>
                  <th scope="col">Needs you</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map((row) => (
                  <Row key={row.id} row={row} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      {/* ------------------------------------------------- STATED LIMITS */}
      <h2>What this page deliberately does not say</h2>
      <p className="plain">
        Three of the gaps above are the same gap on every row, so each is argued once here and carries
        one button rather than forty-five. Queueing one class of gap forty-five times would open
        forty-five items for one fix, which is a worse answer than one. A gap that really is particular
        to a route — what a reading of its key established, what is blocking it — carries its own button
        on its own row.
      </p>
      <ul className="src-limits">
        <li>
          <strong>Coverage by source is not measured anywhere.</strong> Every meeting platform carries a
          real count, because the wiring table can be counted. No other route has a published coverage
          figure, so those cells say so instead of showing a zero. Coverage by capability and by state
          lives on the readiness panel.
          <QueueButton
            where="Sources · coverage"
            says="No per-source coverage figure is published anywhere the console can read."
            returnTo={HERE}
            compact
          />
        </li>
        <li>
          <strong>There is no history of earlier reads.</strong> The nightly refresh publishes its last
          run and nothing else, so a route that was not due on that run has no last-read date here rather
          than a softer one.
          <QueueButton
            where="Sources · last read"
            says="Only the last refresh run is published, so no route has a history of earlier successful reads."
            returnTo={HERE}
            compact
          />
        </li>
        <li>
          <strong>A route nothing schedules is owed on no date.</strong> Its next-due cell says so rather
          than showing the day it would be due if anything were watching it. Putting a source on the
          nightly run is a decision about cost, so it is one you make rather than one a page assumes.
          <QueueButton
            where="Sources · next due"
            says="Routes off the nightly run are owed on no date, because nothing schedules them."
            returnTo={HERE}
            compact
          />
        </li>
        <li>
          <strong>Database connection strings and the admin secrets are not on this page.</strong> They
          are infrastructure rather than sources: they answer no reader&rsquo;s question, and counting
          them would inflate the denominator of a registry about civic records.
        </li>
        <li>
          <strong>No key value and no variable name appears anywhere on this page</strong>, in the table,
          in a hover or in a disclosure. A key is reported as needed or not needed, and as set or not set,
          and nothing further.
        </li>
      </ul>
    </main>
  );
}
