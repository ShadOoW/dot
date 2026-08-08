import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync } from "fs";
import { basename, join } from "path";
import { PACKAGES_DIR } from "./config.ts";
import { detectInit } from "./pkg.ts";
import { colors, logInfo, logError } from "./console.ts";
import { run } from "./spawn.ts";

export type Init = "runit" | "systemd" | "launchd";

export type ServiceState =
  | "running"
  | "stopped" // enabled/installed but not currently active
  | "failed"
  | "not-enabled" // unit exists in the repo but isn't registered with the init system
  | "unknown";

export interface ServiceInfo {
  pkg: string;
  name: string;
  init: Init;
  scope: "user" | "system";
  state: ServiceState;
  detail: string;
}

const STATE_LABEL: Record<ServiceState, string> = {
  running: "running",
  stopped: "stopped",
  failed: "failed",
  "not-enabled": "not enabled",
  unknown: "unknown",
};

export function serviceStateLabel(s: ServiceState): string {
  return STATE_LABEL[s];
}

export function serviceIcon(state: ServiceState): string {
  switch (state) {
    case "running": return colors.green("●");
    case "stopped": return colors.yellow("○");
    case "failed": return colors.red("✗");
    case "not-enabled": return colors.dim("·");
    default: return colors.dim("?");
  }
}

/**
 * Service units a package declares, for the given init system. Two sources:
 *  1. Unit files the package *ships* under system/<init>/... (custom daemons
 *     the repo must provide because no distro does — prettierd, litellm, …).
 *  2. Units declared in meta.json `services` — for distro-provided units the
 *     package only wants enabled + tracked, without forking a copy of the unit
 *     (e.g. mpd's hardened /usr/lib/systemd/user/mpd.service).
 * Both feed the same enable/disable + doctor paths; entries are de-duplicated.
 */
export function declaredServices(pkg: string, init: Init): { name: string; scope: "user" | "system" }[] {
  const pkgDir = join(PACKAGES_DIR, pkg);
  const out: { name: string; scope: "user" | "system" }[] = [];
  const add = (name: string, scope: "user" | "system") => {
    if (!out.some((x) => x.name === name && x.scope === scope)) out.push({ name, scope });
  };

  const addUnits = (dir: string, scope: "user" | "system") => {
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir)) {
      if (f.endsWith(".service") || f.endsWith(".timer") || f.endsWith(".socket") || f.endsWith(".path") || f.endsWith(".mount") || (init === "launchd" && f.endsWith(".plist"))) {
        add(init === "launchd" ? basename(f, ".plist") : f, scope);
      }
    }
  };

  if (init === "runit") {
    const svDir = join(pkgDir, "system/runit/etc/sv");
    if (existsSync(svDir)) {
      for (const name of readdirSync(svDir)) add(name, "system");
    }
  } else if (init === "systemd") {
    addUnits(join(pkgDir, "system/systemd/etc/systemd/user"), "user");
    addUnits(join(pkgDir, "system/systemd/etc/systemd/system"), "system");
  } else if (init === "launchd") {
    addUnits(join(pkgDir, "system/launchd/Library/LaunchAgents"), "user");
  }

  for (const { name, scope } of metaDeclaredServices(pkgDir, init)) add(name, scope);
  return out;
}

/**
 * Services declared in meta.json under `services.<init>`, e.g.
 *   "services": { "systemd": [{ "name": "mpd.service", "scope": "user" }] }
 * Only the current init's entries are returned. `scope` defaults to "user" for
 * launchd, "system" otherwise (the conventional default for each init).
 * Note: extends-inherited declarations are not resolved here — like the shipped
 * unit scan, this reads the package's own meta.json.
 */
function metaDeclaredServices(pkgDir: string, init: Init): { name: string; scope: "user" | "system" }[] {
  const metaPath = join(pkgDir, "meta.json");
  if (!existsSync(metaPath)) return [];
  let raw: { services?: Record<string, { name?: unknown; scope?: unknown }[]> };
  try {
    raw = JSON.parse(readFileSync(metaPath, "utf-8"));
  } catch {
    return [];
  }
  const decl = raw.services?.[init];
  if (!Array.isArray(decl)) return [];
  const defaultScope: "user" | "system" = init === "launchd" ? "user" : "system";
  return decl
    .filter((e): e is { name: string; scope?: unknown } => typeof e?.name === "string")
    .map((e) => ({ name: e.name, scope: e.scope === "user" || e.scope === "system" ? e.scope : defaultScope }));
}

