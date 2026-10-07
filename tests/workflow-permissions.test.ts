import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const DIR = join(ROOT, ".github", "workflows");

function workflows(): { name: string; text: string }[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .map((name) => ({ name, text: readFileSync(join(DIR, name), "utf8") }));
}

function pushesMain(text: string): boolean {
  return /push-main\.mjs/.test(text);
}

/** Does it declare write access, at the top level or on the job? */
function declaresWrite(text: string): boolean {
  return /^\s*contents:\s*write\s*$/m.test(text);
}

const SOFTWARE_WORKFLOW_SECRET_ALLOWLIST = [
  "GITHUB_TOKEN",
  "WTP_CONTROL_PLANE_DATABASE_URL_READONLY",
  "WTP_CONTROL_PLANE_POST_DEPLOY_DATABASE_URL",
  "WTP_PRODUCTION_DATABASE_URL_READONLY",
] as const;

/** Secret names consumed by executable workflow expressions, never their values. */
function workflowSecretReferences(text: string): string[] {
  return [...text.matchAll(/\$\{\{\s*secrets\.([A-Z0-9_]+)\s*\}\}/g)]
    .map((match) => match[1])
    .filter((name): name is string => Boolean(name));
}

function assertSoftwareOnlyWorkflowSecrets(all: { name: string; text: string }[]): void {
  const actual = [...new Set(all.flatMap((workflow) => workflowSecretReferences(workflow.text)))].sort();
  assert.deepEqual(
    actual,
    [...SOFTWARE_WORKFLOW_SECRET_ALLOWLIST].sort(),
    "surviving Actions secrets must equal the closed software-CI/release allowlist; routine publisher credentials cannot return",
  );
}

test("no workflow declares write access", () => {
  const all = workflows();
  assert.ok(all.length > 0, "workflow discovery must not be empty");

  const pushers = all.filter((w) => pushesMain(w.text));
  assert.equal(pushers.length, 0, `no workflow may push mutable runtime truth to main; found ${pushers.map((w) => w.name).join(", ")}`);

  const missing = pushers.filter((w) => !declaresWrite(w.text)).map((w) => w.name);
  assert.deepEqual(
    missing,
    [],
    `these workflows push main with a read-only token and will 403 at the Commit step: ${missing.join(", ")}`,
  );

  const writers = all.filter((w) => declaresWrite(w.text));
  assert.deepEqual(
    writers.map((w) => w.name).sort(),
    [],
    "no workflow is authorized to write to the repository",
  );
});

test("THE PLANT: the guard catches a pusher whose permissions block is gone", () => {
  const planted = [
    "name: A refresher",
    "on:",
    "  schedule:",
    "    - cron: '0 9 * * *'",
    "jobs:",
    "  refresh:",
    "    steps:",
    "      - run: node scripts/push-main.mjs",
  ].join("\n");
  assert.equal(pushesMain(planted), true, "the pusher test cannot see the push script");
  assert.equal(declaresWrite(planted), false, "the permissions test passed a workflow with none");

  const fixed = planted.replace("jobs:", "permissions:\n  contents: write\n\njobs:");
  assert.equal(declaresWrite(fixed), true);
});

test("routine operations do not write runtime state to Git", () => {
  const all = workflows();
  assert.deepEqual(
    all.filter((workflow) => pushesMain(workflow.text)).map((workflow) => workflow.name).sort(),
    [],
  );
  const routineGitWriters = all.filter((workflow) => declaresWrite(workflow.text));
  assert.deepEqual(
    routineGitWriters.map((workflow) => workflow.name),
    [],
    `ROUTINE_OPS_GIT_WRITERS=${routineGitWriters.length}; runtime state belongs in canonical stores, not Git`,
  );
  for (const retired of ["job-watch.yml", "intake-tripwire.yml"]) {
    assert.equal(existsSync(join(DIR, retired)), false, `${retired} is still dispatchable`);
  }
});

test("surviving workflows reference exactly the software-CI/release secret allowlist", () => {
  assertSoftwareOnlyWorkflowSecrets(workflows());
});

test("THE PLANT: a routine publisher credential cannot return to Actions", () => {
  const planted = [
    ...workflows(),
    {
      name: "refresh-fec-snapshot.yml",
      text: "env:\n  FEC_API_KEY: ${{ secrets.FEC_API_KEY }}\n",
    },
  ];
  assert.throws(
    () => assertSoftwareOnlyWorkflowSecrets(planted),
    /routine publisher credentials cannot return/,
  );
  assert.deepEqual(
    workflowSecretReferences("env:\n  GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}\n"),
    ["GITHUB_TOKEN"],
    "the guard must permit the automatic software-CI token",
  );
});
