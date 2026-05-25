import { existsSync } from "fs";
import { mkdir, mkdtemp, readdir, rm } from "fs/promises";
import { join } from "path";
import { HOME_DIR } from "./config.ts";
import { logInfo } from "./console.ts";

export type LogFn = (msg: string) => void;

const CACHE_DIR = join(HOME_DIR, ".cache/assets");

export async function gitInstallerSync(
  remote: string,
  destDir: string,
  installCmd: string[],
  sudo = false,
  log: LogFn = logInfo,
): Promise<void> {
  const gitBin = "/usr/bin/git";

  if (existsSync(destDir)) {
    log("Pulling latest changes…");
    const r = Bun.spawnSync(
      sudo ? ["sudo", gitBin, "-C", destDir, "pull"] : [gitBin, "-C", destDir, "pull"],
      { stdout: "pipe", stderr: "pipe" },
    );
    if (r.exitCode !== 0) throw new Error(`git pull failed: ${new TextDecoder().decode(r.stderr)}`);
  } else {
    log("Cloning repository…");
    sudo && Bun.spawnSync(["sudo", "mkdir", "-p", destDir]);
    const r = Bun.spawnSync(
      sudo ? ["sudo", gitBin, "clone", "--depth=1", remote, destDir] : [gitBin, "clone", "--depth=1", remote, destDir],
      { stdout: "pipe", stderr: "pipe" },
    );
    if (r.exitCode !== 0) throw new Error(`git clone failed: ${new TextDecoder().decode(r.stderr)}`);
  }

  for (const cmd of installCmd) {
    log(`Running: ${cmd}`);
    const r = Bun.spawnSync(
      sudo ? ["sudo", "sh", "-c", cmd] : ["sh", "-c", cmd],
      { cwd: destDir, stdout: "pipe", stderr: "pipe" },
    );
    if (r.exitCode !== 0) throw new Error(`Installer failed: ${new TextDecoder().decode(r.stderr)}`);
  }
}

export async function downloadAndExtract(
  url: string,
  destDir: string,
  sudo = false,
  stripComponents = 0,
  log: LogFn = logInfo,
): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  const tmp = await mkdtemp(join(CACHE_DIR, "dot-asset-"));
  const filename = url.split("/").pop() ?? "asset";
  const archivePath = join(tmp, filename);

  log(`Downloading ${filename}…`);
  const curl = Bun.spawnSync(["curl", "-L", "-o", archivePath, "--silent", "--show-error", url]);
  if (curl.exitCode !== 0) throw new Error(`Download failed: ${new TextDecoder().decode(curl.stderr)}`);

  log("Extracting…");
  const extractDir = join(tmp, "extracted");
  await mkdir(extractDir, { recursive: true });

  const lower = filename.toLowerCase();
  let r: { exitCode: number; stderr: Uint8Array } | null = null;

  if (stripComponents > 0) {
    const stripArgs = Array(stripComponents).fill("--strip-components=1").flat();
    r = Bun.spawnSync(["tar", "-xf", archivePath, "-C", extractDir, ...stripArgs]);
  } else if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) {
    r = Bun.spawnSync(["tar", "-xzf", archivePath, "-C", extractDir]);
  } else if (lower.endsWith(".tar.xz")) {
    r = Bun.spawnSync(["tar", "-xJf", archivePath, "-C", extractDir]);
  } else if (lower.endsWith(".zip")) {
    r = Bun.spawnSync(["unzip", "-q", archivePath, "-d", extractDir]);
  } else {
    await mkdir(destDir, { recursive: true });
    await Bun.write(join(destDir, filename), Bun.file(archivePath));
    await rm(tmp, { recursive: true });
    return;
  }

  if (r.exitCode !== 0) throw new Error(`Extraction failed for ${filename}`);

  const entries = await readdir(extractDir, { withFileTypes: true });
  let sourceDir = extractDir;
  if (!stripComponents && entries.length === 1 && entries[0].isDirectory()) {
    sourceDir = join(extractDir, entries[0].name);
  }

  const cpCmd = `cp -r "${sourceDir}/." "${destDir}/"`;
  if (sudo) {
    Bun.spawnSync(["sudo", "mkdir", "-p", destDir]);
    const cp = Bun.spawnSync(["sudo", "sh", "-c", cpCmd]);
    if (cp.exitCode !== 0) throw new Error("Copy to dest failed");
  } else {
    await mkdir(destDir, { recursive: true });
    const cp = Bun.spawnSync(["sh", "-c", cpCmd]);
    if (cp.exitCode !== 0) throw new Error("Copy to dest failed");
  }

  await rm(tmp, { recursive: true });
}

export async function gitCloneOrPull(
  remote: string,
  destDir: string,
  sudo = false,
  log: LogFn = logInfo,
): Promise<string> {
  const gitBin = "/usr/bin/git";

  if (existsSync(destDir)) {
    log("Pulling latest changes…");
    const r = Bun.spawnSync(
      sudo ? ["sudo", gitBin, "-C", destDir, "pull"] : [gitBin, "-C", destDir, "pull"],
      { stdout: "pipe", stderr: "pipe" },
    );
    if (r.exitCode !== 0) throw new Error(`git pull failed: ${new TextDecoder().decode(r.stderr)}`);
  } else {
    log("Cloning repository…");
    sudo && Bun.spawnSync(["sudo", "mkdir", "-p", destDir]);
    const r = Bun.spawnSync(
      sudo ? ["sudo", gitBin, "clone", "--depth=1", remote, destDir] : [gitBin, "clone", "--depth=1", remote, destDir],
      { stdout: "pipe", stderr: "pipe" },
    );
    if (r.exitCode !== 0) throw new Error(`git clone failed: ${new TextDecoder().decode(r.stderr)}`);
  }

  const rev = Bun.spawnSync([gitBin, "-C", destDir, "rev-parse", "--short", "HEAD"], { stdout: "pipe" });
  return new TextDecoder().decode(rev.stdout).trim();
}
