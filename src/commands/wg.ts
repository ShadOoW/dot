import { defineCommand } from "citty";
import { run, spawnInherit } from "../lib/spawn.ts";
import { colors, logError, logInfo, logSection, logSuccess, logWarn } from "../lib/console.ts";

const WG_CONF = "/data/ops/state/wireguard/wg0.conf";
const WG_BIN = "/data/ops/state/wireguard/env/bin/wg";
const BARZAKH_IP = "10.10.0.1";
const BARZAKH_EXIT_IP = "138.201.90.131";

const ALLOWED_FULL = "0.0.0.0/0, ::/0";
const ALLOWED_SPLIT = "10.10.0.0/24";

/** Live AllowedIPs from the kernel via `wg show` — reflects what's actually routing. */
async function getLiveMode(): Promise<"full" | "split" | "down"> {
  const r = await run(["sudo", WG_BIN, "show", "wg0", "allowed-ips"]);
  if (r.exitCode !== 0) return "down";
  if (r.out.includes("0.0.0.0/0")) return "full";
  if (r.out.includes("10.10.0.0/24")) return "split";
  return "down";
}

/** Run a start/stop/restart against the wireguard service on whichever init is active. */
async function svcAction(action: "start" | "stop" | "restart"): Promise<number> {
  const isSystemd = (await run(["test", "-d", "/run/systemd/system"])).exitCode === 0;
  if (isSystemd) return (await spawnInherit(["sudo", "systemctl", action, "wireguard.service"])).exitCode;
  return (await spawnInherit(["sudo", "sv", action, "/var/service/wireguard"])).exitCode;
}

async function isTunnelUp(): Promise<boolean> {
  const r = await run(["ping", "-c", "1", "-W", "3", BARZAKH_IP]);
  return r.exitCode === 0;
}

async function testStatus(): Promise<void> {
  logSection("WireGuard status");

  const up = await isTunnelUp();
  console.log(`  ${up ? colors.green("●") : colors.red("✗")} mesh (${BARZAKH_IP})  ${up ? colors.green("reachable") : colors.red("unreachable")}`);

  if (!up) { console.log(""); return; }

  const mode = await getLiveMode();
  console.log(`  ${colors.dim("mode")}  ${
    mode === "full" ? colors.yellow("full-tunnel") :
    mode === "split" ? colors.green("split-tunnel") :
    colors.red("down / unknown")
  }`);

  if (mode === "full") {
    const r = await run(["curl", "-s", "--max-time", "5", "ifconfig.me"]);
    const ip = r.exitCode === 0 ? r.out.trim() : "timeout";
    const exitOk = ip === BARZAKH_EXIT_IP;
    console.log(`  ${exitOk ? colors.green("✓") : colors.red("✗")} exit IP  ${ip}  ${
      exitOk ? colors.dim("(barzakh)") : colors.red(`expected ${BARZAKH_EXIT_IP} — routing not applied`)
    }`);
  }

  const wgShow = await run(["sudo", WG_BIN, "show", "wg0"]);
  if (wgShow.exitCode === 0) {
    const handshakeLine = wgShow.out.split("\n").find((l) => l.includes("latest handshake"));
    if (handshakeLine) {
      console.log(`  ${colors.dim("handshake")}  ${handshakeLine.split(":").slice(1).join(":").trim()}`);
    }
  }

  console.log("");
}

async function setAllowedIPs(allowed: string): Promise<void> {
  const text = await Bun.file(WG_CONF).text();
  if (!text) throw new Error(`Cannot read ${WG_CONF} — is the config rendered?`);

  // Replace only inside the [Peer] block, ignoring any AllowedIPs in comments
  const peerIdx = text.indexOf("[Peer]");
  if (peerIdx === -1) throw new Error(`No [Peer] block found in ${WG_CONF}`);

  const before = text.slice(0, peerIdx);
  const peer = text.slice(peerIdx);
  const updatedPeer = peer.replace(/^AllowedIPs\s*=\s*.+/m, `AllowedIPs = ${allowed}`);

  if (updatedPeer === peer) {
    // No AllowedIPs in [Peer] block — append it
    const lines = peer.trimEnd().split("\n");
    const withIPs = [...lines, `AllowedIPs = ${allowed}`].join("\n") + "\n";
    await Bun.write(WG_CONF, before + withIPs);
  } else {
    await Bun.write(WG_CONF, before + updatedPeer);
  }
}

async function restartTunnel(): Promise<boolean> {
  logInfo("Restarting WireGuard tunnel…");
  const code = await svcAction("restart");
  if (code !== 0) { logError("Failed to restart wireguard service"); return false; }
  await new Promise((r) => setTimeout(r, 1500));
  return true;
}

export const wgCommand = defineCommand({
  meta: { description: "WireGuard mesh controls — tunnel mode, up/down, status" },
  subCommands: {
    status: defineCommand({
      meta: { description: "Show live tunnel state, mesh reachability, and last handshake" },
      async run() {
        await testStatus();
      },
    }),

    full: defineCommand({
      meta: { description: "Switch to full-tunnel: all traffic exits through barzakh (Germany)" },
      async run() {
        logSection("WireGuard → full-tunnel");

        const liveMode = await getLiveMode();
        if (liveMode === "full") {
          logInfo("Live interface already in full-tunnel mode");
        } else {
          logInfo(`Writing AllowedIPs = ${ALLOWED_FULL}`);
          await setAllowedIPs(ALLOWED_FULL);
          const ok = await restartTunnel();
          if (!ok) process.exit(1);
        }

        await testStatus();

        // Verify exit IP confirms routing is actually applied
        const r = await run(["curl", "-s", "--max-time", "5", "ifconfig.me"]);
        const ip = r.out.trim();
        if (ip === BARZAKH_EXIT_IP) {
          logSuccess(`Full-tunnel active — internet exits via barzakh (${BARZAKH_EXIT_IP})`);
        } else {
          logWarn(`Exit IP is ${ip} — expected ${BARZAKH_EXIT_IP}. Try: dot wg down && dot wg up`);
        }
      },
    }),

    split: defineCommand({
      meta: { description: "Switch to split-tunnel: only mesh (10.10.0.x) goes through barzakh" },
      async run() {
        logSection("WireGuard → split-tunnel");

        const liveMode = await getLiveMode();
        if (liveMode === "split") {
          logInfo("Live interface already in split-tunnel mode");
        } else {
          logInfo(`Writing AllowedIPs = ${ALLOWED_SPLIT}`);
          await setAllowedIPs(ALLOWED_SPLIT);
          const ok = await restartTunnel();
          if (!ok) process.exit(1);
        }

        await testStatus();
        logSuccess("Split-tunnel active — local internet is direct");
      },
    }),

    up: defineCommand({
      meta: { description: "Bring the WireGuard tunnel up (start wireguard service)" },
      async run() {
        logInfo("Starting WireGuard tunnel…");
        const code = await svcAction("start");
        if (code !== 0) { logError("Failed to start wireguard service"); process.exit(1); }
        await new Promise((r) => setTimeout(r, 1500));
        await testStatus();
      },
    }),

    down: defineCommand({
      meta: { description: "Bring the WireGuard tunnel down (stop wireguard service)" },
      async run() {
        logInfo("Stopping WireGuard tunnel…");
        const code = await svcAction("stop");
        if (code !== 0) { logError("Failed to stop wireguard service"); process.exit(1); }
        logSuccess("Tunnel stopped");
      },
    }),
  },
});
