import { existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve, sep } from "node:path";

export function temporaryPath(value: string): string {
  const target = resolve(value);
  const temporary = resolve(tmpdir());
  const root = realpathSync(tmpdir());
  let ancestor = target;
  while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  const parent = realpathSync(ancestor);
  if (!target.startsWith(temporary + sep) || !(parent === root || parent.startsWith(root + sep))) {
    throw new Error("The filesystem destination must stay inside the operating system temporary directory.");
  }
  const repository = realpathSync(process.cwd());
  if (target === repository || target.startsWith(repository + sep) || parent === repository || parent.startsWith(repository + sep)) {
    throw new Error("The filesystem destination must stay outside the repository.");
  }
  return target;
}
