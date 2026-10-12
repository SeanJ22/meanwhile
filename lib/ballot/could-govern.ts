export const COULD_GOVERN_TEXT = "Could govern you";

export const COULD_GOVERN_ACTION = "add your address to confirm";

export const COULD_GOVERN_SENTENCE = `${COULD_GOVERN_TEXT} — ${COULD_GOVERN_ACTION}`;

const SMALL_WORDS = new Set(["of", "the", "and", "at", "on", "in", "for"]);

export function jurisdictionNameFromOcdId(ocdId: string): string | null {
  const segments = ocdId.split("/").filter((s) => s.includes(":"));
  const CONTAINERS = new Set(["ocd-division", "country", "state"]);
  const body = [...segments]
    .reverse()
    .find((s) => !CONTAINERS.has(s.split(":")[0] ?? ""));
  if (body === undefined) return null;
  const [type, value] = body.split(":");
  if (value === undefined || value.length === 0) return null;

  if (type === "cd") return `${ordinal(value)} Congressional District`;

  const titled = value
    .split("_")
    .map((word, i) =>
      i > 0 && SMALL_WORDS.has(word)
        ? word
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(" ");
  return type === "county" ? `${titled} County` : titled;
}

/** `11` → `11th`. Only the three irregular endings need naming. */
function ordinal(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  const ones = n % 10;
  return `${n}${ones === 1 ? "st" : ones === 2 ? "nd" : ones === 3 ? "rd" : "th"}`;
}
