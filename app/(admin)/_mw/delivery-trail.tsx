/**
 * **PAID RESEARCH, FROM FINDING TO THE PUBLIC SITE.** (MW-053, MW-054; drawn
 * on Fleet · Work, 2026-09-23.)
 *
 * The fleet-wide trail the publisher builds over every item in the promotion
 * pipeline: how many items reached each stage, the refusals between stages
 * with their top reasons, what holds a stage at zero, and each promoted
 * record's full history. A stage with nothing in it, or public availability
 * with no served-reader producer, renders as its named gap — never a zero that
 * reads as measured non-delivery. Routine meeting reads are not in this trail:
 * they have their own chain, opened from each body.
 */
import type { DeliveryTrailView } from "@/lib/control-plane/delivery-trail.ts";
import { formatEastern } from "@/lib/control-plane/eastern-time.ts";

import { Dash, Pill, mw as s } from "./ui.tsx";

export function DeliveryTrailCard({ trail, note }: { readonly trail: DeliveryTrailView | null; readonly note: string | null }) {
  return (
    <section className={`${s.card} ${s.gap32}`} aria-labelledby="delivery-trail">
      <h2 id="delivery-trail" className={s.h2Card}>
        Paid research, from finding to the public site
      </h2>
      {trail === null ? (
        <p className={s.goldNote}>{note !== null ? note : "The published snapshot carries no delivery trail, so where paid research stands is not shown. It is not empty."}</p>
      ) : (
        <>
          <p className={s.lede}>
            Every item paid research has put into the promotion pipeline ({trail.items.toLocaleString("en-US")}), by the furthest stage it reached. Routine meeting
            reads are not here — they reach readers by their own chain, shown on each body.
          </p>
          <div className={`${s.gridAuto220} ${s.gap20}`}>
            {trail.stages.map((stage) => (
              <div key={stage.key} className={`${s.insetTile} ${s.stack6}`}>
                <span className={s.titleStrong14}>{stage.label}</span>
                {stage.reached.held ? (
                  <span className={s.fig}>
                    {stage.reached.value.value.toLocaleString("en-US")}
                    <span className={s.note}> of {stage.reached.value.denominator.toLocaleString("en-US")}</span>
                  </span>
                ) : (
                  <Dash>NOT MEASURED</Dash>
                )}
                <span className={s.note}>{stage.reached.held ? stage.note : stage.reached.gap.says}</span>
              </div>
            ))}
          </div>
          {trail.blockers.length > 0 && (
            <div className={`${s.stack8} ${s.gap20}`}>
              <span className={s.label}>What holds it</span>
              {trail.blockers.map((b) => (
                <div key={b.what} className={s.row10}>
                  <Pill tone="amber">BLOCKED</Pill>
                  <span className={s.text14}>
                    <span className={s.strong}>{b.what}: </span>
                    {b.says}
                  </span>
                </div>
              ))}
            </div>
          )}
          {trail.betweenFailures.length > 0 && (
            <div className={`${s.stack8} ${s.gap20}`}>
              <span className={s.label}>Refused between stages</span>
              {trail.betweenFailures.map((f) => (
                <p key={f.transition} className={s.text14}>
                  <span className={s.strong}>{f.transition}: </span>
                  {f.refusals.toLocaleString("en-US")} refused
                  {f.topReasons.length > 0 ? ` — most often ${f.topReasons.map((r) => `${r.code.toLowerCase().replace(/_/g, " ")} (${r.count})`).join(", ")}` : ""}.
                </p>
              ))}
            </div>
          )}
          <p className={`${s.text14} ${s.gap14}`}>
            <span className={s.strong}>Public availability: </span>
            {trail.servedReader.says}
          </p>
          {trail.promotions.length > 0 && (
            <div className={s.stack8}>
              <span className={s.label}>Records approved for promotion, with their history</span>
              {trail.promotions.map((p) => (
                <div key={`${p.version}-${p.subjectId ?? ""}`} className={s.insetRow}>
                  <div className={s.stack2}>
                    <span className={s.text14}>
                      {p.subjectId ?? p.recordClass} — approved for promotion {formatEastern(p.approvedAt ?? p.promotedAt ?? null)}, version {p.version}, to{" "}
                      {p.destination.startsWith("https://meanwhileusa.com/") ? <a href={p.destination} target="_blank" rel="noreferrer">Open public reader page</a> : p.destination}
                      {p.checkedAt ? `, checked ${formatEastern(p.checkedAt)}` : ", not yet checked on the public site"}.
                    </span>
                    <span className={s.text14}>
                      <span className={s.strong}>What changed: </span>
                      {p.changeSummary ?? "not recorded on this snapshot (it was published before the change summary existed)"}
                    </span>
                    <span className={s.monoSmall}>
                      Found {p.evidenceChain.scouted} · confirmed {p.evidenceChain.confirmed} · verified {p.evidenceChain.verified} · audited {p.evidenceChain.audited}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
