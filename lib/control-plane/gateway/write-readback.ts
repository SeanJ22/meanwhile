/**
 * A write that timed out is read back before the owner is told anything:
 *   there        -> saved
 *   not there    -> not saved, safe to send again
 *   read fails   -> may have saved; never "nothing was recorded"
 */
import { canonicalJson, type ControlPlaneRepositories } from "../repository/types.ts";

export function isRequestTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "ControlPlaneRequestTimeout" || (error as { code?: unknown }).code === "CONTROL_PLANE_REQUEST_TIMEOUT");
}

/** The store timed out and the read-back shows the write did not land. */
export class WriteNotSaved extends Error {
  constructor() {
    super("WRITE_NOT_SAVED: the store timed out, and reading it back shows the change is not there");
    this.name = "WriteNotSaved";
  }
}

/** The store timed out and it could not be asked whether the write landed. */
export class WriteMayHaveSaved extends Error {
  constructor() {
    super("WRITE_MAY_HAVE_SAVED: the store timed out and could not be read back just now");
    this.name = "WriteMayHaveSaved";
  }
}

export function writeFailureSays(what: string, error: unknown): string {
  const name = (error as Error | null)?.name ?? "error";
  if (name === "WriteMayHaveSaved") {
    return `${what} may have been saved: the store timed out and could not be read back just now. Check the page before sending it again.`;
  }
  if (name === "WriteNotSaved") {
    return `${what} was not saved: the store timed out, and reading it back shows the change is not there, so nothing was recorded. It is safe to send again.`;
  }
  return `${what} could not be written (${name}), so nothing was recorded.`;
}

export function appendFailureSays(detail: string): string {
  if (detail.startsWith("WRITE_MAY_HAVE_SAVED")) {
    return "May have saved: the store timed out and could not be read back just now. Check the page before sending it again.";
  }
  if (detail.startsWith("WRITE_NOT_SAVED")) {
    return "Not saved: the store timed out, and reading it back shows the change is not there. It is safe to send again.";
  }
  return `Nothing was recorded — ${detail}.`;
}

async function readBack<T>(read: () => Promise<T>): Promise<{ readonly ok: true; readonly value: T } | { readonly ok: false }> {
  try {
    return { ok: true, value: await read() };
  } catch {
    return { ok: false };
  }
}

export function withWriteReadback(repos: ControlPlaneRepositories): ControlPlaneRepositories {
  const config = repos.adminConfig;
  const adminConfig: typeof config = {
    ...config,
    async put(id, value, now) {
      try {
        return await config.put(id, value, now);
      } catch (error) {
        if (!isRequestTimeout(error)) throw error;
        const held = await readBack(() => config.read(id));
        if (!held.ok) throw new WriteMayHaveSaved();
        if (held.value !== null && canonicalJson(held.value.value) === canonicalJson(value)) return { created: true, persisted: held.value };
        throw new WriteNotSaved();
      }
    },
    async compareAndSet(id, expectedRevision, next, now) {
      try {
        return await config.compareAndSet(id, expectedRevision, next, now);
      } catch (error) {
        if (!isRequestTimeout(error)) throw error;
        const held = await readBack(() => config.read(id));
        if (!held.ok) throw new WriteMayHaveSaved();
        if (held.value !== null && held.value.revision === expectedRevision + 1 && canonicalJson(held.value.value) === canonicalJson(next)) return held.value;
        throw new WriteNotSaved();
      }
    },
  };
  const logged = <T extends { readonly intentId: string }>(log: { append: (key: string, recordId: string, record: T, now: string) => Promise<unknown>; readWhere: (key: string, path: readonly string[], value: string) => Promise<readonly T[]> }) =>
    async (key: string, recordId: string, record: T, now: string) => {
      try {
        return await log.append(key, recordId, record, now);
      } catch (error) {
        if (!isRequestTimeout(error)) throw error;
        const held = await readBack(() => log.readWhere(key, ["intentId"], recordId));
        if (!held.ok) throw new WriteMayHaveSaved();
        if (held.value.length > 0) return { appended: true, recordId, record: held.value[0], position: -1 };
        throw new WriteNotSaved();
      }
    };
  return {
    ...repos,
    adminConfig,
    ownerDecisions: { ...repos.ownerDecisions, append: logged(repos.ownerDecisions) as typeof repos.ownerDecisions.append },
    researchIntents: { ...repos.researchIntents, append: logged(repos.researchIntents) as typeof repos.researchIntents.append },
  };
}
