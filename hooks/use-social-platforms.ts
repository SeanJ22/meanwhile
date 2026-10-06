"use client";

import { useEffect, useState } from "react";

import { DEFAULT_SOCIAL_PLATFORMS, SOCIAL_PLATFORMS_SETTING, socialPlatformsOrDefault, type SocialPlatform } from "@/lib/officials/social-platforms";

let held: Promise<readonly SocialPlatform[]> | null = null;

/** The published list, read once per page from the reader-edge settings; the code default until it arrives or if it cannot. */
function load(): Promise<readonly SocialPlatform[]> {
  held ??= fetch("/api/reader/settings")
    .then((response) => (response.ok ? response.json() : null))
    .then((body: { values?: Record<string, unknown> } | null) => socialPlatformsOrDefault(body?.values?.[SOCIAL_PLATFORMS_SETTING]))
    .catch(() => DEFAULT_SOCIAL_PLATFORMS);
  return held;
}

/** The social platforms the contact pill row maps over. */
export function useSocialPlatforms(): readonly SocialPlatform[] {
  const [platforms, setPlatforms] = useState<readonly SocialPlatform[]>(DEFAULT_SOCIAL_PLATFORMS);
  useEffect(() => {
    let live = true;
    void load().then((next) => { if (live) setPlatforms(next); });
    return () => { live = false; };
  }, []);
  return platforms;
}
