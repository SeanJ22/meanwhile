/** A failure's diagnostic, safe to persist: each error in the cause chain as `name(code, errno): message`, sanitized. */

export const ERROR_DIAGNOSTIC_MAX_CHARS = 1_200;
const MAX_CAUSE_DEPTH = 5;
const MAX_AGGREGATE_MEMBERS = 3;

const REDACTIONS: readonly (readonly [RegExp, string])[] = [
  // Any scheme://..., postgres:// and postgresql:// included.
  [/\b[a-z][a-z0-9+.-]*:\/\/[^\s'"`<>]*/gi, "[url-redacted]"],
  // A postgres target written without slashes.
  [/\bpostgres(?:ql)?:[^\s'"`<>]*/gi, "[url-redacted]"],
  // libpq-style settings that name a host, user or secret.
  [/\b(host|hostaddr|password|passwd|pwd|user|username|sslpassword|dbname)\s*=\s*[^\s&;,'"`]*/gi, "$1=[redacted]"],
  // user@host (and every e-mail address).
  [/[^\s@'"`<>/:()[\]]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi, "[user@host-redacted]"],
  // A bare endpoint name (a socket or TLS error names the host it dialled).
  [/\b(?:[a-z0-9-]+\.){2,}[a-z]{2,}\b/gi, "[host-redacted]"],
  // An IPv4 address, with its port.
  [/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, "[ip-redacted]"],
];

/** Remove every credential- or endpoint-shaped span from diagnostic text. */
export function redactDiagnosticText(text: string): string {
  return REDACTIONS.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), text);
}

function field(value: unknown, key: string): unknown {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

function describe(value: unknown): string {
  if (value === null || typeof value !== "object") return String(value);
  const name = typeof field(value, "name") === "string" ? field(value, "name") as string : "Error";
  const message = typeof field(value, "message") === "string" ? field(value, "message") as string : String(value);
  const tags = ["code", "errno"]
    .map((key) => field(value, key))
    .filter((tag): tag is string | number => (typeof tag === "string" && tag !== "") || typeof tag === "number")
    .map(String);
  const members = field(value, "errors");
  const aggregate = Array.isArray(members) && members.length > 0
    ? ` [${members.slice(0, MAX_AGGREGATE_MEMBERS).map(describe).join("; ")}${members.length > MAX_AGGREGATE_MEMBERS ? "; ..." : ""}]`
    : "";
  const label = name === "Error" && tags.length === 0 ? "" : `${name}${tags.length > 0 ? `(${tags.join(", ")})` : ""}: `;
  return `${label}${message}${aggregate}`;
}

/** Each error in the cause chain, sanitized, one line, at most `maxChars`. */
export function sanitizedErrorDiagnostic(error: unknown, maxChars: number = ERROR_DIAGNOSTIC_MAX_CHARS): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current !== undefined && current !== null && !seen.has(current); depth += 1) {
    seen.add(current);
    parts.push(describe(current));
    current = field(current, "cause") ?? field(current, "sourceError");
  }
  const text = redactDiagnosticText(parts.join(" <- ").replace(/\s+/g, " ").trim()) || "unknown error";
  return text.length > maxChars ? `${text.slice(0, Math.max(0, maxChars - 3))}...` : text;
}
