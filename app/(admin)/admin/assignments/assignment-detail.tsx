/**
 * **ONE ASSIGNMENT'S FULL CHAIN — the seven parts, in the order the owner asked.**
 *
 *   1 what is being worked on, where, why, by which role and model
 *   2 what was discovered versus what was downloaded
 *   3 what parsed, what failed, and the usable records produced
 *   4 what passed verification, what was rejected and why, what needs more evidence
 *   5 what was promoted versus what is confirmed publicly available
 *   6 what it cost, retries and escalations included; unknown named, never $0
 *   7 what is waiting: its age, its blocker, who owns the next step, the next action
 *
 * Then the evidence: every id the chain rests on, and the records' own notes
 * behind a disclosure, verbatim. Every figure is carried from the projection
 * and is in the page's audit (`assignmentRowNumbers`); a gap renders as the
 * gap it is, with the button that queues it.
 */
import { bytesText, durationText } from "@/lib/control-plane/cost-panel.ts";
import { OWNER_WORDS, type AssignmentRow } from "@/lib/control-plane/assignment-view.ts";
import { PIPELINE_STAGES } from "@/lib/control-plane/promotion/types.ts";
import { count, modelName, plainCode, plainText, usdCents } from "@/lib/control-plane/plain-words.ts";

import { GapNote, HeldNum, Num, Said, When } from "../../console-ui.tsx";
import { NeedsYouLine } from "../../status-ui.tsx";
import { ASSIGNMENTS_PATH, AgeWords, AttemptWords, LaneChip, ModelWords, StateWord } from "./assignment-bits.tsx";

function Ids({ label, ids, more }: { label: string; ids: readonly string[]; more: number }) {
  if (ids.length === 0) return null;
  return (
    <li>
      {label}:{" "}
      {ids.map((id, i) => (
        <span key={id}>
          {i > 0 ? ", " : ""}
          <code>{id}</code>
        </span>
      ))}
      {more > 0 ? ` (and ${count(more)} more)` : ""}
    </li>
  );
}

function SourceLink({ url }: { url: string }) {
  return (
    <a href={url} rel="noreferrer noopener" target="_blank" className="wf-id">
      {url}
    </a>
  );
}

