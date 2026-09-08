import type { SocialAccounts } from "./types.ts";

export type SocialChannelId =
  | "x"
  | "facebook"
  | "instagram"
  | "linkedin"
  | "youtube"
  | "tiktok"
  | "nextdoor"
  | "newsletter"
  | "mastodon";

export interface SocialChannelLink {
  id: SocialChannelId;
  label: string;
  pillLabel: string;
  href: string;
}

/**
 * One authoritative projection for both the large-card badges and contact
 * pills. A missing source field produces no placeholder, and ambiguous
 * networks accept only a complete http(s) URL rather than guessing a page.
 */
export function socialChannelLinks(social?: SocialAccounts): SocialChannelLink[] {
  if (!social) return [];
  const links: Array<SocialChannelLink | null> = [
    social.twitter ? {
      id: "x", label: "X", pillLabel: `@${social.twitter.replace(/^@/, "")}`,
      href: profileUrl(social.twitter, "https://x.com/"),
    } : null,
    social.facebook ? {
      id: "facebook", label: "Facebook", pillLabel: "Facebook",
      href: profileUrl(social.facebook, "https://facebook.com/"),
    } : null,
    social.instagram ? {
      id: "instagram", label: "Instagram", pillLabel: "Instagram",
      href: profileUrl(social.instagram, "https://instagram.com/"),
    } : null,
    social.linkedin && absoluteHttpUrl(social.linkedin) ? {
      id: "linkedin", label: "LinkedIn", pillLabel: "LinkedIn", href: social.linkedin,
    } : null,
    social.youtubeId || social.youtube ? {
      id: "youtube", label: "YouTube", pillLabel: "YouTube",
      href: social.youtubeId
        ? `https://youtube.com/channel/${encodeURIComponent(social.youtubeId)}`
        : profileUrl(social.youtube!, "https://youtube.com/"),
    } : null,
    social.tiktok ? {
      id: "tiktok", label: "TikTok", pillLabel: "TikTok",
      href: profileUrl(social.tiktok, "https://www.tiktok.com/@"),
    } : null,
    social.nextdoor && absoluteHttpUrl(social.nextdoor) ? {
      id: "nextdoor", label: "Nextdoor", pillLabel: "Nextdoor", href: social.nextdoor,
    } : null,
    social.newsletter && absoluteHttpUrl(social.newsletter) ? {
      id: "newsletter", label: "Newsletter", pillLabel: "Newsletter", href: social.newsletter,
    } : null,
    social.mastodon ? {
      id: "mastodon", label: "Mastodon", pillLabel: "Mastodon", href: mastodonUrl(social.mastodon),
    } : null,
  ];
  return links.filter((link): link is SocialChannelLink => Boolean(link));
}

function profileUrl(value: string, base: string): string {
  if (absoluteHttpUrl(value)) return value;
  return `${base}${encodeURIComponent(value.replace(/^@/, ""))}`;
}

function absoluteHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

function mastodonUrl(handle: string): string {
  if (absoluteHttpUrl(handle)) return handle;
  const parts = handle.replace(/^@/, "").split("@");
  if (parts.length === 2) return `https://${parts[1]}/@${encodeURIComponent(parts[0])}`;
  return `https://mastodon.social/@${encodeURIComponent(parts[0])}`;
}
