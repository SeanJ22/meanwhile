import type { RoutineRecordClass } from "./types.ts";

export function projectionKey(recordClass: RoutineRecordClass, scope: string): string {
  return `${recordClass}:${scope}`;
}
