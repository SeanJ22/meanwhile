"use client";

/**
 * **EVERY BODY WE WATCH** — the design's body cards, each opening in place to
 * what is happening to it. One body open at a time, as the design behaves.
 * The views are built server-side by the pure model
 * (`lib/control-plane/admin-view/bodies.ts`); this island only opens and
 * closes them, so no number is computed in the browser.
 *
 * The page sends this island only the views it draws: the first few, or every
 * one once "show all" (or a link to a body past the first few) asks for them.
 * Every view it is sent travels in the page as data, and all 120 of them were
 * 689 KB of the 1.1 MB Fleet · Now page on 2026-09-25 while twelve were drawn.
 * "Show all" then asks the server for the rest (`showAllHref`); with every
 * view in hand it opens and closes in place, as before.
 */
import Link from "next/link";
import { useState } from "react";

import type { BodyView } from "@/lib/control-plane/admin-view/bodies.ts";

import s from "./mw.module.css";
import { Cells, DeadEnd, Pill } from "./ui.tsx";

const FMT = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
function when(iso: string): string {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? `${FMT.format(new Date(t))} ET` : "at no recorded time";
}

export function BodyList(props: {
  /** The views sent: the first `firstShown`, or every one of `total`. */
  readonly bodies: readonly BodyView[];
  /** How many bodies the list holds, sent or not. */
  readonly total: number;
  readonly stateNames: Readonly<Record<string, string>>;
  /** Where a body's routine work is followed on the assignment list. */
  readonly workHref: Readonly<Record<string, string>>;
  readonly firstShown: number;
  /** A body a link asked for (`?body=`): it opens, and the list shows it even past the first few. */
  readonly initiallyOpen?: string | null;
  /** The list was asked for whole (`?bodies=all`): it starts with every body shown. */
  readonly initiallyAll?: boolean;
  /** The page that sends every view, followed when "show all" is asked for and they were not all sent. */
  readonly showAllHref: string;
}) {
  const asked = props.initiallyOpen ?? null;
  const askedAt = asked === null ? -1 : props.bodies.findIndex((b) => b.id === asked);
  const [open, setOpen] = useState<string | null>(askedAt >= 0 ? asked : null);
  const [showAll, setShowAll] = useState(askedAt >= props.firstShown || props.initiallyAll === true);
  const everySent = props.bodies.length >= props.total;
  const shown = showAll ? props.bodies : props.bodies.slice(0, props.firstShown);
  return (
    <div className={s.stack14}>
      {shown.map((b) => {
        const isOpen = open === b.id;
        return (
          <div key={b.id} className={`${s.card} ${s.cardList}`} id={`body-${encodeURIComponent(b.id)}`}>
            <div className={s.row}>
              <Pill tone={b.statusTone}>{b.status}</Pill>
              <h3 className={`${s.h3} ${s.grow}`}>{b.name}</h3>
              <span className={s.mono}>{b.stateCode ? props.stateNames[b.stateCode] ?? b.stateCode.toUpperCase() : "State not recorded"}</span>
              <button type="button" className={s.btnLink} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : b.id)}>
                {isOpen ? "Close" : "Open"}
              </button>
            </div>
            <p className={s.body} style={{ margin: "10px 0 16px" }}>
              {b.summary}
            </p>
            <Cells cells={b.cells} />
            {isOpen && (
              <div className={s.divider}>
                <h4 className={s.h4}>What we are trying to find out here</h4>
                <div className={s.stack8} style={{ marginBottom: 24 }}>
                  {b.questions.map((q) => (
                    <div key={q.text} className={`${s.insetRow} ${s.insetRowCenter}`}>
                      <Pill tone={q.tone}>{q.pill}</Pill>
                      <span className={`${s.text14} ${s.grow}`}>{q.text}</span>
                      <span className={s.mono}>{q.detail}</span>
                    </div>
                  ))}
                </div>
                <div className={s.gridAuto300} style={{ gap: 24 }}>
                  <div>
                    <h4 className={s.h4}>Concurrent work lanes</h4>
                    <div className={s.stack8}>
                      {b.lanes.map((l) => (
                        <div key={l.name} className={s.insetBox}>
                          <div className={s.row10}>
                            <span className={s.name14}>{l.name}</span>
                            <Pill tone={l.tone}>{l.pill}</Pill>
                            <span className={`${s.monoSmall} ${s.pushRight}`}>{l.counts}</span>
                          </div>
                          <p className={s.note} style={{ marginTop: 8 }}>
                            {l.note}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h4 className={s.h4}>When we look, and what it costs</h4>
                    <div className={s.kvTight}>
                      {b.schedule.map(([k, v]) => (
                        <div key={k} className={s.contents}>
                          <span className={s.kvKey}>{k}</span>
                          <span>{v}</span>
                        </div>
                      ))}
                    </div>
                    <div className={s.stack10} style={{ marginTop: 16 }}>
                      {b.costs.map((c) => (
                        <div key={c.pill} className={s.insetBox}>
                          <div className={s.row10}>
                            <Pill tone={c.tone}>{c.pill}</Pill>
                            <span className={s.figAmount}>{c.amount}</span>
                          </div>
                          <p className={s.note} style={{ marginTop: 8 }}>
                            {c.note}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                {b.deadEnd && <DeadEnd d={b.deadEnd} />}
                <h4 className={`${s.h4} ${s.h4Top}`}>What happened here recently</h4>
                {b.activity.length === 0 ? (
                  <p className={s.note}>No read of this body is recorded in the last seven days.</p>
                ) : (
                  <div className={s.stack2}>
                    {b.activity.map((a) => (
                      <div key={`${a.at}-${a.what}`} className={s.activityRow}>
                        <span className={s.activityWhen}>{when(a.at)}</span>
                        <span className={`${s.text14} ${s.grow}`}>{a.what}</span>
                        <Pill tone={a.tone}>{a.pill}</Pill>
                        <span className={s.activityCost}>{a.cost}</span>
                      </div>
                    ))}
                  </div>
                )}
                <p className={`${s.note} ${s.noteTop}`}>{b.escalationNote}</p>
                <div className={s.actions}>
                  {b.contractIds.map((id, i) =>
                    props.workHref[id] ? (
                      <Link key={id} href={props.workHref[id]} className={i === 0 ? s.btnPrimary : s.btnSecondary}>
                        {b.contractIds.length === 1 ? "Follow this work" : `Follow source ${i + 1}`}
                      </Link>
                    ) : null,
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
      {props.total > props.firstShown &&
        (everySent ? (
          <button type="button" className={s.btnSecondary} style={{ alignSelf: "flex-start" }} onClick={() => setShowAll((v) => !v)}>
            {showAll ? `Show the first ${props.firstShown} only` : `Show all ${props.total} bodies`}
          </button>
        ) : (
          <Link href={props.showAllHref} scroll={false} className={s.btnSecondary} style={{ alignSelf: "flex-start" }}>
            {`Show all ${props.total} bodies`}
          </Link>
        ))}
    </div>
  );
}
