import { defineCommand } from "citty";
import { existsSync } from "fs";
import { mkdir, unlink } from "fs/promises";
import { dirname, join, resolve } from "path";
import { colors, commandExists, formatBytes, logError, logSuccess, logWarn } from "../../lib/console.ts";
import { run } from "../../lib/spawn.ts";

type Quality = "high" | "medium" | "low";

const QUALITY_CRF: Record<Quality, number> = {
  high: 20,
  medium: 30,
  low: 40,
};

const DEFAULT_OUTPUT_DIR = "/data/screens";
const DEFAULT_FILENAME_PREFIX = "recording";

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

async function getSwayWindows(): Promise<Array<{ id: string; app_id: string; title: string; rect: { x: number; y: number; width: number; height: number } }>> {
  const result = await run(["swaymsg", "-t", "get_tree", "-r"]);
  if (result.exitCode !== 0) return [];
  try {
    const tree = JSON.parse(result.stdout);
    const windows: Array<{ id: string; app_id: string; title: string; rect: { x: number; y: number; width: number; height: number } }> = [];
    function walk(node: Record<string, unknown>) {
      // sway leaf windows are type "con"/"floating_con" (see src/lib/sway.ts);
      // split containers share the type but have no app_id.
      if ((node.type === "con" || node.type === "floating_con") && node.app_id) {
        windows.push({
          id: String(node.id),
          app_id: String(node.app_id),
          title: String(node.name || ""),
          rect: node.rect as { x: number; y: number; width: number; height: number },
        });
      }
      if (node.nodes) (node.nodes as unknown[]).forEach((n) => walk(n as Record<string, unknown>));
      if (node.floating_nodes) (node.floating_nodes as unknown[]).forEach((n) => walk(n as Record<string, unknown>));
    }
    walk(tree as Record<string, unknown>);
    return windows;
  } catch {
    return [];
  }
}

async function getHyprWindows(): Promise<Array<{ id: string; app_id: string; title: string; rect: { x: number; y: number; width: number; height: number } }>> {
  const result = await run(["hyprctl", "-j", "clients"]);
  if (result.exitCode !== 0) return [];
  try {
    const clients = JSON.parse(result.stdout);
    return clients
      .filter((c: { workspace?: { id: number }; windowClass?: string; title?: string; at?: [number, number]; size?: [number, number] }) => c.workspace?.id !== -1)
      .map((c: { address?: string; windowClass?: string; title?: string; at?: [number, number]; size?: [number, number] }) => ({
        id: c.address || "",
        app_id: c.windowClass || "",
        title: c.title || "",
        rect: { x: c.at?.[0] ?? 0, y: c.at?.[1] ?? 0, width: c.size?.[0] ?? 0, height: c.size?.[1] ?? 0 },
      }));
  } catch {
    return [];
  }
}

async function pickWindow(): Promise<string | null> {
  const swayWindows = await getSwayWindows();
  const hyprWindows = await getHyprWindows();
  const windows = swayWindows.length > 0 ? swayWindows : hyprWindows;

  if (windows.length === 0) {
    logWarn("No windows found. Make sure a Wayland compositor is running.");
    return null;
  }

  console.log(`\n${colors.bold("Available windows:")}\n`);
  windows.forEach((w, i) => {
    const geo = `${w.rect.x},${w.rect.y} ${w.rect.width}x${w.rect.height}`;
    console.log(`  ${colors.cyan(String(i + 1).padStart(2))}  ${colors.bold(w.app_id)}  ${w.title.slice(0, 50)}  ${colors.dim(geo)}`);
  });
  console.log(`\n  ${colors.cyan("0")}  Cancel\n`);

  const input = await ask("Select window [0]: ");
  const idx = parseInt(input.trim());
  if (idx === 0 || isNaN(idx)) return null;
  if (idx < 1 || idx > windows.length) return null;

  const w = windows[idx - 1];
  return `${w.rect.x},${w.rect.y} ${w.rect.width}x${w.rect.height}`;
}

async function pickMonitor(): Promise<string | null> {
  const result = await run(["wf-recorder", "--list-output"]);
  if (result.exitCode !== 0) {
    logError("Failed to list outputs. Is wf-recorder installed?");
    return null;
  }

  const outputs: string[] = [];
  for (const line of result.stdout.split("\n")) {
    const m = line.match(/Name:\s*(\S+)/);
    if (m) outputs.push(m[1]);
  }

  if (outputs.length === 0) {
    logError("No monitors found.");
    return null;
  }

  if (outputs.length === 1) return outputs[0];

  console.log(`\n${colors.bold("Available monitors:")}\n`);
  outputs.forEach((o, i) => console.log(`  ${colors.cyan(String(i + 1).padStart(2))}  ${o}`));
  console.log(`\n  ${colors.cyan("0")}  Cancel\n`);

  const input = await ask("Select monitor [0]: ");
  const idx = parseInt(input.trim());
  if (idx === 0 || isNaN(idx)) return null;
  if (idx < 1 || idx > outputs.length) return null;

  return outputs[idx - 1];
}

