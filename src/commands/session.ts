import { defineCommand } from "citty";
import { confirm, isCancel } from "@clack/prompts";
import { colors, logError, logInfo, logSuccess, logWarn } from "../lib/console.ts";
import { buildSessionFile, writeSessionFile } from "../lib/kitty-session.ts";
import { notify } from "../lib/kitty.ts";
import {
  buildRestorePlan,
  captureManifest,
  claimManifest,
  discardManifest,
  MANIFEST_PATH,
  pendingManifest,
  saveManifest,
  type Manifest,
  type RestorePlan,
} from "../lib/session.ts";
import { swayCommand, WindowSubscription } from "../lib/sway.ts";

function spawnDetached(argv: string[]): void {
  Bun.spawn(argv, { stdout: "ignore", stderr: "ignore", stdin: "ignore" }).unref();
}

function summarize(m: Manifest): void {
  const windows = m.osWindows.reduce((n, o) => n + o.tabs.reduce((t, tab) => t + tab.windows.length, 0), 0);
  const claudes =
    m.osWindows.flatMap((o) => o.tabs.flatMap((t) => t.windows)).filter((w) => w.kind === "claude").length +
    m.claudeUnmatched.length;
  logInfo(`${m.osWindows.length} kitty os-window(s), ${windows} terminal window(s), ${claudes} claude session(s)`);
  for (const osw of m.osWindows) {
    const parts = osw.tabs.flatMap((t) =>
      t.windows.map((w) =>
        w.kind === "claude"
          ? colors.cyan(`${w.claude?.command ?? "claude"}:${w.claude?.name ?? w.claude?.sessionId?.slice(0, 8) ?? "?"}`)
          : w.kind === "command"
            ? (w.command?.slice(0, 3).join(" ") ?? "?")
            : "shell",
      ),
    );
    console.log(`  ws ${osw.workspace ?? "?"}  ${colors.bold(osw.appId)}  ${parts.join(" | ")}`);
  }
  if (m.claudeUnmatched.length > 0) {
    logWarn(`${m.claudeUnmatched.length} claude session(s) not tied to a kitty window — restored in their own window`);
  }
  if (m.skipped.guiWindows.length > 0) {
    logInfo(colors.dim(`GUI windows not restored: ${[...new Set(m.skipped.guiWindows.map((g) => g.appId))].join(", ")}`));
  }
}

function printPlan(plan: RestorePlan): void {
  for (const w of plan.windows) {
    console.log(`${colors.bold(w.appId)} → workspace ${w.workspace ?? "current"}`);
    console.log(buildSessionFile(w.tabs).replace(/^/gm, "  "));
  }
  for (const note of plan.notes) logWarn(note);
}

async function runRestore(manifest: Manifest, claimedPath: string): Promise<void> {
  const plan = buildRestorePlan(manifest);
  for (const note of plan.notes) logWarn(note);

  const sub = await WindowSubscription.open();
  let failures = 0;
  try {
    const ordered = [...plan.windows].sort((a, b) => (a.workspace ?? 99) - (b.workspace ?? 99));
    for (const w of ordered) {
      if (w.workspace != null) await swayCommand(`workspace number ${w.workspace}`);
      const file = await writeSessionFile(w.appId, buildSessionFile(w.tabs));
      spawnDetached(["kitty", "--app-id", w.appId, "--session", file]);
      const node = await sub.waitFor(w.appId, 15000);
      if (!node) {
        logWarn(`Timed out waiting for ${w.appId}`);
        failures++;
        continue;
      }
      // A focus race during startup can land the window elsewhere — pin it.
      if (w.workspace != null) {
        await swayCommand(`[con_id=${node.id}] move container to workspace number ${w.workspace}`);
      }
    }
  } finally {
    sub.close();
  }

  if (manifest.focusedWorkspace != null) await swayCommand(`workspace number ${manifest.focusedWorkspace}`);
  await discardManifest(claimedPath);

  const summary = `${plan.windows.length - failures}/${plan.windows.length} windows, ${plan.claudeCount} claude session(s)`;
  if (failures > 0) {
    notify("critical", "Session restore incomplete", summary);
    logWarn(`Restore incomplete: ${summary}`);
  } else {
    notify("normal", "Session restored", summary);
    logSuccess(`Restored ${summary}`);
  }
}

const saveCommand = defineCommand({
  meta: { description: "Snapshot all kitty windows + claude sessions to the restore manifest" },
  async run() {
    const manifest = await captureManifest();
    await saveManifest(manifest);
    summarize(manifest);
    logSuccess(`Saved to ${MANIFEST_PATH}`);
  },
});

const restartCommand = defineCommand({
  meta: { description: "Snapshot sessions, then reboot — restore runs on next sway login" },
  args: {
    now: { type: "boolean", description: "Skip confirmation" },
  },
  async run({ args }) {
    const manifest = await captureManifest();
    summarize(manifest);
    if (!args.now) {
      const ok = await confirm({ message: "Save this snapshot and reboot now?" });
      if (isCancel(ok) || !ok) {
        logInfo("Aborted — nothing saved");
        return;
      }
    }
    await saveManifest(manifest);
    logSuccess("Snapshot saved — rebooting");
    Bun.spawnSync(["systemctl", "reboot"]);
  },
});

const restoreCommand = defineCommand({
  meta: { description: "Restore the pending snapshot (runs from sway exec on login)" },
  args: {
    "if-pending": { type: "boolean", description: "Exit silently when there is nothing to restore" },
    "dry-run": { type: "boolean", description: "Print the restore plan without launching anything" },
  },
  async run({ args }) {
    if (args["dry-run"]) {
      const manifest = pendingManifest();
      if (!manifest) {
        logInfo("No pending manifest");
        return;
      }
      printPlan(buildRestorePlan(manifest));
      return;
    }
    const claimed = await claimManifest();
    if (!claimed) {
      if (args["if-pending"]) return;
      logError(`No pending manifest at ${MANIFEST_PATH} — run \`dot session save\` first`);
      process.exit(1);
    }
    await runRestore(claimed.manifest, claimed.claimedPath);
  },
});

const statusCommand = defineCommand({
  meta: { description: "Show the pending snapshot, if any" },
  async run() {
    const manifest = pendingManifest();
    if (manifest) {
      logInfo(`Pending snapshot from ${new Date(manifest.savedAt).toLocaleString()}:`);
      summarize(manifest);
    } else {
      logInfo("No pending snapshot");
    }
  },
});

export const sessionCommand = defineCommand({
  meta: { description: "Save open terminal/claude sessions and restore them after a reboot" },
  subCommands: {
    save: saveCommand,
    restart: restartCommand,
    restore: restoreCommand,
    status: statusCommand,
  },
});
