/**
 * **THE AGENT BRIDGE — what the two subscriptions can do, what they were asked
 * to do, and what came of it.** (ADM-C8 and ADM-C9, Admin C, 2026-09-06.)
 *
 * Reachable only on `ADMIN_ORIGIN` with a valid session, both enforced upstream
 * in `middleware.ts` (`/admin` is an admin prefix). The page reads the control
 * plane and writes nothing except, through the console's existing decision
 * route, an INTENT recording what the owner decided about a review.
 *
 * It answers the owner's four questions in that order, on every card:
 *
 *   what am I looking at · what happened · does this need me · what happens next
 *
 * ## The two things this page must never do
 *
 * **It must never claim health it did not measure.** The deployed console is a
 * Netlify function: it has no PATH, no home directory and no sight of the
 * machine in the office where Codex and Claude Code actually live. So the
 * provider cards on the website are named gaps that say exactly that, and only
 * a reading taken ON the runner machine fills them in. A green tick here that
 * came from nowhere would be worse than an empty card.
 *
 * **It must never let paid spending look like it is off when it is on, or on
 * when it is off.** The setting is read from the durable admin configuration
 * and rendered with its source and the moment it was decided. The switch is the
 * gateway's own `config.setApiFallback` action, posted to the one door — this
 * page holds no second copy of the rule and no second way to change it. And it
 * says plainly what recording that decision does today: nothing in the running
 * system reads the policy yet, so allowing paid spending records the permission
 * and permits nothing, and the exact missing seam is named on the card.
 *
 * Everything computed lives in `lib/control-plane/agents/view.ts`, which
 * `node --test` can import — a `.tsx` cannot be — so the page holds no
 * arithmetic and no judgement about what a state means.
 */
import { openControlPlane } from "@/lib/control-plane/admin-data.ts";
import { US_STATES } from "@/lib/control-plane/readiness/catalog.ts";
import { ConsoleNav } from "../../console-nav.tsx";
import {
  readAdminConfig,
  readAgentJobs,
  readReviewDecisions,
} from "@/lib/control-plane/agents/read.ts";
import { MODE_WORDS } from "@/lib/control-plane/agents/job.ts";
import { PROVIDER_WORDS } from "@/lib/control-plane/agents/provider.ts";
import {
  AGENTS_PAGE_PATH,
  buildAgentBridgeView,
  reviewDecisionSubject,
  type AgentBridgeView,
  type ReviewRow,
} from "@/lib/control-plane/agents/view.ts";
import { gap, type Held } from "@/lib/control-plane/owner-surface.ts";
import type { AgentProviderDescriptor } from "@/lib/control-plane/agents/provider.ts";

import { DECISION_ROUTE, GapNote, HeldNum, QueueForm, When } from "../../console-ui.tsx";
import { Code, NeedsYouLine, StatusBlock } from "../../status-ui.tsx";
import { API_FALLBACK_SUBJECT, GATEWAY_ACTION_ROUTE, REVIEW_DECISION_OPTIONS, SET_API_FALLBACK_ACTION } from "./contract.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * The page runs inside a web function, which by nature can take no reading of
 * the runner machine. Stated as a constant so the reason travels with the
 * value rather than living in a comment beside a literal.
 */
const OBSERVED_FROM = "WEB_FUNCTION" as const;

