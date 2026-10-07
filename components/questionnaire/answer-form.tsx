"use client";

import { useMemo, useState } from "react";

import { WORD_LIMIT, checkWordLimit, type Question } from "@/lib/questionnaire/instrument";

/**
 * The form a candidate types their own words into. The word count shows as
 * they type and nothing is ever truncated: no `maxLength`, no slice. Over the
 * limit is refused at submit with the count shown, by the same
 * `checkWordLimit` the server uses.
 */
export function AnswerForm({
  token,
  questions,
  candidateName,
  officeTitle,
}: {
  token: string;
  questions: readonly Question[];
  /** `null` where the id resolved to no name. The copy never prints a slug. */
  candidateName: string | null;
  officeTitle: string | null;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [state, setState] = useState<
    | { kind: "editing" }
    | { kind: "sending" }
    | { kind: "sent"; message: string }
    | { kind: "refused"; message: string; overLimit: string[] }
  >({ kind: "editing" });

  const counts = useMemo(() => {
    const out: Record<string, ReturnType<typeof checkWordLimit>> = {};
    for (const q of questions) out[q.id] = checkWordLimit(answers[q.id] ?? "");
    return out;
  }, [answers, questions]);

  const overLimit = questions.filter((q) => !counts[q.id].withinLimit);
  const answered = questions.filter((q) => (answers[q.id] ?? "").trim().length > 0);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (overLimit.length > 0) {
      // Told before anything is sent; nothing is cut.
      setState({
        kind: "refused",
        overLimit: overLimit.map((q) => q.id),
        message:
          overLimit.length === 1
            ? `One answer is over the ${WORD_LIMIT}-word limit. Nothing has been sent and nothing has been cut.`
            : `${overLimit.length} answers are over the ${WORD_LIMIT}-word limit. Nothing has been sent and nothing has been cut.`,
      });
      return;
    }
    setState({ kind: "sending" });
    try {
      const res = await fetch("/api/questionnaire", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token,
          answers: answered.map((q) => ({ questionId: q.id, text: answers[q.id] ?? "" })),
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        message?: string;
        overLimit?: { questionId: string }[];
      };
      if (data.ok) {
        // `ok` establishes success; the sentence is the server's, or empty.
        setState({ kind: "sent", message: data.message ?? "" });
      } else {
        setState({
          kind: "refused",
          overLimit: (data.overLimit ?? []).map((o) => o.questionId),
          // A missing server message is said as such, not turned into a claim about the store.
          message:
            data.message ??
            "That did not go through, and we cannot tell you why — our own answer came back " +
              "without a reason. Reply to the email we sent before trying again, so nothing " +
              "is recorded twice.",
        });
      }
    } catch {
      setState({
        kind: "refused",
        overLimit: [],
        message:
          "We could not reach our own records just now, so nothing was saved. " +
          "Your answers are still on this page — please try again in a minute.",
      });
    }
  }

  if (state.kind === "sent") {
    return (
      <section className="rounded-lg border border-border bg-card p-6">
        <h2 className="text-lg font-semibold">Thank you — your answers are in.</h2>
        <p className="mt-3 text-sm text-muted-foreground">{state.message}</p>
      </section>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-8">
      <p className="text-sm text-muted-foreground">
        {officeTitle ? `Every candidate for ${officeTitle}` : "Every candidate in your race"} gets
        these same questions, on the same day, with the same {WORD_LIMIT}-word limit. Your answers
        publish exactly as you write them — word for word, with nothing summarised, shortened or
        edited.
      </p>

      {questions.map((q, i) => {
        const count = counts[q.id];
        return (
          <div key={q.id} className="flex flex-col gap-2">
            <label htmlFor={q.id} className="text-base font-medium">
              <span className="text-muted-foreground">{i + 1}.</span> {q.text}
            </label>
            <textarea
              id={q.id}
              name={q.id}
              rows={6}
              value={answers[q.id] ?? ""}
              onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
              className="w-full rounded-md border border-border bg-background p-3 text-sm"
              aria-describedby={`${q.id}-count`}
            />
            <p
              id={`${q.id}-count`}
              className={count.withinLimit ? "text-xs text-muted-foreground" : "text-xs font-medium"}
              style={count.withinLimit ? undefined : { color: "var(--danger)" }}
            >
              {count.words} of {q.wordLimit} words
              {count.withinLimit ? "" : ` — ${count.words - q.wordLimit} over. Nothing will be cut for you.`}
            </p>
          </div>
        );
      })}

      {state.kind === "refused" && (
        <p role="alert" className="text-sm font-medium" style={{ color: "var(--danger)" }}>
          {state.message}
        </p>
      )}

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={state.kind === "sending"}
          className="rounded-md border border-border px-4 py-2 text-sm font-medium"
        >
          {state.kind === "sending" ? "Sending…" : "Send my answers"}
        </button>
        <span className="text-xs text-muted-foreground">
          {answered.length} of {questions.length} answered
          {answered.length < questions.length ? " — you can leave any of them blank." : ""}
        </span>
      </div>

      <p className="text-xs text-muted-foreground">
        {candidateName ? `${candidateName} — this` : "This"} link is single-use. If you need to
        change something afterwards, reply to the email we sent and we will send you a new one.
      </p>
    </form>
  );
}
