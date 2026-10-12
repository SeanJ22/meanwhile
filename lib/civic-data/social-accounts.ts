/** Only a profile address counts (one path segment, or the platform's own profile prefix); share and post links do not. */
import { platformForUrl, type SocialPlatform } from "../officials/social-platforms.ts";
import type { AccountKind, SocialAccount } from "../officials/types.ts";

/** Where a link was found decides whose account it is. A personal page is never inferred from where a link sits. */
export type SocialPageKind = "OFFICIAL_PAGE" | "CAMPAIGN_SITE";
export const ACCOUNT_KIND_FOR_PAGE: Readonly<Record<SocialPageKind, AccountKind>> = { OFFICIAL_PAGE: "OFFICIAL", CAMPAIGN_SITE: "CAMPAIGN" };

const NOT_A_PROFILE = new Set([
  "share", "sharer", "sharer.php", "intent", "dialog", "plugins", "tr", "hashtag", "search", "login", "logout", "signup", "home", "explore",
  "i", "p", "reel", "reels", "stories", "watch", "embed", "status", "posts", "photo", "photos", "events", "groups", "pages", "policy",
  "privacy", "legal", "about", "help", "settings", "feed", "pub", "jobs", "learning", "sharearticle",
]);
const PREFIXED = new Set(["in", "company", "channel", "c", "user"]);

function candidates(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\bhref\s*=\s*(?:"([^"]+)"|'([^']+)')/gi)) out.push(m[1] ?? m[2]);
  for (const m of text.matchAll(/https?:\/\/[^\s"'<>)\]]+/gi)) out.push(m[0]);
  return out.map((raw) => raw.replace(/&amp;/g, "&").replace(/[.,;:]+$/, "")).filter((raw) => /^https?:\/\//i.test(raw));
}

export function profileAddress(link: string): string | null {
  let url: URL;
  try { url = new URL(link); } catch { return null; }
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;
  const first = segments[0];
  const lower = first.toLowerCase();
  let path: string;
  if (first.startsWith("@")) {
    if (first.length < 2) return null;
    path = `/${first}`;
  } else if (PREFIXED.has(lower)) {
    if (!segments[1] || segments.length > 2) return null;
    path = `/${lower}/${segments[1]}`;
  } else {
    if (NOT_A_PROFILE.has(lower) || segments.length > 1 || /^\d+$/.test(first) || url.pathname.toLowerCase().endsWith(".php")) return null;
    path = `/${first}`;
  }
  return `https://${url.hostname.toLowerCase().replace(/^www\./, "")}${path}`;
}

export function socialAccountsOnPage(input: {
  readonly pageUrl: string; readonly text: string; readonly pageKind: SocialPageKind;
  readonly platforms: readonly SocialPlatform[]; readonly collectedAt: string;
}): readonly SocialAccount[] {
  const seen = new Set<string>();
  const out: SocialAccount[] = [];
  for (const link of candidates(input.text)) {
    const platform = platformForUrl(link, input.platforms);
    if (!platform) continue;
    const address = profileAddress(link);
    if (!address || platformForUrl(input.pageUrl, input.platforms)) continue;
    const key = `${platform.id}|${address.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ platform: platform.id, url: address, accountKind: ACCOUNT_KIND_FOR_PAGE[input.pageKind], sourceUrl: input.pageUrl, collectedAt: input.collectedAt });
  }
  return out;
}

export function accountIsOnPage(account: SocialAccount, text: string, platforms: readonly SocialPlatform[]): boolean {
  if (!platformForUrl(account.url, platforms)) return false;
  const want = profileAddress(account.url)?.toLowerCase();
  return want !== undefined && candidates(text).some((link) => profileAddress(link)?.toLowerCase() === want);
}
