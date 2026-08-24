import { AnswerForm } from "@/components/questionnaire/answer-form";
import { findInvitation, findToken } from "@/lib/db/questionnaire";
import { displayFor } from "@/lib/questionnaire/candidacy-display";
import { digestToken, tokenRefusalLine, verifyToken } from "@/lib/questionnaire/auth";
import {
  OFFICE_CLASSES,
  WORD_LIMIT,
  questionsFor,
  type OfficeClass,
} from "@/lib/questionnaire/instrument";

/**
 * The page a candidate lands on.
 *
 * ## What this is, and what it is not
 *
 * `NH104`. It is the surface a candidate types into. **It is not the send
 * path** — nothing in this repo emails anybody, and `NH108`'s four sending
 * decisions are Sean's: the domain, the provider credential, the deliverability
 * warm-up, and the timing. A candidate reaches this page by holding a link.
 *
 * ## Why the refusals are separate sentences
 *
 * A link that is unknown, expired or already used are three different facts
 * about a candidate's situation and they need three different next steps.
 * `tokenRefusalLine` holds the wording; this page never collapses them into
 * "invalid link". And a store we cannot reach is a fact about US — it renders
 * as its own named gap and never as "your link does not work", which would be
 * the render-default rule's exact failure pointed at the person we are asking
 * for a favour.
 *
 * ## No new identifier
 *
 * RULING 112: a single-use expiring token to the email already on the certified
 * filing. No account, no password, no new identifier, and only `sha256(token)`
 * is stored. The token appears in the URL and is hashed before it touches the
 * database — there is no code path here that logs or persists a raw one.
 *
 * `noindex` is set for the same reason: this URL carries a credential.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Your questionnaire",
  robots: { index: false, follow: false },
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-5 py-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">In your own words</h1>
        <p className="text-sm text-muted-foreground">
          The same questions, the same {WORD_LIMIT}-word limit, and the same deadline for every
          candidate in your race.
        </p>
      </header>
      {children}
    </main>
  );
}

export default async function QuestionnairePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const lookup = await findToken(digestToken(token));
  if (lookup.kind === "STORE_UNAVAILABLE") {
    return (
      <Shell>
        <p className="text-sm">
          We could not reach our own records just now, so we cannot open your questionnaire yet.
          Your link is fine — this is a problem at our end. Please try again in a few minutes.
        </p>
      </Shell>
    );
  }

  const verdict = verifyToken({
    token,
    record: lookup.kind === "FOUND" ? lookup.record : null,
    now: new Date(),
  });
  if (!verdict.ok) {
    return (
      <Shell>
        <p className="text-sm">{tokenRefusalLine(verdict.reason)}</p>
      </Shell>
    );
  }

  const invitation = await findInvitation(verdict.candidacyId);
  if (invitation.kind === "STORE_UNAVAILABLE") {
    return (
      <Shell>
        <p className="text-sm">
          We could not reach our own records just now. Your link is fine — this is a problem at our
          end. Please try again in a few minutes.
        </p>
      </Shell>
    );
  }
  if (invitation.kind === "NOT_FOUND") {
    return (
      <Shell>
        <p className="text-sm">
          This link works, but we have no questionnaire on file for it yet. Reply to the email we
          sent and we will sort it out.
        </p>
      </Shell>
    );
  }

  const officeClass = (OFFICE_CLASSES as readonly string[]).includes(invitation.officeClass)
    ? (invitation.officeClass as OfficeClass)
    : null;
  if (!officeClass) {
    return (
      <Shell>
        <p className="text-sm">
          This link works, but we have not settled which questions belong to this office yet. Reply
          to the email we sent and we will sort it out.
        </p>
      </Shell>
    );
  }

  const questions = questionsFor(officeClass);

  /*
   * A candidacy id is not a name and a contest id is not an office. Where they
   * resolve to neither, the page says something true and general rather than
   * printing a slug at the person it belongs to — see `candidacy-display.ts`.
   */
  const display = displayFor(verdict.candidacyId);

  return (
    <Shell>
      <AnswerForm
        token={token}
        questions={questions}
        candidateName={display?.name ?? null}
        officeTitle={display?.officeTitle ?? null}
      />
    </Shell>
  );
}
