/** Publish the latest existing state once for overlapping requests, with one CAS writer. */
export function cycleStateWriter(persist: (finishedAt: string | null) => Promise<void>) {
  let requested = 0;
  let published = 0;
  let finishedAt: string | null = null;
  let queue = Promise.resolve();
  return (finish: string | null): Promise<void> => {
    if (finish !== null) finishedAt = finish;
    const version = ++requested;
    queue = queue.catch(() => undefined).then(async () => {
      if (version <= published) return;
      const through = requested;
      await persist(finishedAt);
      published = through;
    });
    return queue;
  };
}