export default async function AgentsPage() {
  const at = new Date().toISOString();
  const opened = await openControlPlane();

  let view: AgentBridgeView;
  if (!opened.ok) {
    /*
     * `opened.detail` names the environment variable that is missing, which
     * belongs in a server log and never in a browser. The owner gets the fact
     * he can act on: this page is not saying anything about the agents, because
     * it could not ask.
     */
    const couldNotAsk =
      "The console could not reach the place it keeps its records, so nothing here is a reading of what the agents did.";
    view = buildAgentBridgeView({
      observedFrom: OBSERVED_FROM,
      at,
      jobs: gap("UNKNOWABLE_NOW", couldNotAsk),
      config: null,
      probes: gap("UNKNOWABLE_NOW", couldNotAsk),
      decisions: gap("UNKNOWABLE_NOW", couldNotAsk),
    });
  } else {
    const [jobs, config, decisions] = await Promise.all([
      readAgentJobs(opened.repos),
      readAdminConfig(opened.repos),
      readReviewDecisions(opened.repos),
    ]);
    view = buildAgentBridgeView({
      observedFrom: OBSERVED_FROM,
      at,
      jobs,
      config,
      probes: gap(
        "UNKNOWABLE_NOW",
        "This website cannot look at the machine in your office. The provider readings below fill in from what that machine records when it publishes.",
      ),
      decisions,
    });
  }

  return (
    <main className="admin console-page">
      <ConsoleNav view="agents" currentState={null} states={US_STATES} />
      <QueueForm returnTo={AGENTS_PAGE_PATH} />

      <h1>Agents</h1>
      <StatusBlock
        what="Two paid subscriptions that can be given a bounded piece of work: Codex on your ChatGPT plan, Claude Code on your Claude plan."
        happened={view.happened}
        next={view.next}
        needsYou={{ needed: view.needsYou, action: view.needsYouAction === null ? undefined : view.needsYouAction }}
        detail={
          <p className="plain">
            Read at <When iso={view.at} />. Every job below is a durable record in the control plane, not a message that
            scrolled past. A job may read this repository and it may put a change forward on a branch; nothing it does
            merges, deploys, or changes what a reader sees.
          </p>
        }
      />

      <h2>Paid API spending</h2>
      <div className="card ab-fallback">
        <StatusBlock
          what={view.fallback.enabled ? "Paid API spending is ON." : "Paid API spending is OFF."}
          happened={
            view.fallback.source === "OWNER_DECISION" ? (
              <>
                You allowed this
                {view.fallback.decidedAt === null ? "" : <> on <When iso={view.fallback.decidedAt} /></>}.
              </>
            ) : (
              "Nobody has turned this on, so it is off — which is where it starts and where it returns after any restart or deploy."
            )
          }
          next={view.fallback.says}
          needsYou={{
            needed: view.fallback.enabled,
            action: "decide whether you still want jobs billed per use when a subscription cannot take them",
          }}
          detail={
            <>
              <p className="note">
                Recording this decision records the decision. Nothing in the running system reads the setting yet, so
                turning it on does not by itself permit a single paid call. The exact piece that is missing:{" "}
                {view.fallback.missingSeam}
              </p>
              <p className="plain">
                Enforcement: <Code raw={view.fallback.enforcement} />
              </p>
            </>
          }
        >
          {view.fallback.enabled ? (
            <form method="post" action={GATEWAY_ACTION_ROUTE} className="ab-actions">
              <input type="hidden" name="type" value={SET_API_FALLBACK_ACTION} />
              <input type="hidden" name="subject" value={API_FALLBACK_SUBJECT} />
              <input type="hidden" name="returnTo" value={AGENTS_PAGE_PATH} />
              <button type="submit" name="enabled" value="false" className="primary">
                Stop allowing paid API spending
              </button>
            </form>
          ) : (
            <details className="ab-arm">
              <summary>Allow paid API spending</summary>
              <p className="plain">
                This is the expensive direction, so it is said twice. Allowing it means a job a subscription cannot take
                may be billed per use instead of refused.
              </p>
              <form method="post" action={GATEWAY_ACTION_ROUTE} className="ab-actions">
                <input type="hidden" name="type" value={SET_API_FALLBACK_ACTION} />
                <input type="hidden" name="subject" value={API_FALLBACK_SUBJECT} />
                <input type="hidden" name="returnTo" value={AGENTS_PAGE_PATH} />
                <input type="hidden" name="enabled" value="true" />
                <button type="submit" name="confirmed" value="true" className="primary">
                  Yes — allow paid API spending
                </button>
              </form>
            </details>
          )}
        </StatusBlock>
      </div>

      <h2>The two providers</h2>
      <div className="ab-providers">
        {view.providers.map((p) => (
          <ProviderCard key={p.provider} p={p} />
        ))}
      </div>

      <h2>Reviews</h2>
      {view.reviews.held ? (
        view.reviews.value.length === 0 ? (
          <p className="note">
            No two-provider run has been recorded yet. When one is, both sides of it appear here with the exact copy they
            read.
          </p>
        ) : (
          <>
            <p className="plain">
              <HeldNum h={view.reviewCount} where="Agents — reviews" returnTo={AGENTS_PAGE_PATH} /> runs, newest first.
            </p>
            <div className="ab-reviews">
              {view.reviews.value.map((r) => (
                <ReviewCard key={r.reviewId} r={r} />
              ))}
            </div>
          </>
        )
      ) : (
        <p className="gap">
          <GapNote gap={view.reviews.gap} where="Agents — reviews" returnTo={AGENTS_PAGE_PATH} />
        </p>
      )}

      <h2>Every job</h2>
      {view.jobs.held ? (
        <>
          <p className="plain">
            <HeldNum h={view.jobCount} where="Agents — job list" returnTo={AGENTS_PAGE_PATH} /> jobs, newest first.
          </p>
          {view.unreadableSays !== null && <p className="note ab-unreadable">{view.unreadableSays}</p>}
          <div className="scroll-x">
            <table className="ab-jobs">
              <thead>
                <tr>
                  <th scope="col">What it was asked</th>
                  <th scope="col">Who</th>
                  <th scope="col">Mode</th>
                  <th scope="col">How it ended</th>
                  <th scope="col">Started</th>
                  <th scope="col">What it read</th>
                </tr>
              </thead>
              <tbody>
                {view.jobs.value.map((j) => (
                  <tr key={j.jobId}>
                    <th scope="row">
                      <span title={j.jobId}>{j.scope}</span>
                      <span className="ab-asked">{j.requestedOutput}</span>
                    </th>
                    <td>{j.providerName === null ? "Nobody — this row is the comparison" : j.providerName}</td>
                    <td title={j.mode}>{j.modeName}</td>
                    <td>
                      <span className="chip">{j.stateWords}</span>
                      {j.refusalSays !== null && <span className="ab-why">{j.refusalSays}</span>}
                      {j.producedBranch !== null && <span className="ab-why">On branch {j.producedBranch}</span>}
                      {j.producedPullRequest !== null && <span className="ab-why">Put forward as {j.producedPullRequest}</span>}
                    </td>
                    <td>
                      <When iso={j.startedAt} />
                      {j.completedAt !== null && (
                        <>
                          {" "}
                          &rarr; <When iso={j.completedAt} />
                        </>
                      )}
                    </td>
                    <td>
                      <span title={j.snapshotHash}>{j.snapshotDescribes}</span>
                      <details className="ab-detail">
                        <summary>Technical details</summary>
                        <p className="plain">
                          Copy read: <code>{j.snapshotShort}</code>. Allowed to touch:{" "}
                          {j.allowedFiles.length === 0 && j.allowedSystems.length === 0
                            ? "nothing outside the copy it was given"
                            : [...j.allowedFiles, ...j.allowedSystems].join(", ")}
                          .
                        </p>
                        <p className="plain">
                          Authority: <Code raw={j.authority} withMeaning />
                        </p>
                        <p className="plain">
                          Job <code>{j.jobId}</code>; receipt <code>{j.receiptId}</code>.
                        </p>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="gap">
          <GapNote gap={view.jobs.gap} where="Agents — job list" returnTo={AGENTS_PAGE_PATH} />
        </p>
      )}
    </main>
  );
}

/** One provider, with every field ADM-C8 names and a named gap wherever one is not measurable. */
function ProviderCard({ p }: { p: AgentProviderDescriptor }) {
  const words = PROVIDER_WORDS[p.provider];
  const where = `Agents — ${p.name}`;
  return (
    <div className="card ab-provider">
      <h3>{p.name}</h3>
      <p className="plain">
        {words.usedFor} Paid for by {words.paidBy}.
      </p>
      <StatusBlock
        what={p.canRunNow ? "Ready to take a job." : "Cannot take a job right now."}
        happened={p.happened}
        next={p.next}
        needsYou={{ needed: p.needsYou, action: p.needsYouAction === null ? undefined : p.needsYouAction }}
        detail={
          <dl className="ab-fields">
            <dt>Set up on the work machine</dt>
            <dd>
              <Yes h={p.configured} where={where} />
            </dd>
            <dt>Answers when started</dt>
            <dd>
              <Yes h={p.reachable} where={where} />
            </dd>
            <dt>Signed in</dt>
            <dd>
              {p.authenticated.held ? (
                p.authenticated.value === "SIGNED_IN_UNVERIFIED" ? (
                  "A saved sign-in is on that machine. Whether it is still good is only known when a job runs — nothing here checks it, and nothing here reads it."
                ) : (
                  "No saved sign-in on that machine."
                )
              ) : (
                <GapNote gap={p.authenticated.gap} where={where} returnTo={AGENTS_PAGE_PATH} />
              )}
            </dd>
            <dt>Free job slots</dt>
            <dd>
              <HeldNum h={p.capacity} where={where} returnTo={AGENTS_PAGE_PATH} />
            </dd>
            <dt>Busy or idle</dt>
            <dd>
              {p.occupancy.held ? (
                p.occupancy.value === "BUSY" ? "Busy on a job now." : "Idle."
              ) : (
                <GapNote gap={p.occupancy.gap} where={where} returnTo={AGENTS_PAGE_PATH} />
              )}
            </dd>
            <dt>Last thing it was asked</dt>
            <dd>
              {p.latestTask.held ? (
                <>
                  <span title={p.latestTask.value.jobId}>{p.latestTask.value.says}</span> &mdash;{" "}
                  {p.latestTask.value.outcome}, <When iso={p.latestTask.value.at} />
                </>
              ) : (
                <GapNote gap={p.latestTask.gap} where={where} returnTo={AGENTS_PAGE_PATH} />
              )}
            </dd>
            <dt>Last thing that went wrong</dt>
            <dd>
              {p.latestError.held ? (
                <>
                  <span title={p.latestError.value.raw}>{p.latestError.value.says}</span> <When iso={p.latestError.value.at} />
                </>
              ) : (
                <GapNote gap={p.latestError.gap} where={where} returnTo={AGENTS_PAGE_PATH} />
              )}
            </dd>
            <dt>If a subscription cannot take the work</dt>
            <dd>{p.fallbackPolicy.says}</dd>
            <dt>Where this reading was taken</dt>
            <dd title={p.observedFrom}>
              {p.observedFrom === "WEB_FUNCTION" ? "This website, which cannot see the work machine" : "The machine that runs the work"},{" "}
              <When iso={p.observedAt} />
              {p.blocker !== null && (
                <>
                  {" "}
                  <span className="chip" title={p.blocker}>
                    {p.blocker === "EXTERNAL" ? "Outside this system" : "Waiting on you"}
                  </span>
                </>
              )}
            </dd>
          </dl>
        }
      />
    </div>
  );
}

/** A yes/no that was measured, or the named gap where the measurement would be. */
function Yes({ h, where }: { h: Held<boolean>; where: string }) {
  if (!h.held) return <GapNote gap={h.gap} where={where} returnTo={AGENTS_PAGE_PATH} />;
  return <>{h.value ? "Yes" : "No"}</>;
}

/**
 * One two-provider run: what was reviewed, what they agreed on, what they did
 * not, and what you decided.
 *
 * The independence line is the load-bearing one. An independent review shows
 * its three checks; an `ASK_BOTH` run says plainly that it proves nothing about
 * how the two answers were reached, because presenting it as a second opinion
 * would be the exact claim ADM-C9 exists to stop.
 */
function ReviewCard({ r }: { r: ReviewRow }) {
  const where = `Agents — review ${r.snapshotShort}`;
  return (
    <div className="card ab-review">
      <h3>{r.scope}</h3>
      <p className="plain">
        <span className="chip" title={r.mode}>
          {r.modeName}
        </span>{" "}
        {MODE_WORDS[r.mode].does}
      </p>
      <p className="plain">
        They were asked for: {r.asked}. They read <span title={r.snapshot.hash}>{r.snapshot.describes}</span>, frozen{" "}
        <When iso={r.snapshot.frozenAt} /> at {r.snapshot.bytes} bytes (copy <code>{r.snapshotShort}</code>).
      </p>

      <dl className="ab-seats">
        {r.seats.map((s) => (
          <div key={s.jobId} className="ab-seat">
            <dt>
              {s.slot}: {s.providerName}
            </dt>
            <dd>
              <span className="chip">{s.stateWords}</span> {s.says}
            </dd>
          </div>
        ))}
      </dl>

      <div className="ab-independence">
        {r.isolation.held ? (
          <>
            <p className={r.isolation.value.holds ? "plain ab-holds" : "refusal"}>{r.isolation.value.says}</p>
            <ul className="ab-checks">
              <li>{r.isolation.value.sameSnapshot ? "Both were given the same frozen copy." : "They were not given the same frozen copy."}</li>
              <li>
                {r.isolation.value.eachReviewedWhatItWasGiven
                  ? "Each one named the copy it was given back to us, so each read what it was handed."
                  : "At least one did not name the copy it was given, so it cannot be shown as having read it."}
              </li>
              <li>
                {r.isolation.value.comparedAfterBoth
                  ? "The two answers were only put side by side after both were finished."
                  : "The comparison is stamped before one of them finished, so the order cannot be shown."}
              </li>
            </ul>
          </>
        ) : (
          <p className="gap">
            <GapNote gap={r.isolation.gap} where={where} returnTo={AGENTS_PAGE_PATH} />
          </p>
        )}
      </div>

      {r.comparison.held ? (
        <>
          <p className="plain">{r.comparison.value.says}</p>
          {r.comparison.value.disagreements.length > 0 && (
            <>
              <h4>Where they disagreed</h4>
              <dl className="ab-points">
                {r.comparison.value.disagreements.map((d) => (
                  <div key={d.topic} className="ab-point ab-point-split">
                    <dt>{d.topic}</dt>
                    <dd>
                      <p className="plain">
                        First reviewer &mdash; {d.aSays} <span className="chip">{confidenceWords(d.aConfidence)}</span>{" "}
                        <span className="ab-evidence">Pointed at: {d.aEvidence}</span>
                      </p>
                      <p className="plain">
                        Second reviewer &mdash; {d.bSays} <span className="chip">{confidenceWords(d.bConfidence)}</span>{" "}
                        <span className="ab-evidence">Pointed at: {d.bEvidence}</span>
                      </p>
                    </dd>
                  </div>
                ))}
              </dl>
            </>
          )}
          {r.comparison.value.agreements.length > 0 && (
            <>
              <h4>Where they agreed</h4>
              <dl className="ab-points">
                {r.comparison.value.agreements.map((a) => (
                  <div key={a.topic} className="ab-point">
                    <dt>{a.topic}</dt>
                    <dd>
                      {a.aSays} <span className="chip">{confidenceWords(a.confidence)}</span>{" "}
                      <span className="ab-evidence">Pointed at: {a.aEvidence}; and {a.bEvidence}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </>
          )}
          {(r.comparison.value.onlyA.length > 0 || r.comparison.value.onlyB.length > 0) && (
            <>
              <h4>Raised by one of them only</h4>
              <ul className="ab-points-one">
                {r.comparison.value.onlyA.map((p) => (
                  <li key={`a-${p.topic}`}>First reviewer only &mdash; {p.topic}: {p.says}</li>
                ))}
                {r.comparison.value.onlyB.map((p) => (
                  <li key={`b-${p.topic}`}>Second reviewer only &mdash; {p.topic}: {p.says}</li>
                ))}
              </ul>
            </>
          )}
        </>
      ) : (
        <p className="gap">
          <GapNote gap={r.comparison.gap} where={where} returnTo={AGENTS_PAGE_PATH} />
        </p>
      )}

      <h4>What you decided</h4>
      {r.decision.held ? (
        <p className="plain">
          {r.decision.value.chose}
          {r.decision.value.inHisWords === null ? "" : ` — ${r.decision.value.inHisWords}`}, recorded{" "}
          <When iso={r.decision.value.decidedAt} />.
        </p>
      ) : (
        <>
          <p className="gap">
            <GapNote gap={r.decision.gap} where={where} returnTo={AGENTS_PAGE_PATH} />
          </p>
          <form method="post" action={DECISION_ROUTE} className="options ab-decide">
            <input type="hidden" name="subjectId" value={reviewDecisionSubject(r.reviewId)} />
            <input type="hidden" name="consequenceShown" value={r.says} />
            <input type="hidden" name="returnTo" value={AGENTS_PAGE_PATH} />
            {REVIEW_DECISION_OPTIONS.map((option) => (
              <button key={option} type="submit" name="chosenOption" value={option} className="option">
                {option}
              </button>
            ))}
          </form>
        </>
      )}

      <NeedsYouLine needs={{ needed: r.needsYou, action: r.needsYouAction === null ? undefined : r.needsYouAction }} />
    </div>
  );
}

/** A confidence as a word rather than a level. */
function confidenceWords(level: "HIGH" | "MEDIUM" | "LOW"): string {
  if (level === "HIGH") return "sure";
  if (level === "MEDIUM") return "fairly sure";
  return "not sure";
}
