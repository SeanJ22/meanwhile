import type { SeatHolder } from "./lookup.ts";

const ISO_DATE = /^\d{4}(?:-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?)?$/;

/** Two held dates agree; one supplies the missing month or day. */
export function morePreciseHeldDate(value: unknown, other: unknown): boolean {
  return typeof value === "string" && typeof other === "string" &&
    ISO_DATE.test(value) && ISO_DATE.test(other) && value.startsWith(`${other}-`);
}

/** Source records stay accessible when several publishers describe one person. */
export function heldPersonSources(holder: SeatHolder): readonly SeatHolder[] {
  return holder.sourceHolders ?? [holder];
}
