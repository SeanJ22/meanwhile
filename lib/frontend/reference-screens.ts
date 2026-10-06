/**
 * **FE-25 — the reference set for side-by-side judging.**
 *
 * The set starts with our own best screens (the "Good live example (Sean, ...)"
 * lines FE-24 keeps in the look standard) and grows with `named-product` rows in
 * `data/frontend/reference-screens/index.json` when Sean names a product. Nothing
 * waits on the second kind.
 */
export interface ReferenceScreen {
  /** The screenshot's key in the image store. */
  key: string;
  label: string;
  source: "sean-like" | "named-product";
}

const GOOD_LINE = /^Good live example \(Sean, [^)]*\): (.+?) \[([^\]]+)\]/;

/** Sean's likes, read from the look standard. */
export function likedScreens(standard: string): ReferenceScreen[] {
  const out: ReferenceScreen[] = [];
  for (const line of standard.split("\n")) {
    const m = GOOD_LINE.exec(line);
    if (m) out.push({ key: m[2], label: m[1], source: "sean-like" });
  }
  return out;
}

/** The data file's rows, dropping any that do not hold. */
export function readReferenceIndex(raw: string): ReferenceScreen[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const list = (parsed as { screens?: unknown } | null)?.screens;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (s): s is ReferenceScreen =>
      !!s && typeof s.key === "string" && !!s.key && typeof s.label === "string" && (s.source === "sean-like" || s.source === "named-product"),
  );
}

/** Both kinds, once per key. */
export function referenceSet(standard: string, indexRaw: string): ReferenceScreen[] {
  const seen = new Set<string>();
  return [...likedScreens(standard), ...readReferenceIndex(indexRaw)].filter((r) => !seen.has(r.key) && !!seen.add(r.key));
}
