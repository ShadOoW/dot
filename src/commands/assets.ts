import { defineCommand } from "citty";
import { existsSync, readFileSync, readdirSync } from "fs";
import { rm } from "fs/promises";
import { join } from "path";
import { ASSETS, type AssetDef, syncAsset, type LogFn } from "../assets/definitions.ts";
import { getLatestRelease } from "../lib/github.ts";
import { getInstalledVersion, readManifest, setInstalledVersion } from "../lib/manifest.ts";
import { colors, commandExists, logError, logInfo, logSection, logSuccess, logWarn } from "../lib/console.ts";

// ─── concurrency ─────────────────────────────────────────────────────────────

function semaphore(limit: number) {
  let running = 0;
  const queue: (() => void)[] = [];
  return function<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const run = async () => {
        running++;
        try { resolve(await fn()); } catch (e) { reject(e); } finally {
          running--;
          queue.shift()?.();
        }
      };
      running < limit ? run() : queue.push(run);
    });
  };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

async function getLatestVersion(asset: AssetDef): Promise<string | null> {
  if (asset.kind === "git" || asset.kind === "git-installer") return null;
  if (asset.kind === "url" || asset.kind === "multi-url") return asset.version;
  const release = await getLatestRelease(asset.repo);
  return release?.tag_name ?? null;
}

function printAssetsUsage() {
  console.log(`
Usage: dot assets <subcommand>

Subcommands:
  list          Show all assets with installed and latest versions
  sync [name]   Download/update all assets, or a specific one (--force to re-download)
  info <name>   Show details for a specific asset
  test [name]   Test font installation and Unicode rendering

Examples:
  dot assets list
  dot assets sync
  dot assets sync JetBrainsMono
  dot assets info catppuccin-gtk
  dot assets test
  dot assets test NotoSansCJK
`);
}

type FontTestSpec = {
  family: string;
  samples: { label: string; text: string }[];
};

const FONT_SPECS: Record<string, FontTestSpec> = {
  JetBrainsMono: {
    family: "JetBrainsMono Nerd Font",
    samples: [
      { label: "Latin",     text: "AaBbCc 0123456789 !@#$%" },
      { label: "Symbols",   text: "→ ← ≤ ≥ ≠ ≈ ∞ λ ƒ" },
      { label: "Powerline", text: "    " },
      { label: "NF Icons",  text: "󰊢  󰉋 󰈙 󰋜 󰀵  " },
    ],
  },
  Terminus: {
    family: "Terminus",
    samples: [
      { label: "Latin",     text: "AaBbCc 0123456789 !@#$%" },
      { label: "Powerline", text: "    " },
      { label: "NF Icons",  text: "󰊢  󰉋 󰈙 󰋜 󰀵  " },
    ],
  },
  NotoSansCJK: {
    family: "Noto Sans CJK",
    samples: [
      { label: "Chinese",  text: "你好世界 汉字测试 中文" },
      { label: "Japanese", text: "日本語テスト こんにちは" },
      { label: "Korean",   text: "안녕하세요 한국어 테스트" },
    ],
  },
  Inter: {
    family: "Inter",
    samples: [
      { label: "Latin",    text: "AaBbCcDd 0123456789" },
      { label: "Extended", text: "àáâã ñ üöä æœ ß" },
    ],
  },
  NotoColorEmoji: {
    family: "Noto Color Emoji",
    samples: [
      { label: "Emoji", text: "😀 😍 🎉 🚀 ❤️  🌍 🎵 🐉" },
      { label: "Flags", text: "🇺🇸 🇯🇵 🇩🇪 🇫🇷 🇬🇧 🇲🇦" },
    ],
  },
  NotoSansArabic: {
    family: "Noto Sans Arabic",
    samples: [
      { label: "Arabic",   text: "مرحبا بالعالم العربية" },
      { label: "Numerals", text: "٠١٢٣٤٥٦٧٨٩" },
    ],
  },
};

function countFontFiles(dir: string): number {
  if (!existsSync(dir)) return 0;
  try {
    const files = readdirSync(dir, { recursive: true, encoding: "utf8" }) as string[];
    return files.filter((f) => /\.(ttf|otf|ttc|woff2?)$/i.test(f)).length;
  } catch {
    return 0;
  }
}

// TTF: 0x00010000 or "true", OTF: "OTTO", TTC: "ttcf", WOFF: "wOFF"
const FONT_MAGIC = new Set([0x00010000, 0x74727565, 0x4f54544f, 0x74746366, 0x774f4646]);

function hasValidFontFiles(dir: string): boolean {
  if (!existsSync(dir)) return false;
  try {
    const files = readdirSync(dir, { recursive: true, encoding: "utf8" }) as string[];
    const fontFile = files.find((f) => /\.(ttf|otf|ttc)$/i.test(f));
    if (!fontFile) return false;
    const buf = readFileSync(join(dir, fontFile));
    return buf.length >= 4 && FONT_MAGIC.has(buf.readUInt32BE(0));
  } catch {
    return false;
  }
}

