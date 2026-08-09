const noColor = Boolean(process.env.NO_COLOR);

const c = (code: string) => (noColor ? "" : `\x1b[${code}m`);
const reset = c("0");

export const colors = {
  red: (s: string) => `${c("0;31")}${s}${reset}`,
  green: (s: string) => `${c("0;32")}${s}${reset}`,
  yellow: (s: string) => `${c("1;33")}${s}${reset}`,
  blue: (s: string) => `${c("0;34")}${s}${reset}`,
  cyan: (s: string) => `${c("0;36")}${s}${reset}`,
  bold: (s: string) => `${c("1")}${s}${reset}`,
  dim: (s: string) => `${c("2")}${s}${reset}`,
};

export function logInfo(msg: string) {
  console.log(`  ${colors.dim("·")} ${msg}`);
}
export function logWarn(msg: string) {
  console.log(`  ${colors.yellow("!")} ${msg}`);
}
export function logError(msg: string) {
  console.error(`  ${colors.red("✗")} ${msg}`);
}
export function logSuccess(msg: string) {
  console.log(`  ${colors.green("✓")} ${msg}`);
}
export function logSection(msg: string) {
  console.log(`\n${colors.dim("▸")} ${colors.bold(msg)}`);
}

export function logDesc(msg: string) {
  console.log(`\n  ${colors.dim(msg)}`);
}

export function formatBytes(bytes: number): string {
  for (const unit of ["B", "KB", "MB", "GB"]) {
    if (Math.abs(bytes) < 1024) return `${bytes.toFixed(1)} ${unit}`;
    bytes /= 1024;
  }
  return `${bytes.toFixed(1)} TB`;
}

/**
 * Writes a whole payload to stdout, honouring backpressure.
 *
 * Needed for anything large — a `--json` dump of a usage database is ~100 KB — where
 * every simpler option loses bytes once stdout is a pipe rather than a terminal:
 * `console.log` returns before the pipe drains and the tail is lost when the process
 * exits, `fs.writeSync` performs a short write and reports it, and
 * `Bun.write(Bun.stdout, …)` never resolves at all. The write callback fires only
 * after the data is handed off, so awaiting it is the one reliable signal.
 */
export function writeStdout(text: string): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  process.stdout.write(text, (err) => (err ? reject(err) : resolve()));
  return promise;
}

export function commandExists(cmd: string): boolean {
  const r = Bun.spawnSync(["which", cmd], { stdout: "ignore", stderr: "ignore" });
  return r.exitCode === 0;
}

export function getVersion(cmd: string, args: string[]): string {
  try {
    const r = Bun.spawnSync([cmd, ...args], { stdout: "pipe", stderr: "pipe" });
    return (
      new TextDecoder().decode(r.stdout).trim() ||
      new TextDecoder().decode(r.stderr).trim()
    );
  } catch {
    return "unknown";
  }
}
