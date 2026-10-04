/** The CI planner calls this only for a diff contained in one source kind and its fixtures. */
export function adapterTestSelection(input: {
  readonly changed: readonly string[]; readonly tests: readonly string[]; readonly readText: (path: string) => string;
}): { readonly kind: string; readonly files: readonly string[] } | null {
  const sourceChanges = input.changed.filter(path => path.startsWith("lib/sources/"));
  const kinds = [...new Set(sourceChanges.map(path => path.split("/")[2]!))];
  if (kinds.length !== 1 || ["composite", "platform-adapters", "mock", "snapshot"].includes(kinds[0]!)) return null;
  const kind = kinds[0]!;
  const prefix = `lib/sources/${kind}/`;
  const matching = input.tests.filter(path => {
    try { return input.readText(path).includes(prefix); } catch { return false; }
  });
  const composite = input.tests.filter(path => ["tests/composite.test.ts", "tests/composite-failure-kind.test.ts"].includes(path));
  if (!matching.length || !composite.includes("tests/composite.test.ts")) return null;
  if (input.changed.some(path => !path.startsWith(prefix) && !path.startsWith(`tests/fixtures/${kind}/`) && !matching.includes(path))) return null;
  return { kind, files: [...new Set([...matching, ...composite])].sort() };
}
