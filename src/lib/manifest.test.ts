import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { readManifest, setInstalledVersion, writeManifest } from "./manifest.ts";

let dir: string;

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("manifest", () => {
  test("concurrent setInstalledVersion keeps every entry", async () => {
    dir = await mkdtemp(join(tmpdir(), "dot-manifest-"));
    const path = join(dir, "versions.json");
    const names = Array.from({ length: 20 }, (_, i) => `asset-${i}`);
    await Promise.all(names.map((n, i) => setInstalledVersion(n, `v${i}`, path)));
    const manifest = await readManifest(path);
    expect(manifest.size).toBe(20);
    for (const [i, n] of names.entries()) expect(manifest.get(n)).toBe(`v${i}`);
  });

  test("write is atomic: file parses and no tmp file remains", async () => {
    dir = await mkdtemp(join(tmpdir(), "dot-manifest-"));
    const path = join(dir, "versions.json");
    await writeManifest(new Map([["a", "1"]]), path);
    expect(JSON.parse(await readFile(path, "utf-8"))).toEqual({ a: "1" });
    expect(async () => await readFile(`${path}.tmp`, "utf-8")).toThrow();
  });

  test("readManifest on missing file returns empty map", async () => {
    dir = await mkdtemp(join(tmpdir(), "dot-manifest-"));
    const manifest = await readManifest(join(dir, "nope.json"));
    expect(manifest.size).toBe(0);
  });
});
