/** Keep simultaneous lanes from waking on the same prior host timestamp. */
export function serializeHostSpacing(spaceOut: (host: string) => Promise<void>): (host: string) => Promise<void> {
  const pending = new Map<string, Promise<void>>();
  return (host) => {
    const prior = pending.get(host) ?? Promise.resolve();
    const next = prior.catch(() => {}).then(() => spaceOut(host));
    pending.set(host, next);
    return next.finally(() => {
      if (pending.get(host) === next) pending.delete(host);
    });
  };
}
