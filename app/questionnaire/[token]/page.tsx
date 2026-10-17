import { withReaderSelection } from "@/lib/db/reader-route";
import { withReaderAuthorityEdge } from "@/lib/registry/runtime-edge";
import { readReaderManifest, ensureReaderAuthorityEdge } from "@/lib/meetings/edge-serving";
import { AnswerForm } from "@/components/questionnaire/answer-form";
import { findInvitation, findToken } from "@/lib/db/questionnaire";
import { displayFor, invitationBallotState } from "@/lib/questionnaire/candidacy-display";
import { digestToken, tokenRefusalLine, verifyToken } from "@/lib/questionnaire/auth";
import {
  OFFICE_CLASSES,
  WORD_LIMIT,
  questionsFor,
  type OfficeClass,
} from "@/lib/questionnaire/instrument";


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


  const state = invitationBallotState(invitation.contestId);
  const display = state ? await withReaderSelection({ states: [state], keys: new Set([`state:${state}`]) }, async () => {
    const manifest = await readReaderManifest();
    const edge = manifest ? await ensureReaderAuthorityEdge(manifest, undefined, ["ballot-contests"]) : null;
    return withReaderAuthorityEdge(edge, () => displayFor(state, verdict.candidacyId));
  }) : null;

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