/**
 * Where runit looks for enabled services. On Void this is a symlink chain to
 * /etc/runit/runsvdir/current -> .../default, which is what runsvdir actually supervises.
 * Shared by queryRunit/enableService/disableService so all three agree on one location.
 */
const RUNIT_SERVICE_DIR = "/var/service";

/**
 * Children of `runsv` that are NOT the service. Treating any of these as "up" yields a
 * confident false healthy, which is worse than the "unknown" it replaced:
 *   svlogd   the ./log service for repo-shipped units — present whenever log/ exists, even if
 *            ./run never starts
 *   vlogger  the ./log service for Void's own units; /etc/sv/sshd/log/run is literally
 *            `exec vlogger -t sshd -p daemon`, so `runsv sshd` has children [vlogger, sshd].
 *            Omit it and a dead sshd whose logger is still alive reports as running.
 *   runsv    runsv forks a copy of itself while retrying a failed ./run (observed live on
 *            navidrome-caddy, whose run script does not exist at all)
 *   sleep    the runit backoff idiom for a run script that has decided it cannot start —
 *            including this repo's own agentmemory run, which sleeps 30 then exits when the
 *            fnm node path is gone. Without this entry a permanently broken service would
 *            report as running, forever.
 */
const RUNSV_SCAFFOLDING: Record<string, true> = {
  svlogd: true,
  vlogger: true,
  runsv: true,
  sleep: true,
};

async function queryRunit(name: string): Promise<{ state: ServiceState; detail: string }> {
  const link = join(RUNIT_SERVICE_DIR, name);

  // "Enabled" in runit means exactly one thing: present in the supervised service dir, which
  // runsvdir rescans every 5s. Establish that FIRST — the runtime query below needs root, and
  // its failure must never be reported as "not enabled". Previously `sv status` ran
  // unprivileged and /run/runit/supervise.<name> is 0700 root:root, so it failed for EVERY
  // service: doctor reported every runit service on this host as "not enabled / not in
  // service dir" with "0 running", including ones that were live at the time.
  //
  // lstat rather than existsSync because existsSync follows the link, which would make a
  // dangling enable indistinguishable from no enable at all — precisely how a leftover
  // /var/service/mpd -> /etc/sv/mpd (package never installed) read as simply absent.
  let target: string;
  try {
    target = lstatSync(link).isSymbolicLink() ? readlinkSync(link) : link;
  } catch {
    return { state: "not-enabled", detail: "not in service dir" };
  }

  if (!existsSync(link)) return { state: "failed", detail: `dangling link -> ${target}` };
  if (!existsSync(join(link, "run"))) return { state: "failed", detail: "enabled but no run script" };

  // Authoritative path: `sv status`. Unprivileged first (correct when already root), then a
  // NON-INTERACTIVE sudo, which succeeds whenever credentials are cached and never prompts
  // from inside a report.
  let r = await run(["sv", "status", name]);
  if (r.exitCode !== 0) r = await run(["sudo", "-n", "sv", "status", name]);
  if (r.exitCode === 0) {
    if (r.out.startsWith("run:")) return { state: "running", detail: r.out.split(";")[0] };
    if (r.out.startsWith("down:")) return { state: "stopped", detail: r.out.split(";")[0] };
    return { state: "unknown", detail: r.out };
  }

  // Unprivileged fallback. /run/runit/supervise.<name> is 0700 root:root, but the `runsv`
  // processes themselves are plainly visible in /proc — so state is still recoverable without
  // a password, which matters because `dot doctor` is run casually and constantly.
  //
  // `runsv <name>` present        => runsvdir picked the service up.
  // a child outside SCAFFOLDING   => the service's own process is genuinely up.
  // no such child                 => runsv is retrying ./run, i.e. crash-looping. That is
  //                                  exactly how litellm (run script symlinked into a deleted
  //                                  package) and agentmemory (`env node` unresolvable under
  //                                  runsvdir's PATH=/usr/bin:/usr/sbin) sat broken and
  //                                  completely unreported.
  const sup = await run(["pgrep", "-f", `^runsv ${name}$`]);
  if (sup.exitCode !== 0) return { state: "stopped", detail: "enabled; not picked up by runsvdir" };
  const kids = await run(["ps", "--ppid", sup.out.split("\n")[0]!.trim(), "-o", "comm="]);
  const own = kids.out.split("\n").map((c) => c.trim()).filter((c) => c && !RUNSV_SCAFFOLDING[c]);
  if (own.length > 0) return { state: "running", detail: `${own[0]} (state via /proc, not sv)` };
  return { state: "failed", detail: "supervised but nothing running — ./run is failing" };
}

