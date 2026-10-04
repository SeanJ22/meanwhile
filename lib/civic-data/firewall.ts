import { posix } from "node:path";
import * as nodeModule from "node:module";

import type { RoutineSourceContract } from "./contracts.ts";
import type { ManualProductionSourceContract } from "./manual-contracts.ts";

export interface CivicDataFirewallTree {
  readonly files: Readonly<Record<string, string>>;
  readonly contracts: readonly RoutineSourceContract[];
  readonly manualContracts: readonly ManualProductionSourceContract[];
  readonly inventory: {
    readonly census?: { readonly datasetFamiliesRepresented?: number; readonly datasetFamiliesTotal?: number };
    readonly classificationVocabulary?: readonly string[];
    readonly rows?: readonly { readonly source_id?: string; readonly classification?: string }[];
  };
}

export interface CivicDataFirewallFinding {
  readonly code: string;
  readonly path: string;
  readonly detail: string;
}

export const REMOVED_ROUTINE_OPS_WORKFLOWS = [
  ".github/workflows/intake-tripwire.yml",
  ".github/workflows/job-watch.yml",
] as const;

export const REMOVED_LEGACY_EXECUTABLES = [
  "scripts/acquire-az-sos-candidate-filings.mts",
  "scripts/acs-population-refresh.mts",
  "scripts/apply-county-finds.mjs",
  "scripts/backup-wakeup.mjs",
  "scripts/b14-official-links.mts",
  "scripts/ballot-az-pima-2026-update.mts",
  "scripts/check-nj-filing.mts",
  "scripts/control-plane-bootstrap.mts",
  "scripts/control-plane-proof.mts",
  "scripts/control-plane-proof-worker.mts",
  "scripts/candidate-universe.mts",
  "scripts/enrich-officials.mts",
  "scripts/emit-execution-result.mts",
  "scripts/fetch-legiscan.mts",
  "scripts/fetch-key-votes.mts",
  "scripts/fetch-law-votes.mts",
  "scripts/fetch-fec-directories.mts",
  "scripts/fetch-candidate-corpus.mts",
  "scripts/fetch-corpus.mts",
  "scripts/fetch-measure-analyses.mts",
  "scripts/build-officeholders.ts",
  "scripts/enrich-federal-officeholders.mts",
  "scripts/fetch-official-photos.mts",
  "scripts/migrate-congress-directory.mts",
  "scripts/reader-finance-identity.mts",
  "scripts/ship-approved-portraits.mts",
  "scripts/fix-b14-notes.mjs",
  "scripts/build-state-cf-agencies.mts",
  "scripts/hunt-azleg-build-store.mts",
  "scripts/fix-nh-official-pages.mts",
  "scripts/fix-stale-official-pages.mts",
  "scripts/identity-az-2026.mts",
  "scripts/jobs-status.mts",
  "scripts/lift-filed-addresses.mjs",
  "scripts/localize-card-photos.mts",
  "scripts/refresh-daily.mts",
  "scripts/refresh-gate.mts",
  "scripts/refresh-provenance-check.mts",
  "scripts/refresh-reader-renewal.mts",
  "scripts/source-headroom.mts",
  "scripts/lib/meetings-snapshot-write.ts",
  "scripts/lib/refresh-revert.ts",
  "scripts/promotion-canary.mts",
  "scripts/repair-mojibake.mts",
  "scripts/schedule-audit.mts",
  "scripts/scout-candidates-rederive.mts",
  "scripts/ship-candidate-field.mts",
  "scripts/ship-door3-portraits.mts",
  "scripts/ship-staged-portraits.mts",
  "scripts/wire-0825.mts",
  "scripts/wire-campaign-sites-0823.mts",
  "scripts/wire-door2-phones-0825.mts",
  "scripts/watch-workflows.mts",
  "lib/control-plane/promotion/promoter.ts",
  "lib/ops/execution-provenance.ts",
  "lib/ops/execution-result.ts",
  "lib/ops/refresh-cadence.ts",
  "lib/ops/refresh-gate.ts",
  "lib/ops/refresh-renewal.ts",
  "lib/ops/refresh-report.ts",
  "lib/ops/schedule-audit.ts",
  "lib/hunt/nj-filing-clock.ts",
  "lib/meetings/refresh-exit.ts",
] as const;

/**
 * Pure modules from the superseded Git-shipping transition. They modeled a
 * GitHub refresh clock/backup and converted source candidates into commits,
 * builds, and deploys. Keeping them callable from tests would preserve a
 * second architecture whose only purpose disappeared at permanent cutover.
 */
export const REMOVED_TRANSITION_DATA_PLANE = [
  "lib/control-plane/freshness/acquisition.ts",
  "lib/control-plane/freshness/authority.ts",
  "lib/control-plane/freshness/certification.ts",
  "lib/control-plane/freshness/coalesce.ts",
  "lib/control-plane/freshness/escalation.ts",
  "lib/control-plane/freshness/resource-policy.ts",
  "lib/control-plane/promotion/legacy-refresh.ts",
  "lib/control-plane/scheduler/providers/meetings.ts",
  "lib/control-plane/scheduler/providers/promoted-facts.ts",
] as const;

/**
 * One-time authority-transfer machinery. These paths intentionally exist only
 * in the importer commit whose exact SHA is written into the durable receipts.
 * The final software tree must delete them; making that absence part of the
 * ordinary civic-data firewall keeps a callable bootstrap from quietly
 * becoming a permanent second authority after cutover.
 */
export const REMOVED_TEMPORARY_TRUSTED_LKG_PATHS = [
  "scripts/pdc-v2-trusted-lkg-import.mts",
  "lib/civic-data/trusted-lkg-import-plan.ts",
  "tests/pdc-v2-trusted-lkg-importer.test.ts",
  "tests/trusted-lkg-reattestation.test.ts",
  "scripts/routine-civic-data-live-acceptance.mts",
  "scripts/routine-civic-data-live-canary-child.mts",
  "scripts/routine-civic-data-live-supervisor-proof.mts",
  "lib/civic-data/live-acceptance.ts",
  "tests/routine-civic-data-live-acceptance.test.ts",
] as const;

