/**
 * **THE CONSOLE ANSWERS THE CLICK BEFORE IT ANSWERS THE QUESTION.** (ADM-38,
 * §9A.12; drawn in the redesign's shell, 2026-09-23.)
 *
 * The owner, third report on the same thing:
 *
 * > *"Switching between Pilot Health, State Readiness, and Research Detail
 * > takes, on average, about 2 seconds between pages. I don't know why it's
 * > taking that long. Software Release Review takes several seconds. That's
 * > definitely something that has to be fixed for sure."*
 *
 * Two of the three fixes are real work — bounded reads, and not blocking a page
 * on a three-and-a-half-second live fetch of production's build stamp. This is
 * the third and it is the one he feels first: **immediate acknowledgment**.
 * Next renders this the instant a console link is followed, and swaps it for
 * the page when the server tree arrives, so a click is never met with a frozen
 * previous page and no evidence that anything is happening.
 *
 * §9A.12 draws the line this must not cross: *"Do not game the metric by
 * rendering an empty shell while all meaningful content still waits
 * unnecessarily."* So this says what it is waiting for, in his words, and every
 * page behind it still does the work of cutting its own load. It is the
 * acknowledgment, never the answer. It is drawn dark, in the redesign's own
 * tokens, so the wait never flashes the old console's look.
 */
import { Logo } from "@/components/brand/logo";

import s from "./_mw/mw.module.css";

export default function ConsoleLoading() {
  return (
    <main className={s.root} aria-busy="true">
      <header className={s.header}>
        <span className={s.brand}>
          <Logo variant="wordmark" size={20} decorative />
        </span>
      </header>
      <div className={s.container}>
        <p className={s.lede} role="status">
          Reading the records…
        </p>
        <p className={s.note}>
          The console is asking the control plane for the current state of things. Nothing is cached, so what arrives is what is true right now.
        </p>
      </div>
    </main>
  );
}
