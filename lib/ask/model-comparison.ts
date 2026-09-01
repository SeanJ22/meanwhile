import { createHash } from "node:crypto";

import type { ModelRate } from "../control-plane/model-cost.ts";

import { packHasEvidence, type EvidencePack } from "./evidence.ts";
import { ASK_MODEL_RATES } from "./model-economics.ts";
import type { AskEffort } from "./model.ts";
import { readCacheUsage, type CacheUsage } from "./prompt-cache.ts";
import {
  SYNTHESIS_MESSAGES_URL,
  synthesisContextPayload,
  synthesisPrompt,
  synthesisQuestionPayload,
  synthesisRequestBody,
} from "./synthesize.ts";

/**
 * **THE COMPARISON SEAM — the same synthesis contract, on a named model,
 * outside the production request path.** (Session C, lane H2, 2026-08-31.)
 *
 * ## Why this is a module and not an option on `synthesizeAnswer`
 *
 * The owner's instruction has two halves and the second one is a prohibition:
 *
 * > Do not add per-reader or per-request model switching to the production Ask
 * > route; do not split production cache behavior. Build the smallest
 * > comparison-only seam/harness necessary to call the same synthesis contract
 * > with an explicitly selected model outside the production request path.
 *
 * An `options.model` on `synthesizeAnswer` would have been three lines and it
 * would have been the wrong three lines. `synthesizeAnswer` is what
 * `app/api/ask/grounded/route.ts` calls on every reader request; a model field
 * on its options is, by construction, a per-request model choice — whether or
 * not today's route passes one. **The law is ONE MODEL FOR ALL ASK TRAFFIC,
 * and caches are model-scoped**, so a per-caller choice would also split one
 * warm prefix into two cold ones and forfeit every hit lane H1 exists to earn.
 *
 * So the seam is a SEPARATE ENTRY POINT that no route imports.
 * `tests/ask-model-comparison.test.ts` asserts both halves mechanically: that
 * nothing under `app/` reaches this module, and that the production path emits
 * `ASK_SYNTHESIS_MODEL` even when handed an options object carrying a `model`
 * key. The shared half — the request body, the system prompt, the payload
 * split — is `synthesisRequestBody` in `synthesize.ts`, called by both, so
 * this measures the contract the product actually ships rather than a copy of
 * it that has begun to drift.
 *
 * ## The cache is DISABLED here, and that is a measurement decision
 *
 * Not isolated by key, not pointed at a second namespace: **absent**. The
 * request is built with `cached: false`, so it carries no `cache_control`
 * marker anywhere and takes no part in caching — no read, no write, no entry
 * created, nothing of production's touched.
 *
 * Three reasons, in the order they matter.
 *
 * 1. **A cache read would make the comparison a measurement of arrival order.**
 *    Cached input tokens bill at roughly a tenth of the base rate. Whichever
 *    model ran second over a shared prefix would look up to ten times cheaper
 *    on input for a reason that has nothing to do with the model. The two
 *    columns have to be priced on the same basis or the cost column is a
 *    fiction, and the only basis both models can share is COLD.
 * 2. **A comparison run must not write into production's prefixes.** The
 *    incumbent arm of this comparison uses the identical system prompt and
 *    context payload a reader's request uses. With the marker on, it would
 *    create and refresh real cache entries out of a harness, and the hit rate
 *    lane H1 reports would then partly measure this script.
 * 3. **The seam never touches the caller-key ledger.** `AskCallerKey` names a
 *    deployment and the ledger exists to keep production's rate unpooled; a
 *    comparison arm is neither a deployment nor a reader, so it records
 *    nothing rather than inventing a fourth key.
 *
 * What that costs is stated rather than hidden: this measures COLD token counts
 * and cold cost, so the dollar figures here are an upper bound on what either
 * model bills in production, where H1's cache is live. The RATIO between the
 * two columns is what the switch rule reads, and it is measured on the same
 * basis for both.
 */

/* ── what the model was actually shown ───────────────────────────────────── */

/* One byte no payload can contain, so two packs cannot collide by
   concatenation. Written as the ESCAPE and never as the raw character: a
   literal NUL makes ripgrep and git grep classify this file as binary and SKIP
   it silently, so a class sweep of the repository would report nothing found
   without ever having looked (tests/nul-bytes.test.ts). */
const SEPARATOR = "\u0000";

/**
 * A digest of EVERYTHING the model is shown for one pack — system rules,
 * civic context, and the reader's question — and nothing else.
 *
 * **This is the instrument for the constraint that if the packs differ the
 * comparison is void.** Not a claim in a report and not an assertion that the
 * same variable was passed twice: the harness digests the two arms' rendered
 * prompts and refuses to report a row whose digests differ. Deliberately over
 * the RENDERED payloads rather than over the pack object, because what makes
 * two runs comparable is what reached the model, and a pack field that never
 * renders could differ without mattering while a reordered key that renders
 * differently matters without the object differing.
 *
 * The model id is NOT in the digest. It is the one thing that is supposed to
 * differ between the arms.
 */
export function shownPromptDigest(pack: EvidencePack): string {
  return createHash("sha256")
    .update(synthesisPrompt(pack))
    .update(SEPARATOR)
    .update(synthesisContextPayload(pack))
    .update(SEPARATOR)
    .update(synthesisQuestionPayload(pack))
    .digest("hex");
}

/* ── the run ─────────────────────────────────────────────────────────────── */

