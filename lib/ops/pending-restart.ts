/**
 * A release that changes the runner's own code loads only by restarting. Once one is pending, the standing clock
 * launches no new run, the runs already started end by their own deadlines, and the runner restarts on the new code.
 * Work a deadline cut off resumes on the next pass.
 */
export class PendingRestart {
  #target: string | null = null;
  readonly #waiting = new Set<() => void>();

  get target(): string | null { return this.#target; }

  /** Records the release; true only the first time, which is when standing admissions close. */
  mark(targetSha: string): boolean {
    if (this.#target !== null) return false;
    this.#target = targetSha;
    for (const wake of [...this.#waiting]) wake();
    return true;
  }

  /** The deployed release is the running one again, so standing runs open again. */
  clear(): void { this.#target = null; }

  /** Waits up to `ms`, ending at once when a restart becomes pending. */
  sleep(ms: number): Promise<void> {
    if (this.#target !== null || ms <= 0) return Promise.resolve();
    return new Promise(resolve => {
      const done = (): void => { clearTimeout(timer); this.#waiting.delete(done); resolve(); };
      const timer = setTimeout(done, ms);
      this.#waiting.add(done);
    });
  }
}
