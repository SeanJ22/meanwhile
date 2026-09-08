import type { SocialAccounts } from "@/lib/officials/types";
import { socialChannelLinks } from "@/lib/officials/social-channels";

import { SocialChannelMark } from "./social-channel-mark";
import styles from "./social-channel-badges.module.css";

/** Official channels held for this person; absent channels stay absent. */
export function SocialChannelBadges({ social }: { social?: SocialAccounts }) {
  const channels = socialChannelLinks(social);
  if (channels.length === 0) return null;

  return (
    <nav className={styles.badges} aria-label="Official social channels">
      {channels.map(channel => (
        <a
          className={styles.badge}
          data-social-channel={channel.id}
          href={channel.href}
          key={channel.id}
          target="_blank"
          rel="noreferrer"
          title={channel.label}
          aria-label={`${channel.label} — official channel`}
        >
          <SocialChannelMark channel={channel.id} />
        </a>
      ))}
    </nav>
  );
}
