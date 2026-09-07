/**
 * **THE STRIP THAT ANSWERS THE EIGHT QUESTIONS.** (ADM-C1.)
 *
 * The acceptance clause for the home page is that the owner can answer eight
 * questions from `/admin` without leaving it. This is that answer, at the top,
 * before anything else: one line saying what to do next, then eight short cards,
 * each with the surface that carries the whole story behind it.
 *
 * A card whose fact could not be read says so and names the surface that would
 * have carried it. It never renders a blank, and it never renders a zero.
 */
import { actNext, commandCentre, type CommandCentreInput } from "@/lib/control-plane/command-centre.ts";

import { Band } from "../../console-ui.tsx";
import { QueueButton } from "../../console-ui.tsx";

export function CommandCentre(props: { readonly input: CommandCentreInput }) {
  const answers = commandCentre(props.input);
  const next = actNext(answers);
  return (
    <section className="cc" aria-labelledby="cc-heading">
      <h2 id="cc-heading" className="visually-hidden">
        What is going on right now
      </h2>
      <p className={`cc-next ${next ? "cc-next-yes" : "cc-next-no"}`}>
        {next ? (
          <>
            <strong>Do this next:</strong> {next.action ?? next.says}
            {next.where && (
              <>
                {" "}
                <a href={next.where}>Take me there</a>
              </>
            )}
          </>
        ) : (
          <>
            <strong>Nothing needs you right now.</strong> Everything below is either running or waiting on something other than you.
          </>
        )}
      </p>
      <ul className="cc-cards">
        {answers.map((a) => (
          <li key={a.question} className={`cc-card l-${a.level}${a.needsYou ? " cc-needs" : ""}`}>
            <span className="cc-q">{a.question}</span>
            <span className="cc-a" title={a.exact ?? undefined}>
              {a.says ?? <span className="gap-inline">not read</span>}
            </span>
            {a.gap && (
              <span className="cc-gap">
                {a.gap}
                <QueueButton where={`Command centre · ${a.question}`} says={a.gap} compact />
              </span>
            )}
            <span className="cc-foot">
              <Band level={a.level}>{a.level}</Band>
              {a.where && <a href={a.where}>Open</a>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
