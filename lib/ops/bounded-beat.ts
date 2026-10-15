/** A repeating write that never queues behind itself: a call during a write inside `boundMs` shares it,
 * and a write past `boundMs` finishes alone so the next call starts fresh. */
export function boundedBeat(write: () => Promise<void>, boundMs: number, onLate: () => void = () => undefined): () => Promise<void> {
  let current: Promise<void> | null = null;
  return () => {
    if (current) return current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<void>(resolve => { timer = setTimeout(() => { onLate(); resolve(); }, boundMs); });
    current = Promise.race([write().catch(() => undefined), late]).finally(() => { clearTimeout(timer); current = null; });
    return current;
  };
}
