"use client";

/**
 * **ASK THE CONSOLE, as a view of the command center.** (ADM-C7, the 9.6.26 Operator
 * Control Room brief; moved in from its own page on 2026-10-01 per rulings §0.)
 *
 * The list of controls it can ask for comes first, then the transcript. Every
 * answer comes from a typed query over the records.
 *
 * **THE CHAT, RENDERED IN THE FOUR LAYERS EVERY OTHER STATE ON THIS CONSOLE IS
 * RENDERED IN.** (ADM-C7, §9A.2.)
 *
 * A transcript is still a set of states, so each answer is a `StatusBlock`:
 * what this is, what happened, does it need you, what happens next, and the
 * instruments' own words one disclosure away. Machine constants — an authority
 * class, an outcome, a refusal — go through `Code`, which puts the words on the
 * face and the raw constant in the hover.
 *
 * ## No form, and no history
 *
 * Every control here is a `<button type="button">` with a handler. A `<form>`
 * inside phrasing content is repaired by the browser into a different tree, React
 * fails to hydrate, and the whole page loses its theme — measured on this console
 * on 2026-09-05. Nothing here touches the router or the history stack either.
 *
 * ## Confirming an action sends the QUESTION back, not the action
 *
 * The console re-derives the proposal from the same words and the same instant
 * and compares the key it computes against the token it issued. So a page that
 * had been tampered with cannot submit an action the console did not itself
 * decide to propose.
 */

import { useV6 } from "./context.tsx";
import { useCallback, useRef, useState } from "react";

import { Code, NeedsYouLine, StatusBlock } from "@/app/(admin)/status-ui.tsx";
import { formatEastern } from "@/lib/control-plane/eastern-time.ts";
import { count } from "@/lib/control-plane/plain-words.ts";
import { REFUSAL_WORDS } from "@/lib/control-plane/gateway/contract.ts";
import { everyQuestion } from "@/lib/control-plane/operator-chat/contract.ts";
import type { ChatAnswer, ChatResponse, ChatTurn } from "@/lib/control-plane/operator-chat/contract.ts";

import { CHAT_PAGE, CHAT_ROUTE, CHAT_TITLE } from "@/lib/control-plane/operator-chat/surface.ts";

interface Said {
  readonly id: number;
  readonly asked: string;
  /** The console's answer, or the sentence that came back instead of one. */
  readonly answered: ChatResponse | null;
  readonly refusedWith: string | null;
}

const ASKING = "Reading…";

/* ------------------------------------------------------------ one answer */

function Answer({ answer }: { answer: ChatAnswer }) {
  const [lead, ...rest] = answer.says;
  return (
    <StatusBlock
      what={<>You asked: {answer.understoodAs}</>}
      happened={lead}
      next={answer.readBackAt === null ? undefined : `Shown on ${answer.readBackAt}`}
      needsYou={answer.needsYou}
      detail={
        answer.detail.length === 0 ? undefined : (
          <ul className="chat-detail">
            {answer.detail.map((line) => (
              <li key={line}>
                <code>{line}</code>
              </li>
            ))}
          </ul>
        )
      }
    >
      {rest.map((line) => (
        <p className="chat-line" key={line}>
          {line}
        </p>
      ))}

      {answer.denominator.held ? (
        <p className="chat-denominator">
          <strong>{answer.denominator.value.says}</strong>
        </p>
      ) : (
        <p className="chat-denominator chat-gap">
          <strong>—</strong>
        </p>
      )}

      <ul className="chat-sources">
        {answer.sources.map((s) => (
          <li key={`${s.raw}${s.at ?? ""}`} title={s.raw}>
            {s.says}
            {s.at === null ? "" : ` — written ${formatEastern(s.at)}`}
          </li>
        ))}
      </ul>
    </StatusBlock>
  );
}

/* ---------------------------------------------------------------- a turn */

