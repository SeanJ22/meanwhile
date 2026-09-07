/**
 * **ASK THE CONSOLE.** (ADM-C7, the 9.6.26 Operator Control Room brief.)
 *
 * The owner's test for every surface is the test for this one too — *what am I
 * looking at, does this need me, what happened, what happens next* — and a chat
 * box is unusually good at failing it, because a chat box looks like it can
 * answer anything. So the page states its own boundary before the first
 * question is asked: exactly what it answers, exactly what it will never do,
 * and whether any control is connected to it in this build.
 *
 * ## What this page is not
 *
 * It is not a model. Every answer is built from the console's own records by a
 * typed query, which is why every answer can name what it read and how many of
 * what it counted. The brief's rule — *do not invoke a model merely to answer an
 * exact database/status question when a typed deterministic query exists* — is
 * kept here by there being no model in the loop at all; the account of why no
 * budgeted seam reaches a web request is in `lib/control-plane/operator-chat/turn.ts`.
 *
 * The transcript itself is a client component because a transcript needs state.
 * Everything above it is server-rendered and static.
 */

import { StatusBlock } from "@/app/(admin)/status-ui.tsx";
import { US_STATES } from "@/lib/control-plane/readiness/catalog.ts";
import { ConsoleNav } from "../../console-nav.tsx";
import {
  CHAT_PROHIBITIONS,
  PROHIBITION_WORDS,
  TOPIC_DEFINITIONS,
  everyQuestion,
} from "@/lib/control-plane/operator-chat/contract.ts";
import { everyControl } from "@/lib/control-plane/operator-chat/gateway-binding.ts";

import { ChatConsole } from "./chat-console.tsx";
import { CHAT_PAGE, CHAT_STANDFIRST, CHAT_TITLE } from "./contract.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function OperatorChatPage() {
  const controls = everyControl();

  return (
    <main className="admin console-page chat-page">
      <ConsoleNav view="chat" currentState={null} states={US_STATES} />
      <h1>{CHAT_TITLE}</h1>
      <p className="note">{CHAT_STANDFIRST}</p>

      <StatusBlock
        what="This answers from the records, not from a model."
        happened="Every question below maps to a typed query over the same records the pages render. An answer names what it read, how many of what it counted, and what it could not cover."
        next="Ask one of the questions below, or type your own. If it is not one this console answers, it says so rather than guessing."
        needsYou={{ needed: false }}
        detailLabel="What it reads to answer each one"
        detail={
          <ul className="chat-reads">
            {TOPIC_DEFINITIONS.map((topic) => (
              <li key={topic.topic}>
                <strong>{topic.asks}</strong> Reads {topic.reads}.
              </li>
            ))}
          </ul>
        }
      >
        <p className="chat-line">
          It can also ask for {controls.length === 1 ? "one control" : `${controls.length} controls`} by name, and each one
          goes through the same door the buttons do — the same permission, the same check on whether the world has moved
          since, the same receipt, the same refusal. Nothing is done until you confirm it, and the confirmation is checked
          against the proposal you were shown.
        </p>
      </StatusBlock>

      <section className="chat-controls">
        <h2>What it can ask for</h2>
        <p className="note">
          These are the console&rsquo;s own controls, not a list this page keeps. A control added to the console becomes
          something you can ask for here; one taken away stops being askable at once.
        </p>
        <ul>
          {controls.map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ul>
      </section>

      <section className="chat-limits">
        <h2>What it will never do</h2>
        <ul>
          {CHAT_PROHIBITIONS.map((code) => (
            <li key={code}>{PROHIBITION_WORDS[code]}</li>
          ))}
        </ul>
      </section>

      <ChatConsole from={CHAT_PAGE} suggestions={everyQuestion()} />
    </main>
  );
}
