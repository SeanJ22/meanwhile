export function sameSeatDiscriminators(contestTitle: string, holderTitle: string, ocdId: string): boolean {
  const qualifiers = (title: string) => {
    const found = new Map<string, string>();
    for (const match of title.matchAll(/\b(ward|seat|position|division|district)\s*(?:no\.?\s*)?[:#]?\s*(\d+|[ivxlc]+)\b/gi)) found.set(match[1].toLowerCase(), match[2].toLowerCase());
    for (const match of title.matchAll(/\b(\d+)(?:st|nd|rd|th)?\s+(?:congressional\s+)?district\b/gi)) found.set("district", match[1]);
    if (/\bat[-\s]large\b/i.test(title)) found.set("at-large", "true");
    return found;
  };
  const left = qualifiers(contestTitle), right = qualifiers(holderTitle);
  for (const kind of new Set([...left.keys(), ...right.keys()])) {
    const a = left.get(kind), b = right.get(kind);
    if (a && b) { if (a !== b) return false; continue; }
    if (kind === "district" && /\/(?:cd|sldl|sldu):[^/]+$/.test(ocdId)) continue;
    if (kind !== "at-large" && ocdId.endsWith(`/${kind}:${a ?? b}`)) continue;
    return false;
  }
  return true;
}
