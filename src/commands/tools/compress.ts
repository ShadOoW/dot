import { defineCommand } from "citty";
import { existsSync } from "fs";
import { appendFile, mkdir, readdir, rename, unlink, writeFile } from "fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "path";
import { colors, formatBytes, logError, logInfo, logWarn } from "../../lib/console.ts";
import { Semaphore } from "../../lib/semaphore.ts";

// ─── types ────────────────────────────────────────────────────────────────────

type Quality = "high" | "medium" | "low";
type FileStatus = "ok" | "keep" | "copy" | "skip" | "fail" | "error";

interface FileResult {
  src: string;
  dst: string;
  status: FileStatus;
  origSize: number;
  outSize: number;
  note: string;
}

const COMPRESS_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

const QUALITY_PRESETS: Record<Quality, { png: string; jpeg: number; webp: number; gif: number }> = {
  high:   { png: "75-90", jpeg: 88, webp: 88, gif: 88 },
  medium: { png: "65-82", jpeg: 82, webp: 82, gif: 82 },
  low:    { png: "50-70", jpeg: 70, webp: 70, gif: 70 },
};

// ─── utilities ────────────────────────────────────────────────────────────────

function toolAvailable(tool: string): boolean {
  return Bun.spawnSync(["which", tool], { stdout: "ignore", stderr: "ignore" }).exitCode === 0;
}

async function checkMagicBytes(path: string, ext: string): Promise<boolean> {
  try {
    const file = Bun.file(path);
    if (file.size === 0) return false;
    const buf = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    switch (ext) {
      case ".png":  return buf[0] === 0x89 && buf[1] === 0x50; // \x89PNG
      case ".jpg":
      case ".jpeg": return buf[0] === 0xff && buf[1] === 0xd8; // JPEG
      case ".webp": return buf[0] === 0x52 && buf[1] === 0x49; // RIFF
      case ".gif":  return buf[0] === 0x47 && buf[1] === 0x49; // GIF
      default:      return file.size > 0;
    }
  } catch { return false; }
}

async function isAnimatedWebp(path: string): Promise<boolean> {
  try {
    const buf = new Uint8Array(await Bun.file(path).slice(0, 64).arrayBuffer());
    const text = new TextDecoder().decode(buf);
    return text.includes("ANIM");
  } catch { return false; }
}

async function runTool(args: string[], timeout = 120_000): Promise<number> {
  try {
    const proc = Bun.spawn(args, { stdout: "ignore", stderr: "ignore" });
    const result = await Promise.race([
      proc.exited,
      new Promise<number>((_, reject) => setTimeout(() => reject(new Error("timeout")), timeout)),
    ]);
    return result as number;
  } catch { return -1; }
}

async function collectFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(d: string) {
    const entries = await readdir(d, { withFileTypes: true });
    for (const e of entries) {
      const full = join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else files.push(full);
    }
  }
  await walk(dir);
  return files;
}

// ─── file processor ───────────────────────────────────────────────────────────

