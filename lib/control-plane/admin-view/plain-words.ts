/** BR-39: machine diagnostics belong in Technical details, never on an Admin face. */
export const UNKNOWN_PROBLEM = "A problem we haven't described yet";
export function hasTechnicalText(value: string): boolean {
  return /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b|\b(?:wi|rt|at|act|adm|ri)-[a-f0-9]{6,}\b|\b[0-9a-f]{24,}\b|\b(?:TypeError|ReferenceError|SyntaxError|NeonDbError|Error):|\b(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOENT|EPERM)\b|\bat\s+\S+\([^\n]+:\d+:\d+\)/.test(value);
}
export const plainWords = (value: string, fallback = UNKNOWN_PROBLEM): string => hasTechnicalText(value) ? fallback : value;
