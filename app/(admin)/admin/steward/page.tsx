/**
 * **THE INTEGRATION STEWARD — what is shipping, what it is waiting for, and
 * what you can actually do about it from here.** (ADM-C2 and §11 of the Admin C
 * brief, 2026-09-06.)
 *
 * The owner's four questions are the layout, in order: *what am I looking at,
 * does this need me, what happened, what happens next.* So the page opens with
 * the four commits side by side — main, the executable head, production, the
 * test site — then the queue of candidate builds oldest first, each one a card
 * that says where it has got to and who has to move; then the controls, with
 * the two that are real beside the four that are not; then the one sentence §11
 * asks for about where the release is waiting.
 *
 * ## This page does not ship anything and cannot
 *
 * §3.8: there is one canonical Integration Steward — the shipping door on the
 * machine plus the required checks and the merge train — and this is a window
 * onto it, never a second one. There is no merge button here, no deploy button,
 * and no control that could reach past the checks. `lib/control-plane/steward.ts`
 * carries the whole argument and every derivation; this file only renders.
 *
 * ## The I/O, deliberately small
 *
 * One `openControlPlane()` (no network) and then ONE round of two reads issued
 * together: the runner heartbeat, for the three commit identities it publishes,
 * and the release-review log, for the candidates. The production commit needs
 * no read at all — it is the build stamp `next.config.ts` inlines, which is a
 * fact about this very deploy. Nothing here fetches the test site, calls
 * GitHub, or touches a filesystem: a page that had to wait eight seconds on a
 * password-protected staging host before it could say anything would be a page
 * the owner stops opening.
 *
 * ## Absence is argued
 *
 * A commit this page cannot compare, a gate result written into the repository
 * rather than the control plane, a post-deploy reading nobody published — each
 * renders as a named gap that says what would fill it. None of them renders as
 * a zero, a dash, or a green tick.
 */

import { openControlPlane, readHeartbeat, unreachable, type ReadOutcome } from "@/lib/control-plane/admin-data.ts";
import { US_STATES } from "@/lib/control-plane/readiness/catalog.ts";
import { ConsoleNav } from "../../console-nav.tsx";
import { isCodeIdentity } from "@/lib/control-plane/code-identity.ts";
import {
  auditRenderedNumbers,
  checkStatedEqualsRendered,
  type Held,
} from "@/lib/control-plane/owner-surface.ts";
import type { SoftwareReleaseReviewRecord } from "@/lib/control-plane/software-release-review.ts";
import {
  RELEASE_EXECUTION_SEAM,
  RELEASE_REVIEW_PATH,
  SOFTWARE_RELEASE_EXECUTION,
  STEWARD_ACTIONS,
  STEWARD_PATH,
  UNSUPPORTED_CONTROLS,
  buildStewardModel,
  countClaimsOf,
  renderedNumbersOf,
  shortId,
  type LifecycleStage,
  type StewardQueueItem,
  type StewardReadModel,
} from "@/lib/control-plane/steward.ts";

import { GapNote, Num, QueueButton, QueueForm, Said, When } from "../../console-ui.tsx";
import { Code, NeedsYouLine, Plain, StatusBlock, type NeedsYou } from "../../status-ui.tsx";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const HERE = STEWARD_PATH;

/* ------------------------------------------------------------------ *
 * SMALL RENDER HELPERS
 * ------------------------------------------------------------------ */

/**
 * A commit the owner reads: the short form leads, the whole thing is on hover.
 * §9A.1's rule about identifiers — a forty-character hash never leads.
 */
function Commit({ h, what }: { readonly h: Held<string>; readonly what: string }) {
  if (!h.held) return <GapNote gap={h.gap} where={`${HERE} — ${what}`} returnTo={HERE} />;
  return (
    <code className="st-commit" title={h.value}>
      {shortId(h.value)}
    </code>
  );
}

/** One of the four commit identities, with the plain name of what it is. */
function IdentityCell({ label, means, h, what }: { readonly label: string; readonly means: string; readonly h: Held<string>; readonly what: string }) {
  return (
    <div className="st-identity-cell">
      <span className="st-identity-label">{label}</span>
      <Commit h={h} what={what} />
      <span className="st-identity-means">{means}</span>
    </div>
  );
}

