import assert from "node:assert/strict";

export function configuredReaderProofPath(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
  fallback: string,
): string {
  if (!(name in environment)) return fallback;
  const value = environment[name]?.trim();
  assert.ok(value, `${name} is present but empty`);
  return value;
}
