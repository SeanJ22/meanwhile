/** The social platform list, one setting read by every surface, so a platform added in Admin shows with no deploy. */
import { registerSetting, type SettingValue } from "../control-plane/settings.ts";
import type { AccountKind, DirectorySocial, SocialAccount, SocialAccounts } from "./types.ts";

export interface SocialPlatform {
  /** Stable key, lowercase. */
  id: string;
  /** What the pill says. */
  label: string;
  /** Host names that identify the platform (`x.com`, never a full URL). */
  urlPatterns: readonly string[];
  /** `{handle}` is replaced by the account's bare handle. */
  profileUrlTemplate: string;
  /** Which mark the pill draws. */
  iconKey: string;
}

export const SOCIAL_PLATFORMS_SETTING = "officials.socialPlatforms";

/** The platform whose pill the small popup keeps; the rest are large-card only. */
export const PRIMARY_SOCIAL_PLATFORM_ID = "x";

export const DEFAULT_SOCIAL_PLATFORMS: readonly SocialPlatform[] = [
  { id: "facebook", label: "Facebook", urlPatterns: ["facebook.com", "fb.com"], profileUrlTemplate: "https://facebook.com/{handle}", iconKey: "facebook" },
  { id: "x", label: "X", urlPatterns: ["x.com", "twitter.com"], profileUrlTemplate: "https://x.com/{handle}", iconKey: "x" },
  { id: "instagram", label: "Instagram", urlPatterns: ["instagram.com"], profileUrlTemplate: "https://instagram.com/{handle}", iconKey: "instagram" },
  { id: "youtube", label: "YouTube", urlPatterns: ["youtube.com", "youtu.be"], profileUrlTemplate: "https://youtube.com/{handle}", iconKey: "youtube" },
  { id: "linkedin", label: "LinkedIn", urlPatterns: ["linkedin.com"], profileUrlTemplate: "https://linkedin.com/in/{handle}", iconKey: "linkedin" },
  { id: "tiktok", label: "TikTok", urlPatterns: ["tiktok.com"], profileUrlTemplate: "https://tiktok.com/@{handle}", iconKey: "tiktok" },
];

const ACCOUNT_KINDS: readonly AccountKind[] = ["OFFICIAL", "CAMPAIGN", "PERSONAL_PUBLIC"];

function validPlatform(value: unknown): value is SocialPlatform {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const p = value as Record<string, unknown>;
  return typeof p.id === "string" && /^[a-z][a-z0-9-]{0,23}$/.test(p.id)
    && typeof p.label === "string" && p.label.trim() !== "" && p.label.length <= 24
    && Array.isArray(p.urlPatterns) && p.urlPatterns.length > 0 && p.urlPatterns.length <= 8
    && p.urlPatterns.every((h) => typeof h === "string" && /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(h))
    && typeof p.profileUrlTemplate === "string" && /^https:\/\/[^\s{}]+\{handle\}[^\s{}]*$/.test(p.profileUrlTemplate)
    && typeof p.iconKey === "string" && /^[a-z][a-z0-9-]{0,23}$/.test(p.iconKey);
}

/** At least one platform, 20 at most, no repeated id. */
export function validSocialPlatforms(value: unknown): value is readonly SocialPlatform[] {
  return Array.isArray(value) && value.length >= 1 && value.length <= 20 && value.every(validPlatform)
    && new Set(value.map((p) => p.id)).size === value.length;
}

/** The published list when it is valid, else the code default. */
export function socialPlatformsOrDefault(value: unknown): readonly SocialPlatform[] {
  return validSocialPlatforms(value) ? value : DEFAULT_SOCIAL_PLATFORMS;
}

registerSetting({
  key: SOCIAL_PLATFORMS_SETTING, label: "Social platforms shown as pills, with their URL patterns",
  defaultValue: DEFAULT_SOCIAL_PLATFORMS as unknown as SettingValue,
  readerFacing: true, control: "json",
  validate: (value): value is SettingValue => validSocialPlatforms(value),
});

function hostOf(url: string): string | null {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return null; }
}

/** The platform a URL belongs to, by host — a subdomain of a pattern host counts. */
export function platformForUrl(url: string, platforms: readonly SocialPlatform[]): SocialPlatform | null {
  const host = hostOf(url);
  if (host === null) return null;
  return platforms.find((p) => p.urlPatterns.some((h) => host === h || host.endsWith(`.${h}`))) ?? null;
}

/** A bare handle (or an `@handle`) becomes the platform's profile URL; a full URL is kept as given. */
export function profileUrl(platform: SocialPlatform, handleOrUrl: string): string {
  const value = handleOrUrl.trim();
  if (/^https?:\/\//i.test(value)) return value;
  return platform.profileUrlTemplate.replace("{handle}", encodeURIComponent(value.replace(/^@/, "")));
}

function isAccountList(value: unknown): value is readonly SocialAccount[] {
  return Array.isArray(value);
}

/** The stored record's accounts as one list; the directory's per-platform fields are official accounts. */
export function socialAccountsOf(
  stored: SocialAccounts | undefined,
  platforms: readonly SocialPlatform[] = DEFAULT_SOCIAL_PLATFORMS,
  held: { sourceUrl: string; collectedAt: string } = { sourceUrl: "https://github.com/unitedstates/congress-legislators", collectedAt: "" },
): readonly SocialAccount[] {
  if (stored === undefined) return [];
  if (isAccountList(stored)) return stored.filter((a) => ACCOUNT_KINDS.includes(a.accountKind));
  const legacy: DirectorySocial = stored;
  const out: SocialAccount[] = [];
  const add = (platformId: string, handleOrUrl: string | undefined, accountKind: AccountKind = "OFFICIAL") => {
    const platform = platforms.find((p) => p.id === platformId);
    if (!platform || !handleOrUrl) return;
    out.push({ platform: platform.id, url: profileUrl(platform, handleOrUrl), accountKind, sourceUrl: held.sourceUrl, collectedAt: held.collectedAt });
  };
  // The directory's field is `twitter`; the platform is X.
  add("x", legacy.twitter);
  add("facebook", legacy.facebook);
  add("youtube", legacy.youtubeId ? `https://youtube.com/channel/${legacy.youtubeId}` : legacy.youtube);
  add("instagram", legacy.instagram);
  if (legacy.mastodon) {
    const handle = legacy.mastodon.replace(/^@/, "").split("@");
    const url = legacy.mastodon.startsWith("http") ? legacy.mastodon
      : handle.length === 2 ? `https://${handle[1]}/@${handle[0]}` : `https://mastodon.social/@${handle[0]}`;
    add("mastodon", url);
  }
  return out;
}

/** The pill's label: a handle for X (the pill has always said who), the platform's label otherwise. */
export function accountLabel(platform: SocialPlatform, account: SocialAccount): string {
  if (platform.id !== PRIMARY_SOCIAL_PLATFORM_ID) return platform.label;
  const handle = account.url.replace(/[?#].*$/, "").split("/").filter(Boolean).pop();
  return handle ? `@${handle.replace(/^@/, "")}` : platform.label;
}
