/**
 * **THE ASSIGNMENT LIST — every count, the bounded list, and what it left out.**
 *
 * Renders the published assignment view VERBATIM: the counts by state and by
 * lane (each a `Measured` the page audits), the filters as plain links (the
 * filter is a URL, so a view is shareable and reloadable), the list rows with
 * all seven parts in brief, and the table of what the bounded list did not
 * carry. The routine civic-data contracts are rows too, read live through the
 * Sources page's own read path. Every number drawn here is in the page's
 * `auditRenderedNumbers` list.
 */
import {
  LANE_WORDS,
  STATE_WORDS,
  groupMeasures,
  type AssignmentCounts,
  type AssignmentLane,
  type AssignmentListRow,
  type AssignmentState,
  type AssignmentView,
} from "@/lib/control-plane/assignment-view.ts";
import { count, plainText, usdCents } from "@/lib/control-plane/plain-words.ts";

import { GapNote, HeldNum, Num, Said, When } from "../../console-ui.tsx";
import { ASSIGNMENTS_PATH, AgeWords, AttemptWords, LaneChip, OwnerWord, StateWord, WorkersWords, assignmentHref } from "./assignment-bits.tsx";

export interface AssignmentFilter {
  readonly state: AssignmentState | null;
  readonly lane: AssignmentLane | null;
  readonly overdue: boolean;
}

function filterHref(next: AssignmentFilter): string {
  const q = new URLSearchParams();
  if (next.state) q.set("state", next.state.toLowerCase());
  if (next.lane) q.set("lane", next.lane.toLowerCase());
  if (next.overdue) q.set("overdue", "1");
  const s = q.toString();
  return s === "" ? ASSIGNMENTS_PATH : `${ASSIGNMENTS_PATH}?${s}`;
}

/** The counts by state and lane as filter tabs, each badge a count the page audits. */
export function AssignmentFilters({ counts, filter }: { counts: AssignmentCounts; filter: AssignmentFilter }) {
  return (
    <>
      <nav className="fleet-tabs" aria-label="Assignments by state">
        <a href={filterHref({ ...filter, state: null })} className={`fleet-tab-link${filter.state === null ? " fleet-tab-active" : ""}`}>
          Every state
        </a>
        {counts.byState.map(({ state: s, count: m }) => (
          <a
            key={s}
            href={filterHref({ ...filter, state: s })}
            className={`fleet-tab-link${filter.state === s ? " fleet-tab-active" : ""}`}
            aria-current={filter.state === s ? "page" : undefined}
            title={`${STATE_WORDS[s].means} (${m.value} of ${m.denominator})`}
          >
            {STATE_WORDS[s].label}
            <span className="fleet-tab-badge">{count(m.value)}</span>
          </a>
        ))}
      </nav>
      <nav className="fleet-tabs" aria-label="Assignments by lane">
        <a href={filterHref({ ...filter, lane: null })} className={`fleet-tab-link${filter.lane === null ? " fleet-tab-active" : ""}`}>
          Every lane
        </a>
        {counts.byLane.map(({ lane: l, count: m }) => (
          <a
            key={l}
            href={filterHref({ ...filter, lane: l })}
            className={`fleet-tab-link${filter.lane === l ? " fleet-tab-active" : ""}`}
            aria-current={filter.lane === l ? "page" : undefined}
            title={`${LANE_WORDS[l].means} (${m.value} of ${m.denominator})`}
          >
            {LANE_WORDS[l].label}
            <span className="fleet-tab-badge">{count(m.value)}</span>
          </a>
        ))}
        <a
          href={filterHref({ ...filter, overdue: !filter.overdue })}
          className={`fleet-tab-link${filter.overdue ? " fleet-tab-active" : ""}`}
          title="Only what is eligible for dispatch now and not yet dispatched"
        >
          {filter.overdue ? "Overdue only (on)" : "Overdue only"}
        </a>
      </nav>
    </>
  );
}

