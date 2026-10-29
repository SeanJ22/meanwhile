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
