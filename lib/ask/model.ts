/**
 * **THE ASK MODEL. ONE DECLARATION, ONE MODULE, AND THIS IS IT.**
 * (Session C final, lane 3, ITEM K, 2026-09-01.)
 *
 * ## Why the model ID is a constant here and not an environment variable
 *
 * **The reason is measurement integrity, and it is the whole reason.**
 *
 * Reader-answerability is this product's top-line health contract, and Ask is
 * a surface it measures. That suite is run LOCALLY, against a local production
 * build (RULING 125). If local and production could hold different model IDs —
 * a per-environment variable, a per-deploy setting, a literal at one call site
 * that drifted from another — then the suite run locally would stop measuring
 * what production serves. A real regression in a reader's answer and ordinary
 * environment drift would then produce the identical symptom, and nothing in
 * the record could tell them apart. A measurement you cannot attribute is not
 * a measurement.
 *
 * So there is exactly one declaration, it is compiled into the build, and both
 * environments serve whatever it says. Rollback is editing this one line.
 *
 * The same reasoning forbids a per-caller or per-request model. Prompt caches
 * are MODEL-SCOPED: a second model anywhere in Ask traffic splits one warm
 * prefix into two cold ones and forfeits every hit lane H1 exists to earn.
 * `lib/ask/synthesize.ts` makes that structural rather than asserted — the
 * production entry point reads no model from its options and has no field that
 * could carry one.
 *
 * ## The override, and the two conditions it is allowed under
 *
 * `WTP_ASK_MODEL` exists so an experiment can run without a deploy. It is
 * bounded by exactly the two conditions the brief set:
 *
 * ```
 *   1. UNSET  -> the constant. The default is the code, never the environment.
 *   2. The RESOLVED value — never the default — is what is recorded on every
 *      stored answer and every evaluation run, and what is logged at startup.
 * ```
 *
 * Condition 2 is what keeps the override from re-creating the drift the
 * constant exists to prevent: an override that ran but was not recorded would
 * be exactly the undiagnosable case above, wearing a different hat.
 *
 * ## Sonnet 5, and the one number the switch actually moved
 *
 * The switch from `claude-opus-5` measured clean on every canonical question
 * this repository grades — see `data/health/ask-model-compare-runs/`. One
 * MEASURED consequence is recorded in `lib/ask/prompt-cache.ts` and is not a
 * quality result: the two models have different MINIMUM CACHEABLE PREFIXES, so
 * the H1 breakpoint that always fired on Opus 5 does not fire on Sonnet 5 for
 * the product's smallest packs. That is a cost fact, it is named where the
 * cache lives, and it is not fixed by anything in this file.
 */

/**
 * The slice of the environment these resolvers read.
 *
 * Deliberately NOT `NodeJS.ProcessEnv`: that type requires `NODE_ENV`, which
 * would force every caller and every test to construct a whole environment to
 * ask about two variables. This names exactly what is read.
 */
export type AskModelEnv = Readonly<Record<string, string | undefined>>;

/** The closed set the Claude API accepts. An unknown value is a 400. */
export const ASK_EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
export type AskEffort = (typeof ASK_EFFORT_LEVELS)[number];

/**
 * **THE MODEL.** `claude-sonnet-5` — exactly this string, and deliberately no
 * date suffix.
 *
 * From the Claude 4.6 generation onward model IDs are dateless AND pinned: the
 * ID identifies one version and the underlying model does not move under it.
 * The floating-alias behaviour that made a dated snapshot necessary on earlier
 * models does not apply, so there is no dated variant to pin to and adding one
 * would name a model that does not exist.
 */
export const ASK_SYNTHESIS_MODEL = "claude-sonnet-5";

