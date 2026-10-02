/**
 * Query-parameter reading that refuses instead of defaulting.
 *
 * ITEM 1b (2026-08-17). The h session's probe list
 * disclosed one nonsense read at **latitude 0, longitude 0** — a populated,
 * plausible-looking answer in the Gulf of Guinea, produced by a probe that
 * passed `?zip=85701` to a route that locates by `lat`/`lng`.
 *
 * The mechanism is one line of JavaScript, and it is not exotic:
 *
 * ```
 * Number(params.get("lat"))   // params.get returns null when absent
 * Number(null) === 0          // NOT NaN — null coerces to zero
 * ```
 *
 * Every `Number.isFinite` guard downstream therefore PASSED, both range checks
 * PASSED, and the route searched the Atlantic. The answer it returned was not
 * empty — it carried a centre, a radius that had climbed the whole ladder to
 * 150 km, a tier, and (because the `zip` parameter is read for the search log)
 * a `nearZip` of "85701". A manufactured claim, and worse than an empty
 * success: it also wrote a row into the search log — the store this product
 * SELLS — asserting that somebody searched near 85701 and found nothing.
 *
 * So: a missing required parameter is a refusal with a stated reason, and a
 * present-but-malformed parameter is a refusal too. A default may only stand
 * in for an ABSENT optional parameter, never for one the caller sent wrong.
 *
 * `Number(...)` is deliberately not used below. `numeric()` reads the raw
 * string and rejects anything that is not a finite decimal number, so neither
 * `null`, `""`, `" "`, `"abc"`, `"Infinity"`, nor `"0x10"` can become a
 * coordinate by coercion.
 */

/** The refusal shape every route in this file returns. */
export interface ParamRefusal {
  error: string;
}

export type ParamResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * A finite decimal number, or a refusal naming the parameter and what arrived.
 *
 * `absent` decides what a MISSING parameter means: "refuse" for a required
 * one, or a number to stand in for an optional one. A malformed value refuses
 * either way — that is the whole point of this file.
 */
export function numeric(
  params: URLSearchParams,
  name: string,
  absent: "refuse" | { default: number },
): ParamResult<number> {
  const raw = params.get(name);
  if (raw === null) {
    if (absent === "refuse") {
      return { ok: false, error: `${name} is required` };
    }
    return { ok: true, value: absent.default };
  }
  // Not Number(): "" and "  " coerce to 0, and that is the defect.
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(raw.trim())) {
    return { ok: false, error: `${name} must be a number, received ${JSON.stringify(raw)}` };
  }
  const value = Number(raw.trim());
  if (!Number.isFinite(value)) {
    return { ok: false, error: `${name} must be a finite number, received ${JSON.stringify(raw)}` };
  }
  return { ok: true, value };
}

/** A finite number inside an inclusive range, or a refusal naming the range. */
export function numericInRange(
  params: URLSearchParams,
  name: string,
  min: number,
  max: number,
  absent: "refuse" | { default: number },
): ParamResult<number> {
  const read = numeric(params, name, absent);
  if (!read.ok) return read;
  if (read.value < min || read.value > max) {
    return { ok: false, error: `${name} must be between ${min} and ${max}, received ${read.value}` };
  }
  return read;
}

/**
 * A string matching `pattern`, or a refusal.
 *
 * An absent optional parameter yields `null` — an honest "the caller did not
 * say". A malformed one refuses rather than silently becoming `null`, because
 * silently-null is how `?zip=8570` (four digits, a typo) would have been
 * logged as a search with no location instead of being sent back.
 */
export function matching(
  params: URLSearchParams,
  name: string,
  pattern: RegExp,
  absent: "refuse" | { default: null },
): ParamResult<string | null> {
  const raw = params.get(name);
  if (raw === null) {
    if (absent === "refuse") return { ok: false, error: `${name} is required` };
    return { ok: true, value: null };
  }
  if (!pattern.test(raw)) {
    return { ok: false, error: `${name} is malformed, received ${JSON.stringify(raw)}` };
  }
  return { ok: true, value: raw };
}

/**
 * Every parameter a route KNOWS. Anything else the caller sent is named back
 * to them rather than ignored.
 *
 * This is the half that would have caught the original defect at the door:
 * `?zip=85701` alone was not a malformed coordinate, it was a caller using a
 * parameter the route does not locate by. Ignoring unknown parameters is what
 * let a wrong request look like a right one.
 */
export function rejectUnknown(
  params: URLSearchParams,
  known: readonly string[],
): ParamResult<null> {
  const allowed = new Set(known);
  const unknown = [...new Set([...params.keys()])].filter((k) => !allowed.has(k));
  if (unknown.length > 0) {
    return {
      ok: false,
      error:
        `unknown parameter${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}. ` +
        `This route accepts: ${known.join(", ")}`,
    };
  }
  return { ok: true, value: null };
}

/** The 400 a refusal renders as, with the reason stated. */
export function refuse(error: string): Response {
  return Response.json({ error } satisfies ParamRefusal, { status: 400 });
}