/** The five stages, marked only where the evidence reaches. */
function LifecycleStrip({ stages }: { readonly stages: readonly LifecycleStage[] }) {
  return (
    <ol className="st-stages">
      {stages.map((stage) => (
        <li
          key={stage.key}
          className={`st-stage st-stage-${stage.state === "REACHED" ? "reached" : stage.state === "NOT_REACHED" ? "not-reached" : "cannot-tell"}`}
          title={stage.says}
        >
          <span className="st-stage-mark" aria-hidden="true" />
          <span className="st-stage-label">{stage.label}</span>
          <span className="st-stage-state">
            {stage.state === "REACHED" ? "Yes" : stage.state === "NOT_REACHED" ? "Not yet" : "Cannot tell from here"}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** A held sentence, or the named gap with the button that queues it. */
function Fact({ h, what }: { readonly h: Held<string>; readonly what: string }) {
  return h.held ? <span>{h.value}</span> : <GapNote gap={h.gap} where={`${HERE} — ${what}`} returnTo={HERE} />;
}

/* ------------------------------------------------------------------ *
 * THE CANDIDATE CARD
 * ------------------------------------------------------------------ */

function CandidateCard({ item }: { readonly item: StewardQueueItem }) {
  // `action` is left undefined rather than defaulted to a sentence: NeedsYouLine
  // owns the wording for "needed, and the action was not named", and a second
  // default here would be a render default this page invented for itself.
  const needs: NeedsYou = item.ownerActionRequired
    ? { needed: true, action: item.ownerAction ?? undefined }
    : { needed: false };
  const where = `${HERE} — build ${shortId(item.stagingSha)}`;
  return (
    <section className="card st-candidate" aria-labelledby={`st-${item.stagingSha}`}>
      <div className="st-candidate-head">
        <h3 id={`st-${item.stagingSha}`}>
          <span className="st-position">{item.position}.</span> Build{" "}
          <code className="st-commit" title={item.stagingSha}>
            {shortId(item.stagingSha)}
          </code>
        </h3>
        <span className="chip st-state">
          <Code raw={item.state} />
        </span>
        <span className="chip st-farthest" title={item.farthest.says}>
          Farthest proved: {item.farthest.label}
        </span>
      </div>

      <StatusBlock
        what={
          <>
            A build of the site made on the test site from one exact commit, waiting for the rest of the way to production.
          </>
        }
        happened={
          <>
            First recorded <When iso={item.firstSeenAt} year />; last touched <When iso={item.lastActivityAt} />.{" "}
            {item.decisionCount === 0
              ? "Nothing has been decided about it."
              : `${item.decisionCount} decision${item.decisionCount === 1 ? "" : "s"} recorded against it.`}
          </>
        }
        next={
          <>
            {item.nextStep} <span className="st-responsible">Next move: {item.responsible}.</span>
          </>
        }
        needsYou={needs}
        detailLabel="What the record says, exactly"
        detail={
          <dl className="st-detail">
            <dt>Commit</dt>
            <dd>
              <code>{item.stagingSha}</code>
            </dd>
            <dt>Deploy on the test site</dt>
            <dd>{item.deployId ? <code>{item.deployId}</code> : <span className="note">the build description carried none</span>}</dd>
            <dt>Rows in the review log for this commit</dt>
            <dd>
              <Num m={item.decisions} /> are decisions; the rest are the console&rsquo;s own notes that it saw the build.
            </dd>
            <dt>Latest receipt</dt>
            <dd>
              {item.receipt.held ? (
                <>
                  <Code raw={item.receipt.value.kind} />
                  {item.receipt.value.section ? ` on ${item.receipt.value.section.replace(/-/g, " ")}` : ""} ·{" "}
                  <When iso={item.receipt.value.at} year /> · <code title={item.receipt.value.recordId}>{item.receipt.value.actorRef}</code>
                </>
              ) : (
                <GapNote gap={item.receipt.gap} where={where} returnTo={HERE} />
              )}
            </dd>
          </dl>
        }
      >
        <LifecycleStrip stages={item.lifecycle} />

        <dl className="st-facts">
          <dt>Is anything blocking it?</dt>
          <dd>
            {item.blocker.blocked ? (
              <>
                <span className="st-blocked">Yes.</span> {item.blocker.says}{" "}
                {item.blocker.klass.held ? (
                  <>
                    Kind of blocker: <Code raw={item.blocker.klass.value} withMeaning />
                  </>
                ) : (
                  <GapNote gap={item.blocker.klass.gap} where={where} returnTo={HERE} />
                )}
              </>
            ) : (
              <>{item.blocker.says}</>
            )}
          </dd>

          <dt>What is it behind?</dt>
          <dd>{item.dependencySays}</dd>

          <dt>Checks that must pass before it can merge</dt>
          <dd>
            {item.requiredChecks.map((check) => (
              <code className="st-check" key={check}>
                {check}
              </code>
            ))}{" "}
            <Fact h={item.gateState} what={`gate results for ${shortId(item.stagingSha)}`} />
          </dd>

          <dt>Merged?</dt>
          <dd>
            <Fact h={item.mergeResult} what={`whether main contains ${shortId(item.stagingSha)}`} />
          </dd>

          <dt>Deployed?</dt>
          <dd>
            <Fact h={item.deployResult} what={`whether production serves ${shortId(item.stagingSha)}`} />
          </dd>

          <dt>Times sent back</dt>
          <dd>
            <Num m={item.retries} />
          </dd>
        </dl>

        <p className="st-controls">
          <a className="st-link" href={RELEASE_REVIEW_PATH}>
            Open the release review
          </a>{" "}
          <span className="note">— that is where a decision on this build is recorded, against this exact commit.</span>{" "}
          <QueueButton where={where} says={`Send this build back to the work queue: ${item.nextStep}`} compact />
        </p>
      </StatusBlock>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * REFUSALS
 * ------------------------------------------------------------------ */

function Refusal({ title, lines }: { readonly title: string; readonly lines: readonly string[] }) {
  return (
    <main className="admin console-page">
      <ConsoleNav view="steward" currentState={null} states={US_STATES} />
      <h1>Integration Steward</h1>
      <p className="refusal">
        <strong>{title}</strong>
      </p>
      {lines.map((line) => (
        <p className="note" key={line}>
          <Plain text={line} />
        </p>
      ))}
    </main>
  );
}

/* ------------------------------------------------------------------ *
 * THE PAGE
 * ------------------------------------------------------------------ */

export default async function StewardPage() {
  const nowIso = new Date().toISOString();

  const opened = await openControlPlane();
  if (!opened.ok) {
    return (
      <Refusal
        title="This page could not reach the record of what has been shipped."
        lines={[
          opened.detail,
          "Nothing below would be a measurement, so nothing is shown. An empty list here would be indistinguishable from a system with nothing waiting.",
        ]}
      />
    );
  }

  // ONE round. The heartbeat carries the three commit identities the runner
  // walked; the review log carries every candidate build. Neither depends on
  // the other, so neither waits for it.
  const reviewLog: Promise<ReadOutcome<readonly SoftwareReleaseReviewRecord[]>> = opened.repos.softwareReleaseReviews
    .readAll()
    .then((rows): ReadOutcome<readonly SoftwareReleaseReviewRecord[]> => ({ kind: "HELD", value: rows }))
    .catch((error: unknown) => unreachable<readonly SoftwareReleaseReviewRecord[]>("the release review log", error));

  const [heartbeat, reviews] = await Promise.all([readHeartbeat(opened.repos), reviewLog]);

  // The runner publishes its three-commit reading on the heartbeat. A beat
  // written before the field existed carries none, and that is a gap rather
  // than a disagreement.
  const published = heartbeat.kind === "HELD" ? heartbeat.value.codeIdentity : null;
  const identity = isCodeIdentity(published) ? published : null;

  const model: StewardReadModel = buildStewardModel({
    nowIso,
    // The commit THIS deploy was built from, which is production's commit: the
    // admin host is a domain alias on the same Netlify site, so it is the same
    // deploy and the same bundle. Inlined by `next.config.ts`'s `env` at build
    // time — a runtime read of COMMIT_REF finds nothing on Netlify, which is
    // the defect `/api/build`'s header records. An empty string is what the
    // config writes for an absent variable, so it reads as absence here.
    deployedSha: process.env.WTP_BUILD_COMMIT ? process.env.WTP_BUILD_COMMIT : null,
    codeIdentity: identity,
    identityDetail:
      identity !== null
        ? null
        : heartbeat.kind === "HELD"
          ? "The runner is beating but has not published the three commit identities yet. Its next cycle writes them."
          : heartbeat.detail,
    reviewRows: reviews.kind === "HELD" ? reviews.value : null,
    reviewDetail: reviews.kind === "HELD" ? null : reviews.detail,
  });

  // The page checks its own numbers against what it is about to draw. A
  // headline that disagrees with the rows beneath it is worse than a blank
  // page, because the owner would act on it.
  const numberAudit = auditRenderedNumbers(renderedNumbersOf(model));
  const countAudit = checkStatedEqualsRendered([
    ...countClaimsOf(model),
    { label: "candidate cards drawn", stated: model.queueDepth.denominator, rendered: model.queue.length },
  ]);
  if (!numberAudit.ok || !countAudit.ok) {
    return (
      <Refusal
        title="This page refused to render its own numbers."
        lines={[
          ...(numberAudit.ok ? [] : [numberAudit.detail]),
          ...(countAudit.ok ? [] : [countAudit.detail]),
          "A number with nothing to measure it against, or a headline that disagrees with the rows beneath it, is the kind of thing that gets acted on.",
        ]}
      />
    );
  }

  const needsAnything: NeedsYou =
    model.needsYou.value > 0
      ? { needed: true, action: `decide about ${model.needsYou.value} build${model.needsYou.value === 1 ? "" : "s"} below` }
      : { needed: false };

  return (
    <main className="admin console-page st-page">
      <ConsoleNav view="steward" currentState={null} states={US_STATES} />
      <QueueForm returnTo={HERE} />

      <h1>Integration Steward</h1>
      <p className="plain">
        What code is live, what code is on the test site, what is waiting to ship, and what is stopping it. The shipping
        itself happens on the machine, from one command — this page watches it and records your decisions, and there is
        no button here that could merge or deploy anything.
      </p>

      {/* ---------------------------------------------------- IDENTITY */}
      <section className="card st-identity" aria-labelledby="st-identity">
        <h2 id="st-identity">The four commits that matter</h2>
        <div className="st-identity-grid">
          <IdentityCell
            label="Main"
            means="The newest commit on the branch everything merges into."
            h={model.identity.rawMain}
            what="main's head"
          />
          <IdentityCell
            label="Newest code change"
            means="The newest commit that actually changed code, as opposed to one that only wrote down an observation."
            h={model.identity.executableMain}
            what="the executable head"
          />
          <IdentityCell
            label="Production"
            means="The commit the live site was built from."
            h={model.identity.production}
            what="the production commit"
          />
          <IdentityCell
            label="Test site"
            means="The newest build recorded for review."
            h={model.identity.staging}
            what="the test site commit"
          />
        </div>
        <StatusBlock
          what={<>Whether the machine doing the work is running current code.</>}
          happened={
            <>
              {model.identity.verdictSays}{" "}
              {model.identity.readAt ? (
                <>
                  Read <When iso={model.identity.readAt} />.
                </>
              ) : null}
            </>
          }
          next={
            <>
              Commits that only record an observation move main without making the runner out of date, so main and the
              runner disagreeing is not by itself a problem.{" "}
              {model.identity.nonShippingAbove.held ? (
                <>
                  Of the commits the runner walked back over main, <Num m={model.identity.nonShippingAbove.value} /> sit
                  above the newest code change and only record observations.
                </>
              ) : (
                <GapNote
                  gap={model.identity.nonShippingAbove.gap}
                  where={`${HERE} — the walk above the newest code change`}
                  returnTo={HERE}
                />
              )}
            </>
          }
          needsYou={{ needed: false }}
          detailLabel="The reading in the instrument's own words"
          detail={
            <>
              <p className="note">
                {model.identity.instrumentSays ? (
                  <Said text={model.identity.instrumentSays} />
                ) : (
                  "The runner has published no reading."
                )}
              </p>
              <p className="note">
                Running on: <Commit h={model.identity.runnerTested} what="the commit the runner is executing" />
                {model.identity.verdict ? (
                  <>
                    {" "}
                    · <Code raw={model.identity.verdict} />
                  </>
                ) : null}
              </p>
            </>
          }
        />
      </section>

      {/* ------------------------------------------------------- QUEUE */}
      <h2>Builds waiting</h2>
      {!model.queueReadable ? (
        // NOT an empty list. "Nothing is waiting" and "the record could not be
        // read" are different sentences and only the first is one to act on.
        <p className="plain">
          <GapNote
            gap={{
              whose: "UNKNOWABLE_NOW",
              says:
                model.queueSays ??
                "The record of what has been reviewed could not be read, so this is not a count of zero builds.",
            }}
            where={`${HERE} — the list of builds waiting`}
            returnTo={HERE}
          />
        </p>
      ) : (
        <>
          <p className="plain">
            <Num m={model.queueDepth} /> builds are still waiting on somebody. <Num m={model.needsYou} /> of them cannot
            move until you decide.
          </p>
          <NeedsYouLine needs={needsAnything} />
          <p className="note">
            The order is the order they were recorded in, oldest first. It is a reading of the review log, not a queue
            anybody rearranges — see the controls below.
          </p>
          {model.current ? (
            <p className="plain st-current">
              <strong>Right now:</strong> {model.waitingSays}
              {model.next ? (
                <>
                  {" "}
                  Behind it is <code className="st-commit" title={model.next.stagingSha}>{shortId(model.next.stagingSha)}</code>.
                </>
              ) : (
                " Nothing is behind it."
              )}
            </p>
          ) : (
            <p className="plain st-current">
              <strong>Right now:</strong> {model.waitingSays}
            </p>
          )}
          {model.queue.length === 0 ? (
            <p className="note">
              The review log holds no build yet. One appears here the first time the release review page can read a build
              description from the test site.
            </p>
          ) : (
            model.queue.map((item) => <CandidateCard key={item.stagingSha} item={item} />)
          )}
        </>
      )}

      {/* ---------------------------------------------------- RECEIPT */}
      <section className="card st-receipt" aria-labelledby="st-receipt">
        <h2 id="st-receipt">The last thing that was recorded</h2>
        {model.latestReceipt.held ? (
          <StatusBlock
            what={
              <>
                A durable record of a decision, kept for good against one exact commit. It is the proof — a message on
                screen is not.
              </>
            }
            happened={
              <>
                <Code raw={model.latestReceipt.value.kind} /> on{" "}
                <code className="st-commit" title={model.latestReceipt.value.stagingSha}>
                  {shortId(model.latestReceipt.value.stagingSha)}
                </code>
                , <When iso={model.latestReceipt.value.at} year />.
              </>
            }
            next={<>It stays where it is. Nothing rewrites a receipt; a later decision is a new row beside it.</>}
            needsYou={{ needed: false }}
            detailLabel="The record"
            detail={
              <p className="note">
                <code>{model.latestReceipt.value.recordId}</code> · written by{" "}
                <code>{model.latestReceipt.value.actorRef}</code>
                {model.latestReceipt.value.section ? ` · ${model.latestReceipt.value.section.replace(/-/g, " ")}` : ""}
              </p>
            }
          />
        ) : (
          <GapNote gap={model.latestReceipt.gap} where={`${HERE} — the last receipt`} returnTo={HERE} />
        )}
      </section>

      {/* --------------------------------------------------- CONTROLS */}
      <section className="card st-actions" aria-labelledby="st-actions">
        <h2 id="st-actions">What you can do from here</h2>
        <p className="plain">
          {STEWARD_ACTIONS.length} things, and each one records something. Nothing here starts a check, merges a branch,
          or deploys a build — that is the shipping door on the machine, and this page is not allowed to go round it.
        </p>
        <ul className="st-action-list">
          {STEWARD_ACTIONS.map((action) => (
            <li key={action.type}>
              <strong>{action.label}</strong>
              <span className="chip st-authority" title={action.type}>
                <Code raw={action.authority} />
              </span>
              <p className="note">{action.does}</p>
              <p className="note st-doesnot">{action.doesNot}</p>
              <p className="note">
                You read the result back on <a href={action.readBackAt}>{action.readBackLabel}</a>.
              </p>
            </li>
          ))}
        </ul>

        <h3>What this console will not pretend to do</h3>
        <p className="plain">
          {UNSUPPORTED_CONTROLS.length} more controls were asked for. Nothing in the system can carry them out, so there
          is no button for them — a button that recorded something and changed nothing would teach you to trust a
          console that lies.
        </p>
        <ul className="st-refused-list">
          {UNSUPPORTED_CONTROLS.map((control) => (
            <li key={control.label}>
              <strong>{control.label}</strong> — <Code raw={control.refusal} />
              <p className="note">{control.says}</p>
              <details className="st-seam">
                <summary>What would have to exist first</summary>
                <p className="note">{control.missingSeam}</p>
              </details>
            </li>
          ))}
        </ul>
      </section>

      {/* -------------------------------------------------- EXECUTION */}
      <section className="card st-execution" aria-labelledby="st-execution">
        <h2 id="st-execution">Shipping itself</h2>
        <StatusBlock
          what={<>Whether the console can carry a reviewed build the rest of the way to production by itself.</>}
          happened={<>It cannot. {RELEASE_EXECUTION_SEAM.says}</>}
          next={<>{model.waitingSays}</>}
          needsYou={{ needed: false }}
          detailLabel="What the next pass would have to build"
          detail={
            <>
              <p className="note">{RELEASE_EXECUTION_SEAM.missingSeam}</p>
              <p className="note">Whatever is built must keep {RELEASE_EXECUTION_SEAM.preserves}</p>
              <p className="note">
                Reported state: <Code raw={SOFTWARE_RELEASE_EXECUTION} />
              </p>
            </>
          }
        />
      </section>

      <p className="note">
        Read from the control plane at <When iso={model.nowIso} year />: the runner heartbeat and the release review
        log, in one round. Nothing on this page calls the test site, GitHub or Netlify.
      </p>
    </main>
  );
}