/**
 * **THE EFFORT, AND IT WAS MEASURED RATHER THAN REASONED.**
 *
 * Effort defaults to `high` on the Claude API when the field is omitted, and
 * thinking tokens bill at the OUTPUT rate — so an omitted effort is not a
 * neutral choice, it is the most expensive one. This surface pins it instead.
 *
 * All five levels were swept against the canonical corpus on Sonnet 5
 * (`pnpm ask:model-compare --effort <level> --no-record`, one pass per level,
 * four comparable questions). Totals over the questions that ran:
 *
 * ```
 *   level    questions held   output tokens   cost      mean latency
 *   low          3 of 4             949       $0.0416      4,260 ms
 *   medium       3 of 4           1,017       $0.0423      5,028 ms
 *   high         3 of 4           1,508       $0.0472      6,061 ms
 *   xhigh        FAILED — truncated output, see below
 *   max          FAILED — truncated output, see below
 * ```
 *
 * **Two results, and the second one is a boundary rather than a preference.**
 *
 * 1. `low`, `medium` and `high` hold the SAME three questions. Output tokens,
 *    latency and cost all rise monotonically, so nothing above `low` buys an
 *    additional answer on this corpus. At one pass per level those three are
 *    not separable on quality — this module's own harness says *one draw is
 *    not a measurement* — so the sweep does not license a move, only a bound.
 * 2. **`xhigh` and `max` BREAK the output contract at `max_tokens: 2048`.**
 *    Thinking tokens count against `max_tokens`, so at the top of the range
 *    the structured answer is truncated mid-string and arrives as `no text
 *    block` or unparseable JSON — three of four questions failed that way at
 *    `max`. Raising effort here is not a cost-quality trade, it is an outage,
 *    and it would need `max_tokens` raised with it.
 *
 * `medium` therefore STAYS, and the reason is measurement discipline rather
 * than inheritance: §6's comparison was run at `medium` over three passes, and
 * moving effort in the same change as the model would confound the one
 * variable that change exists to measure. `low` is the open question — cheaper
 * and faster on this evidence, unproven at this sample size — and it is left
 * to a run that changes only effort. Changing this number is a measurement.
 */
export const ASK_SYNTHESIS_EFFORT: AskEffort = "medium";

/** The two override names. Declared once so the log and the docs agree. */
export const ASK_MODEL_ENV = "WTP_ASK_MODEL";
export const ASK_EFFORT_ENV = "WTP_ASK_EFFORT";

/**
 * The model this process will actually send.
 *
 * An unset variable resolves to the constant, which is condition 1. An empty
 * or whitespace-only value is treated as unset rather than as a request to
 * send an empty model: an empty string is how a misconfigured deploy arrives,
 * and honouring it would take Ask down instead of naming the mistake.
 */
export function resolveAskModel(env: AskModelEnv = process.env): string {
  const raw = env[ASK_MODEL_ENV];
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : ASK_SYNTHESIS_MODEL;
}

/**
 * The effort this process will actually send.
 *
 * **An override off the closed set is REFUSED, not passed through.** The API
 * answers an unknown effort with a 400, so passing one through would turn a
 * typo in a deploy variable into every Ask request failing — and the reader
 * would meet it as an unavailable answer, which is the product announcing a
 * configuration error as though it were a fact about their government. The
 * constant is used instead and `askModelStartupLine` says so out loud.
 */
export function resolveAskEffort(env: AskModelEnv = process.env): AskEffort {
  const raw = env[ASK_EFFORT_ENV];
  const value = typeof raw === "string" ? raw.trim() : "";
  return (ASK_EFFORT_LEVELS as readonly string[]).includes(value)
    ? (value as AskEffort)
    : ASK_SYNTHESIS_EFFORT;
}

/** Did an override actually take effect? Reported, never silently absorbed. */
export function askModelOverrides(env: AskModelEnv = process.env): {
  readonly model: boolean;
  readonly effort: boolean;
  readonly effortRefused: string | null;
} {
  const rawEffort = typeof env[ASK_EFFORT_ENV] === "string" ? env[ASK_EFFORT_ENV]!.trim() : "";
  const effortValid = (ASK_EFFORT_LEVELS as readonly string[]).includes(rawEffort);
  return {
    model: resolveAskModel(env) !== ASK_SYNTHESIS_MODEL,
    effort: effortValid,
    effortRefused: rawEffort.length > 0 && !effortValid ? rawEffort : null,
  };
}

/**
 * **THE STARTUP LINE — the RESOLVED values, never the defaults.**
 *
 * A fact about our machinery and nothing else: two configuration values and
 * whether an override moved them. No reader fact, no credential, no request
 * content. It exists so an operator reading a deployment log can answer *which
 * model served this?* without reading the code that was deployed — which is
 * the question that becomes unanswerable the moment an override is available
 * and unlogged.
 */
export function askModelStartupLine(env: AskModelEnv = process.env): string {
  const o = askModelOverrides(env);
  const parts = [
    `ask · model ${resolveAskModel(env)}${o.model ? ` (overridden by ${ASK_MODEL_ENV})` : ""}`,
    `effort ${resolveAskEffort(env)}${o.effort ? ` (overridden by ${ASK_EFFORT_ENV})` : ""}`,
  ];
  if (o.effortRefused) {
    parts.push(
      `${ASK_EFFORT_ENV}="${o.effortRefused}" REFUSED — not one of ${ASK_EFFORT_LEVELS.join("/")}`,
    );
  }
  return parts.join(" · ");
}
