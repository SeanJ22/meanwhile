import "server-only";

/**
 * Which states have a promoted registration, for the header every Admin page
 * draws, and one state's registration counts, for its own page. Both read
 * slices of the promoted REGISTRATION pointers
 * (`lib/control-plane/admin-view/promoted-slices.ts`), never a registration
 * itself (1-5 MB a state):
 *
 * ```
 *   pointers   every state's pointer metadata — scope, version, promoted
 *              time — in one indexed read: 51 rows, 6.8 KB, 0.15 ms in
 *              Postgres (production, 2026-09-25)
 *   counts     one state's counts, cut out of its pointer row by Postgres:
 *              ~300 bytes, 8.8 ms in Postgres for the largest state
 * ```
 *
 * Kept for a minute in this instance and served for fifteen while a fresh
 * read runs behind it: a pointer moves when the runner promotes, not on a
 * click. The pointers' read waits at most `SHELL_READ_DEADLINE_MS`, because
 * every page opens with it; one that misses says registration was not read,
 * never that nothing is registered.
 */
import {
  registrationCounts,
  registrationPointers,
  type RegistrationCounts,
  type RegistrationPointers,
  type Slice,
} from "@/lib/control-plane/admin-view/promoted-slices.ts";

import { readerQuery } from "./reader-query.ts";
import { ADMIN_READ_DEADLINE_MS, lateWords, sharedRead, type SharedRead } from "./shared-read.ts";

/** How long a page's header waits for the pointers before saying they were not read. */
export const SHELL_READ_DEADLINE_MS = 1_500;

const pointers = sharedRead<RegistrationPointers>({
  freshMs: 60_000,
  staleMs: 15 * 60_000,
  deadlineMs: SHELL_READ_DEADLINE_MS,
  keep: (r) => r.kind === "HELD",
  late: (ms) => ({ kind: "UNREAD", detail: lateWords("Registration", ms) }),
});

export async function loadRegistrationPointers(): Promise<RegistrationPointers> {
  return pointers.read(() => registrationPointers(readerQuery()));
}

const countsByState = new Map<string, SharedRead<Slice<RegistrationCounts>>>();

export async function loadRegistrationCounts(state: string): Promise<Slice<RegistrationCounts>> {
  const code = state.toLowerCase();
  let shared = countsByState.get(code);
  if (shared === undefined) {
    shared = sharedRead<Slice<RegistrationCounts>>({
      freshMs: 60_000,
      staleMs: 15 * 60_000,
      deadlineMs: ADMIN_READ_DEADLINE_MS,
      keep: (r) => r.kind !== "UNREAD",
      late: (ms) => ({ kind: "UNREAD", detail: lateWords(`${code.toUpperCase()}'s registration`, ms) }),
    });
    countsByState.set(code, shared);
  }
  return shared.read(() => registrationCounts(code, readerQuery()));
}