async function processFile(
  src: string,
  inputDir: string,
  outputDir: string,
  quality: (typeof QUALITY_PRESETS)[Quality],
  opts: { dryRun: boolean; resume: boolean; noGifConvert: boolean; timeout: number; tools: Set<string> },
): Promise<FileResult> {
  const ext = extname(src).toLowerCase();
  const rel = relative(inputDir, src);
  const origSize = Bun.file(src).size;

  const convertsGif = ext === ".gif" && !opts.noGifConvert && opts.tools.has("gif2webp");
  const dstRel = convertsGif ? rel.replace(/\.gif$/i, ".webp") : rel;
  const dst = join(outputDir, dstRel);
  const result: FileResult = { src, dst, status: "copy", origSize, outSize: origSize, note: "" };

  if (opts.resume && existsSync(dst)) {
    result.status = "skip";
    result.outSize = Bun.file(dst).size;
    return result;
  }

  if (opts.dryRun) {
    result.status = "skip";
    result.note = "dry-run";
    return result;
  }

  await mkdir(dirname(dst), { recursive: true });

  if (!COMPRESS_EXTS.has(ext)) {
    await Bun.write(dst, Bun.file(src));
    result.status = "copy";
    return result;
  }

  const pid = process.pid;
  const tid = Math.random().toString(36).slice(2, 8);
  const tmp = join(dirname(dst), `.~tmp_${pid}_${tid}_${basename(dst)}`);

  try {
    let attempted = false;
    let compressed = false;

    if (ext === ".png" && opts.tools.has("pngquant")) {
      attempted = true;
      const rc = await runTool(["pngquant", `--quality=${quality.png}`, "--strip", "--force", "--output", tmp, src], opts.timeout);
      compressed = existsSync(tmp) && Bun.file(tmp).size > 0;
      if (!compressed) result.note = `pngquant exited ${rc}`;
    } else if ((ext === ".jpg" || ext === ".jpeg") && opts.tools.has("jpegoptim")) {
      attempted = true;
      await Bun.write(tmp, Bun.file(src));
      const rc = await runTool(["jpegoptim", `--max=${quality.jpeg}`, "--strip-all", "--all-progressive", "--quiet", tmp], opts.timeout);
      compressed = existsSync(tmp) && Bun.file(tmp).size > 0;
      if (!compressed) result.note = `jpegoptim exited ${rc}`;
    } else if (convertsGif) {
      attempted = true;
      const rc = await runTool(["gif2webp", "-q", String(quality.gif), "-m", "4", src, "-o", tmp], opts.timeout);
      compressed = rc === 0 && existsSync(tmp) && Bun.file(tmp).size > 0;
      if (!compressed) result.note = `gif2webp exited ${rc}`;
    } else if (ext === ".webp" && opts.tools.has("cwebp")) {
      if (await isAnimatedWebp(src)) {
        result.note = "animated WebP — skipping compression";
      } else {
        attempted = true;
        const rc = await runTool(["cwebp", "-q", String(quality.webp), "-m", "4", "-af", src, "-o", tmp], opts.timeout);
        compressed = rc === 0 && existsSync(tmp) && Bun.file(tmp).size > 0;
        if (!compressed) result.note = `cwebp exited ${rc}`;
      }
    }

    // Integrity check via magic bytes
    if (compressed && !(await checkMagicBytes(tmp, extname(tmp).toLowerCase()))) {
      await unlink(tmp).catch(() => {});
      compressed = false;
      result.note = "integrity check failed";
    }

    if (compressed) {
      const newSize = Bun.file(tmp).size;
      if (newSize < origSize) {
        await rename(tmp, dst);
        result.status = "ok";
        result.outSize = newSize;
      } else {
        await unlink(tmp).catch(() => {});
        await Bun.write(dst, Bun.file(src));
        result.status = "keep";
      }
    } else {
      await unlink(tmp).catch(() => {});
      await Bun.write(dst, Bun.file(src));
      result.status = attempted ? "fail" : "copy";
    }
  } catch (e) {
    await unlink(tmp).catch(() => {});
    try { await Bun.write(dst, Bun.file(src)); } catch {}
    result.status = "error";
    result.note = String(e);
  }

  return result;
}

// ─── command ─────────────────────────────────────────────────────────────────

