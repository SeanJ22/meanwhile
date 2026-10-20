import Link from "next/link";

import { FeedbackForm } from "@/components/feedback/feedback-form";
import { Logo } from "@/components/brand/logo";
import { titleFor } from "@/lib/brand";
import { feedbackContext } from "@/lib/feedback/shape";

/** `lib/db/feedback.ts` is the only write path; it scrubs before storing and the store carries no key. */

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
        <div>
          <Logo variant="wordmark" size={30} />
        </div>
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
