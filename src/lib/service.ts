import { existsSync, readdirSync } from "fs";
import { basename, join } from "path";
import { PACKAGES_DIR } from "./config.ts";
import { detectInit } from "./pkg.ts";
import { colors, logInfo, logError } from "./console.ts";

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
 * Service units a package declares, for the given init system.
 * Standard path: system/<init>/... (following agentmemory standard)
 */
export function declaredServices(pkg: string, init: Init): { name: string; scope: "user" | "system" }[] {
  const pkgDir = join(PACKAGES_DIR, pkg);
  const out: { name: string; scope: "user" | "system" }[] = [];

  const addUnits = (dir: string, scope: "user" | "system") => {
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir)) {
      if (f.endsWith(".service") || f.endsWith(".timer") || f.endsWith(".socket") || f.endsWith(".path") || f.endsWith(".mount") || (init === "launchd" && f.endsWith(".plist"))) {
        const name = init === "launchd" ? basename(f, ".plist") : f;
        if (!out.some((x) => x.name === name && x.scope === scope)) {
          out.push({ name, scope });
        }
      }
    }
  };

  if (init === "runit") {
    const svDir = join(pkgDir, "system/runit/etc/sv");
    if (existsSync(svDir)) {
      for (const name of readdirSync(svDir)) out.push({ name, scope: "system" });
    }
  } else if (init === "systemd") {
    addUnits(join(pkgDir, "system/systemd/etc/systemd/user"), "user");
    addUnits(join(pkgDir, "system/systemd/etc/systemd/system"), "system");
  } else if (init === "launchd") {
    addUnits(join(pkgDir, "system/launchd/Library/LaunchAgents"), "user");
  }

  return out;
}

async function run(cmd: string[]): Promise<{ code: number; out: string }> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  return { code, out: (stdout + stderr).trim() };
}

async function queryRunit(name: string): Promise<{ state: ServiceState; detail: string }> {
  const r = await run(["sv", "status", name]);
  if (r.code !== 0) return { state: "not-enabled", detail: "not in service dir" };
  if (r.out.startsWith("run:")) return { state: "running", detail: r.out.split(";")[0] };
  if (r.out.startsWith("down:")) return { state: "stopped", detail: r.out.split(";")[0] };
  return { state: "unknown", detail: r.out };
}

async function querySystemd(unit: string, scope: "user" | "system"): Promise<{ state: ServiceState; detail: string }> {
  const flag = scope === "user" ? ["--user"] : [];
  const enabled = (await run(["systemctl", ...flag, "is-enabled", unit])).out;
  if (enabled === "not-found" || enabled === "") {
    return { state: "not-enabled", detail: "unit not registered" };
  }
  const active = (await run(["systemctl", ...flag, "is-active", unit])).out;
  if (active === "active") return { state: "running", detail: `enabled=${enabled}` };
  if (active === "failed") return { state: "failed", detail: `enabled=${enabled}` };
  if (enabled === "disabled") return { state: "not-enabled", detail: "disabled" };
  return { state: "stopped", detail: `${active}, enabled=${enabled}` };
}

async function queryLaunchd(label: string): Promise<{ state: ServiceState; detail: string }> {
  const r = await run(["launchctl", "list", label]);
  if (r.code !== 0) return { state: "not-enabled", detail: "not loaded" };
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
    if (r.code !== 0) { logError(`Failed to enable ${name}: ${r.out}`); return false; }
  } else if (init === "runit") {
    const r = await run(["sudo", "ln", "-sf", `/etc/sv/${name}`, `/var/service/${name}`]);
    if (r.code !== 0) { logError(`Failed to link runit service ${name}: ${r.out}`); return false; }
  } else if (init === "launchd") {
    // Standard path for launchd: Library/LaunchAgents (user scope)
    const r = await run(["launchctl", "load", join(process.env.HOME!, "Library/LaunchAgents", `${name}.plist`)]);
    if (r.code !== 0) { logError(`Failed to load launchd agent ${name}: ${r.out}`); return false; }
  }
  return true;
}

/** Generic service disable/stop. */
export async function disableService(pkg: string, name: string, init: Init, scope: "user" | "system"): Promise<boolean> {
  logInfo(`Disabling service ${colors.bold(`${pkg}:${name}`)}…`);
  if (init === "systemd") {
    const flag = scope === "user" ? ["--user"] : [];
    const r = await run(["systemctl", ...flag, "disable", "--now", name]);
    if (r.code !== 0) { logError(`Failed to disable ${name}: ${r.out}`); return false; }
  } else if (init === "runit") {
    const r = await run(["sudo", "rm", "-f", `/var/service/${name}`]);
    if (r.code !== 0) { logError(`Failed to remove runit service ${name}: ${r.out}`); return false; }
  } else if (init === "launchd") {
    const r = await run(["launchctl", "unload", join(process.env.HOME!, "Library/LaunchAgents", `${name}.plist`)]);
    if (r.code !== 0) { logError(`Failed to unload launchd agent ${name}: ${r.out}`); return false; }
  }
  return true;
}
