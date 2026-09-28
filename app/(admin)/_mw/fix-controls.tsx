"use client";

/**
 * **THE FIX LIST'S CONTROLS.** (Admin redesign, 2026-09-23.)
 *
 * Two different acts, kept apart because they do different things:
 *
 * ```
 *   Must have / Later / Not now   order this list for you. Kept in this
 *                                 browser only, and the page says so: a mark
 *                                 is a sort order, not an instruction
 *   Add to the fix queue          the durable act: `queue.add` through the
 *                                 gateway, the same path every gap on the
 *                                 console takes into the tracker
 *   Go fix these                  sends everything queued: `decision.record`
 *                                 on the fix-queue row, quoting the state the
 *                                 page was drawn from
 * ```
 */
import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";

import { FIX_STATUS_TONE, orderByMarks, type FixItem, type FixMark } from "@/lib/control-plane/admin-view/fix-list.ts";

import s from "./mw.module.css";
import { actionReplyWords, postAdminAction, type AdminActionReply } from "./action-receipt.ts";

const MARKS_KEY = "mw-fix-marks-v1";
const MARK_WORDS: Readonly<Record<FixMark, string>> = { MUST: "Must have", LATER: "Later", NOT_NOW: "Not now" };
const TONE_CLASS: Readonly<Record<string, string>> = { gold: s.gold, amber: s.amber, cyan: s.cyan, teal: s.teal };

export interface QueueState {
  /** QUEUED, SENT, OPENED or REFUSED, in the owner's words, with when. */
  readonly words: string;
  readonly queued: boolean;
}

/*
 * The marks live in this browser's storage and are read through a tiny store:
 * the server and the first client render both see "no marks" (the defaults),
 * and the stored marks arrive as a snapshot after hydration — no state set
 * inside an effect, and no hydration mismatch. A mark made here is written,
 * then announced, so every subscriber re-reads it.
 */
const MARKS_EVENT = "mw-fix-marks";
let memoryMarks = "";

function rawMarks(): string {
  try {
    return window.localStorage.getItem(MARKS_KEY) ?? memoryMarks;
  } catch {
    /* Storage can be absent or refused: the marks last for this visit only. */
    return memoryMarks;
  }
}

function parseMarks(raw: string): Record<string, FixMark> {
  if (raw === "") return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") {
      return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter(([, v]) => v === "MUST" || v === "LATER" || v === "NOT_NOW")) as Record<string, FixMark>;
    }
  } catch {
    /* An unreadable stored value is no marks; the defaults stand. */
  }
  return {};
}

function writeMarks(marks: Record<string, FixMark>): void {
  memoryMarks = JSON.stringify(marks);
  try {
    window.localStorage.setItem(MARKS_KEY, memoryMarks);
  } catch {
    /* Not kept past this visit. */
  }
  window.dispatchEvent(new Event(MARKS_EVENT));
}

