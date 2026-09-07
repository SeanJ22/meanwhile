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
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

import { LAUNCHERS, type AgentProviderId, type ProbeHost } from "./provider.ts";

/* ------------------------------------------- where a provider installs itself */

/**
 * **THE CLOSED LIST OF TRUSTED USER-LOCAL INSTALL DIRECTORIES.** (ACLOSE-1.)
 *
 * ADM-C8 measured both subscription homes present and signed in, and BOTH
 * launchers unresolvable: the Scheduled Task starts `node.exe` with the
 * machine's service PATH, and neither provider installs itself onto it. Codex
 * ships its binary inside its own home; Claude Code ships one per version under
 * the desktop app's data directory.
 *
 * This is the narrowest of the two fixes the brief allows — a small fixed set
 * of trusted user-local executable directories, added to the CHILD's PATH only.
 * Not the machine's PATH, and above all not a path from configuration: this is
 * a frozen literal keyed by the same closed provider union as everything else,
 * so there is no parameter anywhere and no control-plane row through which an
 * executable path could be supplied.
 *
 * **It lives beside the probe rather than beside the run on purpose.** A probe
 * that resolved a launcher differently from the run would report "not
 * installed" for a provider the run can start, and `subscriptionCanTake` would
 * then refuse a working subscription — the exact shape of the defect this
 * closes. One resolution rule, one place, both callers.
 */
export type RootBase = "HOME" | "APPDATA" | "LOCALAPPDATA";

export interface LauncherRoot {
  readonly base: RootBase;
  /** Path segments under that base. Literal names only — never a pattern, never input. */
  readonly segments: readonly string[];
  /** True when the launcher sits one level deeper, in a directory whose NAME is a version. */
  readonly versioned: boolean;
  /** Why this directory is trusted, in one line, so the list cannot grow silently. */
  readonly why: string;
}

export const TRUSTED_LAUNCHER_ROOTS: Readonly<Record<AgentProviderId, readonly LauncherRoot[]>> = {
  CODEX_SUBSCRIPTION: Object.freeze([
    Object.freeze({
      base: "HOME" as const,
      segments: Object.freeze([".codex", ".sandbox-bin"]),
      versioned: false,
      why: "Codex CLI installs its own binary inside its own home directory and puts nothing on PATH.",
    }),
  ]),
  CLAUDE_CODE_SUBSCRIPTION: Object.freeze([
    Object.freeze({
      base: "APPDATA" as const,
      segments: Object.freeze(["Claude", "claude-code"]),
      versioned: true,
      why: "The Claude desktop app manages Claude Code per version under its own data directory and puts nothing on PATH.",
    }),
  ]),
};

/** Resolve a declared base against an environment, or null when it is not set. */
export function baseDir(base: RootBase, env: NodeJS.ProcessEnv, home: string): string | null {
  if (base === "HOME") return home === "" ? null : home;
  const value = base === "APPDATA" ? env.APPDATA : env.LOCALAPPDATA;
  return value === undefined || value === "" ? null : value;
}

/** Compare two dotted version names numerically, newest first. */
export function compareVersionNames(a: string, b: string): number {
  const parts = (v: string): number[] => v.split(/[.\-+]/).map((p) => (/^\d+$/.test(p) ? Number(p) : -1));
  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const l = left[i] ?? -1;
    const r = right[i] ?? -1;
    if (l !== r) return r - l;
  }
  return a < b ? 1 : a > b ? -1 : 0;
}

/** Does this directory hold this launcher, under any of the platform's executable suffixes? */
export function launcherIn(dir: string, launcher: string, env: NodeJS.ProcessEnv, platform: string): string | null {
  const suffixes = platform === "win32" ? ["", ...(env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";")] : [""];
  for (const suffix of suffixes) {
    const candidate = join(dir, `${launcher}${suffix}`);
    try {
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    } catch {
      // An unreadable candidate is not an answer about the launcher.
    }
  }
  return null;
}

/**
 * The newest version directory under `root` that ACTUALLY HOLDS `launcher`.
 *
 * "Actually holds" is the load-bearing half: a half-removed version directory
 * that no longer contains the executable must not win the sort and shadow a
 * working one.
 */
export function newestVersionDir(root: string, launcher: string, env: NodeJS.ProcessEnv, platform: string): string | null {
  let names: readonly string[];
  try {
    names = readdirSync(root);
  } catch {
    return null;
  }
  const dirs = names
    .filter((n) => {
      try {
        return statSync(join(root, n)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort(compareVersionNames);
  for (const name of dirs) {
    const dir = join(root, name);
    if (launcherIn(dir, launcher, env, platform) !== null) return dir;
  }
  return null;
}

/** Every trusted directory that exists on THIS machine and holds a declared launcher. */
export function trustedLauncherDirs(env: NodeJS.ProcessEnv, home: string, platform: string): string[] {
  const dirs: string[] = [];
  for (const [provider, roots] of Object.entries(TRUSTED_LAUNCHER_ROOTS)) {
    const launcher = LAUNCHERS[provider as AgentProviderId].launcher;
    for (const root of roots) {
      const base = baseDir(root.base, env, home);
      if (base === null) continue;
      const at = join(base, ...root.segments);
      if (!existsSync(at)) continue;
      const found = root.versioned ? newestVersionDir(at, launcher, env, platform) : (launcherIn(at, launcher, env, platform) === null ? null : at);
      if (found !== null && !dirs.includes(found)) dirs.push(found);
    }
  }
  return dirs;
}

/**
 * The PATH a probe resolves against and a delegated child is given.
 *
 * APPENDED, not prepended — a launcher the operator has deliberately installed
 * on the machine's own PATH keeps precedence over one we discovered for them.
 */
export function agentChildPath(env: NodeJS.ProcessEnv, home: string, platform: string): string {
  const current = env.PATH ?? env.Path ?? "";
  return [current, ...trustedLauncherDirs(env, home, platform)].filter((p) => p !== "").join(delimiter);
}

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
  /*
   * The SAME path the run gets. A probe that resolved against a narrower PATH
   * than the run would report "not installed" for a provider this machine can
   * start, and `subscriptionCanTake` would then refuse a working subscription
   * and — with paid fallback on — fall through to billing for work the
   * subscription would have done free.
   */
  const path = agentChildPath(process.env, homedir(), process.platform);
  return {
    resolve: (launcher) => resolveOnPath(launcher, { ...process.env, PATH: path }, process.platform),
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
        /*
         * The ALLOWLIST is checked on the argv as declared — element 0 is the
         * launcher NAME, and that is what makes the table closed. Resolving
         * that name to the file the OS would have found anyway is not a
         * widening of what may run: the set of programs reachable here is still
         * exactly the set of names in `LAUNCHERS`, resolved against a PATH this
         * module composed from a frozen literal.
         */
        const program = resolveOnPath(argv[0], { ...process.env, PATH: path }, process.platform) ?? argv[0];
        const printed = execFileSync(program, argv.slice(1), {
          timeout: VERSION_CHECK_TIMEOUT_MS,
          maxBuffer: VERSION_CHECK_MAX_BYTES,
          encoding: "utf8",
          shell: false,
          stdio: ["ignore", "pipe", "ignore"],
          env: { ...process.env, PATH: path },
          windowsHide: true,
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
