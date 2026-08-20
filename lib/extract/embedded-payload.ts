import { cannotRun, extracted, zeroRows } from "./types.ts";
import type { ExtractResult } from "./types.ts";

/**
 * LAYER 4 — the embedded CMS payload (F11, Prompt C item 12).
 *
 * ## This layer is why F11 stopped being about PDFs
 *
 * Vail Unified's superintendent was carried as "Carruth" — a surname with no
 * given name, which this product will not ship about a real person. The cause
 * was none of the three anyone guessed. The link was in the static HTML. The
 * page answered **200 to a plain fetch**. And "John Carruth" was in that HTML
 * **six times**.
 *
 * The fetch worked, discovery worked, and THE EXTRACTION READ NOTHING: the
 * district runs on **Apptegy**, which ships its page content as an escaped
 * JSON payload inside a `<script>` tag. A reader of the RENDERED PROSE finds a
 * news blurb saying "Superintendent Carruth" and never the byline, because the
 * byline is in the payload and the prose is not.
 *
 * That failure is invisible from every layer above it. The class size here is
 * bounded — two bodies on Apptegy — but the failure MODE is not: every CMS
 * that hydrates from an embedded payload has it, and there is no signal in a
 * successful fetch that distinguishes them.
 *
 * ## What it does
 *
 * Finds every `<script>` whose body is or contains JSON, parses it, and walks
 * it to a flat list of every string worth reading, each with the key path it
 * came from. The key path is the point: `pageContent.staff[3].name` is
 * evidence, and a bare string in a blob is not.
 *
 * THREE ENCODINGS, because CMSes use all three and the difference is invisible
 * from outside:
 *   1. A plain JSON script (`type="application/json"`, Next's `__NEXT_DATA__`,
 *      JSON-LD).
 *   2. A JSON string ASSIGNED to a variable (`window.__DATA__ = {...}`).
 *   3. A DOUBLY-encoded payload — a JSON string whose value is itself JSON,
 *      which is Apptegy's shape and the one that produced this row.
 *
 * ## The interface
 *
 *   extractEmbeddedPayload(html, source) -> ExtractResult<PayloadString>
 */

export interface PayloadString {
  /** Dotted key path inside the payload — the provenance of the value. */
  path: string;
  value: string;
  /** Which `<script>` it came from, in document order. */
  script: number;
}

const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;

/** Strings shorter than this are ids, flags and CSS, not content. */
const MIN_VALUE_CHARS = 2;

/** A payload can be enormous; this bounds the walk rather than the truth. */
const MAX_STRINGS = 20000;

function tryParse(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

/**
 * Pull the JSON payload out of a script body that is not itself JSON.
 *
 * THREE SHAPES, and the scanner has to walk the text as JAVASCRIPT rather than
 * hunting for a brace, because the brace it wants is frequently inside a string
 * literal:
 *
 *   window.__DATA__ = {"a":1}          a bare object literal
 *   window.__DATA__ = [1,2]            a bare array literal
 *   window.__DATA__ = "{\"a\":1}"      a JSON STRING whose value is JSON
 *
 * The third is Apptegy's, and it is the one that produced this row. Its first
 * `{` sits inside a quoted string with escaped inner quotes, so a scanner that
 * starts at the first brace captures `{\"a\":1}` — which is not valid JSON —
 * and gives up. Missing it is exactly how a byline printed six times in the
 * HTML was recorded as absent.
 */
export function firstJsonLiteral(text: string): unknown {
  let inString = false;
  let escaped = false;
  let quote = "";
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === quote) inString = false;
      continue;
    }
    if (c === '"' || c === "'") {
      // A STRING literal at the top level. Its value may itself be JSON.
      const literal = readStringLiteral(text, i);
      if (literal) {
        const asJson = tryParse(literal.value);
        if (asJson !== undefined && typeof asJson === "object") return asJson;
        i = literal.end;
        continue;
      }
      inString = true;
      quote = c;
      continue;
    }
    if (c === "{" || c === "[") {
      const balanced = readBalanced(text, i);
      if (balanced !== undefined) return balanced;
    }
  }
  return undefined;
}

