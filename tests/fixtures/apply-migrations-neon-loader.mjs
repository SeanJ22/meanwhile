import { fileURLToPath } from "node:url";
import { toPosix } from "../../scripts/repo-path.mjs";

const fakeNeon = new URL("./apply-migrations-neon-fake.mjs", import.meta.url).href;

export function resolve(specifier, context, nextResolve) {
  const resolved = new URL(specifier, context.parentURL ?? import.meta.url);
  if (specifier === "@neondatabase/serverless" ||
      resolved.protocol === "file:" && toPosix(fileURLToPath(resolved)).endsWith("/lib/db/client.ts")) {
    return { shortCircuit: true, url: fakeNeon };
  }
  return nextResolve(specifier, context);
}
