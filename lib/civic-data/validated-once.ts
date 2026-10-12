/** Keyed by the value object and its version together; a throw records nothing, so an invalid value keeps failing. */
const validated = new WeakMap<object, Set<string>>();
let runs = 0;

export function validateOnce(family: string, value: object, versionId: string, validate: () => void): void {
  if (typeof value !== "object" || value === null) {
    validate();
    runs += 1;
    return;
  }
  const key = `${family}\u0000${versionId}`;
  const seen = validated.get(value);
  if (seen?.has(key)) return;
  validate();
  runs += 1;
  if (seen) seen.add(key);
  else validated.set(value, new Set([key]));
}

export function edgeValidationsRun(): number {
  return runs;
}
