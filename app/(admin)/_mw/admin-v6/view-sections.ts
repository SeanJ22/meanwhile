import type { SectionId } from "./contract.ts";
import type { View } from "./view-param.ts";

/** Only the open screen subscribes; changing screens catches up from the latest pulse. */
export const VIEW_SECTIONS: Readonly<Record<View, readonly SectionId[]>> = {
  now: ["hunts", "national", "stuck", "history", "sends", "fixes", "officials", "checklist", "scoreboard"],
  queue: ["hunts", "history", "sends", "stuck", "fixes"],
  workers: ["hunts", "workers", "agents", "sends", "reliability", "publication"],
  work: ["hunts", "results", "stuck", "sameCause", "history"],
  checklist: ["hunts", "checklist", "spend", "results"],
  money: ["hunts", "money", "spend"],
  scoreboard: ["hunts", "scoreboard"],
  reports: ["hunts"],
  data: ["hunts"],
  settings: ["hunts"],
  changes: ["hunts", "history"],
  chat: ["hunts"],
};
