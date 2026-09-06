/**
 * **SOFTWARE RELEASE REVIEW — the owner reviews one exact staging build.**
 * (Admin Pass B, 2026-09-06.)
 *
 * Reachable only on `ADMIN_ORIGIN` with a valid session, both enforced
 * upstream in `middleware.ts` (`/admin` is an admin prefix). The page CONSUMES
 * Prompt 3's release manifest as observed — it never defines it — and shows:
 *
 *   - the exact staging SHA and deploy id the manifest names, and the exact
 *     production SHA and deploy id from production's own build endpoint, each
 *     with the moment it was observed and a copy control;
 *   - the five required review sections (law regardless of what the manifest
 *     enumerates), each keyed by (staging SHA, section): reviewable when the
 *     manifest exposes it, NOT_YET_REVIEWABLE with its controls disabled when
 *     it does not; manifest-only extras as non-gating sections;
 *   - the Raised State variant choice, AWAITING_OWNER_CHOICE until chosen;
 *   - the composite OWNER_APPROVED_FOR_PRODUCTION: its named conditions, and
 *     one explicit button that appears only when all of them hold;
 *   - MANIFEST_UNAVAILABLE with the last observed SHA and time, every write
 *     disabled, when staging cannot be read;
 *   - unrecognized manifest fields, raw, under a disclosure.
 *
 * No manifest string is rendered as markup. The only links that follow the
 * manifest are plain anchors to the staging review origin. Every write is an
 * append to the control plane's `software_release_reviews` log and nothing
 * else: no merge, no push, no GitHub, no Netlify, no git, no promotion.
 */
import { cookies } from "next/headers";

import { ADMIN_SESSION_COOKIE } from "@/lib/control-plane/admin-auth.ts";
import { openControlPlane } from "@/lib/control-plane/admin-data.ts";
import { US_STATES } from "@/lib/control-plane/readiness/catalog.ts";
import { RAISED_STATE_CHOICES, type SoftwareReleaseReviewRecord } from "@/lib/control-plane/software-release-review.ts";

import { ConsoleNav } from "../../console-nav.tsx";
import { When } from "../../console-ui.tsx";
import {
  MANIFEST_CACHE_SECONDS,
  MANIFEST_URL,
  RAISED_STATE_LABEL,
  RAISED_STATE_SECTION_ID,
  REVIEW_PAGE_URL,
  REVIEW_READY_STATUS,
  WRITE_ROUTE,
  shortSha,
} from "./contract.ts";
import { CopyButton } from "./copy-button.tsx";
import { readManifest, readProductionIdentity } from "./manifest-source.ts";
import { buildReviewModel, type ReviewModel, type SectionView } from "./review-model.ts";
import { noteObservation } from "./write.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** The notices the write route redirects back with — a closed list, rendered as sentences. */
const NOTICE: Record<string, string> = {
  RECORDED: "Recorded.",
  REFRESHED: "The manifest was fetched again.",
  STALE_SHA: "STALE_SHA — staging moved while you were reviewing; your decision was not recorded.",
  MANIFEST_UNAVAILABLE: "MANIFEST_UNAVAILABLE — a decision cannot be recorded against a SHA the Admin cannot currently see.",
  NOT_REVIEWABLE: "That section is not reviewable on this SHA; nothing was recorded.",
  RAISED_STATE_CHOICE_REQUIRED: "APPROVE on Raised State needs a variant chosen on this SHA first; nothing was recorded.",
  NOT_RECORDABLE: "OWNER_APPROVED_FOR_PRODUCTION is not recordable yet; the failing conditions are listed below.",
  ALREADY_RECORDED: "OWNER_APPROVED_FOR_PRODUCTION is already recorded for this SHA.",
  STORE_UNAVAILABLE: "The review store could not be written; nothing was recorded.",
  BAD_REQUEST: "The request was not understood; nothing was recorded.",
};

const DECISION_WORDS: Record<string, string> = {
  APPROVE: "Approved",
  NEEDS_CHANGES: "Needs changes",
  DISCARD: "Discarded",
  FEEDBACK_ONLY: "Feedback",
  RAISED_STATE_CHOICE: "Variant chosen",
  OWNER_APPROVED_FOR_PRODUCTION: "Owner approved for production",
  MANIFEST_OBSERVED: "Manifest observed",
};

const DECISION_CHIP: Record<string, string> = { APPROVE: "rr-approve", NEEDS_CHANGES: "rr-needs", DISCARD: "rr-discard" };

