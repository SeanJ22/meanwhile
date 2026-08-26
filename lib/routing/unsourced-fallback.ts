/**
 * **ASK-12 (2026-08-25) — THE UNSOURCED FALLBACK, AND THE WALL AROUND IT.**
 *
 * Sean's ruling: *"try it while it's in testing. Route out-of-scope questions —
 * the 'Why is it raining?' class — to the Claude API."*
 *
 * ## The constraint is not optional and it is the whole reason this is allowed
 *
 * **A sourced civic answer and an unsourced general answer must never be
 * visually or structurally confusable.** The product's entire trust posture
 * rests on it not answering what it cannot source — the never-generate-a-
 * position rule, the transparency mandate's evidence standard, and every
 * "says who?" affordance on every card are all one commitment, and a general
 * answer that borrowed their chrome would spend it.
 *
 * So the separation is STRUCTURAL rather than stylistic, in four ways, and
 * none of them is a rendering choice a later session could tidy away:
 *
 * 1. **A different RESULT TYPE.** An unsourced answer is `UNSOURCED`, never a
 *    `RoutingAnswer`. A caller cannot render one where the other goes without
 *    the type system objecting.
 * 2. **No sources field EXISTS on it.** Enforced by absence, the RULING 112
 *    pattern: there is no `sources`, no `provenance`, no `sourceUrl` on this
 *    shape, so a Sources section cannot be populated from it even by accident.
 * 3. **The mark is PLAIN LANGUAGE and it leads.** Not a footnote, not an
 *    asterisk, not a superscript. `UNSOURCED_MARK` is a sentence a
 *    fifteen-year-old reads correctly, and it renders ABOVE the answer — a
 *    disclosure a reader meets after the claim is a disclosure they have
 *    already been misled by.
 * 4. **It is LAST, never first.** `shouldFallBack` refuses unless the sourced
 *    path has already declined. If a question can be answered from sources, it
 *    is.
 *
 * ## The flag
 *
 * `ripcord.unsourcedFallback` — ON in testing, off in one place with no code
 * change. It is a ripcord rather than a plain feature flag because the ripcord
 * doctrine already requires the three things this needs: a named closer, a
 * provenance tag on every record so pulling it is a filter rather than a hunt,
 * and the transparency page changing in the same commit.
 *
 * ## What it may never do
 *
 * **It never answers a CIVIC question.** The fallback exists for the class
 * Sean named — *why is it raining* — and a question the router declined
 * because our DATA is thin is not out of scope, it is owed. The two are told
 * apart by the router's own verdict, not by this module guessing.
 *
 * **It never enters a sold store.** An unsourced answer is a generated string;
 * it is not reader signal, it is not a position, and it is not aggregated.
 */
import { ripcordPulled } from "../ripcords.ts";
import { scrubFreeText } from "../log/scrub.ts";

/**
 * The mark, in plain language, rendered ABOVE the answer.
 *
 * LEVEL register — this is a claim surface, and the claim it makes is about
 * us. It says three things a reader needs and nothing else: this did not come
 * from a record, we did not check it, and it is not what this product is for.
 */
export const UNSOURCED_MARK =
  "This answer did not come from any public record, and we have not checked it. It is a general answer from an AI, not something this site sourced — for anything about your government, use the links below.";

/** What an unsourced answer is. Deliberately not a `RoutingAnswer`. */
export interface UnsourcedAnswer {
  readonly kind: "UNSOURCED";
  /** The generated text, verbatim. */
  readonly text: string;
  /** Always the mark. Present on the record so it cannot be rendered without. */
  readonly mark: typeof UNSOURCED_MARK;
  /** RULING doctrine: every record the feature produces carries its tag. */
  readonly provenanceTag: "UNSOURCED_GENERAL";
}

export function unsourcedAnswer(text: string): UnsourcedAnswer {
  return {
    kind: "UNSOURCED",
    text,
    mark: UNSOURCED_MARK,
    provenanceTag: "UNSOURCED_GENERAL",
  };
}

/** Is the fallback available at all right now? */
export function fallbackEnabled(): boolean {
  return !ripcordPulled("ripcord.unsourcedFallback");
}

