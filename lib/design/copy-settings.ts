import { registerSetting } from "../control-plane/settings.ts";
import { READER_COPY } from "./copy.ts";

/** Admin imports this module to offer the labels through its existing log and undo. */
for (const [key, defaultValue] of Object.entries(READER_COPY)) {
  registerSetting({ key, defaultValue, readerFacing: true, control: "text",
    label: ({ "copy.working": "Info still being collected", "copy.notFound": "Stance search with no match", "copy.notPublished": "Government record not posted", "copy.askMap": "Map Ask label", "copy.askSidebar": "Sidebar Ask label", "copy.askWgh": "Who governs Ask label", "copy.askAccessible": "Ask accessible label" })[key] ?? "Reader help",
    validate: (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 300,
  });
}
