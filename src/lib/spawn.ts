let capturing = false;

export function setCapturing(v: boolean) { capturing = v; }

interface SpawnOpts {
  cwd?: string;
  env?: Record<string, string>;
}

/**
 * `pty: false` keeps the child on the real terminal even while capturing.
 *
 * The capture path below wraps children in script(1), which calls setsid() and makes its
 * own pty the child's *controlling* terminal. sudo scopes its credential cache by
 * controlling terminal (`timestamp_type=tty`, the default), so a `sudo` inside the wrapper
 * cannot see — or refresh — the ticket that `dot update --sudoloop` keeps alive on the real
 * terminal: it prompts again on every wrapped command, and again each time its own 5-minute
 * window lapses. Anything that authenticates MUST opt out and give up the pty niceties.
 */
interface InheritOpts extends SpawnOpts {
  pty?: boolean;
}

export function shellEscape(args: string[]): string {
  return args.map(arg => {
    if (/^[\w.,@:/=+-]+$/.test(arg)) return arg;
    return "'" + arg.replace(/'/g, "'\\''") + "'";
  }).join(" ");
}

/** Spawn and capture output. `out` is trimmed stdout+stderr for quick checks. */
export async function run(cmd: string[], opts: SpawnOpts = {}): Promise<{ exitCode: number; stdout: string; stderr: string; out: string }> {
  const proc = Bun.spawn(cmd, { ...opts, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text()]);
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr, out: (stdout + stderr).trim() };
}

/**
 * Re-runs this exact `dot` invocation as root, inheriting the terminal so sudo or doas
 * can prompt for a password. Never returns — it exits with the child's status.
 *
 * ── Why commands escalate themselves instead of being run under sudo ────────────────
 * `sudo dot …` cannot work, and fails in a way that looks like dot is not installed:
 *
 *     $ sudo dot usage acct on
 *     sudo: dot: command not found
 *
 * `dot` is a shim in ~/.local/bin, and sudo resets PATH to its compiled-in
 * `secure_path`, which does not include it. Telling people to type the full
 * `sudo bun /data/config/dot/dot.ts …` instead just moves the problem onto them.
 *
 * So a subcommand that needs root runs unprivileged, notices, and escalates only the
 * part that needs it. The password prompt then belongs to the command that actually
 * needed the privilege, which is also what makes the reason legible at the prompt.
 *
 * `process.execPath` is the bun binary and `Bun.main` the entry script, so the child is
 * the same code rather than a PATH lookup that could resolve to something else.
 */
export function reexecAsRoot(reason: string): never {
  if (process.getuid?.() === 0) {
    throw new Error("reexecAsRoot called while already root — check the uid before escalating");
  }
  const priv = Bun.which("doas") ? "doas" : "sudo";
  if (!Bun.which(priv)) {
    console.error(`  ✗ ${reason}, but neither doas nor sudo is installed`);
    process.exit(1);
  }

  console.log(`  · ${reason} — escalating with ${priv}`);
  const r = Bun.spawnSync([priv, process.execPath, Bun.main, ...process.argv.slice(2)], {
    // stdin included on purpose: sudo prefers /dev/tty but falls back to stdin, and
    // without it a password prompt in a pipeline hangs with no way to answer.
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exit(r.exitCode ?? 1);
}

export async function spawnInherit(cmd: string[], opts: InheritOpts = {}): Promise<{ exitCode: number }> {
  const { pty = true, ...spawnOpts } = opts;

  if (!capturing) {
    const r = Bun.spawnSync(cmd, { stdout: "inherit", stderr: "inherit", ...spawnOpts });
    return { exitCode: r.exitCode ?? 1 };
  }

  // Wrap with script(1) to give the subprocess a real PTY — prevents programs
  // from switching to "pipe mode" (no progress bars, different line-break format).
  // cwd is passed to script itself and inherited by the child via sh -c.
  const hasScript = pty && !!Bun.which("script");
  const spawnCmd = hasScript
    ? ["script", "-q", "-e", "-c", shellEscape(cmd), "/dev/null"]
    : cmd;

  const proc = Bun.spawn(spawnCmd, {
    ...spawnOpts,
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
