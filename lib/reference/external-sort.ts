import { spawn } from "node:child_process";
import { dirname } from "node:path";

export async function sortSourceRecords(input: string, output: string, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("sort", ["--stable", "--buffer-size=16M", "--temporary-directory", dirname(input), "--field-separator=\t", "--key=1,1", "--output", output, input], { stdio: ["ignore", "ignore", "pipe"], signal, env: { ...process.env, LC_ALL: "C" } });
    let error = "";
    child.stderr.on("data", (value: Buffer) => { if (error.length < 4096) error += value.toString("utf8").slice(0, 4096 - error.length); });
    child.once("error", reject);
    child.once("close", code => code === 0 ? resolve() : reject(new Error(`Source external sort failed (${code}): ${error}`)));
  });
}
