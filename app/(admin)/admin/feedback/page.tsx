/**
 * **FEEDBACK INBOX — what readers wrote, and what you did about it.**
 * (ADM-C13, from the 9.6.26 owner feedback.)
 *
 * Reachable only on the admin host with a valid session, both enforced upstream
 * in `middleware.ts`. The page answers the owner's four questions in order:
 * what am I looking at, does this need me, what happened, what happens next.
 *
 * ## This is the first admin page that reads the application database
 *
 * Every other console surface reads the control plane. This one has to read the
 * app's own store, because the messages are there and nowhere else — §3.11 says
 * production Admin uses the application's real database connections, and the
 * two databases stay two databases. So the page opens BOTH: the message store
 * for the words, and the control plane for what the owner has recorded about
 * them. Neither knows about the other; they are joined here, in memory, on the
 * message's own row id.
 *
 * ## What it deliberately never learns
 *
 * A feedback row may carry a minted handle pointing at a reply address in a
 * separate store. This page reads a BOOLEAN — someone asked to hear back — and
 * never the handle, because `lib/control-plane/feedback-inbox.ts` computes the
 * boolean inside the database. There is no join, no second query, and no
 * variable in this process that holds a contact value. §5.3.
 *
 * The staging manifest cookie is not read, not rendered and not referenced
 * anywhere on this page (§12). Nothing is stored in the browser: every control
 * is a plain form POST to the console's existing decision route.
 *
 * All CSS lives in the admin layout; this file writes none.
 */

import { openControlPlane, readDecisions } from "@/lib/control-plane/admin-data.ts";
import { US_STATES } from "@/lib/control-plane/readiness/catalog.ts";
import { ConsoleNav } from "../../console-nav.tsx";
import {
  ENVIRONMENT_WORDS,
  FEEDBACK_ENVIRONMENTS,
  TRIAGE_OPTIONS,
  TRIAGE_STATES,
  TRIAGE_CONSEQUENCE,
  TRIAGE_WORDS,
  buildFeedbackInboxView,
  countClaimsOf,
  openFeedbackStore,
  readFeedbackStore,
  renderedNumbersOf,
  type EnvironmentView,
  type FeedbackEnvironment,
  type InboxItem,
  type TriageState,
} from "@/lib/control-plane/feedback-inbox.ts";
import {
  OWNER_ANSWER_MAX_CHARS,
  auditRenderedNumbers,
  checkStatedEqualsRendered,
  type OwnerDecisionIntent,
} from "@/lib/control-plane/owner-surface.ts";
import { count } from "@/lib/control-plane/plain-words.ts";

import { DECISION_ROUTE, QueueButton, QueueForm, Said, When } from "../../console-ui.tsx";
import { DefinedTile, NeedsYouLine, StatusBlock, StackBar } from "../../status-ui.tsx";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const HERE = "/admin/feedback";

/* ------------------------------------------------------------------ *
 * WORDING — machine values never lead
 * ------------------------------------------------------------------ */

/** Where a message came in through, as a sentence rather than an entry-point key. */
function surfaceWords(surface: string): string {
  if (surface === "SIDEBAR") return "the feedback panel on the site";
  if (surface === "TRANSPARENCY") return "the page that explains what is collected";
  if (surface === "COVERAGE") return "a place the site does not cover yet";
  return "an entry point this console does not have a name for";
}

/** Why the intake protections set a message aside. Kept, never deleted. */
function heldBackWords(reason: string): string {
  if (reason === "VELOCITY") {
    return (
      "It arrived in a burst from the same browser, so the intake protections set it aside. " +
      "It was kept, not deleted, and you are looking at it now."
    );
  }
  if (reason === "LIMITER_UNAVAILABLE") {
    return (
      "The counter that spots bursts could not be reached when this arrived, so it was set " +
      "aside rather than trusted through. It was kept, not deleted."
    );
  }
  return "The intake protections set this aside. It was kept, not deleted.";
}

/** The tone class for a triage state. Colour is restrained and semantic. */
function stateTone(state: TriageState): string {
  if (state === "NEEDS_ACTION") return "bad";
  if (state === "NEW") return "warn";
  if (state === "RESOLVED") return "ok";
  return "info";
}

/* ------------------------------------------------------------------ *
 * READING
 * ------------------------------------------------------------------ */

/**
 * One environment, read or honestly not read.
 *
 * A store that could not be opened and a store that holds nothing are
 * different facts and are reported differently. Neither renders as an empty
 * inbox.
 */