export const compressCommand = defineCommand({
  meta: { description: "Batch compress images (PNG, JPEG, WebP, GIF→WebP)" },
  args: {
    quality: { type: "string", default: "medium", description: "Quality preset: high, medium, low" },
    workers: { type: "string", description: "Parallel workers (default: cpu count, max 8)" },
    timeout: { type: "string", default: "120", description: "Per-file timeout in seconds" },
    "dry-run": { type: "boolean", description: "Print what would happen without writing files" },
    resume: { type: "boolean", description: "Skip files that already exist in the output directory" },
    "no-gif-convert": { type: "boolean", description: "Copy GIFs as-is instead of converting to WebP" },
    verbose: { type: "boolean", description: "Print result for every file" },
    log: { type: "string", description: "Write per-file TSV log to FILE" },
  },
  async run({ args, rawArgs }) {
    const positional = rawArgs.filter((a) => !a.startsWith("-") && !Object.values(args).includes(a));

    const inputPath = positional[0];
    const outputPath = positional[1] ?? `${inputPath?.replace(/\/$/, "")}-compressed`;

    if (!inputPath) {
      console.log(`
Usage: dot tools compress <input> [output] [options]

  input     Source directory
  output    Destination directory (default: <input>-compressed)

Options:
  --quality high|medium|low   Compression preset (default: medium)
  --workers N                 Parallel workers (default: min(cpu, 8))
  --timeout N                 Per-file timeout in seconds (default: 120)
  --dry-run                   Preview without writing
  --resume                    Skip files already in output
  --no-gif-convert            Keep GIFs instead of converting to WebP
  --verbose                   Print every file result
  --log FILE                  Write TSV log to FILE

Examples:
  dot tools compress ~/screenshots/
  dot tools compress ~/photos/ ~/photos-compressed/ --quality high
  dot tools compress ~/downloads/img/ --dry-run
`);
      process.exit(0);
    }

    const inputDir = resolve(inputPath);
    const outputDir = resolve(outputPath);

    if (!existsSync(inputDir)) { logError(`Input directory not found: ${inputDir}`); process.exit(1); }
    if (inputDir === outputDir) { logError("Input and output must be different directories"); process.exit(1); }
    if (outputDir.startsWith(inputDir + "/")) { logError("Output cannot be inside the input directory"); process.exit(1); }

    const quality = (args.quality as Quality) ?? "medium";
    if (!["high", "medium", "low"].includes(quality)) {
      logError(`Invalid quality "${quality}". Use: high, medium, or low`);
      process.exit(1);
    }

    const maxWorkers = Math.min(parseInt(args.workers ?? "8"), navigator.hardwareConcurrency ?? 4);
    const timeoutMs = parseInt(args.timeout ?? "120") * 1000;
    const dryRun = args["dry-run"] ?? false;
    const resume = args.resume ?? false;
    const noGifConvert = args["no-gif-convert"] ?? false;
    const verbose = args.verbose ?? false;
    const logFile = args.log;

    // Collect files
    const allFiles = await collectFiles(inputDir);
    if (allFiles.length === 0) { logError(`No files found in ${inputDir}`); process.exit(1); }

    // Check which tools are available for formats actually present
    const presentExts = new Set(allFiles.map((f) => extname(f).toLowerCase()).filter((e) => COMPRESS_EXTS.has(e)));
    const toolMap: Record<string, string> = { ".png": "pngquant", ".jpg": "jpegoptim", ".jpeg": "jpegoptim", ".gif": "gif2webp", ".webp": "cwebp" };
    const availableTools = new Set<string>();
    const missingTools = new Set<string>();
    for (const ext of presentExts) {
      const tool = toolMap[ext];
      if (tool) (toolAvailable(tool) ? availableTools : missingTools).add(tool);
    }
    if (missingTools.size > 0) logWarn(`Tools not found (files will be copied): ${[...missingTools].join(", ")}`);

    const q = QUALITY_PRESETS[quality];
    if (!dryRun) await mkdir(outputDir, { recursive: true });

    console.log(dryRun
      ? `[DRY RUN] ${allFiles.length} files  ${inputDir} → ${outputDir}`
      : `Processing ${allFiles.length} files  workers=${maxWorkers}  quality=${quality}`
    );

    const counts: Record<FileStatus, number> = { ok: 0, keep: 0, copy: 0, skip: 0, fail: 0, error: 0 };
    let totalOrig = 0;
    let totalSaved = 0;
    let processed = 0;

    const logFh = logFile && !dryRun ? await Bun.file(logFile).writer() : null;
    if (logFh) logFh.write("status\tsaved_bytes\tsrc\tdst\tnote\n");

    const sem = new Semaphore(maxWorkers);

    await Promise.all(
      allFiles.map(async (src) => {
        await sem.acquire();
        try {
          const r = await processFile(src, inputDir, outputDir, q, {
            dryRun, resume, noGifConvert, timeout: timeoutMs, tools: availableTools,
          });

          counts[r.status]++;
          totalOrig += r.origSize;
          if (r.status === "ok") totalSaved += r.origSize - r.outSize;
          processed++;
          process.stdout.write(`\r  ${processed}/${allFiles.length}  saved: ${formatBytes(totalSaved)}  `);

          if (logFh) logFh.write(`${r.status}\t${r.status === "ok" ? r.origSize - r.outSize : 0}\t${r.src}\t${r.dst}\t${r.note}\n`);
          if (r.status === "fail" || r.status === "error" || verbose) {
            const note = r.note ? ` (${r.note})` : "";
            console.log(`\n  [${r.status.toUpperCase()}] ${relative(inputDir, r.src)}${note}`);
          }
        } finally {
          sem.release();
        }
      }),
    );

    if (logFh) await logFh.end();
    console.log(""); // newline after progress

    // Summary
    const pct = totalOrig > 0 ? ((totalSaved / totalOrig) * 100).toFixed(1) : "0.0";
    console.log(`\n${"─".repeat(55)}`);
    console.log(`Compressed  ${String(counts.ok).padStart(5)}  files  (saved ${formatBytes(totalSaved)}, ${pct}%)`);
    console.log(`Kept        ${String(counts.keep).padStart(5)}  files  (no gain, original copied)`);
    console.log(`Copied      ${String(counts.copy).padStart(5)}  files  (non-image or no tool)`);
    if (counts.skip)  console.log(`Skipped     ${String(counts.skip).padStart(5)}  files  (already exists, --resume)`);
    if (counts.fail)  console.log(colors.yellow(`Failed      ${String(counts.fail).padStart(5)}  files  (tool error, original copied)`));
    if (counts.error) console.log(colors.red(`Errors      ${String(counts.error).padStart(5)}  files  (exception, original copied)`));

    if (counts.error > 0) { logError(`${counts.error} file(s) errored`); process.exit(2); }
    if (counts.fail > 0) { logError(`${counts.fail} file(s) failed compression`); process.exit(1); }
    process.exit(0);
  },
});