// ─── list ─────────────────────────────────────────────────────────────────────

export const assetsListCommand = defineCommand({
  meta: { description: "List all assets with installed and latest versions" },
  async run() {
    const manifest = await readManifest();
    console.log(`\n${"Asset".padEnd(22)} ${"Installed".padEnd(16)} ${"Latest".padEnd(16)} Status`);
    console.log("─".repeat(72));

    // Fetch all latest versions in parallel
    const rows = await Promise.all(ASSETS.map(async (asset) => {
      const installed = manifest.get(asset.name) ?? "-";
      const latest = await getLatestVersion(asset) ?? "git";
      const present = existsSync(asset.installDir);
      return { asset, installed, latest, present };
    }));

    for (const { asset, installed, latest, present } of rows) {
      let status: string;
      if (!present) status = colors.red("not installed");
      else if (installed === "-") status = colors.yellow("untracked");
      else if (latest !== "git" && installed !== latest) status = colors.yellow("update available");
      else status = colors.green("up to date");

      console.log(`${asset.name.padEnd(22)} ${installed.padEnd(16)} ${latest.padEnd(16)} ${status}`);
    }
    console.log("");
  },
});

// ─── sync ─────────────────────────────────────────────────────────────────────

const SYNC_CONCURRENCY = 3;

type SyncResult = { name: string; lines: string[]; synced: boolean; skipped: boolean };

async function performSync(
  asset: AssetDef,
  opts: { force: boolean; manifest: Map<string, string> },
): Promise<SyncResult> {
  const lines: string[] = [];
  const log: LogFn = (msg) => lines.push(`  ${colors.dim("·")} ${msg}`);
  const succeed = (msg: string) => lines.push(`  ${colors.green("✓")} ${msg}`);
  const warn = (msg: string) => lines.push(`  ${colors.yellow("!")} ${msg}`);
  const fail = (msg: string) => lines.push(`  ${colors.red("✗")} ${msg}`);

  lines.push(`\n${colors.dim("▸")} ${colors.bold(asset.name)}`);
  lines.push(`  ${colors.dim(asset.description)}`);

  try {
    let latestVersion: string | null = null;

    if (asset.kind === "release" || asset.kind === "release-tarball") {
      const release = await getLatestRelease(asset.repo);
      if (!release) { warn(`Could not fetch release info for ${asset.name}`); return { name: asset.name, lines, synced: false, skipped: false }; }
      latestVersion = release.tag_name;
      const installed = opts.manifest.get(asset.name);
      if (!opts.force && installed === latestVersion && existsSync(asset.installDir)) {
        log(`Already up to date (${latestVersion})`);
        return { name: asset.name, lines, synced: false, skipped: true };
      }
      log(`${installed ?? "not installed"} → ${latestVersion}`);
    } else if (asset.kind === "url" || asset.kind === "multi-url") {
      latestVersion = asset.version;
      const installed = opts.manifest.get(asset.name);
      if (!opts.force && installed === latestVersion && existsSync(asset.installDir)) {
        log(`Already up to date (${latestVersion})`);
        return { name: asset.name, lines, synced: false, skipped: true };
      }
      log(`${installed ?? "not installed"} → ${latestVersion}`);
    } else {
      log(`Syncing: ${(asset as { remote: string }).remote}`);
    }

    if (opts.force && existsSync(asset.installDir)) {
      log("Removing existing installation…");
      await rm(asset.installDir, { recursive: true });
    }

    await syncAsset(asset, log);

    const version = latestVersion ?? "git";
    await setInstalledVersion(asset.name, version);
    succeed(`${asset.name} → ${version}`);
    return { name: asset.name, lines, synced: true, skipped: false };
  } catch (e) {
    fail(`Failed to sync ${asset.name}: ${e}`);
    return { name: asset.name, lines, synced: false, skipped: false };
  }
}

export const assetsSyncCommand = defineCommand({
  meta: { description: "Download/update assets (all or a specific one)" },
  async run({ rawArgs }) {
    const force = rawArgs.includes("--force") || rawArgs.includes("-f");
    const target = rawArgs.find((a) => !a.startsWith("-"));
    const toSync = target ? ASSETS.filter((a) => a.name === target) : ASSETS;

    if (target && toSync.length === 0) {
      logError(`Unknown asset "${target}". Run 'dot assets list' to see available assets.`);
      process.exit(1);
    }

    const manifest = await readManifest();
    const opts = { force, manifest };

    const throttle = semaphore(SYNC_CONCURRENCY);
    let synced = 0;
    let skipped = 0;
    let failed = 0;

    // Kick off all jobs concurrently (up to SYNC_CONCURRENCY at a time),
    // flushing each asset's buffered output as it completes.
    await Promise.all(toSync.map((asset) =>
      throttle(async () => {
        const result = await performSync(asset, opts);
        for (const line of result.lines) console.log(line);
        if (result.synced) synced++;
        else if (result.skipped) skipped++;
        else failed++;
      })
    ));

    console.log(`\nSynced: ${synced}  Skipped (up to date): ${skipped}${failed ? `  Failed: ${failed}` : ""}`);
    if (failed > 0) process.exit(1);
  },
});