async function readEnvironment(
  environment: FeedbackEnvironment,
  nowIso: string,
): Promise<EnvironmentView> {
  const handle = openFeedbackStore(environment);
  if (!handle.ok) {
    return {
      environment,
      connected: false,
      says: handle.says,
      action: handle.action,
      reading: null,
    };
  }
  const outcome = await readFeedbackStore(handle.sql, environment, nowIso);
  if (outcome.kind === "HELD") {
    const held = outcome.value.census.total;
    const shown = outcome.value.rows.length;
    const unreadable =
      outcome.value.unreadable === 0
        ? ""
        : ` ${count(outcome.value.unreadable)} row(s) came back in a shape this page could not ` +
          "read and are counted here rather than dropped.";
    return {
      environment,
      connected: true,
      says:
        `The console read this store. It holds ${count(held)} message(s); the newest ` +
        `${count(shown)} are on this page.${unreadable}`,
      action: null,
      reading: outcome.value,
    };
  }
  return {
    environment,
    connected: true,
    says: outcome.detail,
    action: null,
    reading: null,
  };
}

/* ------------------------------------------------------------------ *
 * RENDER PIECES
 * ------------------------------------------------------------------ */

function Refusal({ title, lines }: { title: string; lines: readonly string[] }) {
  return (
    <main className="admin fi">
      <ConsoleNav view="feedback" currentState={null} states={US_STATES} />
      <h1>Feedback inbox</h1>
      <p className="refusal">
        <strong>{title}</strong>
      </p>
      {lines.map((line) => (
        <p className="note" key={line}>
          {line}
        </p>
      ))}
    </main>
  );
}

function EnvironmentCard({ env }: { env: EnvironmentView }) {
  const words = ENVIRONMENT_WORDS[env.environment];
  const read = env.reading !== null;
  return (
    <section className={`fi-env-card card fi-env-${env.environment.toLowerCase()}`}>
      <h3>{words.words}</h3>
      <StatusBlock
        what={words.means}
        happened={<Said text={env.says} />}
        next={
          read ? (
            <>
              Messages sent here keep arriving whether or not this page is open. This reading was
              taken <When iso={env.reading === null ? null : env.reading.readAt} />.
            </>
          ) : (
            <>Nothing arrives on this page from here until the connection above exists.</>
          )
        }
        needsYou={
          env.action === null
            ? { needed: false }
            : { needed: true, action: env.action }
        }
        detail={
          env.reading === null ? null : (
            <ul className="fi-census">
              <li>{count(env.reading.census.total)} message(s) in the store</li>
              <li>{count(env.reading.census.organic)} sent by readers</li>
              <li>{count(env.reading.census.synthetic)} written by automated runs</li>
              <li>{count(env.reading.census.author)} written by the author</li>
              <li>
                {count(env.reading.census.unknown)} written before the run marker existed and not
                attributable either way
              </li>
              <li>{count(env.reading.census.heldBack)} set aside by the intake protections</li>
            </ul>
          )
        }
      >
        {env.reading === null && (
          /*
           * ADM-20: a gap he cannot act on is a sentence he has to keep
           * reading. This one goes on the fix queue like any other.
           */
          <p className="fi-queue">
            <QueueButton where={`Feedback inbox — ${words.words}`} says={env.says} />
          </p>
        )}
      </StatusBlock>
    </section>
  );
}

