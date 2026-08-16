import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The server/client boundary guard (g3 item 2, 2026-08-16).
 *
 * ## What shipped to production
 *
 * `/about-area?zip=…` answered **HTTP 500 at every zip**, and `?state=…` with
 * it, for as long as the shuffled-facts component had been live. The cause is
 * one line of React law: a Server Component may pass a Client Component only
 * SERIALIZABLE props, and a render prop is a function.
 *
 *     <ShuffledFacts facts={…}>{(fact) => <section>…</section>}</ShuffledFacts>
 *
 * React refuses that outright — "Functions are not valid as a child of Client
 * Components" — and in a Server Component the refusal is a 500 rather than a
 * warning. Nothing in the type system catches it: the prop's TypeScript type
 * (`(fact: AreaFact) => React.ReactNode`) is perfectly well formed. Nothing in
 * `pnpm build` catches it either; the page compiles and the error is thrown at
 * request time. It took a production probe to find, which is precisely the
 * class of defect a cheap static guard should own instead.
 *
 * ## What this asserts
 *
 * For every Client Component in the tree — a file carrying the `"use client"`
 * directive — no exported component declares a prop typed as a function.
 * That is deliberately stricter than React's own rule, which only bites when
 * a SERVER component is the one passing the function: a client-to-client
 * handoff is legal. The strictness is the point. A client component with a
 * function prop is one import away from being rendered by a server component,
 * and the failure mode is a 500 in production rather than a red build. Event
 * handlers are the sanctioned exception and are named below, because
 * `onClick`-style callbacks between client components are ordinary React and
 * cannot be given up.
 *
 * A component that genuinely needs a caller-supplied render must take a
 * discriminated VALUE and switch on it, the way `ShuffledFacts` now carries
 * its own card markup.
 */

const ROOTS = ["components", "app"];

/**
 * Callback props a client component may take from another client component.
 *
 * The rule this guard enforces is "no function crosses the boundary", and an
 * `on…` handler is how React components talk to each other on the same side
 * of it. The prefix is the whole exception: anything else that is a function
 * is a render prop or an injected strategy, and both are the shape that
 * produced the 500.
 */
const HANDLER = /^on[A-Z]/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      walk(path, out);
    } else if (/\.tsx$/.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

/**
 * Prop declarations inside a component's props type, as `name: type` pairs.
 *
 * Deliberately a text scan rather than a TypeScript program: the suite runs
 * under `node --experimental-strip-types` with no type checker in the loop,
 * and the shape being caught — a prop whose type is an arrow — is
 * unambiguous in source. A scan that over-reports would be a nuisance; this
 * one under-reports on exotic type gymnastics, which is the safe direction
 * for a guard whose failure mode is a false alarm on someone else's PR.
 */
function functionProps(source: string): string[] {
  const found: string[] = [];
  // `name?: (args) => Ret` and `name: (args) => Ret`, at any indent, inside
  // an interface or an inline props object.
  for (const m of source.matchAll(
    /^\s{2,}(\w+)\??:\s*\(([^)]*)\)\s*=>/gm,
  )) {
    const name = m[1];
    if (HANDLER.test(name)) continue;
    found.push(name);
  }
  // `children: (fact: AreaFact) => React.ReactNode` written across lines is
  // the same defect; catch the multi-line form too.
  for (const m of source.matchAll(
    /^\s{2,}(children|render\w*)\??:\s*$/gm,
  )) {
    found.push(m[1]);
  }
  return [...new Set(found)];
}

test("no client component takes a render prop or an injected function", () => {
  const offenders: string[] = [];

  for (const root of ROOTS) {
    for (const file of walk(root)) {
      const source = readFileSync(file, "utf8");
      if (!/^\s*["']use client["']/m.test(source)) continue;
      for (const prop of functionProps(source)) {
        offenders.push(`${file.replace(/\\/g, "/")} — prop "${prop}"`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "a client component declares a function prop that is not an on… handler.\n" +
      "A Server Component cannot pass a function across the boundary; React\n" +
      "throws and the route answers 500 at request time, with nothing failing\n" +
      "at build. Take a serializable VALUE and switch on it instead.\n" +
      offenders.map((o) => `  · ${o}`).join("\n"),
  );
});

test("the about-area page passes ShuffledFacts nothing but data", () => {
  const page = readFileSync(join("app", "about-area", "page.tsx"), "utf8");
  const usage = /<ShuffledFacts([\s\S]*?)(\/>|<\/ShuffledFacts>)/.exec(page);
  assert.ok(usage, "the about-area page no longer renders ShuffledFacts");
  assert.ok(
    !/=>/.test(usage[1]),
    `ShuffledFacts is being handed a function again:\n${usage[0].slice(0, 200)}`,
  );
});