function Sha({ sha, raw, what }: { readonly sha: string | null; readonly raw: string | null; readonly what: string }) {
  if (sha) {
    return (
      <span className="rr-sha">
        <code>{sha}</code> <span className="note">({shortSha(sha)})</span> <CopyButton value={sha} what={what} />
      </span>
    );
  }
  return <span className="gap">{raw ? `not a full SHA: “${raw}”` : "not observed"}</span>;
}

function Row({ row }: { readonly row: SoftwareReleaseReviewRecord }) {
  return (
    <li>
      <strong>{DECISION_WORDS[row.decision] ?? row.decision}</strong>
      {row.raisedStateChoice ? ` · ${RAISED_STATE_LABEL[row.raisedStateChoice]}` : ""} · <When iso={row.createdAt} year /> · {row.actor}
      {row.feedback ? <div className="note">“{row.feedback}”</div> : null}
      {row.composedFrom ? <div className="note">composed from {row.composedFrom.length} row(s)</div> : null}
    </li>
  );
}

function SectionCard({ section, model }: { readonly section: SectionView; readonly model: ReviewModel }) {
  const writable = model.writesEnabled && section.availability === "REVIEWABLE";
  const why =
    !model.writesEnabled
      ? model.writesDisabledBecause
      : section.availability === "NOT_YET_REVIEWABLE"
        ? "NOT_YET_REVIEWABLE — the manifest has not exposed this section yet; its controls wait for staging"
        : section.availability === "MANIFEST_UNAVAILABLE"
          ? "MANIFEST_UNAVAILABLE"
          : null;
  const current = section.current;
  const sha = model.liveSha ?? "";
  return (
    <section className="card rr-section" aria-labelledby={`rr-${section.id}`}>
      <div className="rr-head">
        <h3 id={`rr-${section.id}`}>{section.name}</h3>
        <span className={`chip ${section.availability === "REVIEWABLE" ? "receipt-done" : "receipt-waiting"}`}>{section.availability}</span>
        <span className={`chip ${current.decision ? DECISION_CHIP[current.decision] : ""}`}>
          {current.decision ? DECISION_WORDS[current.decision] : "no decision on this SHA"}
        </span>
        {!section.required && <span className="chip">manifest-only · does not gate</span>}
      </div>
      <p className="note">
        {section.manifestSection ? (
          <>
            Manifest section <code>{section.manifestSection.id}</code> — “{section.manifestSection.name}”.{" "}
          </>
        ) : (
          "Not enumerated by the manifest. "
        )}
        <a href={section.link} rel="noreferrer">
          Open on the staging review page
        </a>
        {section.linkIsDeep ? " (the section link the manifest supplied)" : " (the review page; the manifest supplied no section link)"}.
        {current.at ? (
          <>
            {" "}
            Current decision recorded <When iso={current.at} year />.
          </>
        ) : null}
      </p>
      <form method="post" action={WRITE_ROUTE} className="rr-decide">
        <input type="hidden" name="stagingSha" value={sha} />
        <input type="hidden" name="section" value={section.id} />
        <label>
          Feedback (optional, up to 2,000 characters)
          <textarea name="feedback" maxLength={2000} disabled={!writable} />
        </label>
        <div className="rr-actions">
          {/* The pressed button names the decision; the route reads a `decision` field as DECIDE. */}
          <button type="submit" name="decision" value="APPROVE" className="primary" disabled={!writable} title={why ?? undefined}>
            Approve
          </button>
          <button type="submit" name="decision" value="NEEDS_CHANGES" disabled={!writable} title={why ?? undefined}>
            Needs changes
          </button>
          <button type="submit" name="decision" value="DISCARD" disabled={!writable} title={why ?? undefined}>
            Discard
          </button>
          <button type="submit" name="action" value="FEEDBACK" disabled={!writable} title={why ?? undefined}>
            Record feedback only
          </button>
        </div>
        {why && <p className="note">Controls disabled: {why}.</p>}
      </form>
      {section.history.length > 0 ? (
        <details className="rr-history">
          <summary>History on this SHA — {section.history.length}</summary>
          <ul>
            {section.history.map((row) => (
              <Row key={row.id} row={row} />
            ))}
          </ul>
        </details>
      ) : (
        <p className="note rr-history">No row on this SHA for this section.</p>
      )}
    </section>
  );
}