function Item({ item }: { item: InboxItem }) {
  const row = item.row;
  const words = TRIAGE_WORDS[item.state];
  const noteId = `fi-note-${row.rowId}`;
  return (
    <li className="fi-item">
      <div className="fi-head">
        <span className={`fi-badge fi-badge-${row.environment.toLowerCase()}`}>
          {ENVIRONMENT_WORDS[row.environment].words}
        </span>
        <span className={`fi-state fi-state-${stateTone(item.state)}`} title={item.state}>
          {words.words}
        </span>
        <When iso={row.receivedAt} />
      </div>

      <p className="fi-context">
        Sent through <span title={row.surface}>{surfaceWords(row.surface)}</span>.{" "}
        {row.replyRequested
          ? "The sender left a way to reply. This page does not read it and never shows it."
          : "The sender did not leave a way to reply."}
      </p>

      <blockquote className="fi-message">{row.message}</blockquote>

      {row.heldBackReason !== null && (
        <p className="fi-held" title={row.heldBackReason}>
          {heldBackWords(row.heldBackReason)}
        </p>
      )}

      <NeedsYouLine
        needs={
          item.state === "NEW" && row.heldBackReason === null
            ? { needed: true, action: "read it and set a status below" }
            : item.state === "NEEDS_ACTION"
              ? { needed: true, action: "you marked this as needing work; it is still open" }
              : { needed: false }
        }
      />

      {item.mark !== null && (
        <p className="fi-mark">
          You marked this <strong>{words.words}</strong> on <When iso={item.mark.decidedAt} />.
          {item.mark.note !== null && <> Your note: {item.mark.note}</>}
        </p>
      )}

      <form className="fi-triage" method="post" action={DECISION_ROUTE}>
        <input type="hidden" name="subjectId" value={item.subjectId} />
        <input type="hidden" name="consequenceShown" value={TRIAGE_CONSEQUENCE} />
        <input type="hidden" name="returnTo" value={HERE} />
        <label className="fi-note-label" htmlFor={noteId}>
          Your note about this message (optional)
        </label>
        <textarea
          id={noteId}
          name="ownerAnswer"
          className="fi-note"
          rows={2}
          maxLength={OWNER_ANSWER_MAX_CHARS}
        />
        <div className="fi-actions">
          {TRIAGE_OPTIONS.map((option) => (
            <button
              key={option.state}
              type="submit"
              name="chosenOption"
              value={option.option}
              className={`fi-set fi-set-${stateTone(option.state)}`}
              title={TRIAGE_WORDS[option.state].means}
            >
              {TRIAGE_WORDS[option.state].words}
            </button>
          ))}
        </div>
        <p className="fi-consequence">{TRIAGE_CONSEQUENCE}</p>
      </form>

      <details className="fi-technical">
        <summary>Technical details</summary>
        <ul>
          <li>
            message row <code>{row.rowId}</code> in the{" "}
            <code>{row.environment}</code> store
          </li>
          <li>
            entry point <code>{row.surface}</code> · traffic class{" "}
            <code>{row.runClass}</code>
            {row.runLabel !== null && (
              <>
                {" "}
                · run <code>{row.runLabel}</code>
              </>
            )}
          </li>
          {row.heldBackReason !== null && (
            <li>
              quarantine reason <code>{row.heldBackReason}</code>
            </li>
          )}
          <li>
            decision subject <code>{item.subjectId}</code>
            {item.mark !== null && (
              <>
                {" "}
                · recorded option <code>{item.mark.recordedOption}</code>
              </>
            )}
          </li>
          <li>
            the reply handle is not selected by this page&apos;s query; the database returns only
            whether one exists
          </li>
        </ul>
      </details>
    </li>
  );
}

/* ------------------------------------------------------------------ *
 * THE PAGE
 * ------------------------------------------------------------------ */

