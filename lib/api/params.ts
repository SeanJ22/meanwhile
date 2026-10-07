/**
 * Query-parameter reading that refuses instead of defaulting. A missing
 * required parameter or a malformed one is a refusal with a stated reason; a
 * default stands in only for an absent optional parameter. `Number(...)` is not
 * used because `Number(null)` and `Number("")` are 0; `numeric()` accepts only
 * a finite decimal string.
 */

/** The refusal shape every route in this file returns. */
export interface ParamRefusal {
  error: string;
}

export type ParamResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * A finite decimal number, or a refusal naming the parameter and what arrived.
 * `absent` is "refuse" for a required parameter, or the number to use for an
 * optional one. A malformed value always refuses.
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
 * A string matching `pattern`, or a refusal. An absent optional parameter
 * yields `null`; a malformed one refuses rather than becoming `null`.
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

/** Every parameter a route knows; anything else the caller sent is named back. */
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
