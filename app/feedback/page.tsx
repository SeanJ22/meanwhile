import Link from "next/link";

import { FeedbackForm } from "@/components/feedback/feedback-form";
import { PRODUCT_NAME, titleFor } from "@/lib/brand";

/**
 * `/feedback` — R40, 2026-08-17, the author's ruling (1A: in-app).
 *
 * The two halves of R40 are one subject and shipped together: the personal
 * address left the product in the same commit this page arrived, because
 * removing the address without the form leaves a reader with no way to reach
 * anyone, which is worse than the address being there.
 *
 * H02's missing-body feedback link is this same surface with a second entry
 * point — the `surface` prop is why the store can tell them apart later
 * without the page being duplicated.
 *
 * The page states what happens to what a reader types, at the point of
 * typing, in the register the claim deserves. Nothing here is a promise the
 * code does not keep: `lib/db/feedback.ts` is the only write path, it scrubs
 * before storing, the store carries no key of any kind, and nothing in
 * `lib/signal/` can read it.
 */

export const metadata = {
  title: titleFor("Feedback"),
};

export default function FeedbackPage() {
  return (
    <main className="min-h-dvh overflow-y-auto bg-[var(--bg,#101014)]">
      <div className="mx-auto max-w-2xl px-5 py-10 sm:py-14">
        <p className="font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted">
          {PRODUCT_NAME}
        </p>
        {/* Interaction surface, so the ask may be warm. */}
        <h1 className="mt-2 text-2xl font-semibold text-paper">
          Tell us what&apos;s wrong
        </h1>

        <p className="mt-4 text-[0.9375rem] leading-relaxed text-paper-dim">
          A wrong meeting time, a missing board, a number that doesn&apos;t
          ring, an official who isn&apos;t in office any more, a sentence that
          made no sense — all of it is worth sending. So is anything else.
        </p>

        <FeedbackForm surface="SIDEBAR" />

        {/* Every word below is a claim, so every word below is level. */}
        <section className="mt-10 border-t border-[var(--panel-border)] pt-6">
          <h2 className="font-mono text-[0.6875rem] uppercase tracking-[0.2em] text-signal">
            What happens to this
          </h2>
          <div className="mt-2.5 space-y-3 text-[0.875rem] leading-relaxed text-paper-dim">
            <p>
              It is stored on its own, read by the person who built this, and
              it enters nothing that is aggregated or licensed. It is not part
              of the data this product licenses to anyone, and there is no
              query that could put it there.
            </p>
            <p>
              We store the message and the time, plus your email address if you
              choose to leave one. Not your name, not your postal address, not
              your zip, and nothing that could connect this to anything else
              you have done on the site.
            </p>
            {/*
              R41 (2026-08-17, the author's ruling A). This paragraph used to
              promise flatly that we could not write back. That sentence is now
              true of exactly one case — the blank field — so it says which,
              rather than continuing to make a claim the product has outgrown.
            */}
            <p>
              Before it is stored, the message is stripped of anything shaped
              like a phone number, an email address, or a street address —
              mechanically, without anyone reading it first. So{" "}
              <strong className="font-semibold text-paper">
                we can only write back if you fill in the optional email box
              </strong>
              ; an address left in the message itself is removed with
              everything else. Leaving the box blank is fine and sends
              normally — it just means this is one-way.
            </p>
            <p>
              If you are pictured on this site and want your photograph
              removed, say so here and it comes down. You do not have to give
              a reason.
            </p>
            <p>
              <Link
                href="/transparency"
                className="underline decoration-dotted underline-offset-2 hover:text-signal"
              >
                What this site collects
              </Link>
            </p>
          </div>
        </section>

        <p className="mt-10 text-[0.8125rem]">
          <Link
            href="/"
            className="text-muted underline decoration-dotted underline-offset-2 hover:text-signal"
          >
            ← Back to the map
          </Link>
        </p>
      </div>
    </main>
  );
}