export default async function FeedbackInboxPage() {
  const nowIso = new Date().toISOString();

  const [environments, opened] = await Promise.all([
    Promise.all(FEEDBACK_ENVIRONMENTS.map((environment) => readEnvironment(environment, nowIso))),
    openControlPlane(),
  ]);

  let decisions: readonly OwnerDecisionIntent[] = [];
  let decisionsSays =
    "Your recorded statuses were read from the console's own store, where they are kept " +
    "permanently and in order.";
  let decisionsReadable = true;
  if (!opened.ok) {
    decisionsReadable = false;
    decisionsSays = opened.detail;
  } else {
    const outcome = await readDecisions(opened.repos);
    if (outcome.kind === "HELD") {
      decisions = outcome.value;
    } else if (outcome.kind === "NOT_RECORDED") {
      // Reachable and empty. That is a reading, not a failure: nothing has been
      // recorded yet, and every message below is correctly shown without one.
      decisionsSays = outcome.detail;
    } else {
      decisionsReadable = false;
      decisionsSays = outcome.detail;
    }
  }

  const view = buildFeedbackInboxView({ environments, decisions });

  /*
   * The page audits ITSELF before it prints a number, and a failure replaces
   * the numbers with a refusal — the same discipline the control centre and the
   * research view hold themselves to. A wrong number about what a reader said
   * is still a false claim.
   */
  const numbers = auditRenderedNumbers(renderedNumbersOf(view));
  const claims = checkStatedEqualsRendered(countClaimsOf(view));
  if (!numbers.ok || !claims.ok) {
    return (
      <Refusal
        title="The numbers on this page did not check out, so they are not being shown."
        lines={[numbers.detail, claims.detail]}
      />
    );
  }

  const anyStoreRead = environments.some((e) => e.reading !== null);

  return (
    <main className="admin fi">
      <ConsoleNav view="feedback" currentState={null} states={US_STATES} />
      <QueueForm returnTo={HERE} />

      <h1>Feedback inbox</h1>

      <StatusBlock
        what="Messages people sent through the site, and what you have recorded about each one."
        happened={
          anyStoreRead ? (
            <>
              {count(view.items.length)} message(s) were read at <When iso={nowIso} />, newest
              first. {count(view.waiting)} of them have no status from you yet.
            </>
          ) : (
            <>
              No message store was connected to this copy of the console, so nothing was read.
              Nothing has been checked and found missing here — it has not been checked.
            </>
          )
        }
        next={
          <>
            Nothing happens to a message on its own. It stays exactly where it is until you set a
            status on it, and setting one records your decision permanently — it does not reply to
            anyone and it changes nothing a reader sees.
          </>
        }
        needsYou={
          view.needingYou.value > 0
            ? {
                needed: true,
                action: `${count(view.needingYou.value)} message(s) are waiting on you below`,
              }
            : { needed: false }
        }
        detail={
          <>
            <p>{view.denominatorSays}</p>
            <p>{numbers.detail}</p>
            <p>{claims.detail}</p>
          </>
        }
      />

      <p className="fi-privacy">
        This page knows <strong>that</strong> someone asked to hear back. It never reads who they
        are, and it never lines a message up against anything else the site records.
      </p>

      <section className="fi-tiles">
        <DefinedTile
          figure={count(view.items.length)}
          label="messages on this page"
          means={view.shown.contract}
          needsYou={{ needed: false }}
        />
        <DefinedTile
          figure={count(view.needingYou.value)}
          label="waiting on you"
          means={view.needingYou.contract}
          needsYou={
            view.needingYou.value > 0
              ? { needed: true, action: "read them below" }
              : { needed: false }
          }
        />
        <DefinedTile
          figure={count(view.replyRequested)}
          label="asked to hear back"
          means="The sender left a way to reply. The console records that they did, never what it is."
          needsYou={{ needed: false }}
        />
        <DefinedTile
          figure={count(view.heldBack)}
          label="set aside automatically"
          means="The intake protections quarantined these. They were kept, and they are shown here rather than hidden."
          needsYou={{ needed: false }}
        />
      </section>

      <section className="fi-spread card">
        <h2>Where the messages stand</h2>
        <StackBar
          total={view.items.length}
          parts={TRIAGE_STATES.map((state) => ({
            tone: stateTone(state),
            value: view.byState[state],
            label: TRIAGE_WORDS[state].words,
          }))}
        />
        <ul className="fi-legend">
          {TRIAGE_STATES.map((state) => (
            <li key={state} className={`fi-legend-${stateTone(state)}`}>
              <strong>{count(view.byState[state])}</strong> {TRIAGE_WORDS[state].words} —{" "}
              {TRIAGE_WORDS[state].means}
            </li>
          ))}
        </ul>
      </section>

      <section className="fi-environments">
        <h2>Where messages come from</h2>
        {environments.map((env) => (
          <EnvironmentCard env={env} key={env.environment} />
        ))}
      </section>

      <section className="fi-staging card">
        <h2>Messages from the review site</h2>
        <StatusBlock
          what="Feedback sent from the private build you review before it ships."
          happened={
            <>
              {view.stagingFeedback === "ACTIVE" ? (
                <>The review site&apos;s messages are being read and are listed below, labelled.</>
              ) : (
                <Said text={view.stagingSays} />
              )}
            </>
          }
          next={
            view.stagingFeedback === "ACTIVE" ? (
              <>
                A review-site message stays in the review site&apos;s own store. The console reads
                it there; nothing is copied into the live store.
              </>
            ) : (
              <>
                Until then the review site keeps its own messages. They are not lost, and they are
                not visible here.
              </>
            )
          }
          needsYou={
            view.stagingAction === null
              ? { needed: false }
              : { needed: true, action: view.stagingAction }
          }
          detail={
            <p>
              The review site runs this same application against its own database branch, so
              feedback sent there already travels the ordinary path — the same form, the same
              scrub, the same store shape. What is separate is the store. The console reads each
              store on its own and never writes to either, so a message&apos;s source is a
              property of where it lives rather than a label anything could get wrong.
            </p>
          }
        />
      </section>

      <section className="fi-list-section">
        <h2>
          The messages{" "}
          <span className="fi-count">({count(view.items.length)} shown, newest first)</span>
        </h2>
        {!decisionsReadable && (
          <p className="fi-warn">
            <Said text={decisionsSays} /> Every message below is therefore shown without a status,
            which is not the same as having none recorded.
          </p>
        )}
        {view.items.length === 0 ? (
          <p className="fi-empty">
            {anyStoreRead
              ? "The stores the console could read hold no messages. That is a reading, not a guess."
              : "Nothing was read, so there is nothing to list. This is not a finding that nobody has written."}
          </p>
        ) : (
          <ul className="fi-list">
            {view.items.map((item) => (
              <Item item={item} key={item.subjectId} />
            ))}
          </ul>
        )}
      </section>

      <p className="fi-footer note">
        <Said text={decisionsSays} /> Statuses are kept in the console&apos;s own store, one
        record per decision, in order; a later decision supersedes an earlier one and both survive.
      </p>
    </main>
  );
}
