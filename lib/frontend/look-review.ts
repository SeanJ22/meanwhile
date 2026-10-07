/**
 * A look reviewer separate from the builder. It sees only screenshots, the
 * task text and the written look standard; its input type has no room for
 * anything else. Paid work is never started here: the caller passes the model
 * call and the spend reservation, and without either the reviewer does not
 * run and says why.
 */

/** The five questions, one line each. */
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

/**
 * Comparison mode: our screen next to one reference screen, judged for which
 * is better and why. A loss is a red flag naming what the reference does
 * better. The same input and spend rules hold.
 */
export interface ComparePair {
  /** Our screenshot. */
  ours: LookScreenshot;
  /** The reference screenshot it is judged against. */
  reference: LookScreenshot;
}

export interface CompareInput {
  pairs: readonly ComparePair[];
  task: string;
  standard: string;
}

export interface CompareVerdict {
  /** Both labels travel with the verdict so the look pass can show both screenshots. */
  ours: string;
  reference: string;
  winner: "ours" | "reference" | "tie";
  why: string;
  /** What the reference does better. Required when the reference wins. */
  betterElement: string | null;
  /** A loss is a red flag. */
  red: boolean;
}

export type CompareOutcome =
  | { kind: "COMPARED"; pairs: CompareVerdict[]; losses: number }
  | { kind: "NOT_RUN"; why: "no-model" | "no-spend-authority" | "spend-refused" | "no-pairs" | "error" };

export function lookComparePrompt(input: Pick<CompareInput, "task" | "standard">): string {
  return [
    "You are a design reviewer who has never seen the code or the data behind these screens.",
    "The images come in pairs: first ours, then a reference screen from a product people love to use.",
    "For each pair, as a resident opening both for the first time, say which is better: ours, the reference, or a tie, and why in one line.",
    "If the reference wins, name the element it does better (for example its spacing or its one clear action).",
    "Do not assume anything a screen does not show. Do not favor ours to be polite.",
    "",
    "The task the screen was built for:",
    input.task,
    "",
    "The look standard:",
    input.standard,
  ].join("\n");
}

export function lookCompareSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["pairs"],
    properties: {
      pairs: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["winner", "why", "betterElement"],
          properties: {
            winner: { enum: ["ours", "reference", "tie"] },
            why: { type: "string", minLength: 1, maxLength: 240 },
            betterElement: { type: ["string", "null"] },
          },
        },
      },
    },
  };
}

/** Checks the model's answer against the pairs that were sent. Null if it does not hold. */
export function readLookCompare(raw: string, sent: readonly ComparePair[]): CompareVerdict[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const list = (parsed as { pairs?: unknown } | null)?.pairs;
  if (!Array.isArray(list) || list.length !== sent.length) return null;
  const out: CompareVerdict[] = [];
  for (let i = 0; i < list.length; i++) {
    const p = list[i] as { winner?: unknown; why?: unknown; betterElement?: unknown } | null;
    if (!p || typeof p !== "object") return null;
    if (p.winner !== "ours" && p.winner !== "reference" && p.winner !== "tie") return null;
    if (typeof p.why !== "string" || !p.why.trim()) return null;
    const better = typeof p.betterElement === "string" && p.betterElement.trim() ? p.betterElement.trim() : null;
    // A loss that names nothing cannot be fixed, so it does not count as a comparison.
    if (p.winner === "reference" && !better) return null;
    out.push({
      ours: sent[i].ours.label,
      reference: sent[i].reference.label,
      winner: p.winner,
      why: p.why.trim(),
      betterElement: p.winner === "reference" ? better : null,
      red: p.winner === "reference",
    });
  }
  return out;
}

export async function compareLook(input: CompareInput, deps: LookReviewDeps = {}): Promise<CompareOutcome> {
  if (input.pairs.length === 0) return { kind: "NOT_RUN", why: "no-pairs" };
  if (!deps.callModel) return { kind: "NOT_RUN", why: "no-model" };
  if (!deps.reserveSpend) return { kind: "NOT_RUN", why: "no-spend-authority" };
  const images = input.pairs.flatMap((p) => [p.ours, p.reference]);
  if (!(await deps.reserveSpend(images.length))) return { kind: "NOT_RUN", why: "spend-refused" };
  try {
    const raw = await deps.callModel({
      prompt: lookComparePrompt({ task: input.task, standard: input.standard }),
      schema: lookCompareSchema(),
      images,
    });
    const pairs = readLookCompare(raw, input.pairs);
    if (!pairs) return { kind: "NOT_RUN", why: "error" };
    return { kind: "COMPARED", pairs, losses: pairs.filter((p) => p.red).length };
  } catch {
    return { kind: "NOT_RUN", why: "error" };
  }
}