async function querySystemd(unit: string, scope: "user" | "system"): Promise<{ state: ServiceState; detail: string }> {
  const flag = scope === "user" ? ["--user"] : [];
  const enabled = (await run(["systemctl", ...flag, "is-enabled", unit])).out;
  if (enabled === "not-found" || enabled === "") {
    return { state: "not-enabled", detail: "not installed" };
  }
  const active = (await run(["systemctl", ...flag, "is-active", unit])).out;
  if (active === "active") {
    const detail = enabled === "enabled" ? "" : enabled === "disabled" ? "boot: off" : `boot: ${enabled}`;
    return { state: "running", detail };
  }
  if (active === "failed") {
    return { state: "failed", detail: enabled !== "enabled" ? `boot: ${enabled}` : "" };
  }
  if (enabled === "disabled") return { state: "not-enabled", detail: "disabled" };
  return { state: "stopped", detail: active };
}

async function queryLaunchd(label: string): Promise<{ state: ServiceState; detail: string }> {
  const r = await run(["launchctl", "list", label]);
  if (r.exitCode !== 0) return { state: "not-enabled", detail: "not loaded" };
  const pidLine = r.out.split("\n").find((l) => l.includes("\"PID\""));
  return pidLine && !pidLine.includes("= 0")
    ? { state: "running", detail: "loaded" }
    : { state: "stopped", detail: "loaded, no pid" };
}

/** Resolve live state of every service a package declares for the current init system. */
export async function serviceStatus(pkg: string, init: Init = detectInit() ?? "systemd"): Promise<ServiceInfo[]> {
  const declared = declaredServices(pkg, init);
  return Promise.all(declared.map(async ({ name, scope }) => {
    const q =
      init === "runit" ? await queryRunit(name)
      : init === "systemd" ? await querySystemd(name, scope)
      : await queryLaunchd(name);
    return { pkg, name, init, scope, state: q.state, detail: q.detail };
  }));
}

/** True when the package ships any service unit for the current init system. */
export function hasServices(pkg: string, init: Init = detectInit() ?? "systemd"): boolean {
  return declaredServices(pkg, init).length > 0;
}

/** Generic service enable/start. */
export async function enableService(pkg: string, name: string, init: Init, scope: "user" | "system"): Promise<boolean> {
  logInfo(`Enabling service ${colors.bold(`${pkg}:${name}`)}…`);
  if (init === "systemd") {
    const flag = scope === "user" ? ["--user"] : [];
    const r = await run(["systemctl", ...flag, "enable", "--now", name]);
    if (r.exitCode !== 0) { logError(`Failed to enable ${name}: ${r.out}`); return false; }
  } else if (init === "runit") {
    const r = await run(["sudo", "ln", "-sf", `/etc/sv/${name}`, join(RUNIT_SERVICE_DIR, name)]);
    if (r.exitCode !== 0) { logError(`Failed to link runit service ${name}: ${r.out}`); return false; }
  } else if (init === "launchd") {
    // Standard path for launchd: Library/LaunchAgents (user scope)
    const r = await run(["launchctl", "load", join(process.env.HOME!, "Library/LaunchAgents", `${name}.plist`)]);
    if (r.exitCode !== 0) { logError(`Failed to load launchd agent ${name}: ${r.out}`); return false; }
  }
  return true;
}

/** Generic service disable/stop. */
export async function disableService(pkg: string, name: string, init: Init, scope: "user" | "system"): Promise<boolean> {
  logInfo(`Disabling service ${colors.bold(`${pkg}:${name}`)}…`);
  if (init === "systemd") {
    const flag = scope === "user" ? ["--user"] : [];
    const r = await run(["systemctl", ...flag, "disable", "--now", name]);
    if (r.exitCode !== 0) { logError(`Failed to disable ${name}: ${r.out}`); return false; }
  } else if (init === "runit") {
    const r = await run(["sudo", "rm", "-f", join(RUNIT_SERVICE_DIR, name)]);
    if (r.exitCode !== 0) { logError(`Failed to remove runit service ${name}: ${r.out}`); return false; }
  } else if (init === "launchd") {
    const r = await run(["launchctl", "unload", join(process.env.HOME!, "Library/LaunchAgents", `${name}.plist`)]);
    if (r.exitCode !== 0) { logError(`Failed to unload launchd agent ${name}: ${r.out}`); return false; }
  }
  return true;
}
