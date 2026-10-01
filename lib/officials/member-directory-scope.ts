import { officialStateVoteScopeForOfficeholderId } from "../state-rollcalls/authority.ts";

/**
 * **DOES THE MEMBER DIRECTORY SOURCE REACH THIS PERSON AT ALL?**
 * (Part C, 2026-08-31. BAL-33's class, found by grading `vac:ballot-offices-from-record`.)
 *
 * One sentence of law, three copies of it, and the copy that was MISSING is
 * what a reader met.
 *
 * `MemberDirectoryInner` — the map battlecard — asked
 * `holder.id.startsWith("congress:")` and, when the answer was no, rendered
 * the section's own named gap line. `DirectoryContent` asked the same question
 * and returned `null`. **`app/ballot/page.tsx` did not ask it**, and instead
 * passed `recordHolder ? <MemberOfficesContent … /> : null` — so the SLOT was
 * a truthy React element that then rendered nothing, the battlecard's
 * `content ?? emptyLine` fallback tested the slot rather than what it
 * rendered, and the named gap never fired.
 *
 * The measured result on `/ballot?zip=85701`, Katie Hobbs' card: *Committees*
 * and *Offices near you* open to `innerHTML === ""`. Zero children. A reader
 * clicks a section and gets a blank box, on the surface where the same person's
 * map card correctly says which gap it is.
 *
 * That is the render rule exactly: **a null renders as its NAMED GAP, on every
 * surface, always — and the name says WHOSE gap it is.** A blank names nobody.
 *
 * It is also BAL-33's own class recurring one line from the comment describing
 * it. BAL-33 swapped `holder` for `recordHolder` so these sections stopped
 * asking the federal-only join; what it did not do is notice that
 * `recordHolder` being non-null says nothing about whether the DIRECTORY
 * SOURCE covers them. The record and the source are different questions.
 *
 * So the predicate lives HERE, once, in a module that carries NO client
 * boundary directive, so a server component and a client component can both
 * ask it (RULING 103 — a sweep looks for the same code twice, not just the
 * same symptom). Every export of a client-boundary module becomes a client
 * reference, and calling one from a server component throws; `app/ballot/page.tsx`
 * is a server component and is one of the two callers.
 */

/**
 * The member directory's committee seats are sourced from the congressional
 * directory snapshot, whose scope is SITTING FEDERAL MEMBERS. Its offices are
 * sourced for federal members from the same snapshot, and for state
 * legislators from Open States joined to the legislature's own roster
 * (`lib/officials/member-offices.ts`). Anyone else is not covered by the source.
 *
 * This answers a question about OUR SOURCING and never one about the person:
 * false here means "this source does not reach them", never "they sit on no
 * committees". The sections' `emptyLine` text in
 * `lib/ballot/battlecard-sections.ts` is worded to say exactly that, and both
 * surfaces render it from that one table.
 */
export function memberDirectoryReaches(holderId: string, section: "committees" | "offices" = "committees"): boolean {
  if (holderId.startsWith("congress:")) return true;
  // Offices also reach state legislators (Sean, 2026-10-01): their capitol and district offices
  // are carried from Open States onto the legislature's own roster row. Committees stay federal.
  return section === "offices" && officialStateVoteScopeForOfficeholderId(holderId) !== null;
}
