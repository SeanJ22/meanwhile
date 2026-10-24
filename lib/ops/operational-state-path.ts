import { existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve, sep } from "node:path";

/** Host memory metadata lives outside the checkout, including through symlinks. */
export function operationalStatePath(value: string): string {
  const target = resolve(value);
  const temporary = resolve(tmpdir());
  const root = realpathSync(tmpdir());
  const persistent = "/var/lib/meanwhile";
  let ancestor = target;
  while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  const parent = realpathSync(ancestor);
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
