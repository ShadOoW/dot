let capturing = false;

export function setCapturing(v: boolean) { capturing = v; }

interface SpawnOpts {
  cwd?: string;
  env?: Record<string, string>;
}

function shellEscape(args: string[]): string {
  return args.map(arg => {
    if (/^[\w.,@:/=+-]+$/.test(arg)) return arg;
    return "'" + arg.replace(/'/g, "'\\''") + "'";
  }).join(" ");
}

export async function spawnInherit(cmd: string[], opts: SpawnOpts = {}): Promise<{ exitCode: number }> {
  if (!capturing) {
    const r = Bun.spawnSync(cmd, { stdout: "inherit", stderr: "inherit", ...opts });
    return { exitCode: r.exitCode ?? 1 };
  }

  // Wrap with script(1) to give the subprocess a real PTY — prevents programs
  // from switching to "pipe mode" (no progress bars, different line-break format).
  // cwd is passed to script itself and inherited by the child via sh -c.
  const hasScript = !!Bun.which("script");
  const spawnCmd = hasScript
    ? ["script", "-q", "-e", "-c", shellEscape(cmd), "/dev/null"]
    : cmd;

  const proc = Bun.spawn(spawnCmd, {
    ...opts,
    stdout: "pipe",
    // script merges child stdout+stderr through the PTY; fall back pipes both.
    stderr: hasScript ? "inherit" : "pipe",
    stdin: "inherit",
  });

  async function forward(stream: ReadableStream<Uint8Array>, dest: typeof process.stdout | typeof process.stderr) {
    for await (const chunk of stream) {
      dest.write(chunk);
    }
  }

  const forwards: Promise<void>[] = [forward(proc.stdout, process.stdout)];
  if (!hasScript && proc.stderr) forwards.push(forward(proc.stderr, process.stderr));

  await Promise.all([...forwards, proc.exited]);
  const exitCode = proc.exitCode ?? 1;
  if (exitCode === 130) process.exit(130);
  return { exitCode };
}