export type ComparisonOutcome =
  | {
      kind: "WROTE";
      model: string;
      answer: string;
      citedUrls: string[];
      ms: number;
      /** Input-side tokens, read off the API's own usage block. */
      usage: CacheUsage;
      outputTokens: number;
    }
  | {
      kind: "UNAVAILABLE";
      model: string;
      /** Never a guess. `error` carries the status or the parse failure. */
      why: "no-key" | "no-evidence" | "error";
      detail: string | null;
      ms: number;
    };

export interface ComparisonOptions {
  fetchImpl?: typeof fetch;
  apiKey?: string;
  /**
   * **THE EFFORT SWEEP'S ONE VARIABLE.** (ITEM K §4, 2026-09-01.)
   *
   * Omitted, the request is built with the resolved production effort — so the
   * default behaviour of this seam still measures the shape the product ships.
   * Supplied, it varies effort and NOTHING ELSE: same prompt, same pack, same
   * model, same cache policy, so the difference between two sweep rows is
   * attributable to the effort level rather than to anything the harness did.
   *
   * It lives here, on the comparison seam, and NOT on `SynthesizeOptions` —
   * for the same reason the model does not: a production entry point with an
   * effort field is a per-request effort choice whether or not today's route
   * passes one, and effort is part of the cached prefix's request shape.
   */
  effort?: AskEffort;
}

/**
 * Run one canonical question through the synthesis contract on ONE named model.
 *
 * The empty-pack refusal is inherited rather than re-decided: a model asked to
 * answer a civic question with no records will write something fluent and
 * sourced to nothing, and that is as true of a comparison arm as of a reader's
 * request. A pack with no records is reported `no-evidence` on BOTH arms, which
 * is a fact about the corpus and not a difference between the models.
 */
export async function synthesizeForComparison(
  pack: EvidencePack,
  model: string,
  options: ComparisonOptions = {},
): Promise<ComparisonOutcome> {
  const started = Date.now();
  const elapsed = () => Date.now() - started;

  if (!packHasEvidence(pack)) {
    return { kind: "UNAVAILABLE", model, why: "no-evidence", detail: null, ms: elapsed() };
  }
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { kind: "UNAVAILABLE", model, why: "no-key", detail: null, ms: elapsed() };
  }

  const impl = options.fetchImpl ?? fetch;
  try {
    const response = await impl(SYNTHESIS_MESSAGES_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      /* The product's own request, with the model named and the cache marker
         absent. Nothing else about it differs from what a reader's question
         sends. */
      body: JSON.stringify(
        synthesisRequestBody(pack, { model, cached: false, effort: options.effort }),
      ),
    });
    if (!response.ok) {
      /* The status is CARRIED. "It failed" is not a measurement, and a
         comparison that reports a model as unavailable without saying why
         invites the next session to read it as a property of the model. */
      const detail = `HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`;
      return { kind: "UNAVAILABLE", model, why: "error", detail, ms: elapsed() };
    }

    const body = (await response.json()) as {
      content?: Array<{ type?: string; text?: string }>;
      usage?: { output_tokens?: number };
    };
    const text = body.content?.find((b) => b.type === "text")?.text ?? "";
    if (!text) {
      return {
        kind: "UNAVAILABLE",
        model,
        why: "error",
        detail: "the response carried no text block",
        ms: elapsed(),
      };
    }
    const parsed = JSON.parse(text) as { answer?: unknown; citedUrls?: unknown };
    if (typeof parsed.answer !== "string" || parsed.answer.trim().length === 0) {
      return {
        kind: "UNAVAILABLE",
        model,
        why: "error",
        detail: "the response carried no answer string",
        ms: elapsed(),
      };
    }
    return {
      kind: "WROTE",
      model,
      answer: parsed.answer.trim(),
      citedUrls: Array.isArray(parsed.citedUrls)
        ? parsed.citedUrls.filter((u): u is string => typeof u === "string")
        : [],
      ms: elapsed(),
      usage: readCacheUsage(body),
      outputTokens:
        typeof body.usage?.output_tokens === "number" ? body.usage.output_tokens : 0,
    };
  } catch (error) {
    return {
      kind: "UNAVAILABLE",
      model,
      why: "error",
      detail: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
      ms: elapsed(),
    };
  }
}

/* ── the money ───────────────────────────────────────────────────────────── */

/**
 * What one call cost, at the published rate for that model.
 *
 * **A model with no published rate in `ASK_MODEL_RATES` returns null and is
 * never costed at zero.** A missing price is a missing measurement; printing
 * `$0.0000` for it would put a number in a comparison table that nothing
 * measured, and the table would be believed.
 *
 * Cache-read and cache-creation tokens are priced at their published
 * multipliers so this function stays correct if it is ever pointed at a cached
 * call. On the comparison arms both are zero by construction — the seam sends
 * no `cache_control` — which is asserted in the harness rather than assumed
 * here.
 */
export function callUsd(
  model: string,
  usage: CacheUsage,
  outputTokens: number,
): number | null {
  const rate: ModelRate | undefined = ASK_MODEL_RATES[model];
  if (!rate) return null;
  const perInput = rate.inputUsdPerMillion / 1_000_000;
  const perOutput = rate.outputUsdPerMillion / 1_000_000;
  return (
    usage.inputTokens * perInput +
    /* The documented multipliers: a 5-minute write bills 1.25x base, a read
       bills 0.1x. Both are zero on this seam and neither is a guess. */
    usage.cacheCreationInputTokens * perInput * 1.25 +
    usage.cacheReadInputTokens * perInput * 0.1 +
    outputTokens * perOutput
  );
}
