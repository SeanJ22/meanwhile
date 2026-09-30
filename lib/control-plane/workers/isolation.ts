import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import ts from "typescript";
import { requireCapability, type CapabilityGrant } from "../capability.ts";
import { assertNoNetwork } from "../evidence/parser-boundary.ts";
import { assertFleetResult, type FleetInput, type FleetResult, type ComputationRole } from "./types.ts";

const entries = {
  PARSER: { path: "parser.ts", entry: "parseLegistarEvents" },
  VALIDATOR: { path: "validator.ts", entry: "validateExtraction" },
  ADVERSARIAL_AUDITOR: { path: "auditor.ts", entry: "auditExtraction" },
} as const;

/** Only repository-owned portable procedure code is executable. Evidence is never code. */
export async function bundleProcedure(role: ComputationRole): Promise<string> {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(entries[role].path, import.meta.url))],
    bundle: true, write: false, format: "iife", globalName: "procedure", platform: "neutral", target: "es2022",
    plugins: [{ name: "no-worker-host-imports", setup(b) {
      b.onResolve({ filter: /^(node:|https?:|[a-zA-Z@])/ }, args => {
        if (args.kind === "entry-point") return undefined;
        return { errors: [{ text: `DENIED_BY_POLICY: worker runtime import ${args.path}` }] };
      });
    } }],
  });
  return result.outputFiles[0].text + `\nJSON.stringify(procedure.${entries[role].entry}(JSON.parse(INPUT_JSON)));`;
}

const childProgram = `
import vm from 'node:vm';
let body='';
for await (const c of process.stdin) { body+=c; if(body.length>12000000) process.exit(72); }
try {
  const request=JSON.parse(body);
  const context=vm.createContext(Object.create(null),{codeGeneration:{strings:false,wasm:false}});
  // All values, including the input, originate inside the realm. No host objects or callbacks cross it.
  const prelude='const INPUT_JSON='+JSON.stringify(request.inputJson)+';'+
    'const DENIAL_CHECK=(()=>{let denied=null;const deny=function(){denied="NETWORK_PUBLIC_READ";throw new Error("DENIED_BY_POLICY:NETWORK_PUBLIC_READ")};'+
    'for(const name of ["fetch","WebSocket","XMLHttpRequest"])Object.defineProperty(globalThis,name,{value:deny,writable:false,configurable:false});'+
    'Object.defineProperty(globalThis,"browser",{value:Object.freeze({open:deny}),writable:false,configurable:false});'+
    'Object.defineProperty(globalThis,"require",{value:()=>{denied="HOST_IMPORT";throw new Error("DENIED_BY_POLICY:HOST_IMPORT")},writable:false,configurable:false});return ()=>denied;})();';
  const answer=new vm.Script(prelude+request.source).runInContext(context,request.timeoutMs > 0 ? {timeout:request.timeoutMs} : {});
  new vm.Script('if(DENIAL_CHECK())throw new Error("DENIED_BY_POLICY:"+DENIAL_CHECK())').runInContext(context,request.timeoutMs > 0 ? {timeout:request.timeoutMs} : {});
  process.stdout.write(JSON.stringify({ok:true,result:JSON.parse(answer)}));
} catch(e) { process.stdout.write(JSON.stringify({ok:false,error:String(e?.message??e)})); process.exitCode=1; }
`;

/** Fresh bounded process, scrubbed environment, restricted realm, and no host/network imports. */
export async function runIsolatedSource(source: string, input: unknown, timeoutMs: number): Promise<unknown> {
  const syntax = ts.createSourceFile("worker.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const rejectImports = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)) throw new Error("DENIED_BY_POLICY:HOST_IMPORT");
    ts.forEachChild(node, rejectImports);
  };
  rejectImports(syntax);
  const inputJson = JSON.stringify(input);
  if (Buffer.byteLength(inputJson) > 2_000_000) throw new Error("WORKER_INPUT_BOUND_EXCEEDED");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--max-old-space-size=96", "--input-type=module", "-e", childProgram], {
      env: { NODE_ENV: "production" }, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    let settled = false;
    const fail = (error: Error) => { if (!settled) { settled = true; if (timer) clearTimeout(timer); child.kill(); reject(error); } };
    const timer = timeoutMs > 0 ? setTimeout(() => fail(new Error("WORKER_WALL_BOUND_EXCEEDED")), timeoutMs + 1500) : null;
    child.on("error", fail);
    child.stdin.on("error", () => undefined);
    child.stdout.on("data", chunk => {
      output += chunk;
      if (output.length > 8_000_000) fail(new Error("WORKER_OUTPUT_BOUND_EXCEEDED"));
    });
    child.stderr.resume();
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true; if (timer) clearTimeout(timer);
      try {
        const envelope = JSON.parse(output);
        if (!envelope.ok) reject(new Error(envelope.error));
        else if (code !== 0 || signal !== null) reject(new Error("WORKER_PROCESS_CRASHED_WITHOUT_RESULT"));
        else resolve(envelope.result);
      } catch { reject(new Error("WORKER_PROCESS_CRASHED_WITHOUT_RESULT")); }
    });
    child.stdin.end(JSON.stringify({ source, inputJson, timeoutMs }));
  });
}

export async function runIsolatedWorker(role: ComputationRole, input: FleetInput, grant: CapabilityGrant, timeoutMs: number): Promise<FleetResult> {
  if (grant.role !== role || input.worker.role !== role) throw new Error("DENIED_BY_POLICY:WORKER_ROLE_MISMATCH");
  requireCapability(grant, "VAULT_READ_SANITIZED");
  const allowed = role === "ADVERSARIAL_AUDITOR" ? ["VAULT_READ_SANITIZED", "NETWORK_PUBLIC_READ"] : ["VAULT_READ_SANITIZED"];
  if (grant.capabilities.some(c => !allowed.includes(c))) throw new Error("DENIED_BY_POLICY:WORKER_GRANT_EXCEEDS_CONTRACT");
  if (role === "PARSER" || role === "VALIDATOR") assertNoNetwork(grant.capabilities, role);
  const result = await runIsolatedSource(await bundleProcedure(role), input, timeoutMs);
  assertFleetResult(result, role, input.attemptId);
  return result;
}
