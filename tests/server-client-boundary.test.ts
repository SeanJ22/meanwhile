import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * A Server Component may pass a Client Component only SERIALIZABLE props, and a
 * function prop fails at request time (HTTP 500), not in the type system or the build.
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
 * discriminated VALUE and switch on it.
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

/**
 * The opt-out, and why there is one.
 *
 * A few client components cannot be rendered by a Server Component *even in
 * principle*, because they take a live runtime object as an argument — a
 * MapLibre projection, for instance. The rule's rationale ("one import away
 * from being rendered by a server component") does not reach them: a server
 * component has no map to project with, so the 500 this guard exists to
 * prevent cannot occur.
 *
 * The escape hatch is a FILE-LEVEL marker that must state its reason:
 *
 *     // @server-boundary-exempt <why this cannot reach a server component>
 *
 * Deliberately not a rename. The obvious way past this guard is to call the
 * prop `onProject` and move on, which would defeat the rule while making the
 * name worse; an annotated exemption keeps the rule strict, keeps every
 * exception visible in one grep, and makes each one something a reader can
 * disagree with.
 */
const EXEMPT = /@server-boundary-exempt\s+(\S.*)$/m;

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
  const exemptions: string[] = [];

  for (const root of ROOTS) {
    for (const file of walk(root)) {
      const source = readFileSync(file, "utf8");
      if (!/^\s*["']use client["']/m.test(source)) continue;
      const props = functionProps(source);
      if (props.length === 0) continue;
      const exempt = EXEMPT.exec(source);
      if (exempt) {
        exemptions.push(`${file.replace(/\\/g, "/")} — ${exempt[1].trim()}`);
        continue;
      }
      for (const prop of props) {
        offenders.push(`${file.replace(/\\/g, "/")} — prop "${prop}"`);
      }
    }
  }

  // An exemption with no reason is the marker used as a mute button. Every
  // one of them is printed on a pass too, so the list stays visible rather
  // than quietly growing.
  for (const line of exemptions) {
    assert.ok(
      line.split("—")[1]?.trim().length > 20,
      `an exemption must say WHY it cannot reach a server component: ${line}`,
    );
  }
  if (exemptions.length > 0) {
    console.log(
      `  server-boundary exemptions (${exemptions.length}):\n` +
        exemptions.map((e) => `    · ${e}`).join("\n"),
    );
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