// ─── info ─────────────────────────────────────────────────────────────────────

export const assetsInfoCommand = defineCommand({
  meta: { description: "Show details for a specific asset" },
  async run({ rawArgs }) {
    const name = rawArgs[0];
    if (!name) {
      console.log(`\nUsage: dot assets info <name>\n\nAssets: ${ASSETS.map((a) => a.name).join(", ")}\n`);
      process.exit(0);
    }

    const asset = ASSETS.find((a) => a.name === name);
    if (!asset) {
      logError(`Unknown asset "${name}"`);
      process.exit(1);
    }

    const installed = await getInstalledVersion(name);
    console.log(`\n${colors.bold(asset.name)} — ${asset.description}`);
    console.log(`  Kind:      ${asset.kind}`);
    if (asset.kind === "release") console.log(`  Source:    github.com/${asset.repo}`);
    else if (asset.kind === "release-tarball") console.log(`  Source:    github.com/${asset.repo} (tarball)`);
    else if (asset.kind === "url") console.log(`  Source:    ${asset.downloadUrl}`);
    else if (asset.kind === "multi-url") console.log(`  Source:    ${asset.urls[0].replace(/\/[^/]+$/, "/")}… (${asset.urls.length} files)`);
    else console.log(`  Source:    ${asset.remote}`);
    console.log(`  Install:   ${asset.installDir}${asset.sudo ? " (requires sudo)" : ""}`);
    console.log(`  Installed: ${installed ?? colors.dim("not tracked")}`);

    if (asset.kind === "release" || asset.kind === "release-tarball") {
      const release = await getLatestRelease(asset.repo);
      console.log(`  Latest:    ${release?.tag_name ?? colors.dim("unknown")}`);
    } else if (asset.kind === "url" || asset.kind === "multi-url") {
      console.log(`  Latest:    ${asset.version}`);
    }
    console.log("");
  },
});

// ─── test ─────────────────────────────────────────────────────────────────────

export const assetsTestCommand = defineCommand({
  meta: { description: "Test font installation and Unicode rendering" },
  async run({ rawArgs }) {
    const target = rawArgs.find((a) => !a.startsWith("-"));
    const toTest = target
      ? ASSETS.filter((a) => a.name === target)
      : ASSETS.filter((a) => a.name in FONT_SPECS);

    if (target && toTest.length === 0) {
      logError(`Unknown asset: ${target}`);
      process.exit(1);
    }

    logSection("Font Tests");

    const fcAvailable = commandExists("fc-list");
    const fcOutput = fcAvailable
      ? Bun.spawnSync(["fc-list", ":", "family"]).stdout.toString().toLowerCase()
      : null;

    if (!fcAvailable) logWarn("fc-list not found — skipping font cache checks");

    for (const asset of toTest) {
      const spec = FONT_SPECS[asset.name];
      if (!spec) continue;

      const count = countFontFiles(asset.installDir);
      console.log(`\n${colors.bold(asset.name)}`);

      if (count === 0) {
        logError(`Not installed — run: dot assets sync ${asset.name}`);
        continue;
      }

      if (!hasValidFontFiles(asset.installDir)) {
        logError(`Corrupted files (not valid fonts) — run: dot assets sync --force ${asset.name}`);
        continue;
      }

      logSuccess(`Files present (${count} font file${count !== 1 ? "s" : ""})`);

      if (fcOutput !== null) {
        if (fcOutput.includes(spec.family.toLowerCase())) {
          logSuccess(`Registered: "${spec.family}"`);
        } else {
          logError(`Not in font cache — try: fc-cache -fv`);
        }
      }

      for (const { label, text } of spec.samples) {
        logInfo(`${colors.dim(label.padEnd(10))} ${text}`);
      }
    }
    console.log("");
  },
});

// ─── parent command ───────────────────────────────────────────────────────────

export const assetsCommand = defineCommand({
  meta: { description: "Manage fonts, icons, themes, and cursors from GitHub releases" },
  subCommands: {
    list: assetsListCommand,
    sync: assetsSyncCommand,
    info: assetsInfoCommand,
    test: assetsTestCommand,
  },
  async run({ rawArgs }) {
    if (rawArgs.length === 0) {
      printAssetsUsage();
    }
  },
});
