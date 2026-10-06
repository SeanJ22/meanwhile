/**
 * **SOCIAL ACCOUNTS READ OFF PAGES WE ALREADY HOLD (CA-05).**
 *
 * A profile link counts for a person only when it is a link in that person's
 * own block of a saved page, on a platform in the social platform list
 * (`lib/officials/social-platforms.ts`, a setting). Its `accountKind` is set by
 * where it was found: the official roster or profile page is OFFICIAL, a
 * verified campaign site is CAMPAIGN. A link read off a personal page, a news
 * page or a page that merely mentions the person is never collected here. The
 * check is that the link is on the saved page, which §3 re-runs on the exact
 * published value (`socials.<platform>` field).
 *
 * Pure: no host imports beyond the platform list, so it may sit in a worker
 * closure.
 */
import { DEFAULT_SOCIAL_PLATFORMS, platformForUrl, type SocialPlatform } from "../officials/social-platforms.ts";
import type { AccountKind, SocialAccount } from "../officials/types.ts";

/** The field a platform's account is published under: `socials.<platform id>`. */
export const SOCIAL_FIELD_PREFIX = "socials.";
export const socialField = (platformId: string): string => `${SOCIAL_FIELD_PREFIX}${platformId}`;

/** Endpoints that act on a page (share, intent, embed) are not accounts, nor are bare platform homepages. */
const NOT_AN_ACCOUNT = /^\/(?:share(?:r|\.php)?|sharer\.php|intent|dialog|plugins|tr|login|signup|home|explore|watch|hashtag|search|embed|i|policies|privacy|help)(?:\/|$|\?)/i;

const decode = (text: string) => text.replace(/&amp;/gi, "&").replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, "\"");

/** Profile links in a block of saved HTML, one per platform (the first on the block), in the platform list's order. */
export function socialLinksIn(html: string, pageUrl: string, platforms: readonly SocialPlatform[] = DEFAULT_SOCIAL_PLATFORMS): readonly { readonly platform: string; readonly url: string }[] {
  const found = new Map<string, string>();
  for (const match of html.matchAll(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    let url: URL;
    try { url = new URL(decode(match[1] ?? match[2]), pageUrl); } catch { continue; }
    if (url.protocol !== "https:" && url.protocol !== "http:") continue;
    const platform = platformForUrl(url.href, platforms);
    if (!platform || found.has(platform.id)) continue;
    if (url.pathname.replace(/\/+$/, "") === "" || NOT_AN_ACCOUNT.test(url.pathname)) continue;
    found.set(platform.id, url.href);
  }
  return platforms.flatMap(p => found.has(p.id) ? [{ platform: p.id, url: found.get(p.id)! }] : []);
}

/** The `socials.<platform>` fields a reading proposes for a member, from that member's own block. */
export function socialFieldsIn(blockHtml: string, pageUrl: string, platforms?: readonly SocialPlatform[]): Readonly<Record<string, string>> {
  return Object.fromEntries(socialLinksIn(blockHtml, pageUrl, platforms).map(link => [socialField(link.platform), link.url]));
}

/** Accounts from the `socials.*` fields §3 verified on the saved page; anything unverified or off the list is dropped. */
export function verifiedSocialAccounts(input: {
  readonly fields: Readonly<Record<string, unknown>>;
  readonly verified: readonly string[];
  readonly accountKind: AccountKind;
  readonly sourceUrl: string;
  readonly collectedAt: string;
  readonly platforms?: readonly SocialPlatform[];
}): readonly SocialAccount[] {
  const platforms = input.platforms ?? DEFAULT_SOCIAL_PLATFORMS;
  return platforms.flatMap(platform => {
    const field = socialField(platform.id), url = input.fields[field];
    if (!input.verified.includes(field) || typeof url !== "string" || platformForUrl(url, [platform]) === null) return [];
    return [{ platform: platform.id, url, accountKind: input.accountKind, sourceUrl: input.sourceUrl, collectedAt: input.collectedAt }];
  });
}

/** Where a link was found sets what kind of account it is. A page that is neither official nor the candidate's verified own site sets none. */
export function accountKindForPage(page: { readonly official: boolean; readonly campaign: boolean }): AccountKind | null {
  return page.official ? "OFFICIAL" : page.campaign ? "CAMPAIGN" : null;
}
