/**
 * **ASSIGNMENTS — EVERY UNIT OF WORK, FOLLOWED END TO END.**
 * (Owner ask, 2026-09-22: connected, assignment-level operational visibility.)
 *
 * One view that follows each unit of work — a standing obligation's rounds, a
 * created work item's steps, a routine civic-data contract — from why it is
 * owed to whether a reader can see it, including the unhealthy and the
 * blocked. Seven parts per assignment: what/where/why/who; discovered versus
 * downloaded; parsed; verified; promoted versus publicly available; cost; and
 * what is waiting.
 *
 * ## Where each part comes from
 *
 * ```
 *   the list        the PUBLISHED owner snapshot (`assignments`), written by the
 *                   standing publisher from the whole control plane at one
 *                   instant: every count over every assignment, and a BOUNDED,
 *                   ordered list whose cut is stated on the page
 *   routine rows    `readRoutineDataObservability` — the Sources page's own
 *                   read of the production data plane, read live, projected by
 *                   `assignment-routine.ts`
 *   the drilldown   `?id=` — that ONE assignment's records, read live by
 *                   targeted reads (`readAssignmentSourcesById`), so any id
 *                   opens, including the ones the bounded list left out
 * ```
 *
 * The page audits itself before it renders: every number it draws carries a
 * denominator and a contract, and every stated N equals the rows it renders.
 * A failure replaces the numbers with a refusal, as the other console pages do.
 */
import { cookies } from "next/headers";

import { readRoutineDataObservability } from "@/lib/civic-data/observability-server.ts";
import { ADMIN_SESSION_COOKIE } from "@/lib/control-plane/admin-auth.ts";
import { openControlPlane, readSnapshot } from "@/lib/control-plane/admin-data.ts";
import { readAssignmentSourcesById } from "@/lib/control-plane/assignment-read.ts";
import { routineAssignmentRows, routineContractIdOf } from "@/lib/control-plane/assignment-routine.ts";
import {
  ASSIGNMENT_LANES,
  ASSIGNMENT_STATES,
  ASSIGNMENT_TEXT_CLIP,
  LANE_WORDS,
  STATE_WORDS,
  assignmentCountClaims,
  assignmentListRowNumbers,
  assignmentRenderedNumbers,
  assignmentRowNumbers,
  buildAssignments,
  combinedCountNumbers,
  combinedCounts,
  listRowOf,
  type AssignmentLane,
  type AssignmentListRow,
  type AssignmentRow,
  type AssignmentState,
  type AssignmentView,
} from "@/lib/control-plane/assignment-view.ts";
import { auditRenderedNumbers, checkStatedEqualsRendered, type CountClaim, type RenderedNumber } from "@/lib/control-plane/owner-surface.ts";
import { count } from "@/lib/control-plane/plain-words.ts";
import { US_STATES } from "@/lib/control-plane/readiness/catalog.ts";
import { PILOT_ZIPS } from "@/lib/health/owner-corpus-compile.ts";

import { ConsoleNav } from "../../console-nav.tsx";
import { QueueForm, Said, When } from "../../console-ui.tsx";
import { ASSIGNMENTS_PATH } from "./assignment-bits.tsx";
import { AssignmentDetail } from "./assignment-detail.tsx";
import { AssignmentFilters, AssignmentMeasures, AssignmentTable, LeftOut, type AssignmentFilter } from "./assignment-list.tsx";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Assignments",
  robots: { index: false, follow: false, nocache: true },
};

type Params = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function parseState(raw: string | null): AssignmentState | null {
  const up = (raw ?? "").toUpperCase();
  return (ASSIGNMENT_STATES as readonly string[]).includes(up) ? (up as AssignmentState) : null;
}

function parseLane(raw: string | null): AssignmentLane | null {
  const up = (raw ?? "").toUpperCase();
  return (ASSIGNMENT_LANES as readonly string[]).includes(up) ? (up as AssignmentLane) : null;
}

