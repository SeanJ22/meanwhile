/**
 * **WHICH VIEW THE ADDRESS ASKS FOR.** `/admin?view=reports` opens Reports;
 * anything unrecognised opens Now. A plain module (no client directive) so the
 * server page and the client shell read one list.
 */
export const VIEW_IDS = ["now", "queue", "workers", "work", "checklist", "money", "scoreboard", "data", "settings", "reports", "changes", "chat"] as const;

export type View = (typeof VIEW_IDS)[number];

export function parseView(raw: string | readonly string[] | undefined): View {
  const value = Array.isArray(raw) ? raw[0] : raw;
  // The shell opens Work only when the backend actually supplied work rows.
  return (VIEW_IDS as readonly string[]).includes(value ?? "") ? (value as View) : "now";
}
