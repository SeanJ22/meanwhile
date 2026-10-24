export function sameSeatDiscriminators(contestTitle: string, holderTitle: string, ocdId: string): boolean {
  const seatNumber = (value: string) => {
    if (/^\d+$/.test(value)) return String(Number(value));
    const roman: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100 };
    const digits = [...value.toLowerCase()].map(letter => roman[letter]);
    return String(digits.reduce((total, digit, index) => total + (digit < (digits[index + 1] ?? 0) ? -digit : digit), 0));
  };
  const qualifiers = (title: string) => {
    const found = new Map<string, string>();
    for (const match of title.matchAll(/\b(ward|seat|position|division|district|dist\.?)\s*(?:no\.?\s*)?[:#]?\s*(\d+|[ivxlc]+)\b/gi))
      found.set(/^dist/i.test(match[1]) ? "district" : match[1].toLowerCase(), seatNumber(match[2]));
    for (const match of title.matchAll(/\b(\d+)(?:st|nd|rd|th)?\s+(?:congressional\s+)?district\b/gi)) found.set("district", seatNumber(match[1]));
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
