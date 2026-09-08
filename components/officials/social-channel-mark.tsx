import type { SocialChannelId } from "@/lib/officials/social-channels";

import {
  FacebookMark,
  InstagramMark,
  LinkedInMark,
  MastodonMark,
  NewsletterMark,
  NextdoorMark,
  TikTokMark,
  XMark,
  YouTubeMark,
} from "./channel-marks";

export function SocialChannelMark({ channel }: { channel: SocialChannelId }) {
  switch (channel) {
    case "x": return <XMark />;
    case "facebook": return <FacebookMark />;
    case "instagram": return <InstagramMark />;
    case "linkedin": return <LinkedInMark />;
    case "youtube": return <YouTubeMark />;
    case "tiktok": return <TikTokMark />;
    case "nextdoor": return <NextdoorMark />;
    case "newsletter": return <NewsletterMark />;
    case "mastodon": return <MastodonMark />;
  }
}
