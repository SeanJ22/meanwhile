/**
 * **THE ONE PLACE THE BRIDGE TOUCHES A REAL MACHINE.** (ADM-C8; §3.1 of the
 * Admin C brief, 2026-09-06.)
 *
 * `provider.ts` decides what a reading MEANS and takes its facts from an
 * injected {@link ProbeHost}. This is the only implementation of that host that
 * touches an actual filesystem and an actual process, and it exists so the
 * honest answer to *"can this machine start Codex?"* is measured on the machine
 * rather than assumed anywhere.
 *
 * ## Why this cannot become a shell
 *
 * §3.1 forbids an arbitrary terminal, an arbitrary command and an arbitrary
 * script path. Three things hold that here, and each one holds on its own:
 *
 *   1. {@link nodeProbeHost} takes no command and no path — it takes a clock.
 *      There is no parameter through which owner text, chat text or agent text
 *      could reach a process.
 *   2. `askVersion` REFUSES any argv that is not, element for element, one of
 *      the frozen argvs in `LAUNCHERS`. A caller inside this repository holding
 *      this object still cannot run anything else with it.
 *   3. `execFileSync` is used, never `exec` and never a shell — the argv is
 *      passed as an array, so there is no string for a shell to interpret even
 *      if one were somehow reached.
 *
 * ## What it will and will not read
 *
 * It reads `PATH` (and `PATHEXT` on Windows) to answer "is this program
 * installed", which is the operating system's own lookup done explicitly rather
 * than by spawning something. It reads NO other environment variable — in
 * particular nothing that could change the paid-API policy, which is why
 * `provider.ts` reads the environment not at all.
 *
 * It answers whether a provider's saved sign-in file EXISTS. It never opens it.
 * That file is a credential; its presence is a fact about setup and its
 * contents are nobody's business here — including this program's.
 *
 * Server-side only, and only on a machine that actually runs the work. A
 * Netlify function has no PATH, no home directory and no process to spawn; it
 * uses `unobservedFromWeb` instead and says so.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

import { LAUNCHERS, type ProbeHost } from "./provider.ts";

/** How long a version check may take. A launcher that hangs is a launcher that did not answer. */
export const VERSION_CHECK_TIMEOUT_MS = 10_000;

/** The bytes a version check may print. A program that prints a novel is not printing a version. */
export const VERSION_CHECK_MAX_BYTES = 4_096;

/** Every argv this host is allowed to run, taken from the closed launcher table. */
function permittedArgvs(): readonly (readonly string[])[] {
  return Object.values(LAUNCHERS).map((spec) => spec.versionArgv);
}

/** Is this argv, element for element, one of the permitted ones? */
export function argvIsPermitted(argv: readonly string[]): boolean {
  return permittedArgvs().some((allowed) => allowed.length === argv.length && allowed.every((part, i) => part === argv[i]));
}

/**
 * Where a program resolves on this host's PATH, or null.
 *
 * The operating system's own lookup, written out: each PATH entry, each
 * executable suffix. Doing it explicitly rather than by spawning a `which`
 * means the "is it installed" question never itself runs a program.
 */
export function resolveOnPath(launcher: string, env: NodeJS.ProcessEnv, platform: string): string | null {
  const path = env.PATH ?? env.Path ?? "";
  if (path === "") return null;
  const suffixes = platform === "win32" ? ["", ...(env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";")] : [""];
  for (const dir of path.split(delimiter)) {
    if (dir === "") continue;
    for (const suffix of suffixes) {
      const candidate = join(dir, `${launcher}${suffix}`);
      try {
        if (existsSync(candidate)) return candidate;
      } catch {
        // An unreadable PATH entry is not an answer about the launcher. Keep
        // looking rather than reporting "not installed" on someone else's
        // permission error.
      }
    }
  }
  return null;
}

/**
 * A {@link ProbeHost} for the machine this process is running on.
 *
 * Takes the moment as an argument rather than reading the clock, so a probe is
 * stamped by its caller and two providers probed in one pass carry one time.
 */
export function nodeProbeHost(now: string): ProbeHost {
  return {
    resolve: (launcher) => resolveOnPath(launcher, process.env, process.platform),
    exists: (path) => {
      try {
        return existsSync(path);
      } catch {
        return false;
      }
    },
    askVersion: (argv) => {
      if (!argvIsPermitted(argv)) {
        // Not a defensive nicety: this is the §3.1 boundary. Anything that is
        // not one of the frozen version checks is refused here, so the only
        // commands this process can ever run are the ones in the closed table.
        throw new Error(
          `The agent bridge refused to run ${argv.length} argument(s) that are not one of its declared version checks. ` +
            "The launcher table is closed and this host runs nothing else — there is no path here for an arbitrary command.",
        );
      }
      try {
        const printed = execFileSync(argv[0], argv.slice(1), {
          timeout: VERSION_CHECK_TIMEOUT_MS,
          maxBuffer: VERSION_CHECK_MAX_BYTES,
          encoding: "utf8",
          shell: false,
          stdio: ["ignore", "pipe", "ignore"],
        });
        const trimmed = printed.trim();
        return trimmed === ""
          ? { ok: false, printed: null, why: "It started and printed nothing, so there is no version to record." }
          : { ok: true, printed: trimmed, why: null };
      } catch (error) {
        return { ok: false, printed: null, why: `It did not answer (${(error as Error)?.name ?? "error"}).` };
      }
    },
    homeDir: homedir(),
    now,
  };
}