export default async function ReleaseReviewPage({ searchParams }: { searchParams: Promise<{ notice?: string; detail?: string }> }) {
  const { notice, detail } = await searchParams;
  const jar = await cookies();
  const hasSession = jar.has(ADMIN_SESSION_COOKIE);
  const nav = <ConsoleNav view="release-review" currentState={null} states={US_STATES} />;

  const [reading, production] = await Promise.all([readManifest(), readProductionIdentity()]);
  const nowIso = new Date().toISOString();

  let rows: readonly SoftwareReleaseReviewRecord[] = [];
  let store: ReviewModel["store"] = { ok: true };
  const opened = await openControlPlane();
  if (!opened.ok) {
    store = { ok: false, detail: opened.detail };
  } else {
    try {
      await noteObservation(opened.repos.softwareReleaseReviews, reading, nowIso);
      rows = await opened.repos.softwareReleaseReviews.readAll();
    } catch (error) {
      store = {
        ok: false,
        detail:
          `the software_release_reviews log could not be read (${error instanceof Error ? error.message : String(error)}); ` +
          "if the control plane has not been bootstrapped to schema v8 yet, the runner's next cycle creates the table",
      };
    }
  }

  const model = buildReviewModel({ reading, production, rows, store });
  const manifest = reading.kind === "OBSERVED" ? reading.manifest : null;
  // The status word the manifest carried, or a named gap when it carried neither field.
  const statusWord = model.status.prompt3Status ?? model.status.reviewState;
  const status = statusWord !== null ? statusWord : "status field absent";
  const composite = model.composite;
  const raisedSection = model.sections.find((s) => s.id === RAISED_STATE_SECTION_ID);
  const raisedWritable = model.writesEnabled && raisedSection?.availability === "REVIEWABLE";
  const raisedDisabledWhy = model.writesDisabledBecause !== null ? model.writesDisabledBecause : `Raised State is ${raisedSection?.availability ?? "absent"} on this SHA`;

  return (
    <main className="admin console-page">
      {nav}
      <h1>
        Software release review{" "}
        <span className={`rr-status ${model.status.reviewReady ? "state-green" : reading.kind === "OBSERVED" ? "state-amber" : "state-red"}`}>
          {reading.kind === "OBSERVED" ? status : "MANIFEST_UNAVAILABLE"}
        </span>
      </h1>
      <p className="plain">
        One exact staging build, reviewed section by section. Every decision below is keyed to the staging SHA shown at the moment you click; a
        new SHA starts with no decisions. This page reviews SOFTWARE — it never approves a civic fact, and recording a decision merges,
        deploys and promotes nothing.
      </p>
      {notice && (
        <p className={`note ${notice === "RECORDED" || notice === "REFRESHED" ? "state-green" : "state-amber"}`} role="status">
          {NOTICE[notice] ?? "Done."}
          {detail ? ` ${detail}` : ""}
        </p>
      )}

      {reading.kind === "UNAVAILABLE" && (
        <div className="refusal">
          <p>
            <strong>MANIFEST_UNAVAILABLE.</strong> {reading.reason}. Observed <When iso={reading.observedAt} />.
          </p>
          <p className="note">
            {model.lastObserved
              ? <>Last successfully observed staging SHA <code>{model.lastObserved.sha}</code> ({shortSha(model.lastObserved.sha)}) with status {model.lastObserved.prompt3Status ?? "unrecorded"}, <When iso={model.lastObserved.at} year />.</>
              : "No manifest has ever been observed by this Admin; there is no last-observed SHA."}{" "}
            Decision writes are disabled while the manifest cannot be read.
          </p>
        </div>
      )}

      <h2>Build identities</h2>
      <div className="rr-identity">
        <section className="card">
          <h3>Staging (test)</h3>
          <p>
            SHA: <Sha sha={manifest?.sha ?? null} raw={manifest?.shaRaw ?? null} what="staging SHA" />
          </p>
          <p>
            Deploy id: {manifest?.deployId ? <><code>{manifest.deployId}</code> <CopyButton value={manifest.deployId} what="staging deploy id" /></> : <span className="gap">not observed</span>}
          </p>
          <p className="note">
            {manifest ? (
              <>
                branch {manifest.branch ?? "unrecorded"} · context {manifest.context ?? "unrecorded"} · built {manifest.builtAt ? <When iso={manifest.builtAt} year /> : "unrecorded"} · reported{" "}
                {manifest.reportedAt ? <When iso={manifest.reportedAt} year /> : "unrecorded"}
              </>
            ) : (
              "no manifest observed"
            )}
            {" · "}observed <When iso={reading.observedAt} /> from <code>{MANIFEST_URL}</code>
          </p>
          <p className="note">
            prompt3Status <strong>{model.status.prompt3Status ?? "absent"}</strong> · reviewState <strong>{model.status.reviewState ?? "absent"}</strong> · staging boundary{" "}
            <strong>{manifest?.stagingBoundary ?? "absent"}</strong> · milestone <strong>{manifest?.milestone ?? "absent"}</strong>
            {manifest?.boundaryReason ? ` · boundary reason ${manifest.boundaryReason}` : ""}
          </p>
        </section>
        <section className="card">
          <h3>Production</h3>
          <p>
            SHA: <Sha sha={production?.sha ?? null} raw={production?.shaRaw ?? null} what="production SHA" />
          </p>
          <p>
            Deploy id: {production?.deployId ? <><code>{production.deployId}</code> <CopyButton value={production.deployId} what="production deploy id" /></> : <span className="gap">not observed</span>}
          </p>
          <p className="note">
            Source: {production ? production.source : <span className="gap">not read</span>} · branch {production?.branch ?? "unrecorded"} · context{" "}
            {production?.context ?? "unrecorded"} · observed {production ? <When iso={production.observedAt} /> : "never"}
            {production?.detail ? ` · ${production.detail}` : ""}
          </p>
        </section>
      </div>
      <form method="post" action={WRITE_ROUTE} className="rr-actions">
        <input type="hidden" name="action" value="REFRESH" />
        <button type="submit">Refresh manifest</button>
        <span className="note">A reading is reused for up to {MANIFEST_CACHE_SECONDS} seconds; this fetches it again now. Every decision write fetches it again regardless.</span>
      </form>

      <h2>Review sections on {model.liveSha ? shortSha(model.liveSha) : "no SHA"}</h2>
      <p className="note">
        Five sections are required regardless of what the manifest enumerates; a section the manifest has not exposed is NOT_YET_REVIEWABLE. A
        later decision supersedes an earlier one for gating and never deletes it. Prior SHAs are under History.
      </p>
      <div className="rr-sections">
        {model.sections.map((section) => (
          <SectionCard key={section.id} section={section} model={model} />
        ))}
      </div>

      <h3>Raised State variant</h3>
      <section className="card">
        <p>
          Status: <strong>{model.raisedState.status}</strong>
          {model.raisedState.choice ? (
            <>
              {" "}
              — {RAISED_STATE_LABEL[model.raisedState.choice]} chosen <When iso={model.raisedState.at} year />
            </>
          ) : null}
          {model.raisedState.manifestStatus ? <span className="note"> · the manifest says {model.raisedState.manifestStatus}</span> : null}
        </p>
        <p className="note">
          A recorded choice only; it selects and activates nothing in the reader. Prompt 3 and the owner act on it outside this Admin. APPROVE on the Raised
          State section is refused until a variant is chosen on this SHA.
        </p>
        <form method="post" action={WRITE_ROUTE}>
          <input type="hidden" name="action" value="RAISED_STATE_CHOICE" />
          <input type="hidden" name="stagingSha" value={model.liveSha ?? ""} />
          {RAISED_STATE_CHOICES.map((choice) => {
            const candidate = model.raisedState.candidates?.find((c) => c.id === choice) ?? null;
            return (
              <label key={choice}>
                <input type="radio" name="choice" value={choice} defaultChecked={model.raisedState.choice === choice} disabled={!raisedWritable} />{" "}
                {RAISED_STATE_LABEL[choice]}
                {candidate?.url ? (
                  <>
                    {" "}
                    · <a href={candidate.url} rel="noreferrer">open on staging</a>
                  </>
                ) : null}
              </label>
            );
          })}
          <div className="rr-actions">
            <button type="submit" className="primary" disabled={!raisedWritable} title={raisedWritable ? undefined : raisedDisabledWhy}>
              Record variant choice
            </button>
            {!raisedWritable && <span className="note">Disabled: {raisedDisabledWhy}.</span>}
          </div>
        </form>
      </section>

      {model.extras.length > 0 && (
        <>
          <h3>Manifest-only sections — {model.extras.length}</h3>
          <div className="rr-sections">
            {model.extras.map((section) => (
              <SectionCard key={section.id} section={section} model={model} />
            ))}
          </div>
        </>
      )}

      <h2>OWNER_APPROVED_FOR_PRODUCTION</h2>
      <section className="card">
        <p className="note">
          Recordable when, and only when, all five required sections carry a current APPROVE on one exact staging SHA, Raised State has a chosen variant
          on that SHA, and the manifest status for that SHA is {REVIEW_READY_STATUS} (keyed on {model.status.keyedOn ?? "prompt3Status"}). It is
          recorded only by the button below, never on the last approval. The record is the end of the line: it does not merge, push, call GitHub or
          Netlify, run git, promote, or notify.
        </p>
        <ul className="rr-conditions">
          {composite.conditions.map((c) => (
            <li key={c.name} className={c.ok ? "rr-ok" : "rr-fail"}>
              {c.ok ? "✓" : "✗"} {c.name} <span className="note">— {c.detail}</span>
            </li>
          ))}
        </ul>
        {composite.recorded ? (
          <p>
            <strong>Recorded</strong> <When iso={composite.recorded.createdAt} year /> by {composite.recorded.actor} on {shortSha(composite.recorded.stagingSha)}
            {composite.recorded.deployId ? ` (deploy ${composite.recorded.deployId})` : ""}, composed from {composite.recorded.composedFrom?.length ?? 0} row(s).
          </p>
        ) : (
          <form method="post" action={WRITE_ROUTE} className="rr-actions">
            <input type="hidden" name="action" value="RECORD_OWNER_APPROVAL" />
            <input type="hidden" name="stagingSha" value={model.liveSha ?? ""} />
            <button type="submit" className="primary" disabled={!composite.recordable} title={composite.recordable ? undefined : "not recordable until every condition above holds"}>
              Record OWNER_APPROVED_FOR_PRODUCTION for {model.liveSha ? shortSha(model.liveSha) : "this SHA"}
            </button>
            {!composite.recordable && <span className="note">Not recordable: {composite.conditions.filter((c) => !c.ok).length} condition(s) fail.</span>}
          </form>
        )}
      </section>

      <h2>History — other staging SHAs</h2>
      {model.history.length === 0 ? (
        <p className="note">No decision is recorded on any other staging SHA.</p>
      ) : (
        model.history.map((entry) => (
          <details key={entry.sha} className="ph-evidence">
            <summary>
              <code>{shortSha(entry.sha)}</code> — {entry.rows.length} row(s), newest <When iso={entry.rows[0]?.createdAt ?? null} year />
            </summary>
            <p className="note">
              Full SHA <code>{entry.sha}</code>. These decisions belong to that SHA and carry nothing forward.
            </p>
            <ul>
              {entry.rows.map((row) => (
                <Row key={row.id} row={row} />
              ))}
            </ul>
          </details>
        ))
      )}

      <h2>The manifest as observed</h2>
      <details className="ph-evidence">
        <summary>Unrecognized manifest fields — {manifest?.unknownFields.length ?? 0}</summary>
        {manifest && manifest.unknownFields.length > 0 ? (
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Value (raw JSON, as text)</th>
                </tr>
              </thead>
              <tbody>
                {manifest.unknownFields.map((f) => (
                  <tr key={f.key}>
                    <td>
                      <code>{f.key}</code>
                    </td>
                    <td>
                      <code>{f.value}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="note">Every top-level field the manifest carried is one this page models.</p>
        )}
      </details>
      <details className="ph-evidence">
        <summary>Manifest detail — contract, isolation, ownership</summary>
        {manifest ? (
          <>
            <p className="note">
              kind {manifest.kind ?? "absent"} · contract version {manifest.contractVersion ?? "absent"} · Prompt 4 may begin in a separate session:{" "}
              {manifest.prompt4MayBegin === null ? "absent" : String(manifest.prompt4MayBegin)}
            </p>
            <p className="note">
              Isolation:{" "}
              {manifest.isolation
                ? `application ${manifest.isolation.application ?? "absent"} · control plane ${manifest.isolation.controlPlane ?? "absent"} · production writes allowed ${manifest.isolation.productionWritesAllowed === null ? "absent" : String(manifest.isolation.productionWritesAllowed)}`
                : "absent"}
            </p>
            {manifest.ownership ? (
              <ul>
                {manifest.ownership.map((o) => (
                  <li key={o.owner} className="note">
                    <strong>{o.owner}</strong>: {o.items.join("; ")}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="note">Ownership: absent.</p>
            )}
            <p className="note">
              Staging review page: <a href={REVIEW_PAGE_URL} rel="noreferrer">{REVIEW_PAGE_URL}</a>
            </p>
          </>
        ) : (
          <p className="note">No manifest observed.</p>
        )}
      </details>

      <hr />
      <p className="note">
        Read at <When iso={nowIso} />. Store: {model.store.ok ? "software_release_reviews log read" : model.store.detail}. Rows on the live SHA:{" "}
        {model.liveSha ? rows.filter((r) => r.stagingSha === model.liveSha && r.decision !== "MANIFEST_OBSERVED").length : 0} of {rows.filter((r) => r.decision !== "MANIFEST_OBSERVED").length} decision rows in the log.
        {hasSession ? "" : " Session cookie absent — this render should not have been reached."}
      </p>
    </main>
  );
}
