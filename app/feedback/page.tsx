import Link from "next/link";

import { FeedbackForm } from "@/components/feedback/feedback-form";
import { Logo } from "@/components/brand/logo";
import { titleFor } from "@/lib/brand";
import { feedbackContext } from "@/lib/feedback/shape";

/**
 * `/feedback` — R40, 2026-08-17, the author's ruling (1A: in-app).
 *
 * The two halves of R40 are one subject and shipped together: the personal
 * address left the product in the same commit this page arrived, because
 * removing the address without the form leaves a reader with no way to reach
 * anyone, which is worse than the address being there.
 *
 * HUNT02's missing-body feedback link is this same surface with a second entry
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

export default async function FeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ about?: string; zip?: string; recordId?: string }>;
}) {
  const context = feedbackContext(await searchParams);
  // "Report a problem" on a card names the card, so the reader starts with
  // the part they would otherwise have to remember to say.
  const topic = context.about;
  return (
    <main className="mw-page min-h-dvh overflow-y-auto bg-[var(--bg)]">
      <div className="mx-auto max-w-2xl px-5 py-10 sm:py-14">
        {/* ITEM J (2026-09-01): the page eyebrow was the product name typed as
          display text in a 10px uppercase MONO treatment — the register this
          system reserves for numerals and identifiers, worn by the one string
          that is neither. It is the lockup now, at the 18px wordmark floor. */}
        <div>
          {/* BAL-40 (2026-09-02): logo-first hierarchy — the wordmark leads,
              the headline below comes down a step. */}
          <Logo variant="wordmark" size={30} />
        </div>
        {/* Interaction surface, so the ask may be warm. */}
        <h1 className="mt-2 text-xl font-semibold text-paper">
          Tell us what&apos;s wrong
        </h1>

        <p className="mt-4 text-[0.9375rem] leading-relaxed text-paper-dim">
          A wrong meeting time, a missing board, a number that doesn&apos;t
          ring, an official who isn&apos;t in office any more, a sentence that
          made no sense — all of it is worth sending. So is anything else.
        </p>

        <FeedbackForm
          surface="SIDEBAR"
          initialMessage={topic ? `About "${topic}": ` : ""}
          context={context}
        />
        {(topic || context.zip) && (
          <p className="mt-3 text-sm text-paper-dim">
            Report context: {topic || "Map"}{context.zip ? ` · ZIP ${context.zip}` : ""}.
          </p>
        )}

        {/* Every word below is a claim, so every word below is level. */}
        <section className="mt-10 border-t border-[var(--panel-border)] pt-6">
          <h2 className="font-mono text-[0.6875rem] uppercase trailing-space-trimmed-20 tracking-[0.2em] text-signal">
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
              We store the message and the time, the card and ZIP being
              reported when supplied, plus your email address if you choose
              to leave one. We do not store your name, your postal address,
              or a link to anything else you have done on the site.
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
            className="mw-back-pill"
          >
            ← Back to the map
          </Link>
        </p>
      </div>
    </main>
  );
}
