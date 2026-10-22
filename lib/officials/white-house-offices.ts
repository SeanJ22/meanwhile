/** The national executive offices whitehouse.gov lists: the President, the Vice President, and one office per Cabinet title.
 * The White House source, its publication and the reader share this one classification. */
export type WhiteHouseOffice = "president" | "vice-president" | `cabinet:${string}`;

/** Cabinet titles as whitehouse.gov writes them ("Secretary of the Treasury", "Attorney General", "Director of National Intelligence",
 * "United States Trade Representative", "Administrator of the Small Business Administration"). */
const CABINET_TITLE = /^(?:Secretary of \S|Attorney General$|Director of \S|Administrator of \S|(?:United States |U\.S\. )?Trade Representative$|(?:White House )?Chief of Staff$|(?:United States |U\.S\. )?Ambassador to the United Nations$|Chair(?:man|woman)? of \S)/i;

export function whiteHouseOffice(title: string | null | undefined): WhiteHouseOffice | null {
  const value = (title ?? "").trim();
  if (/^President(?: of the United States)?$/i.test(value)) return "president";
  if (/^Vice President(?: of the United States)?$/i.test(value)) return "vice-president";
  if (!CABINET_TITLE.test(value)) return null;
  return `cabinet:${value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
}

/** The President leads, then the Vice President, then the Cabinet. */
export function whiteHouseOfficeRank(title: string | null | undefined): number {
  const office = whiteHouseOffice(title);
  return office === "president" ? 0 : office === "vice-president" ? 1 : office ? 2 : 3;
}
