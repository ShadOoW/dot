import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { getPackageMeta } from "./pkg.ts";

let dir: string;

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("getPackageMeta", () => {
  test("malformed meta.json warns and returns null instead of throwing", async () => {
    dir = await mkdtemp(join(tmpdir(), "dot-pkg-"));
    await mkdir(join(dir, "broken"));
    await writeFile(join(dir, "broken", "meta.json"), "{ not json");
    const meta = await getPackageMeta("broken", new Set(), dir);
    expect(meta).toBeNull();
  });

  test("valid meta.json parses", async () => {
    dir = await mkdtemp(join(tmpdir(), "dot-pkg-"));
    await mkdir(join(dir, "ok"));
    await writeFile(join(dir, "ok", "meta.json"), JSON.stringify({ description: "test pkg", tags: ["dev"] }));
    const meta = await getPackageMeta("ok", new Set(), dir);
    expect(meta?.description).toBe("test pkg");
    expect(meta?.tags).toEqual(["dev"]);
  });
});