/** The whole-universe measures above the list: overdue, backoff, and where the money went. */
export function AssignmentMeasures({ view }: { view: AssignmentView }) {
  const s = view.summary;
  const c = s.costs;
  return (
    <section className="card">
      <h2>Across every control-plane assignment</h2>
      <ul className="plain">
        <li>
          Eligible for dispatch now and not yet dispatched (overdue):{" "}
          <HeldNum h={s.overdue} format={count} where="Assignments · overdue" returnTo={ASSIGNMENTS_PATH} />{" "}
          <span className="note">standing obligations whose next reading is due and whose failure backoff, if any, has elapsed</span>
        </li>
        <li>
          In failure backoff: <HeldNum h={s.inBackoff} format={count} where="Assignments · backoff" returnTo={ASSIGNMENTS_PATH} />{" "}
          <span className="note">standing obligations whose recent rounds did not discharge them, each waiting for its retry time</span>
        </li>
        <li>
          Measured spend joined to an assignment:{" "}
          <HeldNum h={c.attributed} format={usdCents} where="Assignments · attributed spend" returnTo={ASSIGNMENTS_PATH} />
        </li>
        <li>
          Shared cost, not any one assignment&rsquo;s:{" "}
          <HeldNum h={c.shared.usd} format={usdCents} where="Assignments · shared spend" returnTo={ASSIGNMENTS_PATH} />{" "}
          <span className="note">
            <Said text={c.shared.says} />
          </span>
        </li>
        <li>
          Spend that joins no assignment:{" "}
          <HeldNum h={c.unattributed.usd} format={usdCents} where="Assignments · unattributed spend" returnTo={ASSIGNMENTS_PATH} />{" "}
          <span className="note">
            <Said text={c.unattributed.says} />
          </span>
        </li>
        <li>
          Ledger rows from model work that reported no dollar figure — unknown, never zero:{" "}
          <HeldNum h={c.unmeasuredModelRows} format={count} where="Assignments · unmeasured model rows" returnTo={ASSIGNMENTS_PATH} />
        </li>
        {s.pipeline.held ? (
          <li>
            Promotion-pipeline items joined to an assignment: <Num m={s.pipeline.value.linked} format={count} />
          </li>
        ) : (
          <li>
            <GapNote gap={s.pipeline.gap} where="Assignments · pipeline" returnTo={ASSIGNMENTS_PATH} />
          </li>
        )}
      </ul>
    </section>
  );
}

function FoundCell({ row }: { row: AssignmentListRow }) {
  const d = row.discovered;
  const parts: string[] = [];
  if (d !== null) {
    if (d.routes > 0) parts.push(`${count(d.routes)} route${d.routes === 1 ? "" : "s"}`);
    if (d.records > 0) parts.push(`${count(d.records)} record finding${d.records === 1 ? "" : "s"}`);
    if (d.pointers > 0) parts.push(`${count(d.pointers)} pointer${d.pointers === 1 ? "" : "s"}`);
    if (d.sourceRows !== null) parts.push(`${count(d.sourceRows)} source row${d.sourceRows === 1 ? "" : "s"}`);
  }
  return (
    <>
      <div>{d === null ? <span className="gap">nothing has run</span> : parts.length === 0 ? "nothing found" : `found ${parts.join(", ")}`}</div>
      <div className="note">
        {row.downloaded === null ? (
          "nothing downloaded"
        ) : (
          <>
            complete downloads <Num m={row.downloaded} format={count} />
          </>
        )}
      </div>
    </>
  );
}

function ChecksCell({ row }: { row: AssignmentListRow }) {
  const v = row.verification;
  return (
    <>
      <div>
        {row.parsed === null ? (
          <span className="gap">
            {row.kind === "ROUTINE_CONTRACT" ? "how many parsed cannot be told — open it for why" : "no parse step has run"}
          </span>
        ) : (
          <>
            {count(row.parsed.succeeded)} parsed, {count(row.parsed.failed)} failed
            {row.parsed.usable ? (
              <>
                ; usable <Num m={row.parsed.usable} format={count} />
              </>
            ) : null}
          </>
        )}
      </div>
      <div className="note">
        {v === null
          ? "verification was not read"
          : v.items === 0
            ? "nothing offered for checks"
            : `${count(v.items)} ${v.unit}${v.items === 1 ? "" : "s"}: ${count(v.passed)} passed, ${count(v.needsMoreEvidence)} need more evidence, ${count(v.rejected)} rejected`}
        {v !== null && v.refusedFinishes > 0 ? `; ${count(v.refusedFinishes)} hunter finish${v.refusedFinishes === 1 ? "" : "es"} refused` : ""}
      </div>
      <div className="note">
        {row.promoted === "PROMOTED" ? "promoted" : row.promoted === "NOT_PROMOTED" ? "not promoted" : "promotion was not read"};{" "}
        {row.publiclyAvailable === "CONFIRMED"
          ? "confirmed on a reader page"
          : row.publiclyAvailable === "NO_READER_PAGE"
            ? "feeds no reader page"
            : "reader availability not observed"}
      </div>
    </>
  );
}

