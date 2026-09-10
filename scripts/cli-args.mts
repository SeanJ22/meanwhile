/**
 * Command-line flags, read the same way by every script that needs them.
 * (2026-08-27, the descent-resume session. **RULING 103**.)
 *
 * Two scripts written in the same session grew a byte-identical
 * repeated-flag parser — `args()` in `ladder-monotonicity.mts` and `argAll()`
 * in `walk-government-directory.mts` — and `tests/duplicate-implementations.test.ts`
 * refused the commit, which is what it is for.
 *
 * `repeated` is the one worth having in a shared place: `--url a --url b` is
 * how a walk is pointed at more than one directory, and hand-rolling the loop
 * is how one copy quietly starts skipping the last value.
 */

/** The value after `--name`, or undefined. */
export function flag(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** The value in `--name=value`, or null when that assignment is absent. */
export function assignment(argv: readonly string[], name: string): string | null {
  const prefix = `--${name}=`;
  return argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

/** A non-empty `--name=value`, with the caller's fail-closed error family. */
export function requiredAssignment(
  argv: readonly string[],
  name: string,
  errorCode: string,
): string {
  const value = assignment(argv, name)?.trim() ?? "";
  if (value === "") throw new Error(`${errorCode}:${name}`);
  return value;
}

/** Whether `--name` is present at all. */
export function present(argv: readonly string[], name: string): boolean {
  return argv.includes(`--${name}`);
}

/** Every value of a flag that may be repeated: `--url a --url b` -> [a, b]. */
export function repeated(argv: readonly string[], name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === `--${name}` && argv[i + 1] !== undefined) out.push(argv[i + 1]);
  }
  return out;
}
