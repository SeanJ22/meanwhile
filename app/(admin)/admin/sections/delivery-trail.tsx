/**
 * **THE DELIVERY TRAIL SECTION (MW-053, MW-054).** Where every acquired record
 * stands on the way to a reader — acquired, validated, approved for promotion,
 * publicly available — with the refusals between the stages, the blockers that
 * hold each one, the trail's cost, and the promotion history.
 *
 * It renders the projection VERBATIM: every count is carried from
 * `buildDeliveryTrail` (audited on the page beside every other figure), a stage
 * with no producer reads its named gap rather than a zero, and an empty
 * promotion history says why it is empty rather than looking finished. It draws
 * no number the page's `auditRenderedNumbers` has not seen.
 */
import type { DeliveryTrailView } from "@/lib/control-plane/delivery-trail.ts";
import { count, usdCents } from "@/lib/control-plane/plain-words.ts";

import { HeldNum, When } from "../../console-ui.tsx";

export function DeliverySection({ view }: { view: DeliveryTrailView | null }) {
  if (view === null) {
    return (
      <section id="delivery-trail">
        <h2>Delivery trail</h2>
        <p className="note gap">
          The delivery trail is not on this snapshot yet &mdash; republish to fill it. It is not zero.
        </p>
      </section>
    );
  }
  return (
    <section id="delivery-trail">
      <h2>Delivery trail</h2>
      <p className="plain">
        Where every acquired record stands on the way to a reader. {count(view.items)} record
        {view.items === 1 ? "" : "s"} in the promotion pipeline; each count below is &ldquo;reached this stage or
        beyond&rdquo;, out of that total.
      </p>
      <div className="scroll-x">
        <table className="cost">
          <thead>
            <tr>
              <th>Stage</th>
              <th className="n">Reached</th>
              <th>What that means</th>
            </tr>
          </thead>
          <tbody>
            {view.stages.map((s) => (
              <tr key={s.key}>
                <td>{s.label}</td>
                <td className="n">
                  <HeldNum h={s.reached} format={count} />
                </td>
                <td className="note">{s.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {view.betweenFailures.length > 0 && (
        <>
          <h3>Refusals between the stages</h3>
          <p className="note">
            Every refused stage transition, on the boundary it sits between and why. A refusal refuses one offered
            transition, never the record &mdash; the furthest accepted stage stands. A guard code (STAGE_ALREADY_REACHED,
            STAGE_OUT_OF_ORDER) is the pipeline refusing a duplicate or out-of-order write, not a record rejected on
            quality.
          </p>
          <ul className="plain">
            {view.betweenFailures.map((f) => (
              <li key={f.atStage}>
                <strong>{f.transition}</strong>: {count(f.refusals)} refused &mdash;{" "}
                {f.topReasons.map((r) => `${r.code} (${count(r.count)})`).join(", ")}
              </li>
            ))}
          </ul>
        </>
      )}

      {view.blockers.length > 0 && (
        <>
          <h3>What is holding the trail</h3>
          <ul className="plain">
            {view.blockers.map((b) => (
              <li key={b.what}>
                <strong>{b.what}:</strong> {b.says}
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="note">
        <strong>What the trail cost:</strong>{" "}
        {view.costs.measuredUsd === null
          ? "not measured on this snapshot."
          : `${usdCents(view.costs.measuredUsd)} measured across ${count(view.costs.attemptsMeasured)} attempt${view.costs.attemptsMeasured === 1 ? "" : "s"}.`}{" "}
        Cost per verified record: <HeldNum h={view.costs.costPerVerifiedRecord} format={usdCents} />.
      </p>

      <h3>Promotion history</h3>
      {view.promotions.length === 0 ? (
        <p className="note gap">
          No record has been promoted to a reader yet. {view.servedReader.says}
        </p>
      ) : (
        <div className="scroll-x">
          <table className="cost">
            <thead>
              <tr>
                <th>Record</th>
                <th>Class</th>
                <th>Promoted</th>
                <th>Version</th>
                <th>Public destination</th>
              </tr>
            </thead>
            <tbody>
              {view.promotions.map((p) => (
                <tr key={p.version}>
                  <td>{p.subjectId ?? "—"}</td>
                  <td>{p.recordClass}</td>
                  <td>
                    <When iso={p.promotedAt} />
                  </td>
                  <td>{p.version}</td>
                  <td className="note">
                    {p.destination}
                    {p.checkedAt ? (
                      <>
                        {" "}
                        (checked <When iso={p.checkedAt} />)
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
