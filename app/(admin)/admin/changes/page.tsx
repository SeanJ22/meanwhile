/**
 * **CHANGES — one plain line for each change any session has made, and where
 * it has got to.** (S11; rulings §0 test 5: Sean can see what is happening.)
 *
 * Building, on test, deploying, live. Each line links to the pull request. The
 * list is read from GitHub on the server (`lib/control-plane/changes/source.ts`)
 * and cached for a minute. When GitHub cannot be read the page says so and says
 * what fixes it; it never shows an empty list as "nothing changed".
 */
import {
  CHANGE_STATUSES,
  CHANGE_STATUS_MEANING,
  CHANGE_STATUS_WORDS,
  groupChanges,
  type ChangeRow,
} from "@/lib/control-plane/changes/model.ts";
import { readChanges } from "@/lib/control-plane/changes/source.ts";
import { US_STATES } from "@/lib/control-plane/readiness/catalog.ts";

import { ConsoleNav } from "../../console-nav.tsx";
import { When } from "../../console-ui.tsx";

/** The live list is the newest of a long history; the rest is on GitHub. */
const LIVE_SHOWN = 20;

export const dynamic = "force-dynamic";
export const revalidate = 0;

function Line({ row }: { readonly row: ChangeRow }) {
  return (
    <li className="change-line">
      <a href={row.url} rel="noreferrer" target="_blank">
        {row.line}
      </a>
      <span className="note">
        {" "}
        · {row.session ?? "no session named"} · {row.why} · <When iso={row.at} />
      </span>
    </li>
  );
}

export default async function ChangesPage() {
  const reading = await readChanges();
  return (
    <main className="admin console-page">
      <ConsoleNav view="changes" currentState={null} states={US_STATES} />
      <h1>Changes</h1>
      <p className="plain">One line for each change from any session, newest first, with where it has got to.</p>
      {reading.kind === "UNAVAILABLE" ? (
        <section className="card" aria-labelledby="changes-unavailable">
          <h2 id="changes-unavailable">The changes could not be read</h2>
          <p>{reading.reason}</p>
          {reading.fix ? <p className="note">{reading.fix}</p> : null}
          <p className="note">
            Nothing here means nothing changed. It means this page could not look. Checked <When iso={reading.observedAt} />.
          </p>
        </section>
      ) : (
        <>
          <p className="note">
            Read from GitHub <When iso={reading.observedAt} />
            {reading.liveSha ? `; the live site is running build ${reading.liveSha.slice(0, 7)}` : "; what the live site is running could not be read"}.
          </p>
          {(() => {
            const groups = groupChanges(reading.rows);
            return CHANGE_STATUSES.map((status) => (
              <section key={status} className="card" aria-labelledby={`changes-${status}`}>
                <h2 id={`changes-${status}`}>
                  {CHANGE_STATUS_WORDS[status]} <span className="note">({groups[status].length})</span>
                </h2>
                <p className="note">{CHANGE_STATUS_MEANING[status]}</p>
                {groups[status].length === 0 ? (
                  <p className="note">None right now.</p>
                ) : (
                  <ul>
                    {(status === "live" ? groups[status].slice(0, LIVE_SHOWN) : groups[status]).map((row) => (
                      <Line key={row.number} row={row} />
                    ))}
                  </ul>
                )}
              </section>
            ));
          })()}
        </>
      )}
    </main>
  );
}
