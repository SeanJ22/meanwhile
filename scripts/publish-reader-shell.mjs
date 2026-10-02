import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Publish Next's existing root prerender as an ordinary static CDN asset. */
export async function publishReaderShell(root = process.cwd()) {
  const source = join(root, ".next/server/app/index.html");
  const destination = join(root, "public/_reader-shell/index.html");
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
  return destination;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await publishReaderShell();
}