function matches(row: AssignmentListRow, filter: AssignmentFilter): boolean {
  return (
    (filter.state === null || row.state === filter.state) &&
    (filter.lane === null || row.lane === filter.lane) &&
    (!filter.overdue || row.waiting.overdue === true)
  );
}

function Refusal({ lines }: { lines: readonly string[] }) {
  return (
    <main className="admin console-page">
      <ConsoleNav view="assignments" currentState={null} states={US_STATES} />
      <h1>Assignments</h1>
      <p className="refusal">
        <strong>This page refused to render its own numbers.</strong>
      </p>
      {lines.map((line) => (
        <p className="note" key={line}>
          {line}
        </p>
      ))}
    </main>
  );
}

type Drilldown =
  | { readonly kind: "NONE" }
  | { readonly kind: "ROW"; readonly row: AssignmentRow; readonly says: string }
  | { readonly kind: "PUBLISHED_ONLY"; readonly row: AssignmentListRow; readonly says: string }
  | { readonly kind: "NOT_FOUND"; readonly says: string };

export default async function AssignmentsPage({ searchParams }: { searchParams?: Promise<Params> }) {
  const params = (await searchParams) ?? {};
  const jar = await cookies();
  const hasSession = jar.has(ADMIN_SESSION_COOKIE);
  const nowIso = new Date().toISOString();
  const id = first(params.id);
  const filter: AssignmentFilter = {
    state: parseState(first(params.state)),
    lane: parseLane(first(params.lane)),
    overdue: first(params.overdue) === "1",
  };

  const opened = await openControlPlane();
  const snapshotOut = opened.ok ? await readSnapshot(opened.repos) : null;
  const publication = snapshotOut?.kind === "HELD" ? snapshotOut.value.assignments : undefined;
  const view: AssignmentView | null = publication?.kind === "BUILT" ? publication.view : null;

  /* The routine lane, through the Sources page's own read of the production data plane. */
  const routineRead = await readRoutineDataObservability({ now: nowIso });
  const routineFull: AssignmentRow[] = routineRead.kind === "HELD" ? routineAssignmentRows(routineRead.value, nowIso) : [];
  const routineRows: AssignmentListRow[] = routineFull.map((r) => listRowOf(r, ASSIGNMENT_TEXT_CLIP));

  /* The drilldown: one assignment's full chain, read live by id. */
  let drilldown: Drilldown = { kind: "NONE" };
  if (id !== null) {
    const contractId = routineContractIdOf(id);
    if (contractId !== null) {
      const row = routineFull.find((r) => r.id === id);
      drilldown = row
        ? { kind: "ROW", row, says: `read live from the production data plane at ${nowIso}` }
        : {
            kind: "NOT_FOUND",
            says:
              routineRead.kind === "HELD"
                ? `No routine contract has the id ${contractId}.`
                : `The routine civic-data plane could not be read (${routineRead.detail}), so this contract could not be opened.`,
          };
    } else if (!opened.ok) {
      const published = view?.rows.find((r) => r.id === id) ?? null;
      drilldown = published
        ? { kind: "PUBLISHED_ONLY", row: published, says: `The full chain could not be read live: ${opened.detail}` }
        : { kind: "NOT_FOUND", says: `The control plane could not be opened, so ${id} could not be read: ${opened.detail}` };
    } else {
      const read = await readAssignmentSourcesById(opened.repos, id, {
        nowIso,
        activation: view?.activation ?? null,
        pilotZips: PILOT_ZIPS,
      });
      const attributed = view && view.summary.costs.attributed.held ? view.summary.costs.attributed.value.value : null;
      if (read.kind === "HELD") {
        const row = buildAssignments(read.value, { costDenominatorUsd: attributed }).find((r) => r.id === id) ?? null;
        drilldown = row
          ? { kind: "ROW", row, says: `read live from the control plane at ${nowIso}` }
          : { kind: "NOT_FOUND", says: `The records for ${id} were read and no assignment with that id is among them.` };
      } else {
        const published = view?.rows.find((r) => r.id === id) ?? null;
        drilldown =
          published !== null
            ? { kind: "PUBLISHED_ONLY", row: published, says: `The full chain could not be read live: ${read.detail}` }
            : { kind: "NOT_FOUND", says: read.detail };
      }
    }
  }

  /* The list: the published rows and the routine rows, filtered by the URL. */
  const listed = [...(view?.rows ?? []), ...routineRows];
  const shown = listed.filter((r) => matches(r, filter));
  const counts = combinedCounts(view, routineRows);

  /* ---------------- THE PAGE'S AUDIT OF ITSELF ---------------- */
  const numbers: RenderedNumber[] = [];
  const claims: CountClaim[] = [];
  if (drilldown.kind === "ROW") numbers.push(...assignmentRowNumbers(drilldown.row));
  if (drilldown.kind === "PUBLISHED_ONLY") numbers.push(...assignmentListRowNumbers(drilldown.row));
  if (drilldown.kind === "NONE") {
    if (view) {
      numbers.push(...assignmentRenderedNumbers(view, shown.filter((r) => r.kind !== "ROUTINE_CONTRACT")));
      claims.push(...assignmentCountClaims(view));
    }
    numbers.push(...combinedCountNumbers(counts));
    for (const r of shown.filter((x) => x.kind === "ROUTINE_CONTRACT")) numbers.push(...assignmentListRowNumbers(r));
    // Stated from the group counts and the routine read; rendered from the filtered rows.
    const statedPublished = view
      ? view.summary.groups
          .filter((g) => (filter.state === null || g.state === filter.state) && (filter.lane === null || g.lane === filter.lane))
          .reduce((n, g) => n + g.published, 0)
      : 0;
    const statedRoutine = routineRows.filter((r) => (filter.state === null || r.state === filter.state) && (filter.lane === null || r.lane === filter.lane)).length;
    if (!filter.overdue) {
      claims.push({ label: "assignment rows shown for this filter", stated: statedPublished + statedRoutine, rendered: shown.length });
    }
    numbers.push({
      label: "assignments listed for this filter",
      value: shown.length,
      denominator: counts.total,
      contract: "listed rows matching this filter, of every assignment counted on this page; the list is bounded and the rest open by id",
    });
  }
  const numberAudit = auditRenderedNumbers(numbers);
  const countAudit = checkStatedEqualsRendered(claims);
  if (!numberAudit.ok || !countAudit.ok) {
    return (
      <Refusal
        lines={[
          ...(numberAudit.ok ? [] : [numberAudit.detail]),
          ...(countAudit.ok ? [] : [countAudit.detail]),
          "A number without a denominator, or a headline that disagrees with the rows beneath it, is worse than a blank page: you would act on it.",
        ]}
      />
    );
  }

  const nav = <ConsoleNav view="assignments" currentState={null} states={US_STATES} />;

  if (drilldown.kind !== "NONE") {
    return (
      <main className="admin console-page">
        {nav}
        <QueueForm returnTo={ASSIGNMENTS_PATH} />
        {drilldown.kind === "ROW" ? (
          <AssignmentDetail row={drilldown.row} nowIso={nowIso} readSays={drilldown.says} />
        ) : drilldown.kind === "PUBLISHED_ONLY" ? (
          <>
            <p className="note">
              <a href={ASSIGNMENTS_PATH}>All assignments</a>
            </p>
            <h1>Assignment</h1>
            <p className="refusal">
              <Said text={drilldown.says} />
            </p>
            <p className="note">
              The published list row is below, as of the last publish; the full chain opens when the control plane can be read.
            </p>
            <AssignmentTable rows={[drilldown.row]} nowIso={nowIso} />
          </>
        ) : (
          <>
            <p className="note">
              <a href={ASSIGNMENTS_PATH}>All assignments</a>
            </p>
            <h1>Assignment</h1>
            <p className="refusal">
              <Said text={drilldown.says} />
            </p>
          </>
        )}
        <hr />
        <p className="note audit-footer">
          {numberAudit.detail} Read at <When iso={nowIso} />.
          {hasSession ? "" : " No admin session cookie was present on this render."}
        </p>
      </main>
    );
  }

  const filterWords = [
    filter.state ? STATE_WORDS[filter.state].label.toLowerCase() : null,
    filter.lane ? LANE_WORDS[filter.lane].label.toLowerCase() : null,
    filter.overdue ? "overdue" : null,
  ].filter(Boolean);

  return (
    <main className="admin console-page">
      {nav}
      <QueueForm returnTo={ASSIGNMENTS_PATH} />
      <h1>Assignments — every unit of work, end to end</h1>
      <p className="plain">
        Each row is one unit of work the system owes: a standing clock (and its rounds), a piece of work created for one job, or a routine civic-data
        contract. Each says why it is owed, who worked it and on what model, what was found and downloaded, what was parsed and checked, whether it reached
        a reader, what it cost, and what it is waiting on. Open any row for its full chain and evidence.
      </p>
      <p className="note">
        {view ? (
          <>
            Control-plane assignments as published <When iso={view.builtAt} />
            {snapshotOut?.kind === "HELD" ? <> (snapshot from {snapshotOut.value.publisher})</> : null}.
          </>
        ) : null}{" "}
        {routineRead.kind === "HELD" ? (
          <>
            Routine contracts read live <When iso={nowIso} />, through the same read the Sources page makes.
          </>
        ) : (
          <>Routine contracts could not be read: {routineRead.detail}</>
        )}
      </p>
      {!opened.ok && (
        <p className="refusal">
          <strong>We could not ask the control plane.</strong> <Said text={opened.detail} />
        </p>
      )}
      {opened.ok && publication === undefined && (
        <p className="note gap">
          The assignment view is not on the published snapshot yet — it appears after the next publish. It is not an empty list.
        </p>
      )}
      {publication?.kind === "NOT_BUILT" && (
        <p className="refusal">
          <strong>The last publish could not build the assignment view.</strong> <Said text={publication.says} /> (at <When iso={publication.at} />)
        </p>
      )}

      <div className="controls-row">
        <form method="get" action={ASSIGNMENTS_PATH}>
          <label>
            Open an assignment by its id{" "}
            <input type="text" name="id" placeholder="freshness:…, wi-…, or routine:…" size={48} />
          </label>{" "}
          <button type="submit">Open</button>
        </form>
      </div>

      <AssignmentFilters counts={counts} filter={filter} />
      {view && <AssignmentMeasures view={view} />}

      <h2>
        {filterWords.length === 0 ? "Listed" : `Listed — ${filterWords.join(", ")}`}: {count(shown.length)}
      </h2>
      {shown.length === 0 ? (
        <p className="note">
          No listed assignment matches this filter. The counts above are over every assignment; the list carries a bounded set, and any assignment opens
          by its id.
        </p>
      ) : (
        <AssignmentTable rows={shown} nowIso={nowIso} />
      )}

      {view && <LeftOut view={view} />}

      {view && view.reads.length > 0 && (
        <details className="raw-ids">
          <summary>What the publisher read to build this</summary>
          <ul>
            {view.reads.map((r) => (
              <li key={r.what} className="note">
                <strong>{r.what}</strong> — {r.held ? "read" : "not read"}: {r.says}
              </li>
            ))}
            {view.activation !== null && (
              <li className="note">
                <strong>activation gate</strong> — <Said text={view.activation.reason} />
              </li>
            )}
          </ul>
        </details>
      )}

      <hr />
      <p className="note audit-footer">
        {numberAudit.detail} {countAudit.detail} Read at <When iso={nowIso} />.
        {hasSession ? "" : " No admin session cookie was present on this render."}
      </p>
    </main>
  );
}
