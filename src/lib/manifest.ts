import { existsSync } from "fs";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { HOME_DIR } from "./config.ts";

export const MANIFEST_PATH = join(HOME_DIR, ".local/share/assets/versions.json");

export async function readManifest(path: string = MANIFEST_PATH): Promise<Map<string, string>> {
  if (!existsSync(path)) return new Map();
  const obj = JSON.parse(await readFile(path, "utf-8")) as Record<string, string>;
  return new Map(Object.entries(obj));
}

export async function writeManifest(manifest: Map<string, string>, path: string = MANIFEST_PATH): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(Object.fromEntries(manifest), null, 2));
  await rename(tmp, path);
}

export async function getInstalledVersion(name: string): Promise<string | null> {
  return (await readManifest()).get(name) ?? null;
}

// Read-modify-write cycles are serialized through this queue so concurrent
// syncs (assets sync runs 3 workers) can't drop each other's entries.
let writeQueue: Promise<void> = Promise.resolve();

export function setInstalledVersion(name: string, version: string, path: string = MANIFEST_PATH): Promise<void> {
  const task = writeQueue.then(async () => {
    const manifest = await readManifest(path);
    manifest.set(name, version);
    await writeManifest(manifest, path);
  });
  writeQueue = task.catch(() => {});
  return task;
}