function Turn({
  turn,
  asked,
  at,
  onConfirm,
  busy,
}: {
  turn: ChatTurn;
  asked: string;
  at: string;
  onConfirm: (asked: string, token: string, proposedAt: string) => void;
  busy: boolean;
}) {
  if (turn.kind === "ANSWER") return <Answer answer={turn.answer} />;

  if (turn.kind === "PROHIBITED") {
    return (
      <StatusBlock
        what="Not done."
        happened={turn.says}
        needsYou={{ needed: false }}
      />
    );
  }

  if (turn.kind === "UNROUTED") {
    return (
      <StatusBlock
        what="Not recognised."
        happened={turn.says}
        needsYou={{ needed: false }}
      >
        <ul className="chat-suggestions">
          {turn.canAnswer.map((q) => (
            <li key={q}>{q}</li>
          ))}
        </ul>
      </StatusBlock>
    );
  }

  if (turn.kind === "REFUSED") {
    return (
      <StatusBlock
        what="Not done."
        happened={turn.says}
        needsYou={{ needed: false }}
        detail={turn.actionType === null ? undefined : <code>{turn.actionType}</code>}
      />
    );
  }

  if (turn.kind === "PROPOSED") {
    const { definition, request, confirmToken } = turn.proposal;
    return (
      <StatusBlock
        what={<>{definition.label} — proposed</>}
        happened={turn.proposal.willDo}
        needsYou={{ needed: true, action: "confirm it, or ignore it" }}
        detail={
          <ul className="chat-detail">
            <li>
              <code>{request.type}</code>
            </li>
            <li>
              <code>{request.subject}</code>
            </li>
            <li>
              <code>{request.idempotencyKey}</code>
            </li>
            {request.stateVersion !== null && (
              <li>
                <code>{request.stateVersion}</code>
              </li>
            )}
          </ul>
        }
      >
        <p className="chat-line">
          <strong>Authority:</strong> <Code raw={definition.authority} />
        </p>
        <p className="chat-line">
          <strong>{definition.subjectKind}:</strong> <span className="chat-subject">{request.subject}</span>
        </p>
        <button
          type="button"
          className="chat-confirm"
          disabled={busy}
          onClick={() => onConfirm(asked, confirmToken, at)}
        >
          Confirm — {definition.label}
        </button>
      </StatusBlock>
    );
  }

  const receipt = turn.outcome.receipt;
  return (
    <StatusBlock
      what={<>{receipt.label} — {turn.outcome.ok ? "done" : "not done"}</>}
      happened={receipt.says}
      next={receipt.readBackAt === null ? (turn.outcome.replayed ? "Already done" : undefined) : `Read back on ${receipt.readBackAt}`}
      needsYou={{ needed: false }}
      detail={
        <ul className="chat-detail">
          <li>
            <code>{receipt.receiptId}</code>
          </li>
          <li>
            <code>{receipt.type}</code>
          </li>
          <li>
            <code>{receipt.inputDigest}</code>
          </li>
          {receipt.codeSha !== null && (
            <li>
              <code>{receipt.codeSha}</code>
            </li>
          )}
        </ul>
      }
    >
      <p className="chat-line">
        <strong>Outcome:</strong> <Code raw={receipt.outcome} /> — started {formatEastern(receipt.startedAt)}
        {receipt.completedAt === null ? "" : `, finished ${formatEastern(receipt.completedAt)}`}
      </p>
      <p className="chat-line">
        <strong>Authority:</strong> <Code raw={receipt.authority} />
      </p>
      {receipt.refusal !== null && (
        <p className="chat-line chat-gap">{REFUSAL_WORDS[receipt.refusal]}</p>
      )}
      {receipt.openedWork.length > 0 && (
        <p className="chat-line">
          <strong>Opened {count(receipt.openedWork.length)}:</strong> {receipt.openedWork.map((w) => w.title).join("; ")}
        </p>
      )}
      {receipt.undo !== null && (
        <p className="chat-line">
          <strong>Undo:</strong> {receipt.undo}
        </p>
      )}
    </StatusBlock>
  );
}

