const fakeNeon = new URL("./apply-migrations-neon-fake.mjs", import.meta.url).href;

export function resolve(specifier, context, nextResolve) {
  if (specifier === "@neondatabase/serverless") {
    return { shortCircuit: true, url: fakeNeon };
  }
  return nextResolve(specifier, context);
}
