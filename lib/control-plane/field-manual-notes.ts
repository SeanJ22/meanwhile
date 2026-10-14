import { normalizeEntry, type FieldManualEntry, type FieldManualRepos } from "./field-manual.ts";

/** What hunting has learned, by state and place (routes that worked, dead ends, walls, platform notes), and the source registry. */
export async function fieldManualNotes(): Promise<readonly FieldManualEntry[]> {
  // Read only when seeding, so the pages that import the store never carry it.
  return (await import("./field-manual-notes.json", { with: { type: "json" } })).default as unknown as readonly FieldManualEntry[];
}

/** Insert each note the manual does not hold yet. A held row, with what later hunts merged into it, always wins. */
export async function seedFieldManualNotes(repos: FieldManualRepos, now: string): Promise<{ created: number; present: number }> {
  const notes = await fieldManualNotes();
  const inserted = await repos.fieldManual.insertNew(notes.map(normalizeEntry), now);
  return { created: inserted.size, present: notes.length - inserted.size };
}
