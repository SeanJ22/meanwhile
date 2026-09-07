"use client";

/**
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

import { useCallback, useRef, useState } from "react";

import { Code, NeedsYouLine, StatusBlock } from "@/app/(admin)/status-ui.tsx";
import { formatEastern } from "@/lib/control-plane/eastern-time.ts";
import { count } from "@/lib/control-plane/plain-words.ts";
import { REFUSAL_WORDS } from "@/lib/control-plane/gateway/contract.ts";
import { NO_CONTROLS_CONNECTED } from "@/lib/control-plane/operator-chat/contract.ts";
import type { ChatAnswer, ChatResponse, ChatTurn } from "@/lib/control-plane/operator-chat/contract.ts";

import { CHAT_ROUTE } from "./contract.ts";

interface Said {
  readonly id: number;
  readonly asked: string;
  /** The console's answer, or the sentence that came back instead of one. */
  readonly answered: ChatResponse | null;
  readonly refusedWith: string | null;
}

const ASKING = "Reading the records…";

/* ------------------------------------------------------------ one answer */

function Answer({ answer }: { answer: ChatAnswer }) {
  const [lead, ...rest] = answer.says;
  return (
    <StatusBlock
      what={<>You asked: {answer.understoodAs}</>}
      happened={lead}
      next={
        answer.readBackAt === null
          ? "Answered from the records themselves, without a model."
          : `Answered from the records themselves, without a model. The same thing is shown on ${answer.readBackAt}.`
      }
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
          <strong>{answer.denominator.value.says}.</strong> {answer.denominator.value.measured.contract}{" "}
          <span className="chat-denominator-source">Counted from {answer.denominator.value.measured.denominatorSource}.</span>
        </p>
      ) : (
        <p className="chat-denominator chat-gap">
          <strong>No number here.</strong> {answer.denominator.gap.says}
        </p>
      )}

      {answer.gaps.length > 0 && (
        <ul className="chat-gaps">
          {answer.gaps.map((gap) => (
            <li key={gap.says}>{gap.says}</li>
          ))}
        </ul>
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
        what="That is one of the things this console will not do."
        happened={turn.says}
        next="Ask it about the state of something instead, or use the control on the page that owns the thing you mean."
        needsYou={{ needed: false }}
      />
    );
  }

  if (turn.kind === "UNROUTED") {
    return (
      <StatusBlock
        what="The console did not recognise that question."
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
        what="Nothing was done."
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
        what={<>{definition.label} — proposed, and not done.</>}
        happened={turn.proposal.willDo}
        next="Nothing happens until you confirm it. Confirming submits it through the same control the buttons use, and you get the same receipt."
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
          <strong>It will not:</strong> {turn.proposal.willNotDo}
        </p>
        <p className="chat-line">
          <strong>Authority:</strong> <Code raw={definition.authority} withMeaning />
        </p>
        <p className="chat-line">
          It acts on one {definition.subjectKind}: <span className="chat-subject">{request.subject}</span>
        </p>
        <p className="chat-line chat-refusals">
          If it cannot be done, the reasons it can give are:{" "}
          {definition.refusals.map((r) => REFUSAL_WORDS[r]).join(" ")}
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
      what={<>{receipt.label} — {turn.outcome.ok ? "done" : "not done"}.</>}
      happened={receipt.says}
      next={
        receipt.readBackAt === null
          ? turn.outcome.replayed
            ? "This had already been done, so nothing was done a second time; the original receipt is above."
            : "Nothing further is scheduled by this console."
          : `The result can be read back on ${receipt.readBackAt}.`
      }
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
        {receipt.completedAt === null ? "" : `, finished ${formatEastern(receipt.completedAt)}`}.
      </p>
      <p className="chat-line">
        <strong>Authority:</strong> <Code raw={receipt.authority} withMeaning />
      </p>
      {receipt.refusal !== null && (
        <p className="chat-line chat-gap">{REFUSAL_WORDS[receipt.refusal]}</p>
      )}
      {receipt.openedWork.length > 0 && (
        <p className="chat-line">
          It opened {count(receipt.openedWork.length)} piece{receipt.openedWork.length === 1 ? "" : "s"} of work:{" "}
          {receipt.openedWork.map((w) => w.title).join("; ")}.
        </p>
      )}
      {receipt.undo !== null && (
        <p className="chat-line">
          <strong>To undo it:</strong> {receipt.undo}
        </p>
      )}
    </StatusBlock>
  );
}

/* ------------------------------------------------------------- the console */

export function ChatConsole({ from, suggestions }: { from: string; suggestions: readonly string[] }) {
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
              : "The console did not answer, and did not say why.";
          setSaid((prior) => prior.map((s) => (s.id === id ? { ...s, refusedWith: sentence } : s)));
          return;
        }
        setSaid((prior) => prior.map((s) => (s.id === id ? { ...s, answered: body as ChatResponse } : s)));
      } catch {
        setSaid((prior) =>
          prior.map((s) =>
            s.id === id
              ? { ...s, refusedWith: "The console could not be reached, so nothing was read or done." }
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
                <p className="status-what">Nothing was read or done.</p>
                <p className="status-happened">{entry.refusedWith}</p>
                <NeedsYouLine needs={{ needed: false }} />
              </div>
            )}
            {entry.answered === null && entry.refusedWith === null && <p className="chat-waiting">{ASKING}</p>}
            {entry.answered !== null && (
              <>
                {entry.answered.storeRefusedBecause !== null && (
                  <p className="chat-gap">{entry.answered.storeRefusedBecause}</p>
                )}
                {!entry.answered.controlsConnected && <p className="chat-gap">{NO_CONTROLS_CONNECTED}</p>}
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
          Ask about the state of something
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