/* ------------------------------------------------------------- the console */

function ChatConsole({ from, suggestions }: { from: string; suggestions: readonly string[] }) {
  const [said, setSaid] = useState<readonly Said[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const nextId = useRef(0);

  const ask = useCallback(
    async (text: string, confirm?: { token: string; proposedAt: string }) => {
      const asked = text.trim();
      if (asked === "" || busy) return;
      setBusy(true);
      const id = (nextId.current += 1);
      setSaid((prior) => [...prior, { id, asked, answered: null, refusedWith: null }]);
      try {
        const response = await fetch(CHAT_ROUTE, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            text: asked,
            from,
            confirmToken: confirm?.token,
            proposedAt: confirm?.proposedAt,
          }),
        });
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const sentence =
            body !== null && typeof body === "object" && typeof (body as { says?: unknown }).says === "string"
              ? (body as { says: string }).says
              : "No answer";
          setSaid((prior) => prior.map((s) => (s.id === id ? { ...s, refusedWith: sentence } : s)));
          return;
        }
        setSaid((prior) => prior.map((s) => (s.id === id ? { ...s, answered: body as ChatResponse } : s)));
      } catch {
        setSaid((prior) =>
          prior.map((s) =>
            s.id === id
              ? { ...s, refusedWith: "Not reached" }
              : s,
          ),
        );
      } finally {
        setBusy(false);
      }
    },
    [busy, from],
  );

  const onConfirm = useCallback(
    (asked: string, token: string, proposedAt: string) => {
      void ask(asked, { token, proposedAt });
    },
    [ask],
  );

  return (
    <div className="chat-console">
      <ol className="chat-transcript">
        {said.map((entry) => (
          <li className="chat-exchange" key={entry.id}>
            <p className="chat-asked">{entry.asked}</p>
            {entry.refusedWith !== null && (
              <div className="status-block">
                <p className="status-what">Not done.</p>
                <p className="status-happened">{entry.refusedWith}</p>
                <NeedsYouLine needs={{ needed: false }} />
              </div>
            )}
            {entry.answered === null && entry.refusedWith === null && <p className="chat-waiting">{ASKING}</p>}
            {entry.answered !== null && (
              <>
                {entry.answered.storeRefusedBecause !== null && (
                  <p className="chat-gap">—</p>
                )}
                <Turn
                  turn={entry.answered.turn}
                  asked={entry.answered.asked}
                  at={entry.answered.at}
                  onConfirm={onConfirm}
                  busy={busy}
                />
              </>
            )}
          </li>
        ))}
      </ol>

      {said.length === 0 && (
        <ul className="chat-suggestions">
          {suggestions.map((q) => (
            <li key={q}>
              <button type="button" className="chat-suggest" disabled={busy} onClick={() => void ask(q)}>
                {q}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="chat-composer">
        <label className="chat-label" htmlFor="chat-message">
          Ask
        </label>
        <textarea
          id="chat-message"
          className="chat-input"
          rows={2}
          value={draft}
          disabled={busy}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              const text = draft;
              setDraft("");
              void ask(text);
            }
          }}
        />
        <button
          type="button"
          className="chat-send"
          disabled={busy || draft.trim() === ""}
          onClick={() => {
            const text = draft;
            setDraft("");
            void ask(text);
          }}
        >
          Ask
        </button>
      </div>
    </div>
  );
}

/** The whole view: what it can ask for, then the transcript. */
export function ChatView({ controls }: { readonly controls: readonly string[] }) {
  const { scopeKey } = useV6();
  return (
    <div className="chat-page">
      <h1>{CHAT_TITLE}</h1>
      <section className="chat-controls">
        <h2>What it can ask for</h2>
        <ul>
          {controls.map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ul>
      </section>

      <ChatConsole from={`${CHAT_PAGE}?scope=${encodeURIComponent(scopeKey)}`} suggestions={everyQuestion()} />
    </div>
  );
}