/** The literal starting at `from`, decoded. Null when it does not terminate. */
function readStringLiteral(
  text: string,
  from: number,
): { value: string; end: number } | null {
  const quote = text[from];
  let out = "";
  let escaped = false;
  for (let i = from + 1; i < text.length; i += 1) {
    const c = text[i]!;
    if (escaped) {
      out += c === "n" ? "\n" : c === "t" ? "\t" : c;
      escaped = false;
      continue;
    }
    if (c === "\\") {
      escaped = true;
      continue;
    }
    if (c === quote) return { value: out, end: i };
    out += c;
  }
  return null;
}

/** The balanced object or array starting at `from`, parsed. */
function readBalanced(text: string, from: number): unknown {
  const open = text[from];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = from; i < text.length; i += 1) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === open) depth += 1;
    else if (c === close) {
      depth -= 1;
      if (depth === 0) return tryParse(text.slice(from, i + 1));
    }
  }
  return undefined;
}

/**
 * Every string in a parsed payload, with its key path.
 *
 * A string that is ITSELF valid JSON is parsed and walked — that is the
 * doubly-encoded case, and skipping it is exactly how the Apptegy byline was
 * missed.
 */
export function walkStrings(
  node: unknown,
  path: string,
  out: PayloadString[],
  script: number,
  depth = 0,
): void {
  if (out.length >= MAX_STRINGS || depth > 40) return;
  if (typeof node === "string") {
    const nested = node.trim().startsWith("{") || node.trim().startsWith("[")
      ? tryParse(node)
      : undefined;
    if (nested !== undefined) {
      walkStrings(nested, `${path}«json»`, out, script, depth + 1);
      return;
    }
    const value = node.trim();
    if (value.length >= MIN_VALUE_CHARS) out.push({ path, value, script });
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => walkStrings(v, `${path}[${i}]`, out, script, depth + 1));
    return;
  }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      walkStrings(v, path ? `${path}.${k}` : k, out, script, depth + 1);
    }
  }
}

export function extractEmbeddedPayload(
  html: string,
  source: string,
): ExtractResult<PayloadString> {
  if (html.trim() === "") {
    return cannotRun("EMBEDDED_PAYLOAD", source, "the input is empty — nothing was fetched");
  }

  const bytes = Buffer.byteLength(html, "utf8");
  const out: PayloadString[] = [];
  let scripts = 0;
  let parsed = 0;

  SCRIPT.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SCRIPT.exec(html))) {
    scripts += 1;
    const body = m[2] ?? "";
    const payload = tryParse(body) ?? firstJsonLiteral(body);
    if (payload === undefined) continue;
    parsed += 1;
    walkStrings(payload, "", out, scripts);
  }

  const counts = { scripts, scriptsWithJson: parsed, strings: out.length };

  if (scripts === 0) {
    return zeroRows(
      "EMBEDDED_PAYLOAD",
      source,
      bytes,
      "the document carries no <script> element at all. Either it is not a " +
        "hydrated CMS page, or what was fetched is not the page — check for a " +
        "challenge interstitial served at 200 (lib/sources/http.ts, F20).",
      counts,
    );
  }
  if (out.length === 0) {
    return zeroRows(
      "EMBEDDED_PAYLOAD",
      source,
      bytes,
      `${scripts} <script> element(s) were read and none carried a parseable JSON ` +
        "payload. That is a finding about THIS PAGE, not about the body: the " +
        "content may genuinely be in the prose (use the text path), or the payload " +
        "may be fetched after load rather than embedded (ladder rung 7 — the " +
        "page's own network calls).",
      counts,
    );
  }

  return extracted("EMBEDDED_PAYLOAD", source, bytes, out, counts);
}

/**
 * The question a hunt actually asks: does this payload name this person?
 *
 * Returns every payload string containing the needle, with its key path — so a
 * hit is evidence with provenance rather than a substring match somebody has
 * to go and confirm by hand.
 */
export function findInPayload(
  result: ExtractResult<PayloadString>,
  needle: string,
): PayloadString[] {
  const lower = needle.toLowerCase();
  return result.items.filter((s) => s.value.toLowerCase().includes(lower));
}