function ask(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const listener = (_: unknown, data: Buffer) => {
      process.stdin.off("data", listener);
      resolve(data.toString().trim());
    };
    process.stdin.on("data", listener);
  });
}

export const recordCommand = defineCommand({
  meta: { description: "Record screen (Wayland/wf-recorder)" },
  args: {
    output: { type: "string", description: "Output file path" },
    quality: { type: "string", default: "medium", description: "Quality: high, medium, low" },
    mode: { type: "string", description: "Capture mode: window, monitor, area (default: area)" },
    fps: { type: "string", description: "Framerate (default: 30)" },
  },
  async run({ args }) {
    const wfRecAvailable = commandExists("wf-recorder");

    if (!wfRecAvailable) {
      logError("wf-recorder not found. Install it first (e.g., via your package manager).");
      process.exit(1);
    }

    const quality = (args.quality as Quality) ?? "medium";
    if (!["high", "medium", "low"].includes(quality)) {
      logError(`Invalid quality "${quality}". Use: high, medium, or low`);
      process.exit(1);
    }

    const crf = QUALITY_CRF[quality];
    const fps = parseInt(args.fps ?? "30");

    const mode = (args.mode as "window" | "monitor" | "area") ?? "area";

    let outputPath = args.output
      ? resolve(args.output)
      : join(DEFAULT_OUTPUT_DIR, `${DEFAULT_FILENAME_PREFIX}_${timestamp()}.webm`);

    const outDir = dirname(outputPath);
    if (!existsSync(outDir)) {
      await mkdir(outDir, { recursive: true });
    }

    const recorderArgs: string[] = [];

    recorderArgs.push("-c", "libvpx-vp9");
    recorderArgs.push("-p", `crf=${crf}`);
    recorderArgs.push("-p", "speed=4");
    recorderArgs.push("-p", "quality=realtime");
    recorderArgs.push("-p", "row-mt=1");
    recorderArgs.push("-x", "yuv420p");
    recorderArgs.push("-r", String(fps));

    let geometry: string | null = null;

    if (mode === "window") {
      geometry = await pickWindow();
      if (!geometry) {
        console.log("Window selection cancelled.");
        process.exit(0);
      }
    } else if (mode === "monitor") {
      const monitor = await pickMonitor();
      if (!monitor) {
        console.log("Monitor selection cancelled.");
        process.exit(0);
      }
      recorderArgs.push("-o", monitor);
    } else {
      const slurpAvailable = commandExists("slurp");
      if (!slurpAvailable) {
        logError("slurp not found. Install it for area selection or use --mode monitor/window.");
        process.exit(1);
      }
      console.log(`${colors.dim("Select area with mouse, press Enter to confirm...")}`);
      const slurpResult = await run(["slurp"]);
      if (slurpResult.exitCode !== 0 || !slurpResult.stdout.trim()) {
        console.log("Area selection cancelled.");
        process.exit(0);
      }
      geometry = slurpResult.stdout.trim();
    }

    if (geometry) {
      recorderArgs.push("-g", geometry);
    }

    recorderArgs.push("-f", outputPath);

    if (existsSync(outputPath)) {
      await unlink(outputPath);
    }

    console.log(`\n${colors.green("●")} Recording to ${colors.bold(outputPath)}`);
    console.log(`    Mode: ${mode}  Quality: ${quality} (crf=${crf})  FPS: ${fps}\n`);
    console.log("Press Ctrl+C to stop and save.\n");

    const proc = Bun.spawn(["wf-recorder", ...recorderArgs], { stdout: "inherit", stderr: "inherit", stdin: "inherit" });

    let stopped = false;

    const stopRecording = async () => {
      if (stopped) return;
      stopped = true;
      console.log(`\n${colors.yellow("■")} Stopping...`);
      proc.kill("SIGINT");
    };

    const handleSignal = () => {
      console.log("");
      stopRecording();
    };

    process.on("SIGINT", handleSignal);
    process.on("SIGTERM", stopRecording);

    const exitCode = await proc.exited;

    if (stopped) {
      await Bun.sleep(2000);
    }

    process.off("SIGINT", handleSignal);
    process.off("SIGTERM", stopRecording);

    if (existsSync(outputPath) && Bun.file(outputPath).size > 0) {
      const size = Bun.file(outputPath).size;
      logSuccess(`Saved: ${outputPath} (${formatBytes(size)})`);
      process.exit(0);
    } else if (exitCode !== 0) {
      logError("Recording failed. No output file.");
      process.exit(1);
    }
  },
});