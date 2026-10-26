/** Transparent capture wrappers retain their underlying publisher transport and host clock. */
export const nativeSourceFetch = globalThis.fetch;
const wrappedTransports = new WeakMap<typeof fetch, typeof fetch>();

export function trackSourceTransport(wrapper: typeof fetch, underlying: typeof fetch): typeof fetch {
  wrappedTransports.set(wrapper, underlying);
  return wrapper;
}

export function sourceTransportRoot(transport: typeof fetch): typeof fetch {
  let underlying: typeof fetch | undefined;
  while ((underlying = wrappedTransports.get(transport))) transport = underlying;
  return transport;
}
