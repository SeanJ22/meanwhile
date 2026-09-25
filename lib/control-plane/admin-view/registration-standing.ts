/**
 * **WHERE A STATE STANDS: TRACKED, REGISTERED, OR NOTHING REGISTERED.**
 * (2026-09-25.)
 *
 * Admin once called every state outside Arizona, New Hampshire and New Jersey
 * "nothing registered", while production held a promoted REGISTRATION pointer
 * for fifty states and DC (#406: each state's Census governments, kept current
 * by the runner). A figure that claims an absence the data contradicts is the
 * one Admin must never draw (Sean: an Admin "using accurate data"). So a state
 * stands in one of four places, and each says only what is known:
 *
 * ```
 *   TRACKED         the reviewed registry covers it and the runner publishes
 *                   its coverage and readiness figures (COVERED_STATES)
 *   REGISTERED      its REGISTRATION pointer is promoted: its Census
 *                   governments are on file, with no figures of ours yet
 *   NOT_REGISTERED  the pointers were read and none is promoted for it
 *   NOT_READ        the pointers were not read, so neither is claimed
 * ```
 *
 * PURE: no I/O, no clock.
 */
import { formatEastern } from "@/lib/control-plane/eastern-time.ts";

import type { RegistrationCounts, RegistrationPointer, RegistrationPointers } from "./promoted-slices.ts";

export type StateStanding =
  | { readonly kind: "TRACKED" }
  | { readonly kind: "REGISTERED"; readonly pointer: RegistrationPointer }
  | { readonly kind: "NOT_REGISTERED" }
  | { readonly kind: "NOT_READ"; readonly detail: string };

/** Where one state stands, from whether it is tracked and what the registration pointers say. */
export function stateStanding(code: string, tracked: boolean, registration: RegistrationPointers): StateStanding {
  if (tracked) return { kind: "TRACKED" };
  if (registration.kind === "UNREAD") return { kind: "NOT_READ", detail: registration.detail };
  const pointer = registration.pointers.find((p) => p.state === code.toLowerCase());
  return pointer === undefined ? { kind: "NOT_REGISTERED" } : { kind: "REGISTERED", pointer };
}

/** How the scope select names a state: its name alone when it is tracked, else its name and what it holds. */
export function standingLabel(name: string, standing: StateStanding): string {
  switch (standing.kind) {
    case "TRACKED":
      return name;
    case "REGISTERED":
      return `${name} — registered, no figures yet`;
    case "NOT_REGISTERED":
      return `${name} — nothing registered`;
    case "NOT_READ":
      return `${name} — registration not read`;
  }
}

/** The scope select's group heading for the states that stand in one place. */
export const STANDING_GROUP: Readonly<Record<StateStanding["kind"], string>> = {
  TRACKED: "Tracked states",
  REGISTERED: "Registered, no figures yet",
  NOT_REGISTERED: "Nothing registered",
  NOT_READ: "Registration not read",
};

/** What a table cell of ours reads for a state with no figures of ours, by why there are none. */
export function noFiguresCell(standing: StateStanding): string {
  switch (standing.kind) {
    case "REGISTERED":
      return "not measured yet";
    case "NOT_REGISTERED":
      return "not registered";
    case "NOT_READ":
    case "TRACKED":
      return "not read";
  }
}

/**
 * The sentence that leads a state's row or card when it has no figures of
 * ours; the Census universe sentence follows it.
 */
export function registrationWords(name: string, standing: StateStanding): string {
  switch (standing.kind) {
    case "TRACKED":
      return `${name} is tracked, with coverage, requirement and delivery figures of its own.`;
    case "REGISTERED":
      return `Registered: ${name}'s governments from the 2022 Census of Governments are on file, promoted ${formatEastern(standing.pointer.promotedAt, { year: true })}. No coverage, requirement or delivery figures are measured there yet.`;
    case "NOT_REGISTERED":
      return "Nothing registered yet.";
    case "NOT_READ":
      return `Whether ${name} is registered was not read just now, so it is called neither registered nor unregistered here.`;
  }
}

function n(x: number): string {
  return x.toLocaleString("en-US");
}

/**
 * One state's registration counts in words. The Census count here includes
 * dependent school systems, so it can be larger than the Census universe
 * sentence's governments, which counts the five independent types only — and
 * the sentence names what it counts so the two never read as a contradiction.
 */
export function registrationCountWords(name: string, c: RegistrationCounts): string {
  const unplaced = c.governments - c.pairedGovernments;
  const placed =
    unplaced <= 0
      ? "every one of them sits on a Census division"
      : `${n(c.pairedGovernments)} of them sit on a Census division; the other ${n(unplaced)} do not, so the registration holds no body for them`;
  return (
    `The registration holds ${n(c.bodies)} ${c.bodies === 1 ? "body" : "bodies"} on ${n(c.divisions)} Census ${c.divisions === 1 ? "division" : "divisions"}, ` +
    `from the ${n(c.governments)} governments and dependent school systems the 2022 Census of Governments lists in ${name}: ${placed}.`
  );
}
