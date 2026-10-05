"use client";

import { useEffect, useState } from "react";

import { DEFAULT_STANCE_TOPICS, STANCE_TOPICS_SETTING, validStanceTopics } from "@/lib/stances/topics";

const DEFAULT_LABELS = DEFAULT_STANCE_TOPICS.map((topic) => topic.label);
let held: Promise<string[]> | null = null;

/** The published list, read once per page from the reader-edge settings; the code default until it arrives or if it cannot. */
function load(): Promise<string[]> {
  held ??= fetch("/api/reader/settings")
    .then((response) => (response.ok ? response.json() : null))
    .then((body: { values?: Record<string, unknown> } | null) => {
      const value = body?.values?.[STANCE_TOPICS_SETTING];
      return validStanceTopics(value) ? value.map((topic) => topic.label) : DEFAULT_LABELS;
    })
    .catch(() => DEFAULT_LABELS);
  return held;
}

/** The ten stance topic labels the person card offers as chips. */
export function useStanceTopics(): readonly string[] {
  const [labels, setLabels] = useState<readonly string[]>(DEFAULT_LABELS);
  useEffect(() => {
    let live = true;
    void load().then((next) => { if (live) setLabels(next); });
    return () => { live = false; };
  }, []);
  return labels;
}
