/**
 * **FE-20 — a look reviewer separate from the builder.**
 *
 * The reviewer sees only what a reader would: screenshots, the task text and
 * the written look standard. Its input type has no room for anything else, so
 * a checklist, data counts, page text or session notes cannot reach it, and a
 * page that passes every data check can still be judged ugly.
 *
 * Paid work is never started here. The caller passes the model call and the
 * spend reservation (under the owner's budget dial); with either missing, or
 * with the reservation refused, the reviewer does not run and says why.
 */

/** The five questions (rulings §6.11), one line each. */
export const LOOK_QUESTIONS = ["beautiful", "easy", "instant", "come_back", "show_a_friend"] as const;
export type LookQuestion = (typeof LOOK_QUESTIONS)[number];

export interface LookScreenshot {
  /** A label a person would use, such as "ballot card, 390 wide". */
  label: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp";
  /** Base64 image bytes. */
  base64: string;
}

/** The whole input. Anything else is a type error, by design. */
export interface LookReviewInput {
  screenshots: readonly LookScreenshot[];
  task: string;
  standard: string;
}

export interface ScreenVerdict {
  label: string;
  answers: Record<LookQuestion, string>;
  verdict: "red" | "green";
  /** The element a red verdict names. Required when red. */
  element: string | null;
}

export type LookReviewOutcome =
  | { kind: "REVIEWED"; screens: ScreenVerdict[]; red: number }
  | { kind: "NOT_RUN"; why: "no-model" | "no-spend-authority" | "spend-refused" | "no-screens" | "error" };

export interface LookReviewDeps {
  /** Sends the prompt and images, returns the model's raw JSON text. */
  callModel?: (request: { prompt: string; schema: Record<string, unknown>; images: readonly LookScreenshot[] }) => Promise<string>;
  /** Asks the budget dial for room for one review. False means no paid work. */
  reserveSpend?: (screens: number) => boolean | Promise<boolean>;
}

export function lookReviewPrompt(input: Pick<LookReviewInput, "task" | "standard">): string {
  return [
    "You are a design reviewer who has never seen the code or the data behind these screens.",
    "Judge each screenshot only as a resident opening it for the first time, using the standard below.",
    "",
    "For each screen answer these five questions in one line each:",
    "beautiful? easy? instant? would they come back? would they show a friend?",
    "Then give a verdict: red or green. A red verdict must name the element at fault (for example a 9px label or a cramped card).",
    "Do not assume anything a screen does not show. Do not praise to be polite.",
    "If a screen resembles a \"Bad live example (Sean, ...)\" in the standard, say which one and make the verdict red.",
    "",
    "The task the screen was built for:",
    input.task,
    "",
    "The look standard:",
    input.standard,
  ].join("\n");
}

export function lookReviewSchema(): Record<string, unknown> {
  const line = { type: "string", minLength: 1, maxLength: 240 };
  return {
    type: "object",
    additionalProperties: false,
    required: ["screens"],
    properties: {
      screens: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["label", "answers", "verdict", "element"],
          properties: {
            label: { type: "string" },
            answers: {
              type: "object",
              additionalProperties: false,
              required: [...LOOK_QUESTIONS],
              properties: Object.fromEntries(LOOK_QUESTIONS.map((q) => [q, line])),
            },
            verdict: { enum: ["red", "green"] },
            element: { type: ["string", "null"] },
          },
        },
      },
    },
  };
}

/** Checks the model's answer against the screens that were sent. Null if it does not hold. */
export function readLookReview(raw: string, sent: readonly LookScreenshot[]): ScreenVerdict[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const list = (parsed as { screens?: unknown } | null)?.screens;
  if (!Array.isArray(list) || list.length !== sent.length) return null;
  const out: ScreenVerdict[] = [];
  for (let i = 0; i < list.length; i++) {
    const s = list[i] as Partial<ScreenVerdict> | null;
    if (!s || typeof s !== "object" || (s.verdict !== "red" && s.verdict !== "green")) return null;
    const answers = s.answers as Record<string, unknown> | undefined;
    if (!answers) return null;
    const checked = {} as Record<LookQuestion, string>;
    for (const q of LOOK_QUESTIONS) {
      const a = answers[q];
      if (typeof a !== "string" || !a.trim()) return null;
      checked[q] = a.trim();
    }
    const element = typeof s.element === "string" && s.element.trim() ? s.element.trim() : null;
    // A red flag that names nothing cannot be fixed, so it does not count as a review.
    if (s.verdict === "red" && !element) return null;
    out.push({ label: sent[i].label, answers: checked, verdict: s.verdict, element: s.verdict === "red" ? element : null });
  }
  return out;
}

export async function reviewLook(input: LookReviewInput, deps: LookReviewDeps = {}): Promise<LookReviewOutcome> {
  if (input.screenshots.length === 0) return { kind: "NOT_RUN", why: "no-screens" };
  if (!deps.callModel) return { kind: "NOT_RUN", why: "no-model" };
  if (!deps.reserveSpend) return { kind: "NOT_RUN", why: "no-spend-authority" };
  if (!(await deps.reserveSpend(input.screenshots.length))) return { kind: "NOT_RUN", why: "spend-refused" };
  try {
    // Only these three things are passed on; extra fields on `input` are never read.
    const raw = await deps.callModel({
      prompt: lookReviewPrompt({ task: input.task, standard: input.standard }),
      schema: lookReviewSchema(),
      images: input.screenshots,
    });
    const screens = readLookReview(raw, input.screenshots);
    if (!screens) return { kind: "NOT_RUN", why: "error" };
    return { kind: "REVIEWED", screens, red: screens.filter((s) => s.verdict === "red").length };
  } catch {
    return { kind: "NOT_RUN", why: "error" };
  }
}
