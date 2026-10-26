const fakeNeon = new URL("./apply-migrations-neon-fake.mjs", import.meta.url).href;

export function resolve(specifier, context, nextResolve) {
  if (specifier === "@neondatabase/serverless" ||
      new URL(specifier, context.parentURL ?? import.meta.url).pathname.endsWith("/lib/db/client.ts")) {
    return { shortCircuit: true, url: fakeNeon };
  }
  return nextResolve(specifier, context);
}
