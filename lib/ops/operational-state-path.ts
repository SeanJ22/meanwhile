import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve, sep } from "node:path";

/** Host memory metadata lives outside the checkout, including through symlinks. */
export function operationalStatePath(value: string): string {
  const target = resolve(value);
  const temporary = resolve(tmpdir());
  const root = realpathSync(tmpdir());
  const persistent = "/var/lib/meanwhile";
  // Other processes create and remove the shared lock and temporary files at any moment, so a path seen a moment ago
  // may be gone when it is resolved: resolve the nearest ancestor that exists at the moment of resolution.
  let parent = "";
  for (let ancestor = target; !parent; ancestor = dirname(ancestor)) {
    try { parent = realpathSync(ancestor); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT" || dirname(ancestor) === ancestor) throw error; }
  }
  const inTemporary = target.startsWith(temporary + sep) && (parent === root || parent.startsWith(root + sep));
  const inPersistent = (target === persistent || target.startsWith(persistent + sep)) &&
    (parent === persistent || parent.startsWith(persistent + sep));
  if (!inTemporary && !inPersistent) throw new Error("WORKER_MEMORY_PATH_OUTSIDE_HOST_STATE");
  const repository = realpathSync(process.cwd());
  if (target === repository || target.startsWith(repository + sep) || parent === repository || parent.startsWith(repository + sep)) {
    throw new Error("WORKER_MEMORY_PATH_INSIDE_REPOSITORY");
  }
  return target;
}