function CostCell({ row }: { row: AssignmentListRow }) {
  const c = row.cost;
  return (
    <>
      <div>
        {c.kind === "MEASURED" && c.usd !== null ? (
          <Num m={c.usd} format={usdCents} />
        ) : c.kind === "PLAIN_CODE" ? (
          <span className="free">plain code, no model charge</span>
        ) : c.kind === "NOTHING_RAN" ? (
          <span className="note">nothing ran</span>
        ) : (
          <span className="gap">unknown — not measured</span>
        )}
        {c.kind === "MEASURED" && c.unmeasured > 0 ? <span className="gap"> + {count(c.unmeasured)} unknown</span> : null}
      </div>
      <div className="note">
        <AttemptWords n={c.attempts} />
        {c.retries === null ? (
          c.attempts === null ? null : <span className="gap">, retries not counted</span>
        ) : c.retries > 0 ? (
          `, ${count(c.retries)} retr${c.retries === 1 ? "y" : "ies"}`
        ) : null}
      </div>
    </>
  );
}

function WaitingCell({ row, nowIso }: { row: AssignmentListRow; nowIso: string }) {
  const w = row.waiting;
  return (
    <>
      <div>
        {w.waiting ? (
          <>
            waiting <AgeWords since={w.since} nowIso={nowIso} />
            {w.overdue === true ? <span className="state-amber"> · overdue</span> : null}
          </>
        ) : (
          <span className="note">nothing waiting</span>
        )}
      </div>
      {w.blocker !== null && (
        <div className="note">
          <Said text={plainText(w.blocker)} />
        </div>
      )}
      <div className="note">
        Next: <OwnerWord owner={w.owner} /> — <Said text={plainText(w.nextAction)} />
      </div>
    </>
  );
}

/** The rows, seven parts in brief each; the title opens the full chain. */
export function AssignmentTable({ rows, nowIso }: { rows: readonly AssignmentListRow[]; nowIso: string }) {
  if (rows.length === 0) return null;
  return (
    <div className="scroll-x">
      <table className="cost">
        <thead>
          <tr>
            <th>1 · What, where, why</th>
            <th>State</th>
            <th>1 · Who</th>
            <th>2 · Found → downloaded</th>
            <th>3–5 · Parsed · checked · delivered</th>
            <th>6 · Cost</th>
            <th>7 · Waiting</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <a href={assignmentHref(row.id)}>
                  <strong>
                    <Said text={plainText(row.title)} />
                  </strong>
                </a>
                {row.subjectName !== null && <div className="note">{row.subjectName}</div>}
                <div className="note">
                  {row.where === null ? <span className="gap">no subject on record</span> : row.where}
                  {row.band !== null ? ` · reader-impact band ${row.band}` : ""}
                </div>
                <LaneChip lane={row.lane} />
              </td>
              <td>
                <StateWord state={row.state} />
                <div className="note">
                  <Said text={plainText(row.stateSays)} />
                </div>
                {row.lastActivityAt !== null && (
                  <div className="note">
                    last activity <When iso={row.lastActivityAt} />
                  </div>
                )}
              </td>
              <td>
                <WorkersWords workers={row.workers} />
              </td>
              <td>
                <FoundCell row={row} />
              </td>
              <td>
                <ChecksCell row={row} />
              </td>
              <td>
                <CostCell row={row} />
              </td>
              <td>
                <WaitingCell row={row} nowIso={nowIso} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** What the bounded list carries of each group, and what it left out — nothing silently truncated. */
export function LeftOut({ view }: { view: AssignmentView }) {
  return (
    <section>
      <h2>What the list carries, and what it leaves out</h2>
      <p className="note">
        <Said text={view.selection.rule} />{" "}
        {view.selection.trimmedForBytes > 0
          ? `${count(view.selection.trimmedForBytes)} more would have been listed and were left out to keep the published record under its size budget.`
          : "Nothing was left out for size."}
      </p>
      <div className="scroll-x">
        <table className="cost">
          <thead>
            <tr>
              <th>State</th>
              <th>Lane</th>
              <th className="n">Listed</th>
              <th className="n">Left out (each opens by id)</th>
            </tr>
          </thead>
          <tbody>
            {view.summary.groups.map((g) => {
              const m = groupMeasures(g);
              return (
                <tr key={`${g.state}|${g.lane}`}>
                  <td>
                    <StateWord state={g.state} />
                  </td>
                  <td>{LANE_WORDS[g.lane].label}</td>
                  <td className="n">
                    <Num m={m.listed} format={count} />
                  </td>
                  <td className="n">
                    <Num m={m.leftOut} format={count} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
