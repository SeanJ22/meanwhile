import { heldRosterFiles } from "../holdings/discovery.ts";

/**
 * Tracked officeholder projections a read may use: the federal roster and every
 * held state roster. The state rosters come from Open States, which rulings §3
 * approves for state legislators; where an official roster is also held, the
 * official value replaces the Open States one.
 */
export function officeholderRosterFiles(): readonly string[] {
  return heldRosterFiles(process.cwd());
}
