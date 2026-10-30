import { loadWebsiteSavedKeys } from "../../lib/core/keys-entry.ts";
import Link from "next/link";

import { FeedbackForm } from "@/components/feedback/feedback-form";
import { Logo } from "@/components/brand/logo";
import { titleFor } from "@/lib/brand";
import { feedbackContext } from "@/lib/feedback/shape";

/** `lib/db/feedback.ts` is the only write path; it scrubs before storing and the store carries no key. */

type FeedbackPageProps = { searchParams: Promise<{ about?: string; zip?: string; recordId?: string; intent?: string }> };

export async function generateMetadata({ searchParams }: FeedbackPageProps) {
  return { title: titleFor((await searchParams).intent === "sooner" ? "Want us to get this sooner?" : "Tell us what’s wrong") };
}

export default async function FeedbackPage({
  searchParams,
}: FeedbackPageProps) {
  await loadWebsiteSavedKeys();
  const params = await searchParams;
  const context = feedbackContext(params);
  const sooner = params.intent === "sooner";
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
          {sooner ? "Want us to get this sooner?" : "Tell us what’s wrong"}
        </h1>

        <p className="mt-4 text-[0.9375rem] leading-relaxed text-paper-dim">
          {sooner ? "Tell us which information you want us to get next." : "Tell us what is wrong, missing, or confusing."}
        </p>

        <FeedbackForm
          surface="SIDEBAR"
          initialMessage={sooner ? `Please get ${topic || "this information"} sooner. ` : topic ? `About "${topic}": ` : ""}
          context={context}
        />
        {(topic || context.zip) && (
          <p className="mt-3 text-sm text-paper-dim">
            {sooner ? "Requested information" : "Report context"}: {topic || "Map"}{context.zip ? ` · ZIP ${context.zip}` : ""}.
          </p>
        )}

        <section className="mt-10 border-t border-[var(--panel-border)] pt-6">
          <h2 className="font-mono text-[0.6875rem] trailing-space-trimmed-20 tracking-[0.2em] text-signal">
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