export function AssignmentDetail({
  row,
  nowIso,
  readSays,
}: {
  row: AssignmentRow;
  nowIso: string;
  /** Where and when this chain was read, in one sentence. */
  readSays: string;
}) {
  const what = row.what;
  const d = row.discovery;
  const v = row.verification;
  const dv = row.delivery;
  const c = row.cost;
  const w = row.waiting;
  const e = row.evidence;
  const where = `Assignment · ${row.id}`;
  return (
    <article>
      <p className="note">
        <a href={ASSIGNMENTS_PATH}>All assignments</a> · {readSays}
      </p>
      <h1>
        <Said text={plainText(what.title)} />
      </h1>
      <p className="plain">
        <StateWord state={row.state} /> — <Said text={plainText(row.stateSays)} /> <LaneChip lane={row.lane} />
      </p>
      <p className="note">
        <code>{row.id}</code>
        {row.lastActivityAt !== null ? (
          <>
            {" "}
            · last activity <When iso={row.lastActivityAt} />
          </>
        ) : null}
      </p>

      {/* 1 — WHAT, WHERE, WHY, WHO */}
      <section className="card">
        <h2>1 · What is being worked on, where, why, and by whom</h2>
        <ul className="plain">
          <li>
            <strong>What:</strong> <Said text={plainText(what.title)} />
            {what.recordClass !== null ? <span className="note"> (record class {plainCode(what.recordClass)})</span> : null}
            {what.subjectName !== null ? <div className="note">{what.subjectName}</div> : null}
          </li>
          <li>
            <strong>Where:</strong>{" "}
            {what.where.held ? what.where.value.name : <GapNote gap={what.where.gap} where={`${where} · where`} returnTo={ASSIGNMENTS_PATH} />}
          </li>
          <li>
            <strong>Why:</strong> <Said text={plainText(what.why.says)} />
            {what.why.band !== null ? (
              <div className="note">
                Reader-impact band {what.why.band.band}: <Said text={plainText(what.why.band.why)} /> (the band orders paid model work; plain-code work goes oldest due first)
              </div>
            ) : null}
            {what.why.dueAt !== null ? (
              <div className="note">
                Next due <When iso={what.why.dueAt} />
                {what.why.readerImpactAt !== null ? (
                  <>
                    ; a reader is affected from <When iso={what.why.readerImpactAt} />
                  </>
                ) : null}
              </div>
            ) : null}
            {what.why.cadence !== null ? (
              <div className="note">
                Cadence: <Said text={plainText(what.why.cadence)} />
              </div>
            ) : null}
          </li>
          <li>
            <strong>Who:</strong>{" "}
            {what.workers.held ? (
              <ul>
                {what.workers.value.map((wk, i) => (
                  <li key={`${wk.role}-${i}`}>
                    {plainCode(wk.role)} — <ModelWords model={wk.model} />, <AttemptWords n={wk.attempts} />
                    {wk.reportedModels.length > 0 ? <span className="note"> (the provider reported {wk.reportedModels.map(modelName).join(", ")})</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <GapNote gap={what.workers.gap} where={`${where} · who`} returnTo={ASSIGNMENTS_PATH} />
            )}
          </li>
        </ul>
      </section>

      {/* 2 — DISCOVERED VERSUS DOWNLOADED */}
      <section className="card">
        <h2>2 · What was discovered, and what was actually downloaded</h2>
        <p className="note">
          {d.rounds === null ? (
            <span className="gap">Rounds not counted</span>
          ) : (
            <>
              {count(d.rounds)} round{d.rounds === 1 ? "" : "s"} opened
              {c.rounds !== null && c.rounds !== d.rounds ? ` (${count(c.rounds)} reached by a worker)` : ""}
            </>
          )}
          , <AttemptWords n={d.attempts} />.
        </p>
        <h3>Discovered</h3>
        {d.discovered.held ? (
          <>
            <p className="plain">
              <Said text={d.discovered.value.says} />
              {d.discovered.value.rungsWalked !== null ? ` The newest walk had ${count(d.discovered.value.rungsWalked)} evidence-backed rungs.` : ""}
            </p>
            {d.discovered.value.leads.length > 0 && (
              <ul className="plain">
                {d.discovered.value.leads.map((lead, i) => (
                  <li key={`${lead.kind}-${i}`}>
                    <span className="chip">{plainCode(lead.kind)}</span> <Said text={lead.says} />
                    {lead.url !== null ? (
                      <div className="note">
                        <SourceLink url={lead.url} />
                      </div>
                    ) : null}
                    {lead.artifactIds.length > 0 ? (
                      <div className="note">
                        evidence{" "}
                        {lead.artifactIds.map((id, j) => (
                          <span key={id}>
                            {j > 0 ? ", " : ""}
                            <code>{id}</code>
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {d.discovered.value.moreLeads > 0 && <p className="note">{count(d.discovered.value.moreLeads)} more lead(s) are not listed here.</p>}
          </>
        ) : (
          <p>
            <GapNote gap={d.discovered.gap} where={`${where} · discovered`} returnTo={ASSIGNMENTS_PATH} />
          </p>
        )}
        <h3>Downloaded</h3>
        {d.downloaded.held ? (
          <>
            <p className="plain">
              <Said text={d.downloaded.value.says} /> Complete captures <Num m={d.downloaded.value.complete} format={count} />
              {d.downloaded.value.bytes !== null ? `; ${bytesText(d.downloaded.value.bytes)} in all.` : "; byte counts are not recorded for this lane."}
            </p>
            {d.downloaded.value.items.length > 0 && (
              <ul className="plain">
                {d.downloaded.value.items.map((a) => (
                  <li key={a.artifactId}>
                    <code>{a.artifactId}</code> · {bytesText(a.bytes)} · {a.contentType}
                    {a.partial ? <span className="state-amber"> · partial capture</span> : null}
                    <div className="note">
                      <SourceLink url={a.url} />
                    </div>
                    <div className="note">
                      vaulted <When iso={a.at} /> by attempt <code>{a.attemptId}</code>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {d.downloaded.value.more > 0 && <p className="note">{count(d.downloaded.value.more)} more document(s) are not listed here.</p>}
          </>
        ) : (
          <p>
            <GapNote gap={d.downloaded.gap} where={`${where} · downloaded`} returnTo={ASSIGNMENTS_PATH} />
          </p>
        )}
      </section>

      {/* 3 — PARSED */}
      <section className="card">
        <h2>3 · What parsed, what failed, and the usable records produced</h2>
        {row.parsing.parsed.held ? (
          <>
            <p className="plain">
              <Said text={row.parsing.parsed.value.says} />
            </p>
            <p>
              Usable records: <HeldNum h={row.parsing.parsed.value.usable} format={count} where={`${where} · usable records`} returnTo={ASSIGNMENTS_PATH} />
            </p>
            {row.parsing.parsed.value.failures.length > 0 && (
              <ul className="plain">
                {row.parsing.parsed.value.failures.map((f) => (
                  <li key={f}>
                    <Said text={plainText(f)} />
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p>
            <GapNote gap={row.parsing.parsed.gap} where={`${where} · parsed`} returnTo={ASSIGNMENTS_PATH} />
          </p>
        )}
      </section>

      {/* 4 — VERIFIED, REJECTED, NEEDS MORE EVIDENCE */}
      <section className="card">
        <h2>4 · What passed verification, what was rejected, what needs more evidence</h2>
        {v.pipeline.held ? (
          <>
            <p className="plain">
              <Said text={v.pipeline.value.says} />
            </p>
            {v.pipeline.value.items > 0 && (
              <ul className="plain">
                <li>
                  Passed: <Num m={v.pipeline.value.passed} format={count} />
                </li>
                <li>
                  Needs more evidence: <Num m={v.pipeline.value.needsMoreEvidence} format={count} />
                </li>
                <li>
                  Rejected on quality: <Num m={v.pipeline.value.rejected} format={count} />
                </li>
              </ul>
            )}
            {v.pipeline.value.furthest !== null && v.pipeline.value.items > 0 && (
              <ol className="stage-strip" aria-label="Furthest pipeline stage reached">
                {PIPELINE_STAGES.map((stage) => {
                  const n = v.pipeline.held && v.pipeline.value.furthest !== null ? v.pipeline.value.furthest[stage] : 0;
                  return (
                    <li key={stage} className={`stage stage-${n > 0 ? "ok" : "unknown"}`}>
                      <i className="stage-mark" aria-hidden="true" /> {plainCode(stage)}: {count(n)}
                    </li>
                  );
                })}
              </ol>
            )}
            {v.pipeline.value.rejections.length > 0 && (
              <ul className="plain">
                {v.pipeline.value.rejections.map((r, i) => (
                  <li key={`${r.itemId}-${r.code}-${i}`}>
                    <strong>{r.guard ? "A duplicate or out-of-order write was refused" : "Rejected"}</strong> at {plainCode(r.stage)} — {plainCode(r.code)}: <Said text={r.says} />{" "}
                    <code>{r.itemId}</code>
                  </li>
                ))}
              </ul>
            )}
            {v.pipeline.value.moreRejections > 0 && <p className="note">{count(v.pipeline.value.moreRejections)} more refusal(s) are not listed here.</p>}
            {v.pipeline.value.itemIds.length > 0 && (
              <p className="note">
                {v.pipeline.value.unit === "pipeline item" ? "Pipeline items" : "Checked version"}:{" "}
                {v.pipeline.value.itemIds.map((id, i) => (
                  <span key={id}>
                    {i > 0 ? ", " : ""}
                    <code>{id}</code>
                  </span>
                ))}
              </p>
            )}
          </>
        ) : (
          <p>
            <GapNote gap={v.pipeline.gap} where={`${where} · verification`} returnTo={ASSIGNMENTS_PATH} />
          </p>
        )}
        {v.checks.length > 0 && (
          <>
            <h3>Independent checks</h3>
            <ul className="plain">
              {v.checks.map((ck) => (
                <li key={`${ck.resultId}-${ck.at}`}>
                  {ck.who}: <strong>{plainCode(ck.verdict)}</strong> <When iso={ck.at} /> — <Said text={plainText(ck.says)} /> <code>{ck.resultId}</code>
                </li>
              ))}
            </ul>
            {v.moreChecks > 0 && <p className="note">{count(v.moreChecks)} more check(s) are not listed here.</p>}
          </>
        )}
        {v.refusedFinishCount > 0 && (
          <>
            <h3>Hunter finishes the executor refused — {count(v.refusedFinishCount)}</h3>
            <ul className="plain">
              {v.refusedFinishes.map((r) => (
                <li key={r.attemptId}>
                  <code>{r.attemptId}</code>: {r.codes.map(plainCode).join(", ")} — <Said text={plainText(r.says)} />
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {/* 5 — PROMOTED VERSUS PUBLICLY AVAILABLE */}
      <section className="card">
        <h2>5 · What was promoted, and what is confirmed publicly available</h2>
        <ul className="plain">
          {dv.approved !== null && (
            <li>
              Approved for promotion: <HeldNum h={dv.approved} format={count} where={`${where} · approved`} returnTo={ASSIGNMENTS_PATH} />
            </li>
          )}
          <li>
            Promoted:{" "}
            {dv.promoted.held ? (
              <Said text={dv.promoted.value.says} />
            ) : (
              <GapNote gap={dv.promoted.gap} where={`${where} · promoted`} returnTo={ASSIGNMENTS_PATH} />
            )}
          </li>
          <li>
            Publicly available:{" "}
            {dv.publiclyAvailable.held ? (
              <>
                <Said text={dv.publiclyAvailable.value.says} />
                {dv.publiclyAvailable.value.proof !== null ? <div className="note">{dv.publiclyAvailable.value.proof}</div> : null}
              </>
            ) : (
              <GapNote gap={dv.publiclyAvailable.gap} where={`${where} · publicly available`} returnTo={ASSIGNMENTS_PATH} />
            )}
          </li>
        </ul>
        {dv.blockers.length > 0 && (
          <ul className="note">
            {dv.blockers.map((b) => (
              <li key={b}>
                <Said text={b} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 6 — COST */}
      <section className="card">
        <h2>6 · What it cost — every retry included; unknown is never shown as $0</h2>
        <p className="plain">
          {c.dollars.kind === "MEASURED" ? (
            <>
              Measured: <HeldNum h={c.dollars.usd} format={usdCents} where={`${where} · cost`} returnTo={ASSIGNMENTS_PATH} />
            </>
          ) : c.dollars.kind === "UNMEASURED" ? (
            <GapNote gap={c.dollars.gap} where={`${where} · cost`} returnTo={ASSIGNMENTS_PATH} />
          ) : (
            <Said text={c.dollars.says} />
          )}
        </p>
        <p className="note">
          <Said text={c.says} />
        </p>
        <ul className="plain">
          <li>Escalations to you: {count(c.escalations.toOwner)}</li>
          <li>
            Model-routing escalations:{" "}
            {c.escalations.modelRouting === null ? (
              "none possible — this lane uses no model"
            ) : (
              <GapNote gap={c.escalations.modelRouting} where={`${where} · escalations`} returnTo={ASSIGNMENTS_PATH} />
            )}
          </li>
          <li>
            {c.nonDollar === null
              ? "Requests, bytes and time: not metered for this lane."
              : `Requests ${count(c.nonDollar.requests)}, ${bytesText(c.nonDollar.bytes)} fetched, ${durationText(c.nonDollar.durationMs)} of work.`}
          </li>
        </ul>
      </section>

      {/* 7 — WHAT IS WAITING */}
      <section className="card">
        <h2>7 · What is waiting</h2>
        <NeedsYouLine needs={w.owner === "OWNER" ? { needed: true, action: plainText(w.nextAction) } : { needed: false }} />
        <ul className="plain">
          <li>
            {w.waiting ? (
              <>
                Waiting <AgeWords since={w.since} nowIso={nowIso} />
                {w.overdue === true ? <span className="state-amber"> — eligible for dispatch now and not yet dispatched</span> : null}
              </>
            ) : (
              "Nothing is waiting."
            )}
          </li>
          <li>
            <strong>Blocker:</strong>{" "}
            {w.blocker.kind === "UNKNOWN" ? (
              <GapNote gap={w.blocker.gap} where={`${where} · blocker`} returnTo={ASSIGNMENTS_PATH} />
            ) : (
              <Said text={plainText(w.blocker.says)} />
            )}
          </li>
          <li>
            <strong>Next step belongs to:</strong> {OWNER_WORDS[w.owner]}
          </li>
          <li>
            <strong>Next action:</strong> <Said text={plainText(w.nextAction)} />
          </li>
          {w.dueAt !== null || w.eligibleAt !== null ? (
            <li className="note">
              Stored next-due <When iso={w.dueAt} />; next eligible for dispatch <When iso={w.eligibleAt} />
              {w.retryAt !== null ? (
                <>
                  ; failure-backoff retry <When iso={w.retryAt} />
                </>
              ) : null}
            </li>
          ) : null}
          {w.backoff !== null && (
            <li className="note">
              {count(w.backoff.failures)} consecutive round{w.backoff.failures === 1 ? "" : "s"} without discharging the obligation, since <When iso={w.backoff.since} /> (a found route counts: it is progress, not a reading of the record).
            </li>
          )}
          {w.openRound !== null && (
            <li className="note">
              Round <code>{w.openRound.id}</code> opened <When iso={w.openRound.openedAt} />, {w.openRound.reached ? "reached by a worker" : "no worker has reached it yet"}.
            </li>
          )}
        </ul>
      </section>

      {/* EVIDENCE */}
      <section className="card">
        <h2>Evidence</h2>
        <ul className="plain">
          {e.obligationId !== null && (
            <li>
              Standing obligation: <code>{e.obligationId}</code>
            </li>
          )}
          <Ids label="Rounds" ids={e.occurrenceIds} more={e.more.occurrences} />
          <Ids label="Work items" ids={e.workItemIds} more={e.more.workItems} />
          <Ids label="Route tasks" ids={e.routeTaskIds} more={e.more.routeTasks} />
          <Ids label="Attempts" ids={e.attemptIds} more={e.more.attempts} />
          <Ids label="Disposition commits" ids={e.dispositionCommitIds} more={e.more.dispositionCommits} />
          {e.otherIds.map((o) => (
            <li key={`${o.what}-${o.id}`}>
              {o.what}: <code>{o.id}</code>
            </li>
          ))}
        </ul>
        {e.notes.length > 0 && (
          <details className="raw-ids">
            <summary>The records&rsquo; own notes, verbatim — {count(e.notes.length)}</summary>
            <ul>
              {e.notes.map((n, i) => (
                <li key={`${n.from}-${i}`} className="note">
                  <strong>{n.from}</strong>
                  {n.at !== null ? (
                    <>
                      {" "}
                      (<When iso={n.at} />)
                    </>
                  ) : null}
                  : {n.text}
                </li>
              ))}
            </ul>
            {e.more.notes > 0 && <p className="note">{count(e.more.notes)} more note(s) are not listed here.</p>}
          </details>
        )}
      </section>
    </article>
  );
}