const TRUSTED_LKG_BOOTSTRAP_COMMAND = /(?:scripts[\\/]pdc-v2-trusted-lkg-import\.mts|lib[\\/]civic-data[\\/]trusted-lkg-import-plan\.ts)/i;
const TRUSTED_LKG_BOOTSTRAP_PLAN_CALLABLE = /\b(?:PDC_V2_TRUSTED_LKG_IMPORTER_PATH|buildPdcV2TrustedLkgImportPlan|buildPdcV2TrustedLkgReattestationCandidate|executePdcV2(?:TrustedLkg|PermanentCutover)ImportPlan|inspectTrustedLkgRepository|retirePdcV2LegacyMeetingsAggregate|assertPdcV2(?:PreContractMigrationState|PreImportDataIntegrity|ContractMigrationPreflight))\b/;
const TRUSTED_LKG_RUNTIME_CAPABILITY_DECLARATION = /\bRUNTIME_AUTHORITY_CAPABILITIES\s*=\s*(?:Object\.freeze\s*\()?\s*\[[\s\S]{0,2000}?["']TRUSTED_LKG_IMPORT["']/;
const TRUSTED_LKG_CAPABILITY_MINT = /(?:\[\s*RUNTIME_AUTHORITY_ENV\.capability\s*\]|["']WTP_RUNTIME_AUTHORITY_CAPABILITY["'])\s*(?::|=)\s*["']TRUSTED_LKG_IMPORT["']/;
const TRUSTED_LKG_AUTHORITY_BYPASS = /\ballowTemporaryImporterCheckout\b|\bcapabilities\s*:\s*\[[^\]]*["']TRUSTED_LKG_IMPORT["']|\bif\s*\([^)]*\.capability\s*===\s*["']TRUSTED_LKG_IMPORT["'][^)]*\)\s*return\b/;
const TRUSTED_LKG_STORE_ADMISSION = /\bauthority\s*\.\s*capability\s*===\s*["']TRUSTED_LKG_IMPORT["']/;
const TRUSTED_LKG_PROMOTION_ADMISSION = /\bTRUSTED_LKG_REGISTERED_DOOR\b/;
const TRUSTED_LKG_TEST_ADMISSION = /\bprocessRegistered(?:Routine|MeetingPartition|Manual)Candidate\b[\s\S]{0,20000}?["']TRUSTED_LKG_IMPORT["']|["']TRUSTED_LKG_IMPORT["'][\s\S]{0,20000}?\bprocessRegistered(?:Routine|MeetingPartition|Manual)Candidate\b/;

const ROUTINE_DATA_MARKER = /refresh(?::|-)(?:daily|meetings|nj-filing|dotgov|fec|legiscan)|routine:civic-data|routine-civic-data|ingest\s+composite|nj:ballot|dotgov:fetch|fec:fetch|nh:members|acs:population/i;
const ROUTINE_OPS_MARKER = /job(?::|-)?watch|watch(?::|-)?workflows|intake(?::|-)?tripwire|schedule(?::|-)?audit|jobs(?::|-)?status|freshness(?::|-)?shadow|nightly(?::|-)?window|window:run|runtime(?:-|_|\s)+(?:health|status|watch)|(?:health|status|watch)(?:-|_|\s)+runtime|refresh-run-log|workflow-run-index/i;
const SCHEDULE = /(?:^|\n)\s*schedule\s*:/m;
const CONTENTS_WRITE = /contents\s*:\s*write/i;
const WORKFLOW_GIT_WRITE = /\bgit(?:\.exe)?\b[^\r\n]{0,240}\b(?:add|commit|push)\b|scripts[\\/]push-main\.mjs|\bgh\s+api\b[^\r\n]*(?:\/contents(?:\/|\b)|repos\/[^/\s]+\/[^/\s]+\/contents)/i;
const RELEASE_INVOCATION = /scripts[\\/]push-main\.mjs|(?:spawn|spawnSync|execFile|execFileSync|exec|execSync|execa|command:|runCommand)\s*\([\s\S]{0,480}(?:["'`]git["'`][\s\S]{0,200}["'`](?:add|commit|push|merge|rebase|tag)["'`]|["'`]git\s+(?:add|commit|push|merge|rebase|tag)\b|["'`]gh["'`]|["'`]next["'`][\s\S]{0,100}["'`]build["'`]|netlify|\bdeploy\b|(?:pnpm|npm|yarn|bun)[\s\S]{0,160}\b(?:test|build|walk)\b|playwright)/i;
const PROCESS_LAUNCH_METHODS = new Set(["exec", "execFile", "execFileSync", "execSync", "fork", "spawn", "spawnSync"]);
const PROCESS_LAUNCH_METHOD = [...PROCESS_LAUNCH_METHODS].sort((left, right) => right.length - left.length).join("|");
const GIT_MUTATION_ARGUMENT = /(?:["'`](?:add|apply|am|checkout|cherry-pick|clean|commit|merge|mv|pull|push|rebase|reset|restore|revert|rm|switch|tag|update-index|update-ref|worktree)["'`]|\bgit(?:\.exe)?\s+(?:-[^\s"'`]+\s+)*(?:add|apply|am|checkout|cherry-pick|clean|commit|merge|mv|pull|push|rebase|reset|restore|revert|rm|switch|tag|update-index|update-ref|worktree)\b)/i;
const GIT_READ_ONLY_ARGUMENT = /["'`](?:cat-file|diff|log|ls-files|merge-base|remote|rev-parse|show|status|symbolic-ref)["'`]/i;
const NON_GIT_RELEASE_PAYLOAD = /scripts[\\/]push-main\.mjs|["'`]gh(?:\.exe)?["'`]|["'`]next(?:\.cmd)?["'`][\s\S]{0,120}["'`]build["'`]|\bnetlify\b|\bdeploy\b|["'`](?:pnpm|pnpm\.cmd|npm|npm\.cmd|yarn|bun)["'`][\s\S]{0,180}["'`](?:test|build|walk)["'`]|\bplaywright\b/i;
const SOFTWARE_CERTIFICATION_INVOCATION = /(?:(?:spawnSync|execFileSync|execSync|execa|command:|runCommand)\s*\([\s\S]{0,480}(?:(?:pnpm|npm|yarn|bun)[\s\S]{0,160}\b(?:test|build|lint|tsc|typecheck|walk)\b|--test|playwright|office-opening-spell|tests[\\/][^\s"'`]+\.test\.[cm]?[jt]s)|(?:from\s*|import\s*\()\s*["'][^"']*tests[\\/][^"']+\.test\.[cm]?[jt]s["'])/i;
const SOFTWARE_CERTIFICATION_PAYLOAD = /(?:pnpm|npm|yarn|bun)[\s\S]{0,180}\b(?:test|build|lint|tsc|typecheck|walk)\b|["'`]--test["'`]|\bplaywright\b|office-opening-spell|tests[\\/][^\s"'`]+\.test\.[cm]?[jt]s/i;
const SHELL_EXECUTABLE = /\.(?:ps1|sh|cmd|bat)$/i;
const SHELL_RELEASE_INVOCATION = /\bgit(?:\.exe)?\b[^\r\n]{0,240}\b(?:add|apply|am|checkout|cherry-pick|clean|commit|merge|pull|push|rebase|reset|restore|revert|rm|tag|update-ref)\b|scripts[\\/]push-main\.mjs|\bgh(?:\.exe)?\b|\bnetlify\b|\bdeploy\b/i;
const SHELL_FILESYSTEM_MUTATION = /\b(?:Add-Content|Clear-Content|Copy-Item|Move-Item|New-Item|Out-File|Remove-Item|Rename-Item|Set-Content)\b|(?:^|[;&|]\s*)(?:copy|cp|del|erase|mkdir|move|mv|rm|rmdir|touch|truncate)\b/im;
const FILESYSTEM_MUTATION_METHODS = new Set([
  "appendFile",
  "appendFileSync",
  "chmod",
  "chmodSync",
  "chown",
  "chownSync",
  "copyFile",
  "copyFileSync",
  "cp",
  "cpSync",
  "createWriteStream",
  "fchmod",
  "fchmodSync",
  "fchown",
  "fchownSync",
  "ftruncate",
  "ftruncateSync",
  "futimes",
  "futimesSync",
  "lchmod",
  "lchmodSync",
  "lchown",
  "lchownSync",
  "link",
  "linkSync",
  "lutimes",
  "lutimesSync",
  "mkdir",
  "mkdirSync",
  "mkdtemp",
  "mkdtempSync",
  "rename",
  "renameSync",
  "rm",
  "rmSync",
  "rmdir",
  "rmdirSync",
  "symlink",
  "symlinkSync",
  "truncate",
  "truncateSync",
  "unlink",
  "unlinkSync",
  "utimes",
  "utimesSync",
  "write",
  "writeFile",
  "writeFileSync",
  "writeSync",
  "writev",
  "writevSync",
]);
const DISTINCTIVE_FILESYSTEM_MUTATION_CALL = /(?:writeFile(?:Sync)?|appendFile(?:Sync)?|createWriteStream|writeStampStable)\s*\(/;
const FILESYSTEM_READ_METHODS = new Set(["createReadStream", "read", "readFile", "readFileSync"]);
const FILESYSTEM_READ_METHOD = [...FILESYSTEM_READ_METHODS]
  .sort((left, right) => right.length - left.length)
  .join("|");
const DISTINCTIVE_FILESYSTEM_READ_CALL = /(?:readFile(?:Sync)?|createReadStream|readArtifact)\s*\(/;
const TRACKED_RUNTIME_MUTABLE_TARGET = /\b(?:data\/health\/(?:freshness-shadow-runs|nightly-window-runs|job-watch\.json)|data\/control-plane\/(?:freshness-shadow|staging)|data\/method\/candidates\.json|data\/ops\/(?:maptiler-usage|refresh-debt|refresh-run-log|workflow-run-index|runner-relaunch-proof)\.json)\b/i;
const OWNER_SNAPSHOT_FORBIDDEN_TRACKED_LIVE_INPUT = /\b(?:data\/health\/(?:reader-suite-runs|control-set-runs)|data\/feedback\/sweeps|latestReaderRun|latestControlRun)\b/i;
const STANDING_RUNTIME_FORBIDDEN_TRACKED_SOFTWARE_HEALTH_INPUT = /\b(?:data\/health\/(?:reader-suite-runs|reader-questions\.json)|latestReaderRun|openRedReaderQuestions|openRedQuestionZips|openRedQuestions|readerSuiteRun)\b/i;
const RETIRED_REFRESH_HELPER = /\b(?:parseRefreshRunJson|parseRefreshRunMarkdown|legacyRefreshLines|RefreshRunUnreadable|restoreRefusedChange|revertFilesToHead|changedFilesUnder)\b/;
const RETIRED_TRACKED_ACQUISITION_WRITERS = [
  {
    path: "lib/sources/az-sos-candidate-filings/index.ts",
    marker: /\b(?:upsertCorpus|CORPUS_PATH|writeFile(?:Sync)?|mkdir(?:Sync)?|node:fs)\b/,
  },
  {
    path: "lib/sources/census-acs-population/index.ts",
    marker: /\b(?:function\s+upsert|writeFile(?:Sync)?|mkdir(?:Sync)?|node:fs)\b/,
  },
] as const;
const RETIRED_SCHEDULE_AUDIT_MARKERS = [
  /\bcronsInWorkflowYaml\b/,
  /\bparseDailyCron\b/,
  /\bexpectedSlots\b/,
  /\bUnsupportedCronShapeError\b/,
] as const;

function stripExecutableComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function stripShellComments(source: string, path: string): string {
  if (/\.(?:ps1|sh)$/i.test(path)) return source.replace(/^\s*#.*$/gm, "");
  if (/\.(?:cmd|bat)$/i.test(path)) return source.replace(/^\s*(?:rem\b|::).*$/gim, "");
  return source;
}

/**
 * Mask literal bodies before looking for calls. This keeps an error string or
 * recorded incident such as `"call rename(...)"` from manufacturing a writer
 * finding while leaving identifiers, punctuation, and line positions intact.
 */
function maskStringLiterals(source: string): string {
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;
  let masked = "";
  for (const char of source) {
    if (quote !== null) {
      if (escaped) {
        escaped = false;
        masked += char === "\n" ? "\n" : " ";
      } else if (char === "\\") {
        escaped = true;
        masked += " ";
      } else if (char === quote) {
        quote = null;
        masked += char;
      } else {
        masked += char === "\n" ? "\n" : " ";
      }
      continue;
    }
    if (char === "'" || char === '"' || char === "`") quote = char;
    masked += char;
  }
  return masked;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseNamedBindings(specifiers: string): readonly { imported: string; local: string }[] {
  return specifiers.split(",").flatMap((raw) => {
    const item = raw.trim().replace(/^type\s+/, "");
    if (!item) return [];
    const alias = /^([A-Za-z_$][\w$]*)(?:\s+as\s+|\s*:\s*)([A-Za-z_$][\w$]*)$/.exec(item);
    const imported = alias?.[1] ?? item;
    const local = alias?.[2] ?? imported;
    return /^[A-Za-z_$][\w$]*$/.test(imported) && /^[A-Za-z_$][\w$]*$/.test(local)
      ? [{ imported, local }]
      : [];
  });
}

/**
 * Follow capabilities detached from an already-known namespace or callable.
 * The sets only grow, so reversed alias chains converge and cycles terminate.
 * This deliberately does not treat an arbitrary object method with the same
 * name as a Node capability: the chain must originate at a recognized module.
 */
function resolveDetachedMethodBindings(
  source: string,
  namespaces: Set<string>,
  callables: Set<string>,
  methods: ReadonlySet<string>,
  { promisesNamespace = false }: { readonly promisesNamespace?: boolean } = {},
): void {
  const methodPattern = [...methods]
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp)
    .join("|");
  const simpleAssignments = [...source.matchAll(
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)(?:\s*:[^=;\r\n]+)?\s*=\s*([^;\r\n]+)/g,
  )];
  const destructuredAssignments = [...source.matchAll(
    /\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*([^;\r\n]+)/g,
  )];

  let changed = true;
  while (changed) {
    changed = false;
    for (const match of simpleAssignments) {
      const local = match[1]!;
      const value = (match[2] ?? "").trim();
      for (const namespace of [...namespaces]) {
        const escapedNamespace = escapeRegExp(namespace);
        if (new RegExp(String.raw`^${escapedNamespace}\s*$`).test(value) && !namespaces.has(local)) {
          namespaces.add(local);
          changed = true;
        }
        if (
          promisesNamespace
          && new RegExp(String.raw`^${escapedNamespace}\s*(?:\?\.|\.)\s*promises\s*$`).test(value)
          && !namespaces.has(local)
        ) {
          namespaces.add(local);
          changed = true;
        }
        const detachedMethod = new RegExp(
          String.raw`^${escapedNamespace}\s*(?:\?\.|\.)\s*${promisesNamespace ? String.raw`(?:promises\s*(?:\?\.|\.)\s*)?` : ""}(?:${methodPattern})\b(?:\s*\.\s*bind\s*\([^)]*\))?\s*$`,
        );
        if (detachedMethod.test(value) && !callables.has(local)) {
          callables.add(local);
          changed = true;
        }
      }
      for (const callable of [...callables]) {
        if (
          new RegExp(String.raw`^${escapeRegExp(callable)}\s*(?:\.\s*bind\s*\([^)]*\))?\s*$`).test(value)
          && !callables.has(local)
        ) {
          callables.add(local);
          changed = true;
        }
      }
    }

    for (const match of destructuredAssignments) {
      const value = (match[2] ?? "").trim();
      for (const namespace of [...namespaces]) {
        const escapedNamespace = escapeRegExp(namespace);
        const comesFromNamespace = new RegExp(
          String.raw`^${escapedNamespace}${promisesNamespace ? String.raw`(?:\s*(?:\?\.|\.)\s*promises)?` : ""}\s*$`,
        ).test(value);
        if (!comesFromNamespace) continue;
        for (const { imported, local } of parseNamedBindings(match[1] ?? "")) {
          if (promisesNamespace && imported === "promises" && !namespaces.has(local)) {
            namespaces.add(local);
            changed = true;
          }
          if (methods.has(imported) && !callables.has(local)) {
            callables.add(local);
            changed = true;
          }
        }
      }
    }
  }
}

function balancedCall(source: string, openAt: number): string {
  let depth = 0;
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;
  for (let index = openAt; index < source.length; index += 1) {
    const char = source[index]!;
    if (quote !== null) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(openAt, index + 1);
    }
  }
  // An incomplete expression is still inspected fail-closed rather than
  // becoming an evasion merely because the static instrument cannot balance it.
  return source.slice(openAt, Math.min(source.length, openAt + 1_200));
}

function matchingCalls(source: string, callee: RegExp): readonly string[] {
  const calls: string[] = [];
  for (const match of source.matchAll(callee)) {
    const at = (match.index ?? 0) + match[0].lastIndexOf("(");
    calls.push(balancedCall(source, at));
  }
  return calls;
}

/** Match against masked code, then recover the same balanced call from source. */
function matchingExecutableCalls(
  source: string,
  masked: string,
  callee: RegExp,
): readonly string[] {
  const calls: string[] = [];
  for (const match of masked.matchAll(callee)) {
    const at = (match.index ?? 0) + match[0].lastIndexOf("(");
    calls.push(balancedCall(source, at));
  }
  return calls;
}

function callCarriesReleasePayload(call: string): boolean {
  if (NON_GIT_RELEASE_PAYLOAD.test(call)) return true;
  const invokesGit = /["'`]git(?:\.exe)?["'`]|["'`][^"'`]{0,200}\bgit(?:\.exe)?\s+[^"'`]*/i.test(call);
  if (!invokesGit) return false;
  if (GIT_MUTATION_ARGUMENT.test(call)) return true;
  // Exact code-identity reads are the only legitimate Git dependency in the
  // real registered closure. An unknown Git verb fails closed; it does not get
  // to masquerade as another read-only identity operation.
  return !GIT_READ_ONLY_ARGUMENT.test(call);
}

/** Resolve child-process imports and detached aliases to balanced invocations. */
function processLaunchCalls(source: string): readonly string[] {
  const executable = stripExecutableComments(source);
  const masked = maskStringLiterals(executable);

  const callables = new Set<string>();
  const namespaces = new Set<string>();
  const modulePattern = String.raw`(?:node:)?child_process`;
  for (const match of executable.matchAll(new RegExp(String.raw`\b(?:import|export)\s*\{([^}]*)\}\s*from\s*["']${modulePattern}["']`, "g"))) {
    for (const { imported, local } of parseNamedBindings(match[1] ?? "")) {
      if (PROCESS_LAUNCH_METHODS.has(imported)) callables.add(local);
    }
  }
  for (const match of executable.matchAll(new RegExp(String.raw`\bimport\s+(?:\*\s+as\s+)?([A-Za-z_$][\w$]*)\s+from\s*["']${modulePattern}["']`, "g"))) {
    namespaces.add(match[1]!);
  }
  for (const match of executable.matchAll(new RegExp(String.raw`\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*(?:await\s*)?(?:require|import)\s*\(\s*["']${modulePattern}["']\s*\)`, "g"))) {
    for (const { imported, local } of parseNamedBindings(match[1] ?? "")) {
      if (PROCESS_LAUNCH_METHODS.has(imported)) callables.add(local);
    }
  }
  for (const match of executable.matchAll(new RegExp(String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s*)?(?:require|import)\s*\(\s*["']${modulePattern}["']\s*\)`, "g"))) {
    namespaces.add(match[1]!);
  }
  resolveDetachedMethodBindings(executable, namespaces, callables, PROCESS_LAUNCH_METHODS);

  const calls: string[] = [];
  for (const local of callables) {
    calls.push(...matchingExecutableCalls(
      executable,
      masked,
      new RegExp(String.raw`(?<![\w$.])${escapeRegExp(local)}\s*\(`, "g"),
    ));
  }
  for (const namespace of namespaces) {
    calls.push(...matchingExecutableCalls(
      executable,
      masked,
      new RegExp(String.raw`\b${escapeRegExp(namespace)}\s*(?:\?\.|\.)\s*(?:${PROCESS_LAUNCH_METHOD})\s*\(`, "g"),
    ));
  }
  for (const direct of [
    /\bBun\s*\.\s*(?:spawn|spawnSync)\s*\(/g,
    /\b(?:new\s+)?Deno\s*\.\s*Command\s*\(/g,
  ]) {
    calls.push(...matchingExecutableCalls(executable, masked, direct));
  }
  return [...new Set(calls)];
}

/** Resolve child-process imports before inspecting each balanced invocation. */
function invokesReleaseMachinery(
  source: string,
  launchCalls: readonly string[] = processLaunchCalls(source),
): boolean {
  const executable = stripExecutableComments(source);
  if (RELEASE_INVOCATION.test(executable)) return true;
  return launchCalls.some(callCarriesReleasePayload);
}

function invokesSoftwareCertification(
  source: string,
  launchCalls: readonly string[] = processLaunchCalls(source),
): boolean {
  const executable = stripExecutableComments(source);
  return SOFTWARE_CERTIFICATION_INVOCATION.test(executable)
    || launchCalls.some((call) => SOFTWARE_CERTIFICATION_PAYLOAD.test(call));
}

/** Resolve imported Node capabilities, including detached aliases and fs.promises. */
function nodeMethodBindings(executable: string, modulePattern: string, methods: ReadonlySet<string>, shadowed: ReadonlySet<string> = new Set()) {
  const namespaces = new Set<string>();
  const namedMutators = new Set<string>();

  for (const match of executable.matchAll(new RegExp(String.raw`\b(?:import|export)\s*\{([^}]*)\}\s*from\s*["']${modulePattern}["']`, "g"))) {
    for (const { imported, local } of parseNamedBindings(match[1] ?? "")) {
      if (imported === "promises") namespaces.add(local);
      if (methods.has(imported)) namedMutators.add(local);
    }
  }
  for (const match of executable.matchAll(new RegExp(String.raw`\bimport\s+(?:\*\s+as\s+)?([A-Za-z_$][\w$]*)\s+from\s*["']${modulePattern}["']`, "g"))) {
    namespaces.add(match[1]!);
  }
  for (const match of executable.matchAll(new RegExp(String.raw`\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*(?:await\s*)?(?:require|import)\s*\(\s*["']${modulePattern}["']\s*\)`, "g"))) {
    for (const { imported, local } of parseNamedBindings(match[1] ?? "")) {
      if (imported === "promises") namespaces.add(local);
      if (methods.has(imported)) namedMutators.add(local);
    }
  }
  for (const match of executable.matchAll(new RegExp(String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s*)?(?:require|import)\s*\(\s*["']${modulePattern}["']\s*\)(?:\s*\.\s*promises)?`, "g"))) {
    namespaces.add(match[1]!);
  }

  resolveDetachedMethodBindings(
    executable,
    namespaces,
    namedMutators,
    methods,
    { promisesNamespace: true },
  );

  const callees = [...namedMutators].filter(name => !shadowed.has(name)).map(escapeRegExp);
  for (const namespace of namespaces) {
    if (shadowed.has(namespace)) continue;
    callees.push(String.raw`${escapeRegExp(namespace)}\s*(?:\?\.|\.)\s*(?:promises\s*(?:\?\.|\.)\s*)?(?:${[...methods].map(escapeRegExp).join("|")})`);
  }
  return callees.length ? `(?:${callees.join("|")})` : "(?!)";
}

/** Split expressions at top-level commas, preserving nested calls and literals. */
function expressionParts(source: string): string[] {
  const masked = maskStringLiterals(source);
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < masked.length; index += 1) {
    const char = masked[index]!;
    if (char === "(" || char === "[" || char === "{") depth += 1;
    else if (")]}".includes(char)) depth -= 1;
    else if (char === "," && depth === 0) {
      parts.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(source.slice(start).trim());
  return parts;
}

/** Only exempt destinations derived from the OS temp root, never names like 'tmp'. */
function temporaryPathClassifier(executable: string): (expression: string) => boolean {
  const masked = maskStringLiterals(executable);
  const parameters = [
    ...matchingExecutableCalls(executable, masked, /\b(?:function(?:\s*\*)?(?:\s+[\w$]+)?|catch)\s*\(/g),
    ...[...masked.matchAll(/\(([^()]*)\)\s*(?::[^=;{}]+)?=>|\b([A-Za-z_$][\w$]*)\s*=>/g)].map(match => match[1] ?? match[2]!),
  ];
  // A same-named parameter must not inherit another scope's temporary path.
  const shadowed = new Set(parameters.flatMap(value => maskStringLiterals(value).match(/[A-Za-z_$][\w$]*/g) ?? []));
  const tmpdir = nodeMethodBindings(executable, String.raw`(?:node:)?os`, new Set(["tmpdir"]), shadowed);
  const paths = nodeMethodBindings(executable, String.raw`(?:node:)?path`, new Set(["join", "resolve"]), shadowed);
  const mkdtemp = nodeMethodBindings(executable, String.raw`(?:node:)?fs(?:/promises)?`, new Set(["mkdtemp", "mkdtempSync"]), shadowed);
  const constants = new Map<string, string>();
  const duplicates = new Set<string>();
  const declarations = new Set<string>();
  for (const match of executable.matchAll(/\b(const|let|var)\s+([A-Za-z_$][\w$]*)(?:\s*:[^=;\r\n]+)?\s*=\s*([^;\r\n]+)/g)) {
    if (!/^(?:const|let|var)\s/.test(masked.slice(match.index))) continue;
    if (declarations.has(match[2]!)) duplicates.add(match[2]!);
    declarations.add(match[2]!);
    if (match[1] === "const") constants.set(match[2]!, match[3]!.trim());
  }
  const relativeLiteral = (value: string): boolean => {
    const literal = /^(["'`])([^"'`\\]*)\1$/.exec(value)?.[2];
    return literal !== undefined && !literal.includes("${") && !literal.includes(":")
      && !literal.startsWith("/") && !literal.split("/").includes("..");
  };
  const isTemporary = (raw: string, seen = new Set<string>()): boolean => {
    const value = raw.trim().replace(/^await\s+/, "");
    if (new RegExp(`^${tmpdir}\\s*\\(\\s*\\)$`).test(value)) return true;
    if (constants.has(value) && !duplicates.has(value) && !shadowed.has(value) && !seen.has(value)) {
      return isTemporary(constants.get(value)!, new Set([...seen, value]));
    }
    const call = new RegExp(`^(?:${paths}|${mkdtemp})\\s*\\(`).exec(value);
    if (!call) return false;
    const open = call[0].lastIndexOf("(");
    const body = balancedCall(value, open);
    if (open + body.length !== value.length || !body.endsWith(")")) return false;
    const args = expressionParts(body.slice(1, -1));
    return args.length > 0 && isTemporary(args[0]!, seen) && args.slice(1).every(relativeLiteral);
  };
  return expression => isTemporary(expression);
}

function invokesFilesystemMutation(source: string): boolean {
  const executable = stripExecutableComments(source);
  const masked = maskStringLiterals(executable);
  const isTemporary = temporaryPathClassifier(executable);
  const destinationOnly = new Set(["copyFile", "copyFileSync", "cp", "cpSync", "link", "linkSync", "symlink", "symlinkSync"]);
  const moves = new Set(["rename", "renameSync"]);
  const firstPath = new Set([...FILESYSTEM_MUTATION_METHODS].filter(method => !destinationOnly.has(method) && !moves.has(method)));
  // A copy mutates its destination; a move mutates both source and destination.
  for (const { methods, indexes } of [{ methods: destinationOnly, indexes: [1] }, { methods: moves, indexes: [0, 1] }, { methods: firstPath, indexes: [0] }]) {
    const callees = nodeMethodBindings(executable, String.raw`(?:node:)?fs(?:/promises)?`, methods);
    const calls = [...matchingExecutableCalls(executable, masked, new RegExp(`(?<![\\w$.])${callees}\\s*\\(`, "g"))];
    if (methods === firstPath) calls.push(...matchingExecutableCalls(executable, masked, new RegExp(DISTINCTIVE_FILESYSTEM_MUTATION_CALL.source, "g")));
    if (calls.some(call => {
      const args = expressionParts(call.slice(1, -1));
      return indexes.some(index => args[index] === undefined || !isTemporary(args[index]!));
    })) return true;
  }
  return false;
}

/**
 * The read-side twin of the mutation detector. A retired tracked runtime file
 * cannot become authoritative again merely by renaming `readFile`, reaching it
 * through a namespace/CommonJS binding, or switching to fs/promises.
 */
function filesystemReadCalls(source: string): readonly string[] {
  const executable = stripExecutableComments(source);
  const masked = maskStringLiterals(executable);
  const calls: string[] = [
    ...matchingExecutableCalls(executable, masked, new RegExp(DISTINCTIVE_FILESYSTEM_READ_CALL.source, "g")),
  ];

  const namespaces = new Set<string>();
  const namedReaders = new Set<string>();
  const modulePattern = String.raw`(?:node:)?fs(?:/promises)?`;
  for (const match of executable.matchAll(new RegExp(String.raw`\b(?:import|export)\s*\{([^}]*)\}\s*from\s*["']${modulePattern}["']`, "g"))) {
    for (const { imported, local } of parseNamedBindings(match[1] ?? "")) {
      if (imported === "promises") namespaces.add(local);
      if (FILESYSTEM_READ_METHODS.has(imported)) namedReaders.add(local);
    }
  }
  for (const match of executable.matchAll(new RegExp(String.raw`\bimport\s+(?:\*\s+as\s+)?([A-Za-z_$][\w$]*)\s+from\s*["']${modulePattern}["']`, "g"))) {
    namespaces.add(match[1]!);
  }
  for (const match of executable.matchAll(new RegExp(String.raw`\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*(?:await\s*)?(?:require|import)\s*\(\s*["']${modulePattern}["']\s*\)`, "g"))) {
    for (const { imported, local } of parseNamedBindings(match[1] ?? "")) {
      if (imported === "promises") namespaces.add(local);
      if (FILESYSTEM_READ_METHODS.has(imported)) namedReaders.add(local);
    }
  }
  for (const match of executable.matchAll(new RegExp(String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s*)?(?:require|import)\s*\(\s*["']${modulePattern}["']\s*\)(?:\s*\.\s*promises)?`, "g"))) {
    namespaces.add(match[1]!);
  }

  resolveDetachedMethodBindings(
    executable,
    namespaces,
    namedReaders,
    FILESYSTEM_READ_METHODS,
    { promisesNamespace: true },
  );

  for (const local of namedReaders) {
    calls.push(...matchingExecutableCalls(
      executable,
      masked,
      new RegExp(String.raw`(?<![\w$.])${escapeRegExp(local)}\s*\(`, "g"),
    ));
  }
  for (const namespace of namespaces) {
    const call = new RegExp(
      String.raw`\b${escapeRegExp(namespace)}\s*(?:\?\.|\.)\s*(?:promises\s*(?:\?\.|\.)\s*)?(?:${FILESYSTEM_READ_METHOD})\s*\(`,
      "g",
    );
    calls.push(...matchingExecutableCalls(executable, masked, call));
  }
  return [...new Set(calls)];
}

function trackedRuntimePathBindings(source: string, target = TRACKED_RUNTIME_MUTABLE_TARGET): ReadonlySet<string> {
  const bindings = new Set<string>();
  const executable = stripExecutableComments(source);
  const assignments = [...executable.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\r\n]+)/g)];
  let changed = true;
  while (changed) {
    changed = false;
    for (const match of assignments) {
      const local = match[1]!;
      const value = match[2] ?? "";
      const carriesTrackedPath = target.test(joinedPathLiterals(value));
      const aliasesTrackedPath = [...bindings].some((binding) =>
        new RegExp(String.raw`\b${escapeRegExp(binding)}\b`).test(value));
      if ((carriesTrackedPath || aliasesTrackedPath) && !bindings.has(local)) {
        bindings.add(local);
        changed = true;
      }
    }
  }
  return bindings;
}

function readsTrackedRuntimeState(source: string): boolean {
  const executable = stripExecutableComments(source);
  const bindings = trackedRuntimePathBindings(executable);
  const callCarriesTrackedPath = (call: string) =>
    TRACKED_RUNTIME_MUTABLE_TARGET.test(joinedPathLiterals(call))
    || [...bindings].some((binding) => new RegExp(String.raw`\b${escapeRegExp(binding)}\b`).test(call));
  if (filesystemReadCalls(executable).some(callCarriesTrackedPath)) return true;

  for (const match of executable.matchAll(
    /(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)["'`]([^"'`]+\.json(?:[?#][^"'`]*)?)["'`]/g,
  )) {
    if (TRACKED_RUNTIME_MUTABLE_TARGET.test((match[1] ?? "").replace(/\\/g, "/"))) return true;
  }
  return false;
}

/** Make `join(ROOT, "data", "health", "x")` searchable as `data/health/x`. */
function joinedPathLiterals(source: string): string {
  return source.replace(/["'`]\s*,\s*["'`]/g, "/").replace(/\\/g, "/");
}

function resolveLocalModule(
  files: Readonly<Record<string, string>>,
  importer: string,
  reference: string,
): string | null {
  if (!reference.startsWith(".")) return null;
  const clean = reference.split(/[?#]/, 1)[0] ?? reference;
  const base = posix.normalize(posix.join(posix.dirname(importer), clean));
  if (base === ".." || base.startsWith("../")) return null;
  const extension = posix.extname(base);
  const candidates = extension
    ? [
        base,
        ...(extension === ".js" || extension === ".mjs" || extension === ".cjs"
          ? [base.slice(0, -extension.length) + ".ts", base.slice(0, -extension.length) + ".mts", base.slice(0, -extension.length) + ".tsx"]
          : []),
      ]
    : [base, `${base}.ts`, `${base}.mts`, `${base}.tsx`, `${base}.js`, `${base}.mjs`, `${base}/index.ts`, `${base}/index.mts`, `${base}/index.tsx`, `${base}/index.js`];
  return candidates.find((candidate) => Object.hasOwn(files, candidate)) ?? null;
}

interface ExecutableDependencyNode {
  readonly path: string;
  readonly executable: string;
  readonly launchCalls: readonly string[];
}

interface ExecutableDependencyClosure {
  readonly nodes: readonly ExecutableDependencyNode[];
  readonly problems: readonly string[];
}

const EXECUTABLE_CLOSURE_NODE_LIMIT = 512;

function repositoryLocalExecutableReferences(
  files: Readonly<Record<string, string>>,
  executable: string,
): readonly string[] {
  const references = new Set<string>();
  const searchable = joinedPathLiterals(executable);
  for (const match of searchable.matchAll(
    /(?:^|[^A-Za-z0-9_.-])(?:\.\/)?((?:scripts|lib)\/[A-Za-z0-9_./-]+\.(?:[cm]?[jt]sx?|ps1|sh|cmd|bat))\b/gim,
  )) {
    const requested = (match[1] ?? "").replace(/\\/g, "/");
    const extension = posix.extname(requested);
    const candidates = [
      requested,
      ...(extension === ".js" || extension === ".mjs" || extension === ".cjs"
        ? [
            requested.slice(0, -extension.length) + ".ts",
            requested.slice(0, -extension.length) + ".mts",
            requested.slice(0, -extension.length) + ".tsx",
          ]
        : []),
    ];
    const path = candidates.find((candidate) => Object.hasOwn(files, candidate));
    if (path !== undefined) references.add(path);
  }
  return [...references];
}

function processInvocationProjection(
  source: string,
  launchCalls: readonly string[] = processLaunchCalls(source),
): string {
  return launchCalls
    .map((call) => [...call.matchAll(/["'`]([^"'`]*)["'`]/g)].map((match) => match[1] ?? "").join(" "))
    .join("\n");
}

function executableDependencyClosure(
  files: Readonly<Record<string, string>>,
  entry: string,
  expandExecutable: (path: string) => WorkflowExecutableClosure = (path) =>
    workflowExecutableClosure(files, path),
): ExecutableDependencyClosure {
  const seen = new Set<string>();
  const pending = [entry];
  const nodes: ExecutableDependencyNode[] = [];
  const problems = new Set<string>();
  while (pending.length > 0) {
    if (seen.size >= EXECUTABLE_CLOSURE_NODE_LIMIT) {
      problems.add(`registered executable closure exceeded ${EXECUTABLE_CLOSURE_NODE_LIMIT} files`);
      break;
    }
    const path = pending.shift()!;
    if (seen.has(path)) continue;
    seen.add(path);
    const source = stripExecutableComments(files[path] ?? "");
    const packageClosure = expandExecutable(path);
    for (const problem of packageClosure.problems) problems.add(problem);
    const launchCalls = processLaunchCalls(packageClosure.executable);
    nodes.push({ path, executable: packageClosure.executable, launchCalls });
    // Type-only imports cannot grant runtime capabilities. Let Node's own TS
    // parser erase them, rather than walking a repository interface into its
    // unrelated writers. Unparseable syntax retains the conservative closure.
    let importSource = source;
    if (/\b(?:import|export)\s+(?:type\b|\{[^}]*\btype\b)/.test(source)) {
      // Runtime Node exposes this API before this repository's @types/node.
      const strip = (nodeModule as typeof nodeModule & { stripTypeScriptTypes?: (code: string) => string }).stripTypeScriptTypes;
      try { if (strip) importSource = strip(source); } catch { /* fail closed */ }
    }
    const references = importSource.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s*)["'`]([^"'`]+)["'`]/g);
    for (const match of references) {
      const dependency = resolveLocalModule(files, path, match[1] ?? "");
      if (
        dependency !== null
        && /\.[cm]?[jt]sx?$/.test(dependency)
        && !seen.has(dependency)
      ) {
        pending.push(dependency);
      }
    }
    const executedText = [
      processInvocationProjection(source, launchCalls),
      ...launchCalls,
      ...packageClosure.packageCommands,
    ].join("\n");
    for (const dependency of repositoryLocalExecutableReferences(files, executedText)) {
      if (!seen.has(dependency)) pending.push(dependency);
    }
  }
  return { nodes, problems: [...problems].sort() };
}

interface WorkflowExecutableClosure {
  readonly executable: string;
  readonly packageCommands: readonly string[];
  readonly problems: readonly string[];
}

const WORKFLOW_CLOSURE_NODE_LIMIT = 256;

/**
 * Expand only executable indirection GitHub itself can follow without code
 * review: package-script aliases and repository-local composite actions.
 * Cycles are ordinary (scripts can alias each other while being edited), so a
 * visited set terminates them; a path that cannot be resolved is a named,
 * fail-closed instrumentation problem rather than an invisible workflow body.
 */
function workflowExecutableClosure(
  files: Readonly<Record<string, string>>,
  workflowPath: string,
): WorkflowExecutableClosure {
  let packageScripts: Readonly<Record<string, string>> = {};
  const problems: string[] = [];
  try {
    const parsed = JSON.parse(files["package.json"] ?? "{}") as { readonly scripts?: unknown };
    if (parsed.scripts !== undefined && (typeof parsed.scripts !== "object" || parsed.scripts === null || Array.isArray(parsed.scripts))) {
      problems.push("package.json scripts is not an object");
    } else {
      packageScripts = Object.fromEntries(
        Object.entries((parsed.scripts ?? {}) as Record<string, unknown>)
          .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      );
    }
  } catch (error) {
    problems.push(`package.json could not be parsed (${error instanceof Error ? error.name : "error"})`);
  }

  const pending: { readonly id: string; readonly body: string }[] = [{
    id: workflowPath,
    body: (files[workflowPath] ?? "").replace(/^\s*#.*$/gm, ""),
  }];
  const seen = new Set<string>();
  const chunks: string[] = [];
  const packageCommands: string[] = [];
  while (pending.length > 0) {
    if (seen.size >= WORKFLOW_CLOSURE_NODE_LIMIT) {
      problems.push(`workflow executable closure exceeded ${WORKFLOW_CLOSURE_NODE_LIMIT} nodes`);
      break;
    }
    const next = pending.shift()!;
    if (seen.has(next.id)) continue;
    seen.add(next.id);
    chunks.push(next.body);
    if (next.id.startsWith("package-script:")) packageCommands.push(next.body);

    // YAML/composite actions and package-script bodies are shell text. Source
    // files are not: a diagnostic/error string such as "run `pnpm x`" is not
    // executable reachability. For code, follow only balanced child-process
    // calls projected by processInvocationProjection.
    const shellLike = next.id.startsWith("package-script:")
      || /(?:\.ya?ml|\.ps1|\.sh|\.cmd|\.bat)$/i.test(next.id);
    const invocationSurface = `${shellLike ? next.body : ""}\n${processInvocationProjection(next.body)}`;
    for (const [name, command] of Object.entries(packageScripts)) {
      const escaped = escapeRegExp(name);
      const invocation = new RegExp(
        String.raw`\b(?:pnpm(?:\.cmd)?\s+(?:(?:--silent|-s)\s+)*(?:run\s+)?|npm(?:\.cmd)?\s+(?:(?:--silent|-s)\s+)*(?:run|run-script)\s+|yarn(?:\.cmd)?\s+(?:(?:--silent|-s)\s+)*(?:run\s+)?|bun(?:\.exe)?\s+run\s+)["']?${escaped}["']?(?=$|[\s;&|])`,
        "m",
      );
      const id = `package-script:${name}`;
      if (invocation.test(invocationSurface) && !seen.has(id)) pending.push({ id, body: stripExecutableComments(command) });
    }

    for (const match of next.body.matchAll(/\buses\s*:\s*["']?(\.\/[A-Za-z0-9_./\\-]+)["']?/g)) {
      const requested = (match[1] ?? "").replace(/\\/g, "/").replace(/^\.\//, "");
      const normalized = posix.normalize(requested);
      if (normalized === ".." || normalized.startsWith("../")) {
        problems.push(`local action escapes the repository: ${match[1]}`);
        continue;
      }
      const candidates = /\.ya?ml$/i.test(normalized)
        ? [normalized]
        : [`${normalized}/action.yml`, `${normalized}/action.yaml`];
      const actionPath = candidates.find((candidate) => Object.hasOwn(files, candidate));
      if (actionPath === undefined) {
        problems.push(`local action could not be resolved: ${match[1]}`);
        continue;
      }
      if (!seen.has(actionPath)) {
        pending.push({ id: actionPath, body: (files[actionPath] ?? "").replace(/^\s*#.*$/gm, "") });
      }
    }
  }
  return {
    executable: chunks.join("\n"),
    packageCommands,
    problems: [...new Set(problems)].sort(),
  };
}
const RETIRED_PLURAL_WRITER_SOURCE = /(?:from\s*["'][^"']*sources\/plural\/index\.ts["']|officeholders-\$\{|data\/states\/\*\/officials\/officeholders-\?\?\.json)/;
const RETIRED_PLURAL_READER_GATES = [
  { path: "lib/photos/person.ts", gate: /officeholderIdentityMayEnterReader\(row\.officeholderId\)/ },
  { path: "lib/registry/server.ts", gate: /officeholderIdentityMayEnterReader\(photo\.officeholderId\)/ },
  { path: "lib/officials/campaign-sites.ts", gate: /officeholderIdentityMayEnterReader\(officeholderId\)/ },
  { path: "lib/corpus/unified.ts", gate: /currentOfficeholderStatements\(\)/ },
] as const;
const OFFICEHOLDER_STATEMENT_FIRST_SEEDS = [
  "statements.json",
  "statement-identity-first-seed-v1.json",
] as const;
const PDC_V2_TRUSTED_LKG_IMPORT_PLAN = "lib/civic-data/trusted-lkg-import-plan.ts";
const PDC_V2_TRUSTED_LKG_IMPORTER = "scripts/pdc-v2-trusted-lkg-import.mts";
const OFFICEHOLDER_STATEMENT_SEED_ALLOWLIST = new Set([
  "lib/corpus/data-plane.ts",
  "lib/corpus/artifacts.ts",
  "lib/civic-data/firewall.ts",
  "lib/civic-data/manual-contracts.ts",
  "lib/civic-data/non-routine-dispositions.ts",
  PDC_V2_TRUSTED_LKG_IMPORT_PLAN,
]);
const FEDERAL_VOTE_FIRST_SEEDS = [
  "votes-snapshot.json",
  "bill-summaries.json",
  "key-votes-snapshot.json",
  "key-vote-positions.json",
  "law-titles-cache.json",
] as const;
const FEDERAL_VOTE_SEED_REFERENCE_ALLOWLIST = new Set([
  "lib/votes/snapshot.ts",
  "lib/votes/key-votes-projection.ts",
  "lib/civic-data/firewall.ts",
  "lib/civic-data/manual-contracts.ts",
  "lib/civic-data/non-routine-dispositions.ts",
  "lib/holdings/reader-census.ts",
  "lib/holdings/reader-trace.ts",
  PDC_V2_TRUSTED_LKG_IMPORT_PLAN,
]);
const RETIRED_ACTION_OUTCOME_SEEDS = [
  {
    name: "az-governor-actions.json",
    allowed: new Set([
      "lib/officials/executive-actions.ts",
      "lib/civic-data/firewall.ts",
      "lib/civic-data/manual-contracts.ts",
      "lib/civic-data/non-routine-dispositions.ts",
      PDC_V2_TRUSTED_LKG_IMPORT_PLAN,
    ]),
  },
  {
    name: "legistar-outcomes.json",
    allowed: new Set([
      "lib/outcomes/store.ts",
      "lib/civic-data/firewall.ts",
      // The routine contract names it as bootstrap/test material only.
      "lib/civic-data/contracts.ts",
      "lib/civic-data/non-routine-dispositions.ts",
      // This is a filename-classification table used only by the engineering
      // holdings census. It neither opens nor serves the historical seed.
      "lib/holdings/classification.ts",
    ]),
  },
] as const;
const VOTING_PRL_FIRST_SEEDS = [
  {
    name: "voting-sites.json",
    allowed: new Set([
      "lib/ballot/voting-sites-server.ts",
      "lib/civic-data/firewall.ts",
      "lib/civic-data/manual-contracts.ts",
      "lib/civic-data/non-routine-dispositions.ts",
    ]),
  },
  {
    name: "prl-profiles.json",
    allowed: new Set([
      "lib/sources/prl/snapshot.ts",
      "lib/civic-data/firewall.ts",
      "lib/civic-data/manual-contracts.ts",
      "lib/civic-data/non-routine-dispositions.ts",
    ]),
  },
] as const;
const REGISTRY_RUNTIME_FIRST_SEEDS = [
  "officeholders-us.json",
  "registry.json",
  "promoted-bodies.json",
  "official-photos.json",
  "roster-photos.json",
  "official-candidacies-first-seed.json",
] as const;
const REGISTRY_RUNTIME_SEED_ALLOWLIST = new Set([
  "lib/officials/federal-directory-read-model.ts",
  "lib/registry/runtime-read-model.ts",
  "lib/registry/promoted-bodies.ts",
  "lib/civic-data/firewall.ts",
  "lib/civic-data/manual-contracts.ts",
  "lib/civic-data/non-routine-dispositions.ts",
  "lib/holdings/reader-census.ts",
  "lib/holdings/reader-trace.ts",
  "lib/holdings/manifest.ts",
  "lib/holdings/module-datasets.ts",
  "lib/ops/generated-register.ts",
  "lib/coverage/photo-slots.ts",
  // These paths name retired/first-seed filenames only as explicit test
  // policy or another source's longer artifact name; their production reads
  // are separately guarded below and by the Plural retirement checks.
  "lib/ask/votes.ts",
  "lib/civic-data/manual-read-models.ts",
  "lib/identity/az-2026.ts",
  "lib/officials/roster-authority.ts",
  "lib/registry/server.ts",
]);
const CURATED_READER_FIRST_SEED_SYMBOLS = [
  "COMMENT_ACCESS",
  "POLLING_PLACE_LINKS",
  "REGISTRATION_LINKS",
  "CAMPAIGN_SITES",
  "VENUE_CACHE",
] as const;
const CURATED_READER_SEED_ALLOWLIST = new Set([
  "lib/registry/comment-access.ts",
  "lib/ballot/polling-place-links.ts",
  "lib/ballot/registration-links.ts",
  "lib/officials/campaign-sites.ts",
  "lib/meetings/venue-cache.ts",
  "lib/holdings/module-datasets.ts",
  "scripts/audit-officials.mts",
  "lib/civic-data/firewall.ts",
  PDC_V2_TRUSTED_LKG_IMPORT_PLAN,
]);
const CURATED_READER_TRACKED_WRITE = /(?:writeFile(?:Sync)?|appendFile(?:Sync)?|writeStampStable)\s*\(\s*(?:["'`](?:\.\.\/|\.\/)?(?:lib\/registry\/comment-access\.ts|lib\/ballot\/(?:polling-place|registration)-links\.ts|lib\/officials\/campaign-sites\.ts|lib\/meetings\/venue-cache\.ts)["'`]|(?:join|resolve)\s*\([^)]{0,300}["'`](?:comment-access|polling-place-links|registration-links|campaign-sites|venue-cache)\.ts["'`][^)]*\))/;
const CURATED_READER_TRACKED_VENUE_AUTHORITY = /\b(?:legistar|insite)-venues\.json\b/;
const CURATED_READER_TRACKED_VENUE_REFERENCE_ALLOWLIST = new Set([
  "lib/holdings/classification.ts",
  "lib/holdings/datasets.ts",
  "lib/civic-data/firewall.ts",
]);
const CURATED_READER_READER_GATES = [
  {
    path: "lib/civic-data/curated-reader-read-model.ts",
    required: [
      /readPromotedCivicData<CuratedReaderProjection>/,
      /mayUseTestFixture\(\)/,
    ],
  },
  { path: "lib/registry/comment-access.ts", required: [
    /const seed = COMMENT_ACCESS\.map\(\(value\) => \(\{\s*id: `comment-access:\$\{value\.bodyId\}`,\s*\.\.\.value,?\s*\}\)\);\s*return currentCuratedReaderRecords\("comment-access",\s*seed\)/,
    /records = \[\]/,
  ] },
  { path: "lib/ballot/polling-place-links.ts", required: [/currentCuratedReaderRecords\("ballot-navigation",\s*seed\)/] },
  { path: "lib/ballot/registration-links.ts", required: [/currentCuratedReaderRecords\("ballot-navigation",\s*seed\)/] },
  { path: "lib/officials/campaign-sites.ts", required: [/currentCuratedReaderRecords\("campaign-sites",\s*seed\)/, /records = \{\}/] },
  { path: "lib/meetings/venue-cache.ts", required: [/currentCuratedReaderRecords\("venue-resolutions",\s*seed\)/, /reviewedVenueEntries[\s\S]*currentVenueCache\(\)/] },
  { path: "lib/sources/legistar/client-registry.ts", required: [/reviewedVenueEntries\(/, /legistarClientsFromWiring/, /wiringForMeetingSource\("legistar"\)/] },
  { path: "lib/sources/legistar-insite/tenant-registry.ts", required: [/reviewedVenueEntries\(/, /inSiteTenantsFromWiring/, /wiringForMeetingSource\("legistar-insite"\)/] },
  { path: "app/api/meetings/route.ts", required: [/refreshCommentAccessFromPromoted/, /commentAccessDataState = "STORE_UNREACHABLE"/] },
  { path: "app/api/voting-sites/route.ts", required: [/refreshBallotNavigationFromPromoted/, /ballotNavigationDataState = "STORE_UNREACHABLE"/] },
  { path: "app/ballot/page.tsx", required: [/settleBallotNavigationRead/, /registrationLinkFor\([^,]+,\s*registrationLinks\)/, /pollingPlaceLinkFor\([^,]+,\s*pollingPlaceLinks\)/] },
  { path: "app/api/ask/grounded/route.ts", required: [/refreshCommentAccessFromPromoted\(\)\.catch/] },
  { path: "lib/registry/server.ts", required: [/refreshCampaignSitesFromPromoted/] },
  { path: "scripts/ingest.ts", required: [/refreshVenueResolutionsFromPromoted/, /input\.sourceName === "composite"\s*\|\|\s*input\.sourceName === "legistar"/] },
] as const;

const MEETING_PARTITION_AUTHORITY_GATES = [
  {
    path: "lib/registry/source-wiring.ts",
    required: [/meetingSourceNamesForWiring/, /wiringForMeetingSource/, /TUCSON_CLERKSBOARDS_ROUTES/],
  },
  {
    path: "lib/registry/curated-bodies.ts",
    required: [/activeWiring/, /agendaSourceType === "CLERKSBOARDS"/],
  },
  {
    path: "lib/civic-data/meeting-partitions.ts",
    required: [/SOURCE_WIRING/, /meetingSourceNamesForWiring/, /MEETING_PARTITION_CONTRACTS/],
  },
  {
    path: "lib/sources/legistar/client-registry.ts",
    required: [/legistarClientsFromWiring/, /wiringForMeetingSource\("legistar"\)/],
  },
  {
    path: "lib/sources/legistar-insite/tenant-registry.ts",
    required: [/inSiteTenantsFromWiring/, /wiringForMeetingSource\("legistar-insite"\)/],
  },
  {
    path: "lib/sources/composite/wiring.ts",
    required: [/wiringForMeetingSource/, /capability\.make\(rows(?:, *[\w.]+)?\)/],
  },
  {
    path: "lib/meetings/snapshot.ts",
    required: [/MEETING_PARTITION_CONTRACTS/, /partition\.scope/, /collapseDuplicateSittings/, /PRODUCTION_MEETING_SOURCE_MUST_BE_CANONICAL/],
  },
  {
    path: "lib/meetings/registry.ts",
    required: [/process\.env\.NODE_ENV === "production"/, /PRODUCTION_MEETING_SOURCE_MUST_BE_CANONICAL/],
  },
  {
    path: "lib/ask/meeting-knowledge.ts",
    required: [/read:\s*MeetingSnapshotRead/, /import\s+type\s+\{\s*MeetingsSnapshot\s*\}/],
  },
  {
    path: "scripts/ingest.ts",
    required: [
      /source\.lastPartitionRows/,
      /readPreviousMeetingPartition/,
      /readMeetingPartitionProjection/,
      /processRegisteredMeetingPartitionCandidate/,
      /RCD_MEETING_PARTITION_RECEIPT=/,
      /MEETING_PARTITION_EXACTLY_ONE_REQUIRED/,
      /MEETING_PARTITION_BATCH_ARGUMENT_RETIRED/,
    ],
  },
] as const;

/** Deterministic architecture audit. Every finding is a fail-closed result. */
export function civicDataFirewall(tree: CivicDataFirewallTree): readonly CivicDataFirewallFinding[] {
  const findings: CivicDataFirewallFinding[] = [];
  const add = (code: string, path: string, detail: string) => findings.push({ code, path, detail });
  const registeredDataCommands = [
    ...tree.contracts.map((contract) => contract.acquisitionAdapter.command[0] ?? ""),
    ...tree.manualContracts.map((contract) => contract.command[0] ?? ""),
  ].filter(Boolean);
  const workflowClosureCache = new Map<string, WorkflowExecutableClosure>();
  const expandExecutable = (path: string): WorkflowExecutableClosure => {
    const cached = workflowClosureCache.get(path);
    if (cached !== undefined) return cached;
    const source = stripExecutableComments(tree.files[path] ?? "");
    const closure = /\b(?:pnpm(?:\.cmd)?|npm(?:\.cmd)?|yarn(?:\.cmd)?|bun(?:\.exe)?)\b|\buses\s*:/i.test(source)
      ? workflowExecutableClosure(tree.files, path)
      : { executable: source, packageCommands: [], problems: [] };
    workflowClosureCache.set(path, closure);
    return closure;
  };

  for (const [path, source] of Object.entries(tree.files)) {
    if (!/^\.github\/workflows\/.*\.ya?ml$/.test(path)) continue;
    // Historical comments may name a retired routine workflow while explaining
    // why an unrelated operational workflow has a permission. Only executable
    // YAML participates in the coupling decision.
    const workflowExecutable = source.replace(/^\s*#.*$/gm, "");
    const closure = expandExecutable(path);
    for (const problem of closure.problems) {
      add(
        "WORKFLOW_EXECUTABLE_CLOSURE_UNRESOLVED",
        path,
        `The workflow executable closure could not be classified: ${problem}.`,
      );
    }
    const executable = closure.executable;
    const routineData = ROUTINE_DATA_MARKER.test(executable) || registeredDataCommands.some((command) => executable.includes(command));
    const routineOps = ROUTINE_OPS_MARKER.test(executable);
    if (SCHEDULE.test(workflowExecutable) && routineOps) {
      add("SCHEDULED_ROUTINE_OPS_WORKFLOW", path, "A GitHub schedule can invoke routine runtime observation or operational-state work.");
    }
    if (CONTENTS_WRITE.test(workflowExecutable) && routineData) {
      add("ROUTINE_DATA_CONTENTS_WRITE", path, "A routine data workflow carries contents: write.");
    }
    if (CONTENTS_WRITE.test(workflowExecutable) && routineOps) {
      add("ROUTINE_OPS_CONTENTS_WRITE", path, "A routine runtime/operations workflow carries contents: write.");
    }
    if (WORKFLOW_GIT_WRITE.test(executable) && routineData) {
      add("ROUTINE_DATA_GIT_WRITE", path, "A routine data workflow can add, commit, or push mutable repository state.");
    }
    if (WORKFLOW_GIT_WRITE.test(executable) && routineOps) {
      add("ROUTINE_OPS_GIT_WRITE", path, "A routine runtime/operations workflow can add, commit, or push mutable repository state.");
    }
  }

  const standingRunner = stripExecutableComments(tree.files["scripts/pilot-runner.mts"] ?? "");
  for (const trackedChild of [
    "scripts/apply-owner-decisions.mts",
    "scripts/owner-decisions-pull.mts",
    "scripts/scout-candidates-rederive.mts",
    "scripts/tracker.mjs",
  ]) {
    if (standingRunner.includes(trackedChild)) {
      add(
        "IMMUTABLE_RUNTIME_INVOKES_TRACKED_WRITER",
        "scripts/pilot-runner.mts",
        `The standing production runtime invokes ${trackedChild}, which can dirty its detached checkout and block exact-SHA handoff.`,
      );
    }
  }

  /*
   * The standing owner-snapshot child may read release-pinned acceptance
   * corpora and software-governance inputs, but it may not select mutable or
   * latest tracked run/sweep outputs and relabel them as present operational
   * health. Reader/control certification is software CI; intake observations
   * already have the canonical append-only owner outcome log.
   */
  const ownerPublisher = stripExecutableComments(tree.files["scripts/publish-owner-snapshot.mts"] ?? "");
  if (OWNER_SNAPSHOT_FORBIDDEN_TRACKED_LIVE_INPUT.test(joinedPathLiterals(ownerPublisher))) {
    add(
      "OWNER_SNAPSHOT_TRACKED_LIVE_INPUT",
      "scripts/publish-owner-snapshot.mts",
      "The standing owner snapshot can project a tracked software-run or feedback-sweep output as live operational truth.",
    );
  }

  /*
   * Reader-suite runs and their question corpus are release-pinned software
   * certification inputs. They cannot become standing scheduler ordering or
   * health inputs: current Reader impact is carried by the canonical runtime
   * obligation itself. Keep the semantic field/helper names in the tripwire so
   * reopening the coupling through an indirect loader is rejected too.
   */
  const freshnessRuntime = stripExecutableComments(tree.files["scripts/freshness-shadow.mts"] ?? "");
  if (STANDING_RUNTIME_FORBIDDEN_TRACKED_SOFTWARE_HEALTH_INPUT.test(joinedPathLiterals(freshnessRuntime))) {
    add(
      "STANDING_RUNTIME_TRACKED_SOFTWARE_HEALTH_INPUT",
      "scripts/freshness-shadow.mts",
      "The standing freshness runtime can let tracked Reader software certification state change data-plane ordering or health.",
    );
  }

  for (const path of [...REMOVED_ROUTINE_OPS_WORKFLOWS, ...REMOVED_LEGACY_EXECUTABLES]) {
    if (Object.hasOwn(tree.files, path)) add("LEGACY_EXECUTABLE_PRESENT", path, "This release-coupled data path was retired by the permanent cutover.");
  }
  for (const path of REMOVED_TRANSITION_DATA_PLANE) {
    if (Object.hasOwn(tree.files, path)) {
      add(
        "TRANSITION_ARCHITECTURE_PRESENT",
        path,
        "The permanent data plane cannot retain a Git/CI shipping model or a GitHub runtime-clock backup.",
      );
    }
  }
  for (const path of REMOVED_TEMPORARY_TRUSTED_LKG_PATHS) {
    if (Object.hasOwn(tree.files, path)) {
      add(
        "TEMPORARY_TRUSTED_LKG_PATH_PRESENT",
        path,
        "One-time import/live-acceptance machinery or its cutover-only test must not survive in the terminal software tree.",
      );
    }
  }

  /*
   * Keep the durable receipt vocabulary and its validators/read projections:
   * production must remain able to explain imported LKG after the executable
   * importer is deleted. Audit only capabilities which can mint or admit a new
   * first-seed candidate. This is deliberately semantic as well as path-based,
   * so renaming the importer or its runtime bypass does not reopen the door.
   */
  for (const [path, source] of Object.entries(tree.files)) {
    if (!/^(?:app|components|lib|scripts)\/.*\.[cm]?[jt]sx?$/.test(path) || path === "lib/civic-data/firewall.ts") continue;
    const executable = stripExecutableComments(source);
    if (TRUSTED_LKG_BOOTSTRAP_PLAN_CALLABLE.test(executable)) {
      add(
        "TRUSTED_LKG_BOOTSTRAP_PLAN_CALLABLE",
        path,
        "Executable code can still inspect, build, or execute the one-time trusted-LKG cutover plan.",
      );
    }
    if (TRUSTED_LKG_RUNTIME_CAPABILITY_DECLARATION.test(executable)) {
      add(
        "TRUSTED_LKG_RUNTIME_CAPABILITY_PRESENT",
        path,
        "TRUSTED_LKG_IMPORT remains a mintable runtime authority capability.",
      );
    }
    if (TRUSTED_LKG_CAPABILITY_MINT.test(executable)) {
      add(
        "TRUSTED_LKG_CAPABILITY_MINT_PRESENT",
        path,
        "Executable code can mint a TRUSTED_LKG_IMPORT authority envelope.",
      );
    }
    if (TRUSTED_LKG_AUTHORITY_BYPASS.test(executable)) {
      add(
        "TRUSTED_LKG_AUTHORITY_BYPASS_PRESENT",
        path,
        "Runtime checkout, parent, or registered-contract admission still contains a trusted-LKG importer exception.",
      );
    }
    if (TRUSTED_LKG_STORE_ADMISSION.test(executable)) {
      add(
        "TRUSTED_LKG_STORE_ADMISSION_PRESENT",
        path,
        "The canonical store still grants mutation authority to TRUSTED_LKG_IMPORT.",
      );
    }
    if (TRUSTED_LKG_PROMOTION_ADMISSION.test(executable)) {
      add(
        "TRUSTED_LKG_PROMOTION_ADMISSION_PRESENT",
        path,
        "The promotion plane still owns a special token capable of admitting trusted-LKG bootstrap candidates.",
      );
    }
  }

  for (const [path, source] of Object.entries(tree.files)) {
    // This file contains inert planted strings which prove every detector; it
    // never imports or invokes the temporary implementation itself.
    if (path === "tests/civic-data-firewall.test.ts" || !/^tests\/.*\.test\.[cm]?[jt]sx?$/.test(path)) continue;
    const executable = stripExecutableComments(source);
    if (
      TRUSTED_LKG_BOOTSTRAP_COMMAND.test(executable) ||
      TRUSTED_LKG_BOOTSTRAP_PLAN_CALLABLE.test(executable) ||
      TRUSTED_LKG_TEST_ADMISSION.test(executable)
    ) {
      add(
        "TRUSTED_LKG_BOOTSTRAP_TEST_ADMISSION",
        path,
        "A cutover-only test still compiles or exercises callable trusted-LKG bootstrap admission instead of historical receipt interpretation.",
      );
    }
  }
  for (const { path, marker } of RETIRED_TRACKED_ACQUISITION_WRITERS) {
    const executable = stripExecutableComments(tree.files[path] ?? "");
    if (marker.test(executable)) {
      add(
        "RETIRED_TRACKED_ACQUISITION_WRITER",
        path,
        "A source adapter still exposes filesystem mutation from the superseded Git-backed acquisition path.",
      );
    }
  }

  /*
   * Executable production paths only. Historical docs and recorded fixtures
   * may retain the incident vocabulary; they cannot become a writer or clock.
   */
  for (const [path, source] of Object.entries(tree.files)) {
    if (!/^(?:app|components|lib|scripts)\/.*\.[cm]?[jt]sx?$/.test(path) || path === "lib/civic-data/firewall.ts") continue;
    const executable = stripExecutableComments(source);
    if (path !== "lib/civic-data/promotion.ts" && /\bprocessRoutineCandidate\b/.test(executable)) {
      add(
        "UNREGISTERED_PRODUCTION_PROMOTION_DOOR",
        path,
        "Executable production code can reach the generic transition driver instead of an exact routine, meeting-partition, or manual contract door.",
      );
    }
    const paths = joinedPathLiterals(executable);
    if (TRACKED_RUNTIME_MUTABLE_TARGET.test(paths) && invokesFilesystemMutation(executable)) {
      add("TRACKED_RUNTIME_STATE_WRITER", path, "Executable code can write freshness, nightly-window, watcher, or refresh operational truth into a tracked repository path.");
    }
    if (TRACKED_RUNTIME_MUTABLE_TARGET.test(paths) && readsTrackedRuntimeState(executable)) {
      add(
        "TRACKED_RUNTIME_STATE_READER",
        path,
        "Executable code can treat retired tracked freshness, watcher, refresh, staging, or method state as live runtime truth.",
      );
    }
    if (RETIRED_REFRESH_HELPER.test(executable)) {
      add("RETIRED_REFRESH_BRIDGE_HELPER", path, "Executable code recreates the Git-refresh report/revert bridge under a surviving or renamed path.");
    }
    if (RETIRED_SCHEDULE_AUDIT_MARKERS.filter((marker) => marker.test(executable)).length >= 2) {
      add("RETIRED_SCHEDULE_AUDIT_IMPLEMENTATION", path, "Executable code recreates the deleted GitHub-cron schedule-audit implementation under a surviving or renamed path.");
    }
  }

  const ids = new Set<string>();
  // The canonical projection key is recordClass:scope. Source identity is
  // evidence about the writer, not a namespace that permits a second writer
  // to claim the same Reader authority.
  const authorityKeys = new Map<string, string>();
  const commands = new Set<string>();
  const routineAdaptersReachingManualDoor = new Set<string>();
  const certificationPaths = new Set<string>();
  const releaseInvocationPaths = new Set<string>();
  const repositoryWriterPaths = new Set<string>();
  const executableClosureProblems = new Set<string>();
  const dataCommandClosureCache = new Map<string, ExecutableDependencyClosure>();
  const inspectDataCommandClosure = (
    commandPath: string,
    commandKind: "routine" | "manual",
  ): void => {
    let closure = dataCommandClosureCache.get(commandPath);
    if (closure === undefined) {
      closure = executableDependencyClosure(tree.files, commandPath, expandExecutable);
      dataCommandClosureCache.set(commandPath, closure);
    }
    for (const problem of closure.problems) {
      const key = `${commandPath}:${problem}`;
      if (executableClosureProblems.has(key)) continue;
      executableClosureProblems.add(key);
      add(
        "DATA_EXECUTABLE_CLOSURE_UNRESOLVED",
        commandPath,
        `The registered data-command closure could not be classified: ${problem}.`,
      );
    }
    for (const { path, executable: expandedExecutable, launchCalls } of closure.nodes) {
      const executable = SHELL_EXECUTABLE.test(path)
        ? stripShellComments(expandedExecutable, path)
        : stripExecutableComments(expandedExecutable);
      const shellSoftwareCertification = SHELL_EXECUTABLE.test(path)
        && SOFTWARE_CERTIFICATION_PAYLOAD.test(executable);
      if (
        !certificationPaths.has(path)
        && (invokesSoftwareCertification(executable, launchCalls) || shellSoftwareCertification)
      ) {
        certificationPaths.add(path);
        add(
          "DATA_PATH_INVOKES_SOFTWARE_CERTIFICATION",
          path,
          `A source acquisition/promotion path reachable from ${commandPath} invokes an application, browser, build, or software-test certification tier.`,
        );
      }
      const releaseCode = commandKind === "routine"
        ? "ROUTINE_PATH_INVOKES_RELEASE"
        : "MANUAL_DATA_PATH_INVOKES_RELEASE";
      const releaseKey = `${releaseCode}:${path}`;
      const shellRelease = SHELL_EXECUTABLE.test(path) && SHELL_RELEASE_INVOCATION.test(executable);
      if (
        !releaseInvocationPaths.has(releaseKey)
        && (invokesReleaseMachinery(executable, launchCalls) || shellRelease)
      ) {
        releaseInvocationPaths.add(releaseKey);
        add(
          releaseCode,
          path,
          `A source acquisition/promotion path reachable from ${commandPath} invokes Git, GitHub, build, browser, or deploy machinery.`,
        );
      }
      const writerCode = commandKind === "routine"
        ? "ROUTINE_PATH_WRITES_REPOSITORY"
        : "MANUAL_DATA_PATH_WRITES_REPOSITORY";
      const writerKey = `${writerCode}:${path}`;
      const shellWriter = SHELL_EXECUTABLE.test(path) && SHELL_FILESYSTEM_MUTATION.test(executable);
      if (
        !repositoryWriterPaths.has(writerKey)
        && (invokesFilesystemMutation(executable) || shellWriter)
      ) {
        repositoryWriterPaths.add(writerKey);
        add(
          writerCode,
          path,
          `A filesystem writer reachable from ${commandPath} can bypass the canonical production data plane.`,
        );
      }
    }
  };
  for (const contract of tree.contracts) {
    if (ids.has(contract.id)) add("DUPLICATE_CONTRACT_ID", "lib/civic-data/contracts.ts", contract.id);
    ids.add(contract.id);
    const authorityKey = `${contract.recordClass}:${contract.scope}`;
    const priorAuthority = authorityKeys.get(authorityKey);
    if (priorAuthority !== undefined) {
      add(
        "MULTIPLE_AUTHORITATIVE_WRITERS",
        "lib/civic-data/contracts.ts",
        `${authorityKey} is claimed by both ${priorAuthority} and ${contract.id}`,
      );
    } else {
      authorityKeys.set(authorityKey, contract.id);
    }
    const commandPath = contract.acquisitionAdapter.command[0] ?? "";
    const commandSignature = contract.acquisitionAdapter.command.join("\u0000");
    if (!commandPath || !Object.hasOwn(tree.files, commandPath)) {
      add("CONTRACT_ADAPTER_MISSING", commandPath || "lib/civic-data/contracts.ts", contract.id);
      continue;
    }
    if (commands.has(commandSignature)) {
      add("MULTIPLE_ROUTINE_MEMBERSHIPS", commandPath, `The exact acquisition command is registered more than once: ${contract.acquisitionAdapter.command.join(" ")}`);
    }
    commands.add(commandSignature);
    if (/^(?:data|lib\/registry)\//.test(contract.canonicalProductionStore)) {
      add("TRACKED_RUNTIME_CANONICAL_STORE", "lib/civic-data/contracts.ts", `${contract.id}: ${contract.canonicalProductionStore}`);
    }
    // A standing-clock scope has exactly one writer. An adapter that can still
    // reach the owner-invoked manual door would give it a second, clockless one.
    if (!routineAdaptersReachingManualDoor.has(commandPath) &&
        /\bprocessRegisteredManualCandidate\b/.test(stripExecutableComments(tree.files[commandPath] ?? ""))) {
      routineAdaptersReachingManualDoor.add(commandPath);
      add(
        "ROUTINE_ADAPTER_REACHES_MANUAL_DOOR",
        commandPath,
        `${contract.id} is clocked by the standing runner; its adapter may promote only through its registered routine door.`,
      );
    }
    inspectDataCommandClosure(commandPath, "routine");
  }

  const manualCommands = new Set<string>();
  const manualWriteContexts = new Set<string>();
  for (const contract of tree.manualContracts) {
    if (ids.has(contract.id)) add("DUPLICATE_CONTRACT_ID", "lib/civic-data/manual-contracts.ts", contract.id);
    ids.add(contract.id);
    const authorityKey = `${contract.recordClass}:${contract.scope}`;
    const priorAuthority = authorityKeys.get(authorityKey);
    if (priorAuthority !== undefined) {
      add(
        "MULTIPLE_AUTHORITATIVE_WRITERS",
        "lib/civic-data/manual-contracts.ts",
        `${authorityKey} is claimed by both ${priorAuthority} and ${contract.id}`,
      );
    } else {
      authorityKeys.set(authorityKey, contract.id);
    }
    const commandPath = contract.command[0] ?? "";
    const commandSignature = contract.command.join("\u0000");
    if (!commandPath || !Object.hasOwn(tree.files, commandPath)) {
      add("CONTRACT_ADAPTER_MISSING", commandPath || "lib/civic-data/manual-contracts.ts", contract.id);
      continue;
    }
    if (manualCommands.has(commandSignature)) {
      add("MULTIPLE_MANUAL_MEMBERSHIPS", commandPath, `The exact owner-invoked command is registered more than once: ${contract.command.join(" ")}`);
    }
    manualCommands.add(commandSignature);
    if (/^(?:data|lib\/registry)\//.test(contract.canonicalProductionStore)) {
      add("TRACKED_RUNTIME_CANONICAL_STORE", "lib/civic-data/manual-contracts.ts", `${contract.id}: ${contract.canonicalProductionStore}`);
    }
    const adapter = tree.files[commandPath] ?? "";
    const executableAdapter = adapter.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    if (!manualWriteContexts.has(commandPath)) {
      manualWriteContexts.add(commandPath);
      const contextAt = executableAdapter.search(/prepareProductionCivicDataWrite\s*\(/);
      const storeAt = executableAdapter.indexOf("new PostgresRoutineDataStore");
      if (contextAt < 0 || (storeAt >= 0 && contextAt > storeAt)) {
        add(
          "MANUAL_PRODUCTION_WRITE_CONTEXT_MISSING",
          commandPath,
          "A production civic-data command must establish and prove its sanctioned write handle before constructing or using the canonical store.",
        );
      }
    }
    inspectDataCommandClosure(commandPath, "manual");
  }

  const packageJson = tree.files["package.json"] ?? "";
  for (const temporaryPath of REMOVED_TEMPORARY_TRUSTED_LKG_PATHS) {
    if (packageJson.includes(temporaryPath)) {
      add(
        "TEMPORARY_PDC_PACKAGE_COMMAND",
        "package.json",
        `A package command still exposes cutover-only executable ${temporaryPath}.`,
      );
    }
  }
  if (TRUSTED_LKG_BOOTSTRAP_COMMAND.test(packageJson)) {
    add(
      "TRUSTED_LKG_BOOTSTRAP_PACKAGE_COMMAND",
      "package.json",
      "A package command still exposes the one-time trusted-LKG importer or import plan.",
    );
  }
  const trustedImportPlan = tree.files[PDC_V2_TRUSTED_LKG_IMPORT_PLAN];
  if (trustedImportPlan !== undefined) {
    const trustedImporter = tree.files[PDC_V2_TRUSTED_LKG_IMPORTER] ?? "";
    const planProofs = [
      /PDC_V2_FROZEN_BASE_SHA/,
      /trustedLkgFrozenRepositoryIssue/,
      /trustedLkgImporterRepositoryIssue/,
      /sourceAuthenticated:\s*false/,
      /PROMOTED_ABSENT_POINTER/,
    ];
    const importerProofs = [
      /--promote/,
      /--frozen-root=/,
      /prepareProductionCivicDataWrite\s*\(\s*\)/,
      /temporaryTrustedLkgImportEnvironment/,
      /pdcV2TrustedLkgExecutingImporterIssue/,
    ];
    if (
      !trustedImporter ||
      planProofs.some((proof) => !proof.test(trustedImportPlan)) ||
      importerProofs.some((proof) => !proof.test(trustedImporter)) ||
      packageJson.includes(PDC_V2_TRUSTED_LKG_IMPORTER)
    ) {
      add(
        "TRUSTED_LKG_TEMPORARY_BOUNDARY_INVALID",
        PDC_V2_TRUSTED_LKG_IMPORT_PLAN,
        "Tracked first-seed reads are allowed only inside the exact temporary, explicit, frozen-SHA trusted-LKG importer and may not become a package/runtime door.",
      );
    }
    for (const [path, source] of Object.entries(tree.files)) {
      if (
        path === PDC_V2_TRUSTED_LKG_IMPORT_PLAN ||
        path === PDC_V2_TRUSTED_LKG_IMPORTER ||
        path === "lib/civic-data/firewall.ts" ||
        !/^(?:app|components|lib|scripts)\//.test(path)
      ) continue;
      if (/trusted-lkg-import-plan(?:\.ts)?["']/.test(stripExecutableComments(source))) {
        add(
          "TRUSTED_LKG_IMPORT_PLAN_REACHABLE_OUTSIDE_IMPORTER",
          path,
          "Only the one-time exact importer may reach the frozen tracked-seed transfer plan.",
        );
      }
    }
  }
  for (const path of [...REMOVED_LEGACY_EXECUTABLES, ...REMOVED_TRANSITION_DATA_PLANE]) {
    if (packageJson.includes(path)) {
      add("LEGACY_EXECUTABLE_COMMAND", "package.json", `A package command still names retired executable ${path}.`);
    }
  }
  if (/"refresh:daily"\s*:/.test(packageJson)) add("LEGACY_REFRESH_COMMAND", "package.json", "refresh:daily remains callable.");
  if (/"(?:acquire:az-sos-candidates|ballot:az-pima-update|candidates:fetch|candidates:universe|corpus:fetch|identity:az|ship:candidate|wire:0825|wire:phones)"\s*:/.test(packageJson)) {
    add("LEGACY_MANUAL_PROJECTION_WRITER_COMMAND", "package.json", "A retired tracked ballot/profile/corpus writer remains callable.");
  }
  if (/"(?:key-votes:fetch|law-votes:fetch)"\s*:|scripts\/(?:fetch-key-votes|fetch-law-votes)\.mts/.test(packageJson)) {
    add("LEGACY_FEDERAL_VOTE_WRITER_COMMAND", "package.json", "A retired tracked federal-vote writer remains callable.");
  }
  if (/"hunt:azleg-store"\s*:|scripts\/hunt-azleg-build-store\.mts/.test(packageJson)) {
    add("LEGACY_OFFICIAL_ACTION_WRITER_COMMAND", "package.json", "The retired tracked Arizona official-action builder remains callable.");
  }
  const packageCommand = (name: string): string =>
    new RegExp(`"${name.replace(":", "\\:")}"\\s*:\\s*"([^"]+)"`).exec(packageJson)?.[1] ?? "";
  const installedManualCommand = (contract: string): string =>
    `node scripts/installed-runtime-command.mjs manual-promote --contract=${contract}`;

  for (const [name, commandPath, contract] of [
    ["official-actions:promote", "scripts/promote-az-official-actions.mts", "az-official-actions"],
  ] as const) {
    const command = packageCommand(name);
    if (command !== installedManualCommand(contract)) add("ACTION_OUTCOME_COMMAND_NOT_PROMOTING", "package.json", `${name} must enter ${commandPath}'s exact installed-runtime contract ${contract}.`);
  }
  for (const [name, contract] of [
    ["votes:fetch", "congress-rollcalls"],
    ["key-votes:positions", "federal-key-votes"],
  ] as const) {
    const command = packageCommand(name);
    if (command !== installedManualCommand(contract)) {
      add("FEDERAL_VOTE_COMMAND_NOT_PROMOTING", "package.json", `${name} must enter exact installed-runtime contract ${contract}.`);
    }
  }
  for (const [name, contract] of [
    ["congress:fetch", "congress-bulk-roster"],
    ["registry:promote", "registry-runtime-bindings"],
  ] as const) {
    const command = packageCommand(name);
    if (command !== installedManualCommand(contract)) {
      add("REGISTRY_RUNTIME_COMMAND_NOT_PROMOTING", "package.json", `${name} must enter exact installed-runtime contract ${contract}.`);
    }
  }
  for (const [name, contract] of [
    ["voting-sites:fetch", "voting-sites"],
    ["prl:fetch", "prl"],
  ] as const) {
    const command = packageCommand(name);
    if (command !== installedManualCommand(contract)) {
      add("VOTING_PRL_COMMAND_NOT_PROMOTING", "package.json", `${name} must enter exact installed-runtime contract ${contract}.`);
    }
  }
  for (const [name, contract] of [
    ["jurisdictions:promote", "jurisdiction-operational-reference"],
    ["money:az", "az-sos-campaign-finance"],
    ["money:nh", "nh-sos-campaign-finance"],
    ["money:nj", "nj-elec-campaign-finance"],
    ["money:az:pima", "az-pima-local-finance"],
  ] as const) {
    if (packageCommand(name) !== installedManualCommand(contract)) {
      add("MANUAL_PACKAGE_AUTHORITY_BYPASS", "package.json", `${name} must enter exact installed-runtime contract ${contract}.`);
    }
  }
  if (packageCommand("civic-data:promote-manual") !== "node scripts/installed-runtime-command.mjs manual-promote") {
    add("MANUAL_PACKAGE_AUTHORITY_BYPASS", "package.json", "civic-data:promote-manual must enter the closed installed-runtime dispatcher, which then requires one registered contract.");
  }
  // Class-wide: whatever a package alias is called, it may name an owner
  // manual promotion only for an explicit-owner contract. A routine contract's
  // sole production clock and writer is the standing runner.
  const explicitOwnerContracts = new Set(tree.manualContracts.map(({ id }) => id));
  for (const [, name, command] of packageJson.matchAll(/"([^"]+)"\s*:\s*"([^"]*installed-runtime-command\.mjs\s+manual-promote\b[^"]*)"/g)) {
    for (const [, contract] of command!.matchAll(/--contract=([^\s"]+)/g)) {
      if (!explicitOwnerContracts.has(contract!)) {
        add(
          "MANUAL_PACKAGE_CONTRACT_NOT_MANUAL",
          "package.json",
          `${name} names an owner manual promotion for ${contract}, which is not an explicit-owner contract; a routine contract promotes only on the standing runner's clock.`,
        );
      }
    }
  }
  for (const [name, expected] of [
    ["window:run", "node scripts/installed-runtime-command.mjs window"],
    ["agent-bridge:job", "node scripts/installed-runtime-command.mjs agent-bridge-job"],
    ["agent-bridge:review", "node scripts/installed-runtime-command.mjs agent-bridge-review"],
  ] as const) {
    if (packageCommand(name) !== expected) {
      add("RUNTIME_PACKAGE_AUTHORITY_BYPASS", "package.json", `${name} must enter the closed installed-runtime dispatcher.`);
    }
  }
  for (const name of [
    "pilot:run",
    "routine:civic-data",
    "intake:tripwire",
    "pilot:pause-note",
    "freshness:shadow:pg",
    "owner:publish",
    "readiness:publish",
    "console:publish",
    "acs:population",
    "acs:population:promote",
    "dotgov:fetch",
    "fec:fetch",
    "fec:promote",
    "nh:members:promote",
    "outcomes:ingest",
    "ingest",
  ]) {
    if (packageCommand(name) !== "") {
      add("DIRECT_PRODUCTION_CHILD_COMMAND", "package.json", `${name} restores a direct production child outside the installed authority graph.`);
    }
  }
  if (/"(?:fec:directories|cf:agencies|jurisdictions:enumerate)"\s*:/.test(packageJson)) {
    add("LEGACY_OPERATIONAL_REFERENCE_COMMAND", "package.json", "A retired tracked operational-reference writer remains callable.");
  }
  if (/"(?:b14:links|nh:fix-pages|fix:official-pages)"\s*:|scripts\/enrich-officials\.mts/.test(packageJson)) {
    add("LEGACY_INTERMEDIARY_COMMAND", "package.json", "A retired Plural/OpenStates state-roster writer remains callable.");
  }

  for (const path of [
    "scripts/build-officeholders.ts",
    "scripts/enrich-federal-officeholders.mts",
    "scripts/reader-finance-identity.mts",
  ]) {
    const source = tree.files[path] ?? "";
    const executable = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    if (RETIRED_PLURAL_WRITER_SOURCE.test(executable)) {
      add("RETIRED_INTERMEDIARY_WRITER", path, "Executable code can rebuild production output from a retired Plural/OpenStates state roster.");
    }
  }

  const candidateLinks = tree.files["data/ballot/candidate-links-2026.json"] ?? "";
  if (/"verification"\s*:\s*"[^"]*(?:Plural Open States|OpenStates)|"note"\s*:\s*"MISS — B14 official-page rung/.test(candidateLinks)) {
    add("RETIRED_INTERMEDIARY_READER_ARTIFACT", "data/ballot/candidate-links-2026.json", "A Reader candidate link or gap was derived from the retired intermediary roster.");
  }
  const reviewedLinks = tree.files["lib/funding/official-person-candidacy-links.json"] ?? "";
  if (reviewedLinks) {
    add("TRACKED_OFFICIAL_CANDIDACY_AUTHORITY", "lib/funding/official-person-candidacy-links.json", "The old production-looking identity input path is retired; reviewed first-seed evidence belongs only under lib/registry/fixtures and live outcomes belong in REGISTRY_RUNTIME_BINDING.");
  }
  const reviewedLinksFixture = tree.files["lib/registry/fixtures/official-person-candidacy-links-v1.json"] ?? "";
  if (!/"classification"\s*:\s*"EXPLICIT_VERSIONED_IDENTITY_INPUT"/.test(reviewedLinksFixture)
    || !/"productionAuthority"\s*:\s*false/.test(reviewedLinksFixture)
    || /"officialId"\s*:\s*"plural:/.test(reviewedLinksFixture)) {
    add("REGISTRY_IDENTITY_FIXTURE_AUTHORITY_INVALID", "lib/registry/fixtures/official-person-candidacy-links-v1.json", "Reviewed same-person evidence must remain explicitly versioned, non-authoritative, and free of retired intermediary identities.");
  }
  const financeBridge = tree.files["lib/funding/official-candidacies.json"] ?? "";
  if (financeBridge) {
    add("TRACKED_OFFICIAL_CANDIDACY_AUTHORITY", "lib/funding/official-candidacies.json", "The mutable officeholder/candidacy bridge must live in the canonical registry runtime projection, not a tracked generated file.");
  }
  if (/"sourcePath"\s*:\s*"data\/states\/[a-z]{2}\/officials\/officeholders-\d{2}\.json"|"id"\s*:\s*"plural:/.test(financeBridge)) {
    add("RETIRED_INTERMEDIARY_READER_ARTIFACT", "lib/funding/official-candidacies.json", "Generated Reader identity output still contains a retired state-roster identity.");
  }
  for (const { path, gate } of RETIRED_PLURAL_READER_GATES) {
    const source = tree.files[path];
    if (source !== undefined && !gate.test(source)) {
      add("RETIRED_INTERMEDIARY_READER", path, "A production identity bridge no longer proves that Plural/OpenStates ids are test-only.");
    }
  }
  const campaignMoney = tree.files["lib/funding/campaign-money.ts"];
  if (campaignMoney !== undefined && (!/getRegistryRuntimeReadModel\(\)\.officialCandidacies/.test(campaignMoney) || /official-candidacies\.json|readFile(?:Sync)?\s*\(/.test(campaignMoney))) {
    add("REGISTRY_RUNTIME_FINANCE_BRIDGE_GATE_MISSING", "lib/funding/campaign-money.ts", "Campaign identity must consume the promoted registry-runtime bridge and cannot reopen a tracked bridge or roster.");
  }
  const nightly = tree.files["scripts/nightly-window.mts"] ?? "";
  if (/refresh:daily|runLegacyRefresh|skip-legacy/i.test(nightly)) {
    add("HIDDEN_LEGACY_STANDING_PATH", "scripts/nightly-window.mts", "The standing window can still enter legacy refresh acquisition.");
  }

  const enrichmentProvider = tree.files["lib/control-plane/scheduler/providers/candidate-enrichment.ts"];
  if (enrichmentProvider !== undefined) {
    const executable = enrichmentProvider.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    if (/candidate-universe-2026\.json|readFileSync|data["'],\s*["']states["'],\s*stateCode,\s*["']hunt["']/.test(executable)) {
      add("TRACKED_CANDIDATE_UNIVERSE_AUTHORITY", "lib/control-plane/scheduler/providers/candidate-enrichment.ts", "Standing enrichment reopened a tracked hunt denominator.");
    }
    if (
      !/preloadCandidateEnrichmentAuthorities/.test(executable) ||
      !/candidateUniversesFromPromoted/.test(executable) ||
      !/readPromotedCivicData/.test(executable) ||
      /read(?:AzBallot|NhBallot|NjMorrisFiling|CandidateProfiles|CandidateCorpus)Projection/.test(executable)
    ) {
      add("PROMOTED_CANDIDATE_DENOMINATOR_GATE_MISSING", "lib/control-plane/scheduler/providers/candidate-enrichment.ts", "Standing enrichment must derive its denominator from preloaded canonical ballot/profile projections.");
    }
  }

  // The statement corpus is immutable first-seed/history only. No production
  // module may name it except the guarded data-plane bootstrap and inventory
  // metadata; production Readers consume currentOfficeholderStatements().
  for (const [path, source] of Object.entries(tree.files)) {
    if (!/^(?:app|components|lib)\//.test(path) || OFFICEHOLDER_STATEMENT_SEED_ALLOWLIST.has(path)) continue;
    const executable = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    if (OFFICEHOLDER_STATEMENT_FIRST_SEEDS.some((seed) => executable.includes(seed))) {
      add("OFFICEHOLDER_STATEMENT_TRACKED_RUNTIME_READER", path, "Tracked statement first-seed evidence may not be reopened by a production Reader.");
    }
  }
  const statementIdentityEvidence = tree.files["lib/corpus/fixtures/statement-identity-first-seed-v1.json"] ?? "";
  if (
    !/"classification"\s*:\s*"IMMUTABLE_STATEMENT_IDENTITY_TRANSFER_EVIDENCE"/.test(statementIdentityEvidence) ||
    !/"productionAuthority"\s*:\s*false/.test(statementIdentityEvidence) ||
    !/"path"\s*:\s*"lib\/funding\/official-candidacies\.json"/.test(statementIdentityEvidence) ||
    /"candidacyId"\s*:\s*"plural:/.test(statementIdentityEvidence)
  ) {
    add(
      "STATEMENT_IDENTITY_FIRST_SEED_AUTHORITY_INVALID",
      "lib/corpus/fixtures/statement-identity-first-seed-v1.json",
      "Retired statement identities may survive only as immutable, non-authoritative transfer evidence with permanent destination ids.",
    );
  }
  const statementPlane = tree.files["lib/corpus/data-plane.ts"];
  if (statementPlane !== undefined && !/process\.env\.NODE_ENV === "production"[\s\S]*readPromotedCivicData/.test(statementPlane)) {
    add("OFFICEHOLDER_STATEMENT_PRODUCTION_GATE_MISSING", "lib/corpus/data-plane.ts", "Production must require the canonical pointer before any first-seed bootstrap is considered.");
  }

  // Voting-site and PRL tracked holdings are immutable bootstrap/test evidence.
  // Only their guarded readers may name those seeds; every production request
  // must first resolve the exact source/class/scope pointer and fail closed on
  // any actual store error.
  for (const [path, source] of Object.entries(tree.files)) {
    if (!/^(?:app|components|lib|scripts)\//.test(path)) continue;
    const executable = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const seed of VOTING_PRL_FIRST_SEEDS) {
      const escaped = seed.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (!seed.allowed.has(path) && new RegExp(`(?:^|[^A-Za-z0-9_-])${escaped}`).test(executable)) {
        add("VOTING_PRL_TRACKED_RUNTIME_READER", path, `${seed.name} is bootstrap/test evidence and may not be opened by a production path.`);
      }
    }
  }
  for (const { path, required } of [
    {
      path: "lib/ballot/voting-sites-server.ts",
      required: [/readPromotedCivicData<VotingSitesFile>/, /mayUseTestFixture/, /STORE_NOT_CONFIGURED/, /READ_NOT_INITIALIZED/],
    },
    {
      path: "lib/sources/prl/snapshot.ts",
      required: [/readPromotedCivicData<PrlSnapshot>/, /mayUseTestFixture/, /STORE_NOT_CONFIGURED/, /READ_NOT_INITIALIZED/],
    },
  ] as const) {
    const source = tree.files[path];
    if (source !== undefined && required.some((proof) => !proof.test(source))) {
      add("VOTING_PRL_PRODUCTION_GATE_MISSING", path, "The tracked first seed is no longer isolated behind an exact canonical pointer plus a test-only, no-store bootstrap gate.");
    }
  }
  for (const [contractId, path] of [
    ["voting-sites", "scripts/fetch-voting-sites.mts"],
    ["prl", "scripts/fetch-prl.mts"],
  ] as const) {
    const source = tree.files[path];
    if (source === undefined) continue;
    if (!/processRegisteredManualCandidate/.test(source) || !/process\.argv(?:\.slice\([^)]*\))?\.includes\("--promote"\)/.test(source)) {
      add("VOTING_PRL_MANUAL_PROMOTION_GATE_MISSING", path, `${contractId} can no longer prove its only executable mode is canonical manual promotion.`);
    }
  }

  // The four tracked JSON files are immutable first seeds only. Any new
  // production reference outside the two guarded bootstrap readers recreates
  // the mutable-Git authority even if it never writes the file itself.
  for (const [path, source] of Object.entries(tree.files)) {
    if (!/^(?:app|components|lib|scripts)\//.test(path) || FEDERAL_VOTE_SEED_REFERENCE_ALLOWLIST.has(path)) continue;
    const executable = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const namedSeed = FEDERAL_VOTE_FIRST_SEEDS.find((name) => {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Do not mistake `state-votes-snapshot.json` for the retired federal
      // `votes-snapshot.json` seed. A basename reference must start at a real
      // token boundary, not in the middle of another tracked artifact name.
      return new RegExp(`(?:^|[^A-Za-z0-9_-])${escaped}`).test(executable);
    });
    if (namedSeed) add("FEDERAL_VOTE_TRACKED_RUNTIME_READER", path, `${namedSeed} may be opened only by an explicit first-seed bootstrap reader.`);
  }

  // Federal directory and registry/body-person holdings are immutable first
  // seeds only. Runtime consumers initialize the exact promoted pointer; a
  // database error never reopens these files.
  for (const [path, source] of Object.entries(tree.files)) {
    if (!/^(?:app|components|lib)\//.test(path) || REGISTRY_RUNTIME_SEED_ALLOWLIST.has(path)) continue;
    const executable = stripExecutableComments(source);
    const readCalls = [
      ...filesystemReadCalls(executable),
      ...matchingExecutableCalls(executable, maskStringLiterals(executable), /\b(?:import|require)\s*\(/g),
    ];
    const seed = REGISTRY_RUNTIME_FIRST_SEEDS.find((name) => {
      const escaped = escapeRegExp(name);
      // A module specifier must itself name the seed. An unrelated Node import
      // followed by an artifact-path constant is not a tracked-file read.
      const specifier = `["'][^"'\\r\\n]*(?<![A-Za-z0-9_-])${escaped}(?:[?#][^"'\\r\\n]*)?["']`;
      const importsSeed = new RegExp(`(?:\\bfrom\\s*|\\bimport\\s*)${specifier}`).test(executable);
      // Follow seed-path aliases into actual read arguments. A seed name in
      // explanatory text or an exclusion condition does not authorize a read.
      const target = new RegExp(`(?<![A-Za-z0-9_-])${escaped}(?![A-Za-z0-9_.-])`);
      const bindings = trackedRuntimePathBindings(executable, target);
      const readsSeed = readCalls.some((call) => target.test(joinedPathLiterals(call))
        || [...bindings].some((binding) => new RegExp(`\\b${escapeRegExp(binding)}\\b`).test(maskStringLiterals(call))));
      return importsSeed || readsSeed;
    });
    if (seed) add("REGISTRY_RUNTIME_TRACKED_READER", path, `${seed} is first-seed/test evidence and may not be opened by a production path.`);
  }
  for (const { path, required } of [
    { path: "lib/officials/federal-directory-read-model.ts", required: /readPromotedOrBootstrap\([\s\S]*bootstrap[\s\S]*allowUnconfiguredBootstrap/ },
    { path: "lib/registry/runtime-read-model.ts", required: /readPromotedOrBootstrap\([\s\S]*bootstrap[\s\S]*allowUnconfiguredBootstrap/ },
  ]) {
    const source = tree.files[path];
    if (source !== undefined && !required.test(source)) add("REGISTRY_RUNTIME_FIRST_SEED_GATE_MISSING", path, "Tracked first-seed data is no longer isolated behind the canonical pointer/no-store-error bootstrap gate.");
  }
  for (const [contractId, path] of [
    ["congress-bulk-roster", "scripts/fetch-congress-legislators.mts"],
    ["registry-runtime-bindings", "scripts/promote-registry-runtime.mts"],
  ] as const) {
    const source = tree.files[path];
    if (source === undefined) continue;
    if (!/processRegisteredManualCandidate/.test(source) || !/process\.argv\.includes\("--promote"\)/.test(source) || invokesFilesystemMutation(source)) {
      add("REGISTRY_RUNTIME_MANUAL_PROMOTION_GATE_MISSING", path, `${contractId} must be promotion-only and cannot write tracked runtime truth.`);
    }
  }
  for (const [path, required] of [
    ["lib/officials/directory.ts", /getFederalDirectoryFile/],
    ["lib/registry/server.ts", /refreshRegistryRuntimeFromPromoted/],
    ["lib/registry/body-rosters.ts", /currentBodyRosters\(\)/],
    ["lib/officials/statewide-executives.ts", /currentStatewideExecutives\(\)/],
    ["lib/ask/body-identity.ts", /getRegistryRuntimeReadModel/],
    ["lib/funding/campaign-money.ts", /getFederalOfficeholderSet/],
    ["lib/photos/person.ts", /getRegistryRuntimeReadModel/],
  ] as const) {
    const source = tree.files[path];
    if (source !== undefined && !required.test(source)) add("REGISTRY_RUNTIME_READER_GATE_MISSING", path, "A production registry/directory/person reader no longer consumes the canonical promoted authority.");
  }
  for (const { path, required } of [
    { path: "lib/votes/snapshot.ts", required: /readPromotedOrBootstrap\([\s\S]*bootstrap[\s\S]*allowUnconfiguredBootstrap/ },
    { path: "lib/votes/key-votes-projection.ts", required: /readPromotedOrBootstrap\([\s\S]*bootstrap[\s\S]*allowUnconfiguredBootstrap/ },
  ]) {
    const source = tree.files[path];
    if (source !== undefined && !required.test(source)) {
      add("FEDERAL_VOTE_FIRST_SEED_GATE_MISSING", path, "The tracked seed is no longer behind the canonical-pointer/no-store-error bootstrap gate.");
    }
  }
  for (const [contractId, path] of [
    ["congress-rollcalls", "scripts/fetch-votes.mts"],
    ["federal-key-votes", "scripts/fetch-key-vote-positions.mts"],
  ] as const) {
    const source = tree.files[path];
    if (source === undefined) continue;
    if (!/processRegisteredManualCandidate/.test(source) || !/process\.argv\.includes\("--promote"\)/.test(source)) {
      add("FEDERAL_VOTE_MANUAL_PROMOTION_GATE_MISSING", path, `${contractId} can no longer prove its only executable mode is canonical manual promotion.`);
    }
  }

  // Current comment rules, election-authority routes, and campaign-site
  // bindings are mutable production facts. Their tracked modules are only
  // first-seed/test evidence; production must resolve the exact promoted
  // pointer, and no executable may recreate a writer for those modules.
  for (const [path, source] of Object.entries(tree.files)) {
    if (!/^(?:app|components|lib|scripts)\//.test(path)) continue;
    const executable = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    if (!CURATED_READER_SEED_ALLOWLIST.has(path)) {
      const symbol = CURATED_READER_FIRST_SEED_SYMBOLS.find((name) => new RegExp(`\\b${name}\\b`).test(executable));
      if (symbol) add("CURATED_READER_TRACKED_RUNTIME_READER", path, `${symbol} is first-seed/test evidence and may not be opened by a production path.`);
    }
    if (
      !CURATED_READER_TRACKED_VENUE_REFERENCE_ALLOWLIST.has(path) &&
      CURATED_READER_TRACKED_VENUE_AUTHORITY.test(executable)
    ) {
      add("CURATED_READER_TRACKED_VENUE_AUTHORITY", path, "A production path may not read the frozen Legistar/InSite venue holdings; it must use the promoted venue-resolutions projection.");
    }
    if (path !== "lib/civic-data/firewall.ts" && CURATED_READER_TRACKED_WRITE.test(executable)) {
      add("CURATED_READER_TRACKED_WRITER", path, "Executable code can write a mutable curated Reader fact back into the repository.");
    }
  }
  for (const { path, required } of CURATED_READER_READER_GATES) {
    const source = tree.files[path];
    if (source !== undefined && required.some((proof) => !proof.test(source))) {
      add("CURATED_READER_PRODUCTION_GATE_MISSING", path, "A mutable curated Reader family no longer proves its canonical promoted read and test-only first seed boundary.");
    }
  }
  for (const { path, required } of MEETING_PARTITION_AUTHORITY_GATES) {
    const source = tree.files[path];
    if (source !== undefined && required.some((proof) => !proof.test(source))) {
      add(
        "MEETING_PARTITION_AUTHORITY_GATE_MISSING",
        path,
        "Meetings production membership, promotion, and Reader composition must remain source/body-scoped and derived from SOURCE_WIRING.",
      );
    }
  }
  const sourceWiring = stripExecutableComments(tree.files["lib/registry/source-wiring.ts"] ?? "");
  if (/\bTUCSON_CLERKSBOARDS\b|from\s+["'][^"']*curated-bodies\.ts["']/.test(sourceWiring)) {
    add(
      "MEETING_HIDDEN_MEMBERSHIP_REGISTRY",
      "lib/registry/source-wiring.ts",
      "A presentation/coverage registry cannot add production meeting memberships; curated coverage must derive from SOURCE_WIRING.",
    );
  }
  const meetingIngest = stripExecutableComments(tree.files["scripts/ingest.ts"] ?? "");
  if (
    /scope\s*:\s*["']supported-bodies["']/.test(meetingIngest) ||
    /RCD_RECEIPT=/.test(meetingIngest) ||
    /EXIT_(?:WRITTEN_WITH_JOB_FAILURES|NOTHING_WRITTEN)/.test(meetingIngest) ||
    /readPreviousPartitionComposition|readMeetingsProjection/.test(meetingIngest)
  ) {
    add(
      "LEGACY_MEETING_AGGREGATE_AUTHORITY",
      "scripts/ingest.ts",
      "The retired aggregate meetings pointer/receipt/read-amplification/commit-era exit semantics cannot return.",
    );
  }
  const curatedPromoter = tree.files["scripts/promote-manual-civic-projection.mts"];
  if (curatedPromoter !== undefined && (
    !/processRegisteredManualCandidate/.test(curatedPromoter) ||
    !/MANUAL_PROMOTION_PACKAGE_MUST_BE_OUTSIDE_REPOSITORY/.test(curatedPromoter) ||
    invokesFilesystemMutation(curatedPromoter)
  )) {
    add("CURATED_READER_PROMOTION_GATE_MISSING", "scripts/promote-manual-civic-projection.mts", "Curated Reader adoption must accept an external reviewed package and write only through the canonical promotion plane.");
  }

  for (const [path, source] of Object.entries(tree.files)) {
    if (!/^(?:app|components|lib|scripts)\//.test(path)) continue;
    const executable = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const seed of RETIRED_ACTION_OUTCOME_SEEDS) {
      if (!seed.allowed.has(path) && executable.includes(seed.name)) {
        add("ACTION_OUTCOME_TRACKED_RUNTIME_READER", path, `${seed.name} is historical/test seed evidence and may not be opened by a production path.`);
      }
    }
  }
  for (const { path, required } of [
    { path: "lib/officials/executive-actions.ts", required: /readPromotedCivicData<ExecutiveActionStore>/ },
    { path: "lib/outcomes/store.ts", required: /readPromotedCivicData<OutcomeSnapshot>/ },
  ]) {
    const source = tree.files[path];
    if (source !== undefined && !required.test(source)) {
      add("ACTION_OUTCOME_PROMOTED_READER_GATE_MISSING", path, "The tracked historical seed is no longer isolated from the production Reader pointer.");
    }
  }

  const vocabulary = new Set(tree.inventory.classificationVocabulary ?? []);
  const rows = tree.inventory.rows ?? [];
  if (tree.inventory.census?.datasetFamiliesRepresented !== tree.inventory.census?.datasetFamiliesTotal || tree.inventory.census?.datasetFamiliesTotal !== 42) {
    add("INVENTORY_DENOMINATOR_OPEN", "docs/permanent-civic-data-plane-cutover-v2-inventory.json", "The 42-family denominator does not reconcile.");
  }
  const inventoryIds = new Set<string>();
  for (const row of rows) {
    const id = row.source_id ?? "";
    if (!id || inventoryIds.has(id)) add("INVENTORY_ROW_ID_INVALID", "docs/permanent-civic-data-plane-cutover-v2-inventory.json", id || "missing source_id");
    inventoryIds.add(id);
    if (!row.classification || !vocabulary.has(row.classification)) {
      add("UNCLASSIFIED_EXTERNAL_DATA", "docs/permanent-civic-data-plane-cutover-v2-inventory.json", id || "missing source_id");
    }
  }

  return findings.sort((a, b) => `${a.code}:${a.path}:${a.detail}`.localeCompare(`${b.code}:${b.path}:${b.detail}`));
}
