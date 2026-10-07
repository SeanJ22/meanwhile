import {
  ROUTINE_RECORD_CLASSES,
  VALIDATION_CHECKS,
  type ValidationCheck,
  type ValidationReceipt,
} from "./types.ts";

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validInstant(value: unknown): value is string {
  return nonempty(value) && Number.isFinite(Date.parse(value));
}

export function parseValidationReceipt(value: unknown): ValidationReceipt | null {
  const row = object(value);
  if (
    row?.contractVersion !== 2 ||
    !["GOOD", "FAIL", "CANNOT_TELL"].includes(String(row.decision)) ||
    !nonempty(row.candidateId) ||
    !nonempty(row.sourceId) ||
    typeof row.recordClass !== "string" ||
    !(ROUTINE_RECORD_CLASSES as readonly string[]).includes(row.recordClass) ||
    !nonempty(row.scope) ||
    !validInstant(row.validatedAt) ||
    !Array.isArray(row.checks) ||
    !Array.isArray(row.excludedFacts)
  ) return null;

  const checks: ValidationCheck[] = [];
  for (let index = 0; index < row.checks.length; index += 1) {
    const check = object(row.checks[index]);
    if (
      !check ||
      check.check !== VALIDATION_CHECKS[index] ||
      !["PASS", "FAIL", "CANNOT_TELL"].includes(String(check.verdict)) ||
      !nonempty(check.code) ||
      !nonempty(check.detail)
    ) return null;
    checks.push(check as unknown as ValidationCheck);
  }
  if (checks.length !== VALIDATION_CHECKS.length) return null;
  if (row.decision === "GOOD" && checks.some((check) => check.verdict !== "PASS")) return null;
  if (row.decision === "FAIL" && !checks.some((check) => check.verdict === "FAIL")) return null;
  if (
    row.decision === "CANNOT_TELL" &&
    (checks.some((check) => check.verdict === "FAIL") || !checks.some((check) => check.verdict === "CANNOT_TELL"))
  ) return null;

  for (const value of row.excludedFacts) {
    const fact = object(value);
    if (
      !fact ||
      !nonempty(fact.code) ||
      !nonempty(fact.detail) ||
      ("key" in fact && fact.key !== undefined && fact.key !== null && typeof fact.key !== "string")
    ) return null;
  }
  return row as unknown as ValidationReceipt;
}
