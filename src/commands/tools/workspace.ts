import { defineCommand } from "citty";
import { existsSync, readFileSync } from "fs";
import { isAbsolute, join } from "path";
import { isCancel, select } from "@clack/prompts";
import { HOME_DIR } from "../../lib/config.ts";
import { colors, logError, logInfo, logSuccess, logWarn } from "../../lib/console.ts";
import { buildSessionFile, launchArgv, writeSessionFile, type SessionTab } from "../../lib/kitty-session.ts";
import { notify } from "../../lib/kitty.ts";
import { findByAppIdPrefix, findByMark, swayCommand, WindowSubscription, type SwayNode } from "../../lib/sway.ts";
import { shellEscape } from "../../lib/spawn.ts";

const PROFILES_PATH = join(HOME_DIR, ".config/dot/workspaces.json");
const WAIT_MS = 15000;

interface LeftMember {
  name: string;
  kind: "kitty" | "app";
  /** kitty: shell command for the window; omitted → plain shell. */
  cmd?: string;
  /** app: command line run through `swaymsg exec` (detaches into the sway session). */
  exec?: string;
  /** app: required — the Wayland app_id sway will see (e.g. "insomnia"). */
  appId?: string;
  cwd?: string;
}

interface RightTab {
  title: string;
  cmd?: string;
  cwd?: string;
}

interface Profile {
  description?: string;
  path: string;
  workspace?: number | "current";
  left?: LeftMember[];
  right?: { widthPpt?: number; tabs: RightTab[] };
  env?: Record<string, string>;
}

function loadProfiles(): Record<string, Profile> {
  if (!existsSync(PROFILES_PATH)) {
    logError(`No profiles at ${PROFILES_PATH} — is the sway package linked?`);
    process.exit(1);
  }
  try {
    const parsed = JSON.parse(readFileSync(PROFILES_PATH, "utf-8"));
    return parsed.workspaces ?? {};
  } catch (e) {
    logError(`Failed to parse ${PROFILES_PATH}: ${e}`);
    process.exit(1);
  }
}

function resolveCwd(cwd: string | undefined, base: string): string {
  if (!cwd) return base;
  return isAbsolute(cwd) ? cwd : join(base, cwd);
}

/** `K=V cmd` prefix — applies inside the zsh -c wrapper, so quoting matters. */
function withEnv(env: Record<string, string> | undefined, cmd: string): string {
  const entries = Object.entries(env ?? {});
  if (entries.length === 0) return cmd;
  return `${entries.map(([k, v]) => `${k}=${shellEscape([v])}`).join(" ")} ${cmd}`;
}

function spawnDetached(argv: string[]): void {
  Bun.spawn(argv, { stdout: "ignore", stderr: "ignore", stdin: "ignore" }).unref();
}

function leftAppId(profile: string, member: LeftMember): string | null {
  return member.kind === "app" ? (member.appId ?? null) : `ws-${profile}-${member.name}`;
}

async function waitOrWarn(sub: WindowSubscription, appId: string, what: string): Promise<SwayNode | null> {
  const node = await sub.waitFor(appId, WAIT_MS);
  if (!node) {
    logWarn(`Timed out waiting for ${what} (app_id ${appId}) — continuing`);
    notify("critical", "workspace launcher", `Timed out waiting for ${what}`);
  }
  return node;
}

function rightSessionTabs(profile: Profile): SessionTab[] {
  return (profile.right?.tabs ?? []).map((t) => ({
    title: t.title,
    windows: [
      {
        cwd: resolveCwd(t.cwd, profile.path),
        cmd: t.cmd ? withEnv(profile.env, t.cmd) : undefined,
      },
    ],
  }));
}

