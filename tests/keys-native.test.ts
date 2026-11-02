import assert from "node:assert/strict";
import { test } from "node:test";
import { loadNativeSavedKeys } from "../lib/core/keys-native.ts";

test("native Functions load their own website keys only in the platform's production deployment", async () => {
  const opened: string[] = [];
  const load = async (role: "runner" | "website" | "build") => { opened.push(role); };
  await loadNativeSavedKeys(undefined, load);
  await loadNativeSavedKeys({ deploy: { context: "deploy-preview" } }, load);
  await loadNativeSavedKeys({ deploy: { context: "branch-deploy" } }, load);
  assert.deepEqual(opened, []);
  await loadNativeSavedKeys({ deploy: { context: "production" } }, load);
  assert.deepEqual(opened, ["website"]);
});


test("website requests use the compiled production context and never open preview or build connections", async () => {
  const { loadWebsiteSavedKeys } = await import("../lib/core/keys-entry.ts");
  const before = process.env.WTP_BUILD_CONTEXT, phase = process.env.NEXT_PHASE;
  const sources: string[] = [];
  const read = async (source: "runner" | "website" | "build") => { sources.push(source); };
  try {
    for (const context of ["", "deploy-preview", "branch-deploy"]) {
      process.env.WTP_BUILD_CONTEXT = context; await loadWebsiteSavedKeys(read);
    }
    process.env.WTP_BUILD_CONTEXT = "production"; process.env.NEXT_PHASE = "phase-production-build";
    await loadWebsiteSavedKeys(read); assert.deepEqual(sources, []);
    delete process.env.NEXT_PHASE;
    await loadWebsiteSavedKeys(read); assert.deepEqual(sources, ["website"]);
  } finally {
    if (before === undefined) delete process.env.WTP_BUILD_CONTEXT; else process.env.WTP_BUILD_CONTEXT = before;
    if (phase === undefined) delete process.env.NEXT_PHASE; else process.env.NEXT_PHASE = phase;
  }
});