function subscribeMarks(onChange: () => void): () => void {
  window.addEventListener(MARKS_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(MARKS_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

async function postAction(body: Record<string, unknown>): Promise<{ ok: boolean; kind: AdminActionReply["kind"]; says: string }> {
  const reply = await postAdminAction(body);
  return { ok: reply.kind === "DONE", kind: reply.kind, says: actionReplyWords(reply) };
}

export function FixList(props: {
  readonly items: readonly FixItem[];
  readonly queue: Readonly<Record<string, QueueState>>;
  readonly fixField: Readonly<Record<string, string>>;
  readonly returnTo: string;
}) {
  const router = useRouter();
  const raw = useSyncExternalStore(subscribeMarks, rawMarks, () => "");
  const marks = useMemo(() => parseMarks(raw), [raw]);
  const [pending, startTransition] = useTransition();
  const [said, setSaid] = useState<Record<string, { ok: boolean; kind?: AdminActionReply["kind"]; says: string }>>({});

  const effective = useMemo(() => Object.fromEntries(props.items.map((i) => [i.id, marks[i.id] ?? i.defaultMark])) as Record<string, FixMark>, [marks, props.items]);
  const ordered = useMemo(() => orderByMarks(props.items, effective), [props.items, effective]);
  const counts = { MUST: 0, LATER: 0, NOT_NOW: 0 } as Record<FixMark, number>;
  for (const id of Object.keys(effective)) counts[effective[id]] += 1;

  function mark(id: string, m: FixMark) {
    writeMarks({ ...marks, [id]: m });
  }

  function queue(item: FixItem) {
    startTransition(async () => {
      const out = await postAction({
        type: "queue.add",
        subject: item.id,
        input: { fix: props.fixField[item.id] },
        idempotencyKey: `fix-list:${item.id}:${Date.now()}`,
        returnTo: props.returnTo,
      });
      setSaid((prev) => ({ ...prev, [item.id]: out }));
      if (out.ok) router.refresh();
    });
  }

  return (
    <>
      <div className={`${s.tally} ${s.gap24}`}>
        {(["MUST", "LATER", "NOT_NOW"] as const).map((m) => (
          <span key={m} className={s.tallyItem}>
            <span className={s.fig}>{counts[m]}</span> <span className={s.note}>marked {MARK_WORDS[m]}</span>
          </span>
        ))}
        <span className={`${s.note} ${s.pushRight}`}>
          The order below follows your marks: Must have first, then Later, then Not now.{" "}
          Marks are kept in this browser only — they order the list, they instruct no one.
        </span>
      </div>
      <div className={`${s.stack14} ${s.gap32}`}>
        {ordered.map((item) => {
          const q = props.queue[item.id] ?? null;
          const r = said[item.id] ?? null;
          const current = effective[item.id];
          return (
            <article key={item.id} className={`${s.card} ${s.cardList}`}>
              <div className={s.stack10}>
                <div className={s.row10}>
                  <span className={s.monoId}>{item.id}</span>
                  <h3 className={s.titleStrong16}>{item.title}</h3>
                  <span className={s.pushRight}>
                    <span className={`${s.pill} ${TONE_CLASS[FIX_STATUS_TONE[item.status]] ?? ""}`}>{item.status}</span>
                  </span>
                </div>
                <p className={s.body}>{item.body}</p>
                <p className={s.text14}>
                  <span className={s.strong}>Where it stands: </span>
                  {item.standing}
                </p>
                <p className={`${s.text14} ${s.cLink}`}>
                  <span className={s.strong}>Check first: </span>
                  {item.checkFirst}
                </p>
                <div className={s.row10}>
                  {(["MUST", "LATER", "NOT_NOW"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={`${s.btnToggle} ${current === m ? s.btnToggleOn : ""}`}
                      aria-pressed={current === m}
                      onClick={() => mark(item.id, m)}
                    >
                      {MARK_WORDS[m]}
                    </button>
                  ))}
                  <span className={s.pushRight}>
                    {q?.queued ? (
                      <span className={s.pending}>{q.words}</span>
                    ) : item.status === "IN PLACE" ? (
                      <span className={s.pending}>Nothing to queue — in place</span>
                    ) : (
                      <button type="button" className={s.btnSecondary} disabled={pending} onClick={() => queue(item)}>
                        Add to the fix queue
                      </button>
                    )}
                  </span>
                </div>
                {r && <span className={r.ok ? s.cTeal : s.refusal}>{r.says}</span>}
                <span className={s.monoSmall}>{item.provenance}</span>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}

/** "Go fix these": the owner's dispatch of everything queued, recorded against the state the page was drawn from. */
export function GoFix(props: {
  readonly queued: number;
  readonly subjectId: string;
  readonly option: string;
  readonly renderedRevision: string;
  readonly returnTo: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [said, setSaid] = useState<{ ok: boolean; says: string } | null>(null);

  function send() {
    startTransition(async () => {
      try {
        const live = await fetch("/api/admin/live", { headers: { accept: "application/json" }, cache: "no-store" });
        const pulse = (await live.json().catch(() => null)) as { revision?: string } | null;
        const current = pulse?.revision ?? null;
        if (!live.ok || current === null || current === "unread") {
          setSaid({ ok: false, says: "The console could not read the current state, so nothing was sent. Try again in a moment." });
          return;
        }
        const listPart = (rev: string) => rev.split("|").slice(1, 3).join("|");
        if (listPart(current) !== listPart(props.renderedRevision)) {
          setSaid({ ok: false, says: "The queue changed after this page was drawn, so nothing was sent. Reload the page and send it again." });
          return;
        }
        const out = await postAction({
          type: "decision.record",
          subject: props.subjectId,
          input: {
            subjectId: props.subjectId,
            chosenOption: props.option,
            consequenceShown: `${props.queued} queued gap(s) sent for a session to fix`,
            ownerAnswer: null,
          },
          idempotencyKey: `fix-queue-go:${props.queued}:${Date.now()}`,
          stateVersion: current,
          returnTo: props.returnTo,
        });
        setSaid(out);
        if (out.ok) router.refresh();
      } catch (e) {
        setSaid({ ok: false, says: e instanceof Error ? `Nothing was sent: ${e.message}` : "Nothing was sent." });
      }
    });
  }

  return (
    <div className={s.stack8}>
      <div className={s.row10}>
        <button type="button" className={s.btnPrimary} disabled={pending || props.queued === 0} onClick={send}>
          {pending ? "Sending…" : props.option}
        </button>
        <span className={s.note}>
          {props.queued === 0 ? "Nothing waiting to send." : `Sends ${props.queued} queued item${props.queued === 1 ? "" : "s"}; the next decision sync opens one work row for each.`}
        </span>
      </div>
      {said && <span className={said.ok ? s.cTeal : s.refusal}>{said.says}</span>}
    </div>
  );
}