/**
 * May this question go to the fallback?
 *
 * **The sourced path must have declined first.** That is the "last, never
 * first" clause made checkable: a caller that has not tried the router cannot
 * satisfy `routerDeclined`, and one that got an answer must render that.
 */
export function shouldFallBack(input: {
  /** Did the sourced router produce an answer? */
  routerAnswered: boolean;
  /** Did the sourced router explicitly decline — `NO_ROUTE`? */
  routerDeclined: boolean;
  /** Is the question about a government thing we simply have not sourced yet? */
  civicButUnsourced: boolean;
}): boolean {
  if (!fallbackEnabled()) return false;
  if (input.routerAnswered) return false;
  if (!input.routerDeclined) return false;
  /*
   * The clause that keeps this honest. A civic question we cannot answer is
   * OWED — the transparency mandate says an unfound fact is hunted again on
   * its cadence, and handing it to a general model would convert a gap in our
   * research into a plausible sentence nobody can check. That is the
   * never-generate-a-position rule, with a different generator.
   */
  if (input.civicButUnsourced) return false;
  return true;
}

/* ------------------------------------------------------------------------- */
/* The call itself                                                           */
/* ------------------------------------------------------------------------- */

const MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-5";

/**
 * The system prompt, and every line of it is a constraint rather than a style.
 *
 * The model is told what it is NOT for, because the failure that matters is a
 * general model answering a civic question confidently — the router already
 * refused to route it, and a model that decides to have a go anyway would put
 * an unsourced claim about a real government in front of a reader.
 */
function fallbackPrompt(): string {
  return [
    "You are answering a general-knowledge question that a civic-information site could not answer from public records.",
    "",
    "Answer plainly, in at most three sentences, at a level a fifteen-year-old reads comfortably.",
    "",
    "HARD RULES:",
    "- If the question is about a specific government, official, election, ballot, meeting, law, or public record, DO NOT ANSWER IT. Reply with exactly: DECLINE",
    "- Never state a fact about a named person, a named public body, or a named jurisdiction. Reply with exactly: DECLINE",
    "- Never cite a source, a URL, or a document. You have none, and this answer is labelled as unsourced.",
    "- Never say what the site holds, covers, or has looked for.",
    "- No preamble, no sign-off, no offer to help further.",
  ].join("\n");
}

export interface FallbackOptions {
  /** Overridden in tests so the suite never touches the network. */
  fetchImpl?: typeof fetch;
}

export type FallbackOutcome =
  | { kind: "UNSOURCED"; answer: UnsourcedAnswer }
  | { kind: "UNAVAILABLE"; why: "off" | "no-key" | "error" | "declined" };

/**
 * Ask the general model, or say why not.
 *
 * **Every failure returns `UNAVAILABLE`, and every caller renders the sourced
 * refusal for it.** A fallback that quietly produced something when it was
 * switched off, out of credit, or refused by the model would be worse than one
 * that never existed — that is the classifier's own rule, and this is the same
 * rung with more at stake.
 */
export async function askUnsourced(
  question: string,
  options: FallbackOptions = {},
): Promise<FallbackOutcome> {
  if (!fallbackEnabled()) return { kind: "UNAVAILABLE", why: "off" };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { kind: "UNAVAILABLE", why: "no-key" };

  const impl = options.fetchImpl ?? fetch;
  try {
    const response = await impl(MESSAGES_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 300,
        thinking: { type: "disabled" },
        output_config: { effort: "low" },
        system: fallbackPrompt(),
        // The same scrub the refusal log and the classifier already run:
        // nothing shaped like a phone number, an email or a street address
        // leaves this origin.
        messages: [{ role: "user", content: scrubFreeText(question) }],
      }),
    });
    if (!response.ok) return { kind: "UNAVAILABLE", why: "error" };

    const body = (await response.json()) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const text = (body.content?.find((b) => b.type === "text")?.text ?? "").trim();
    if (text === "" || /^DECLINE\b/i.test(text)) {
      // The model judged it civic. That verdict is honoured rather than
      // second-guessed: it is the same direction our own guard points, and
      // the cost of getting it wrong is asymmetric.
      return { kind: "UNAVAILABLE", why: "declined" };
    }
    return { kind: "UNSOURCED", answer: unsourcedAnswer(text) };
  } catch {
    return { kind: "UNAVAILABLE", why: "error" };
  }
}
