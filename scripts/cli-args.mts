/** Command-line flags, read the same way by every script that needs them. */

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