async function launchProfile(name: string, profile: Profile, dryRun: boolean): Promise<void> {
  const leftMark = `ws:${name}:left`;
  const rightAppId = `ws-${name}-right`;
  const members = profile.left ?? [];

  if (dryRun) {
    logInfo(`workspace: ${profile.workspace ?? "current"}`);
    if (profile.right) {
      logInfo(`right kitty (${rightAppId}), session file:`);
      console.log(buildSessionFile(rightSessionTabs(profile)));
    }
    for (const m of members) {
      const appId = leftAppId(name, m);
      if (m.kind === "app") {
        logInfo(`left ${m.name}: swaymsg exec ${m.exec} (wait for app_id ${appId})`);
      } else {
        const cwd = resolveCwd(m.cwd, profile.path);
        const cmd = m.cmd ? withEnv(profile.env, m.cmd) : undefined;
        logInfo(`left ${m.name}: kitty --app-id ${appId} --directory ${cwd} ${shellEscape(launchArgv({ cwd, cmd }))}`);
      }
    }
    if (members.length > 1) logInfo(`left members grouped in a tabbed container marked ${leftMark}`);
    return;
  }

  // Idempotency: an existing container from this profile → focus, don't rebuild.
  const existing = (await findByMark(leftMark)) ?? (await findByAppIdPrefix(`ws-${name}-`))[0];
  if (existing) {
    await swayCommand(`[con_id=${existing.id}] focus`);
    logInfo(`Workspace "${name}" already running — focused`);
    return;
  }

  if (profile.workspace != null && profile.workspace !== "current") {
    await swayCommand(`workspace number ${profile.workspace}`);
  }

  // Subscribe before spawning anything so no window event can be missed.
  const sub = await WindowSubscription.open();
  try {
    if (profile.right?.tabs?.length) {
      const file = await writeSessionFile(`ws-${name}-right`, buildSessionFile(rightSessionTabs(profile)));
      spawnDetached(["kitty", "--app-id", rightAppId, "--session", file]);
      await waitOrWarn(sub, rightAppId, "right terminal");
    }

    const useContainer = members.length > 1;
    let firstNode: SwayNode | null = null;
    for (const [i, m] of members.entries()) {
      const appId = leftAppId(name, m);
      if (m.kind === "app") {
        if (!m.exec || !appId) {
          logWarn(`Member "${m.name}" needs exec + appId — skipped`);
          continue;
        }
        // Single-instance apps may surface an existing window instead of a new
        // one; waitFor's tree pre-check adopts it, which is what we want.
        await swayCommand(`exec ${m.exec}`);
      } else {
        const cwd = resolveCwd(m.cwd, profile.path);
        const cmd = m.cmd ? withEnv(profile.env, m.cmd) : undefined;
        spawnDetached(["kitty", "--app-id", appId!, "--directory", cwd, ...launchArgv({ cwd, cmd })]);
      }
      const node = appId ? await waitOrWarn(sub, appId, `left member ${m.name}`) : null;
      if (!node) continue;

      if (!firstNode) {
        firstNode = node;
        if (profile.right?.tabs?.length) await swayCommand(`[con_id=${node.id}] move left`);
        if (useContainer) {
          // Wrap the first window in a container, make it tabbed, mark the
          // container (not the window) so later members can `move to mark`.
          await swayCommand(`[con_id=${node.id}] focus`);
          await swayCommand("splitv");
          await swayCommand("layout tabbed");
          await swayCommand("focus parent");
          await swayCommand(`mark --add ${leftMark}`);
          await swayCommand("focus child");
        }
      } else {
        await swayCommand(`[con_id=${node.id}] move container to mark ${leftMark}`);
      }
      if (i < members.length - 1) await Bun.sleep(150); // let sway settle between insertions
    }

    if (useContainer && firstNode) {
      // Insurance against autotiling-rs having toggled the split mid-build.
      await swayCommand(`[con_mark="${leftMark}"] layout tabbed`);
    }
    if (profile.right?.widthPpt) {
      await swayCommand(`[app_id="${rightAppId}"] resize set width ${profile.right.widthPpt} ppt`);
    }
    if (firstNode) await swayCommand(`[con_id=${firstNode.id}] focus`);
  } finally {
    sub.close();
  }
  logSuccess(`Workspace "${name}" ready`);
}

/** fuzzel toggle convention (see fuzzel-scripts/windows.sh): a second press closes the menu. */
async function pickWithFuzzel(profiles: Record<string, Profile>): Promise<string | null> {
  if (Bun.spawnSync(["pkill", "-x", "fuzzel"]).exitCode === 0) return null;
  const lines = Object.entries(profiles)
    .map(([name, p]) => `${name}: ${p.description ?? p.path}`)
    .join("\n");
  const proc = Bun.spawn(["fuzzel", "--dmenu", "--prompt", "  Workspace  "], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
  });
  proc.stdin.write(lines);
  await proc.stdin.end();
  const out = (await proc.stdout.text()).trim();
  await proc.exited;
  if (!out) return null;
  const name = out.split(":")[0]!.trim();
  return name in profiles ? name : null;
}

export const workspaceCommand = defineCommand({
  meta: { description: "Launch or focus a sway+kitty project workspace" },
  args: {
    name: { type: "positional", description: "Profile name from ~/.config/dot/workspaces.json", required: false },
    pick: { type: "boolean", description: "Choose a profile via fuzzel (sway keybinding entry point)" },
    list: { type: "boolean", description: "List available profiles" },
    "dry-run": { type: "boolean", description: "Print the launch plan without touching sway" },
  },
  async run({ args }) {
    const profiles = loadProfiles();

    if (args.list) {
      for (const [name, p] of Object.entries(profiles)) {
        console.log(`${colors.bold(name)}  ${p.description ?? ""}\n  ${colors.dim(p.path)}`);
      }
      return;
    }

    let name = args.name as string | undefined;
    if (!name && args.pick) {
      name = (await pickWithFuzzel(profiles)) ?? undefined;
      if (!name) return; // toggled closed or dismissed
    }
    if (!name && process.stdin.isTTY) {
      const picked = await select({
        message: "Workspace profile",
        options: Object.entries(profiles).map(([n, p]) => ({ value: n, label: `${n} — ${p.description ?? p.path}` })),
      });
      if (isCancel(picked)) return;
      name = picked as string;
    }
    if (!name) {
      logError("No profile given — use `dot tools workspace <name>`, --pick, or --list");
      process.exit(1);
    }

    const profile = profiles[name];
    if (!profile) {
      logError(`Unknown profile "${name}" — available: ${Object.keys(profiles).join(", ")}`);
      process.exit(1);
    }
    await launchProfile(name, profile, Boolean(args["dry-run"]));
  },
});
